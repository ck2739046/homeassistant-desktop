import { app, dialog, ipcMain, shell, globalShortcut, screen, Menu, Tray, BrowserWindow, powerMonitor } from "electron";
import AutoLaunch from "auto-launch";
import Positioner from "electron-traywindow-positioner";
import Bonjour from "bonjour-service";
import logger from "electron-log";
import config  from "./config.js";
import semver from "semver";
import http from 'http';
import https from 'https';
import winston from 'winston';
import path from 'path';
const bonjour = new Bonjour.Bonjour();
//scaling options for different app versions
//app.commandLine.appendSwitch('high-dpi-support', 'true');
//app.commandLine.appendSwitch('force-device-scale-factor', 1);

logger.errorHandler.startCatching();
logger.info(`${app.name} started`);
logger.info(`Platform: ${process.platform} ${process.arch}`);

if (process.platform === "darwin") {
  app.dock.hide();
}

const autoLauncher = new AutoLaunch({ name: "Home Assistant Desktop" });

const __dirname = import.meta.dirname;
const indexFile = `file://${__dirname}/web/index.html`;
const errorFile = `file://${__dirname}/web/error.html`;
const sleepFile = `file://${__dirname}/web/sleeping.html`;

let initialized = false;
let autostartEnabled = false;
let forceQuit = false;
let resizeEvent = false;
let mainWindow;
let tray;
let availabilityCheckerInterval;

function registerKeyboardShortcut() {
  globalShortcut.register(config.get("userShortcut"), () => {
    if (mainWindow.isVisible()) {
      mainWindow.hide();
      if (process.platform === "darwin") {
        app.dock.hide();
      }
    } else {
      showWindow();
    }
  });
}

function unregisterKeyboardShortcut() {
  globalShortcut.unregisterAll();
}

async function checkForUpdates() {
  try {
    const apiResponse = await fetch("https://api.github.com/repos/DustyArmstrong/homeassistant-desktop/releases/latest");
    const apiData = await apiResponse.json();
    const latestVersion = apiData.tag_name;
    const currentVersion = app.getVersion();

    if (semver.gt(latestVersion, currentVersion)) {
      const versionMessage = await dialog.showMessageBox({
        type: "question",
        buttons: ["Download", "Not Now"],
        title: "Update Available",
        message: `A new version of Home Assistant Desktop is available (${currentVersion} --> ${latestVersion})`,
      });
      if (versionMessage.response === 0) {
        await shell.openExternal("https://github.com/DustyArmstrong/homeassistant-desktop/releases/latest");
        } 
      }
    } catch (error) {
      logger.error("There was a problem checking for updates");
      logger.error(error);
    }
  }

function checkAutoStart() {
  autoLauncher
    .isEnabled()
    .then((isEnabled) => {
      autostartEnabled = isEnabled;
    })
    .catch((err) => {
      logger.error("There was a problem with application auto start");
      logger.error(err);
    });
}

async function availabilityCheck() {
  const instance = currentInstance();

  if (!instance) {
      return;
  }

  try {
      const statusCode = await getResponse(instance);
      if (statusCode !== 200) {
          logger.error("Instance unavailable: " + statusCode);
          clearInterval(availabilityCheckerInterval);
          availabilityCheckerInterval = null;
          await showError(true);
          if (config.get("autoReconnect") === true) {
            retryAvailabilityCheck();
          }
          if (config.get("automaticSwitching")) {
              checkForAvailableInstance();
          }
      }
  } catch (error) {
    logger.error("Error during availability check:", error);
  }
}

async function getResponse(instance) {
  return new Promise((resolve, reject) => {
      const url = new URL(instance);
      const request = (url.protocol === 'https:' ? https : http).request(`${url.origin}/auth/providers`, (res) => {
          const statusCode = res.statusCode;
          resolve(statusCode);
      });
      request.on("error", (error) => {
          reject(error);
      });
      request.end();
  });
}

async function retryAvailabilityCheck() {
  const instance = currentInstance();
  let retryCount = 0;
  const maxRetries = 5;
  let retryData;
  while (retryCount <= maxRetries) {
      try {
          const statusCode = await getResponse(instance);
          if (statusCode !== 200) {
            if (retryCount === 5) {
              logger.error(`Cannot automatically connect to instance.`);
              retryData = "Unable to connect to instance!";
              mainWindow.webContents.send('retry-update', retryData);
            } else {
              logger.error(`Instance unavailable. Retry ${retryCount}...`);
              retryData = `Trying to reconnect ${retryCount} of ${maxRetries}`;
              mainWindow.webContents.send('retry-update', retryData);
              await new Promise(resolve => setTimeout(resolve, 4000));
            }
          } else {
              logger.info("Automatic reconnection successful!");
              mainWindow.webContents.send('retry-success', "Instance alive, reconnecting.");
              await reinitMainWindow();
          }
      } catch (error) {
          logger.error('Error trying to reconnect:', error);
          retryData = "Connection to instance failed.";
          mainWindow.webContents.send('retry-error', retryData);
      }
      retryCount++;
  }
}

function changePosition() {
  const trayBounds = tray.getBounds();
  const windowBounds = mainWindow.getBounds();
  const displayWorkArea = screen.getDisplayNearestPoint({
    x: trayBounds.x,
    y: trayBounds.y,
  }).workArea;
  const taskBarPosition = Positioner.getTaskbarPosition(trayBounds);

  if (taskBarPosition === "top" || taskBarPosition === "bottom") {
    const alignment = {
      x: "center",
      y: taskBarPosition === "top" ? "up" : "down",
    };

    if (trayBounds.x + (trayBounds.width + windowBounds.width) / 2 < displayWorkArea.width) {
      Positioner.position(mainWindow, trayBounds, alignment);
    } else {
      const { y } = Positioner.calculate(mainWindow.getBounds(), trayBounds, alignment);

      mainWindow.setPosition(
        displayWorkArea.width - windowBounds.width + displayWorkArea.x,
        y + (taskBarPosition === "bottom" && displayWorkArea.y),
        false
      );
    }
  } else {
    const alignment = {
      x: taskBarPosition,
      y: "center",
    };

    if (trayBounds.y + (trayBounds.height + windowBounds.height) / 2 < displayWorkArea.height) {
      const { x, y } = Positioner.calculate(mainWindow.getBounds(), trayBounds, alignment);
      mainWindow.setPosition(x + (taskBarPosition === "right" && displayWorkArea.x), y);
    } else {
      const { x } = Positioner.calculate(mainWindow.getBounds(), trayBounds, alignment);
      mainWindow.setPosition(x, displayWorkArea.y + displayWorkArea.height - windowBounds.height, false);
    }
  }
}

async function checkForAvailableInstance() {
  const instances = config.get("allInstances");

  if (instances?.length > 1) {
    bonjour.find({ type: "home-assistant" }, (instance) => {
      if (instance.txt.internal_url && instances.indexOf(instance.txt.internal_url) !== -1) {
        return currentInstance(instance.txt.internal_url);
      }

      if (instance.txt.external_url && instances.indexOf(instance.txt.external_url) !== -1) {
        return currentInstance(instance.txt.external_url);
      }
    });
    let found;
    for (const instance of instances.filter((e) => e.url !== currentInstance())) {
      const statusCode = await getResponse(instance);
      if (statusCode === 200) {
        found = instance;
      };
      if (found) {
        currentInstance(found);
        break;
      }
    }
  }
}

async function getBonjourResult(instances) {
  return new Promise((resolve) => {
    const foundInstances = [];
    
    bonjour.find({ type: "home-assistant" }, (instance) => {
      if (instance.txt.internal_url && instances.indexOf(instance.txt.internal_url) === -1) {
        foundInstances.push(instance.txt.internal_url);
      }
      if (instance.txt.external_url && instances.indexOf(instance.txt.external_url) === -1) {
        foundInstances.push(instance.txt.external_url);
      }
    });
    setTimeout(() => {
      resolve(foundInstances);
    }, 1500);
  });
}

function getMenu() {
  const instancesMenu = [
    {
      label: "Open in Browser",
      enabled: currentInstance(),
      click: async () => {
        await shell.openExternal(currentInstance());
      },
    },
    {
      type: "separator",
    },
  ];

  const allInstances = config.get("allInstances");

  if (allInstances) {
    allInstances.forEach((e) => {
      instancesMenu.push({
        label: e,
        type: "checkbox",
        checked: currentInstance() === e,
        click: async () => {
          currentInstance(e);
          await mainWindow.loadURL(e);
          mainWindow.show();
        },
      });
    });

    instancesMenu.push(
      {
        type: "separator",
      },
      {
        label: "Add another Instance...",
        click: async () => {
          config.delete("currentInstance");
          await mainWindow.loadURL(indexFile);
          mainWindow.show();
        },
      },
      {
        label: "Automatic Switching",
        type: "checkbox",
        enabled: config.has("allInstances") && config.get("allInstances").length > 1,
        checked: config.get("automaticSwitching"),
        click: () => {
          config.set("automaticSwitching", !config.get("automaticSwitching"));
        },
      }
    );
  } else {
    instancesMenu.push({ label: "Not Connected...", enabled: false });
  }

  return Menu.buildFromTemplate([
    {
      label: "Show/Hide Window",
      visible: process.platform === "linux",
      click: () => {
        if (mainWindow.isVisible()) {
          mainWindow.hide();
        } else {
          showWindow();
        }
      },
    },
    {
      visible: process.platform === "linux",
      type: "separator",
    },
    ...instancesMenu,
    {
      type: "separator",
    },
    {
      label: "Hover to Show",
      visible: process.platform !== "linux" && !config.get("detachedMode"),
      enabled: !config.get("detachedMode"),
      type: "checkbox",
      checked: !config.get("disableHover"),
      click: () => {
        config.set("disableHover", !config.get("disableHover"));
      },
    },
    {
      label: "Stay on Top",
      type: "checkbox",
      checked: config.get("stayOnTop"),
      click: () => {
        config.set("stayOnTop", !config.get("stayOnTop"));
        mainWindow.setAlwaysOnTop(config.get("stayOnTop"));

        if (mainWindow.isAlwaysOnTop()) {
          showWindow();
        }
      },
    },
    {
      label: "Start at Login",
      type: "checkbox",
      checked: autostartEnabled,
      click: () => {
        if (autostartEnabled) {
          autoLauncher.disable();
        } else {
          autoLauncher.enable();
        }

        checkAutoStart();
      },
    },
    {
      label: "Shortcuts",
      submenu: [
        {
          label: "Select Shortcut",
          submenu: [
            {
              label: "CommandOrControl+Alt+X",
              type: "radio",
              checked: config.get("userShortcut") === "CommandOrControl+Alt+X",
              click: () => {
                config.set("userShortcut", "CommandOrControl+Alt+X");
                unregisterKeyboardShortcut();
                registerKeyboardShortcut();
              },
            },
            {
              label: "CommandOrControl+Alt+Y",
              type: "radio",
              checked: config.get("userShortcut") === "CommandOrControl+Alt+Y",
              click: () => {
                config.set("userShortcut", "CommandOrControl+Alt+Y");
                unregisterKeyboardShortcut();
                registerKeyboardShortcut();
              },
            },
            {
              label: "CommandOrControl+Alt+Z",
              type: "radio",
              checked: config.get("userShortcut") === "CommandOrControl+Alt+Z",
              click: () => {
                config.set("userShortcut", "CommandOrControl+Alt+Z");
                unregisterKeyboardShortcut();
                registerKeyboardShortcut();
              },
            }
          ]
        },
        {
          label: "Enable Shortcut",
          type: "checkbox",
          accelerator: config.get("userShortcut"),
          checked: config.get("shortcutEnabled"),
          click: () => {
            const isEnabled = config.get("shortcutEnabled");
            config.set("shortcutEnabled", !isEnabled);

            if (!isEnabled) {
              registerKeyboardShortcut();
            } else {
              unregisterKeyboardShortcut();
            }
          },
        }
      ]
    },
    {
      label: "Appearance",
      submenu: [
        {
          label: "Tray Icon",
          submenu: [
            {
              label: "White",
              type: "radio",
              checked: config.get("userTrayIcon") === (process.platform === 'darwin' ? "IconTemplate.png" : "IconWin.png"),
              click: () => {
                if (process.platform === 'darwin') {
                  changeIcon("IconTemplate.png");
                } else {
                  changeIcon("IconWin.png");
                }
              }
            },
            {
              label: "Blue",
              type: "radio",
              checked: config.get("userTrayIcon") === "IconWinAlt.png",
              click: () => changeIcon("IconWinAlt.png"),
            },
            {
              label: "Black",
              type: "radio",
              checked: config.get("userTrayIcon") === "IconWinBlack.png",
              click: () => changeIcon("IconWinBlack.png"),
            },
          ]
        }
      ]
    },
    {
      type: "separator",
    },
    {
      label: "Use detached Window",
      type: "checkbox",
      checked: config.get("detachedMode"),
      click: async () => {
        config.set("detachedMode", !config.get("detachedMode"));
        mainWindow.hide();
        await createMainWindow(config.get("detachedMode"));
      },
    },
    {
      label: "Use Fullscreen",
      type: "checkbox",
      checked: config.get("fullScreen"),
      click: () => {
        toggleFullScreen();
      },
    },
    {
      label: "Enable Fullscreen Shortcut",
      type: "checkbox",
      accelerator: "CommandOrControl+Alt+Return",
      checked: config.get("shortcutFullscreenEnabled"),
      click: () => {
        const isEnabled = config.get("shortcutFullscreenEnabled");
        config.set("shortcutFullscreenEnabled", !isEnabled);
        if (!isEnabled) {
          globalShortcut.register("CommandOrControl+Alt+Return", () => {
            toggleFullScreen();
          });
        } else {
          globalShortcut.unregister("CommandOrControl+Alt+Return");
        }
      },
    },
    {
      type: "separator",
    },
    {
      label: `v${app.getVersion()}`,
      enabled: false,
    },
    {
      label: "Check for Updates",
      click: async () => {
        checkForUpdates();
      },
    },
    {
      label: "Enable Update Check on Startup",
      type: "checkbox",
      checked: config.get("autoUpdate"),
      click: async () => {
        config.set("autoUpdate", !config.get("autoUpdate"));
      },
    },
    {
      label: "Enable Automatic Reconnect",
      type: "checkbox",
      checked: config.get("autoReconnect"),
      click: async () => {
        config.set("autoReconnect", !config.get("autoReconnect"));
      },
    },
    {
      label: "Open on github.com",
      click: async () => {
        await shell.openExternal("https://github.com/DustyArmstrong/homeassistant-desktop");
      },
    },
    {
      type: "separator",
    },
    {
      label: "Restart Application",
      click: () => {
        app.relaunch();
        app.exit();
      },
    },
    {
      label: "⚠️ Reset Application",
      click: () => {
        dialog
          .showMessageBox({
            message: "Are you sure you want to reset Home Assistant Desktop?",
            buttons: ["Reset Everything!", "Reset Windows", "Cancel"],
          })
          .then(async (res) => {
            if (res.response !== 2) {
              if (res.response === 0) {
                config.clear();
                await mainWindow.webContents.session.clearCache();
                await mainWindow.webContents.session.clearStorageData();
              } else {
                config.delete("windowSizeDetached");
                config.delete("windowSize");
                config.delete("windowPosition");
                config.delete("fullScreen");
                config.delete("detachedMode");
              }

              app.relaunch();
              app.exit();
            }
          });
      },
    },
    {
      type: "separator",
    },
    {
      label: "Quit",
      click: () => {
        forceQuit = true;
        app.quit();
      },
    },
  ]);
}

async function createMainWindow(show = false) {
  logger.info("Initialized main window");

  const w = 400;
  const h = 500;

  mainWindow = new BrowserWindow({
    width: w,
    height: h,
    minWidth: w,
    minHeight: h,
    maxWidth: w,
    maxHeight: h,
    resizable: false,
    show: false,
    skipTaskbar: !show,
    autoHideMenuBar: true,
    frame: config.get("detachedMode") && process.platform !== "darwin",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'web', 'preload.cjs'),
    },
  });

  //mainWindow.webContents.openDevTools();
  try {
    await mainWindow.loadURL(indexFile);
  } catch (error) {
    logger.info(error);
  }

  createTray();

  mainWindow.webContents.on('render-process-gone', (event, detailed) => {
    logger.error("Renderer dead, reason: " + detailed.reason);
    if (detailed.reason === 'crashed') {
        mainWindow.webContents.reload();
        logger.info("Renderer rebooted successfully.");
     }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.webContents.on("did-finish-load", async function () {
    await mainWindow.webContents.insertCSS("::-webkit-scrollbar { display: none; } body { -webkit-user-select: none; }");

    if (config.get("detachedMode") && process.platform === "darwin") {
      await mainWindow.webContents.insertCSS("body { -webkit-app-region: drag; }");
    }
  });

  if (config.get("detachedMode")) {
    if (config.has("windowPosition")) {
      mainWindow.setSize(...config.get("windowSizeDetached"));
    } else {
      config.set("windowPosition", mainWindow.getPosition());
    }

    if (config.has("windowSizeDetached")) {
      mainWindow.setPosition(...config.get("windowPosition"));
    } else {
      config.set("windowSizeDetached", mainWindow.getSize());
    }
  } else if (config.has("windowSize")) {
    mainWindow.setSize(...config.get("windowSize"));
  } else {
    config.set("windowSize", mainWindow.getSize());
  }

  mainWindow.on("resize", (e) => {

    if (mainWindow.isFullScreen()) {
      return e;
    }

    if (!config.get("disableHover") || resizeEvent) {
      config.set("disableHover", true);
      resizeEvent = e;
      setTimeout(() => {
        if (resizeEvent === e) {
          config.set("disableHover", false);
          resizeEvent = false;
        }
      }, 600);
    }

    if (config.get("detachedMode")) {
      config.set("windowSizeDetached", mainWindow.getSize());
    } else {
      if (process.platform !== "linux") {
        changePosition();
      }

      config.set("windowSize", mainWindow.getSize());
    }
  });

  mainWindow.on("move", () => {
    if (config.get("detachedMode")) {
      config.set("windowPosition", mainWindow.getPosition());
    }
  });

  mainWindow.on("close", (e) => {
    if (!forceQuit) {
      mainWindow.hide();
      e.preventDefault();
    }
  });

  mainWindow.on("blur", () => {
    if (!config.get("detachedMode") && !mainWindow.isAlwaysOnTop()) {
      mainWindow.hide();
    }
  });

  mainWindow.setAlwaysOnTop(!!config.get("stayOnTop"));

  if (initialized && (mainWindow.isAlwaysOnTop() || show)) {
    showWindow();
  }

  toggleFullScreen(!!config.get("fullScreen"));

  initialized = true;
}

async function reinitMainWindow() {
  logger.info("Re-initialized main window");
  mainWindow.destroy();
  mainWindow = null;
  await createMainWindow(!config.has("currentInstance"));

  if (!availabilityCheckerInterval) {
    logger.info("Re-initialized availability check");
    availabilityCheckerInterval = setInterval(availabilityCheck, 3000);
  }
}

function showWindow() {
  if (!config.get("detachedMode")) {
    changePosition();
  }

  if (!mainWindow.isVisible()) {
    mainWindow.setVisibleOnAllWorkspaces(true);
    mainWindow.show();
    mainWindow.focus();
    mainWindow.setVisibleOnAllWorkspaces(false);
    mainWindow.setSkipTaskbar(!config.get("detachedMode"));
  }
}

function createTray() {
  if (tray instanceof Tray) {
    return;
  }

  logger.info("Initialized Tray menu");
  const iconName = config.get("userTrayIcon");
  tray = new Tray(
    ["win32", "linux"].includes(process.platform) ? `${__dirname}/assets/${iconName}` : `${__dirname}/assets/${iconName}`
  );

  tray.on("click", () => {
    if (mainWindow.isVisible()) {
      mainWindow.hide();

      if (process.platform === "darwin") {
        app.dock.hide();
      }
    } else {
      showWindow();
    }
  });

  tray.on("right-click", () => {
    if (!config.get("detachedMode")) {
      mainWindow.hide();
    }

    tray.popUpContextMenu(getMenu());
  });

  let timer = undefined;

  tray.on("mouse-move", () => {
    if (config.get("detachedMode") || mainWindow.isAlwaysOnTop() || config.get("disableHover")) {
      return;
    }

    if (!mainWindow.isVisible()) {
      showWindow();
    }

    if (timer) {
      clearTimeout(timer);
    }

    timer = setTimeout(() => {
      const mousePos = screen.getCursorScreenPoint();
      const trayBounds = tray.getBounds();

      if (
        !(mousePos.x >= trayBounds.x && mousePos.x <= trayBounds.x + trayBounds.width) ||
        !(mousePos.y >= trayBounds.y && mousePos.y <= trayBounds.y + trayBounds.height)
      ) {
        setWindowFocusTimer();
      }
    }, 100);
  });
}

function changeIcon(iconName) {
  config.set("userTrayIcon", iconName);
  tray.setImage(
    ["win32", "linux"].includes(process.platform) ? `${__dirname}/assets/${iconName}` : `${__dirname}/assets/${iconName}`
  );
  logger.info(`Changed tray icon to ${iconName}`);
}

function setWindowFocusTimer() {
  setTimeout(() => {
    const mousePos = screen.getCursorScreenPoint();
    const windowPosition = mainWindow.getPosition();
    const windowSize = mainWindow.getSize();

    if (
      !resizeEvent &&
      (!(mousePos.x >= windowPosition[0] && mousePos.x <= windowPosition[0] + windowSize[0]) ||
        !(mousePos.y >= windowPosition[1] && mousePos.y <= windowPosition[1] + windowSize[1]))
    ) {
      mainWindow.hide();
    } else {
      setWindowFocusTimer();
    }
  }, 110);
}

function toggleFullScreen(mode = !mainWindow.isFullScreen()) {
  config.set("fullScreen", mode);
  mainWindow.setFullScreen(mode);

  if (mode) {
    mainWindow.setAlwaysOnTop(true);
  } else {
    mainWindow.setAlwaysOnTop(config.get("stayOnTop"));
  }
}

function currentInstance(url = null) {
  if (url) {
    config.set("currentInstance", config.get("allInstances").indexOf(url));
  }

  if (config.has("currentInstance")) {
    return config.get("allInstances")[config.get("currentInstance")];
  }

  return false;
}

function addInstance(url) {
  if (!config.has("allInstances")) {
    config.set("allInstances", []);
  }

  const instances = config.get("allInstances");

  if (instances.find((e) => e === url)) {
    currentInstance(url);

    return;
  }

  if (!instances.length) {
    config.set("disableHover", false);
  }

  instances.push(url);
  config.set("allInstances", instances);
  currentInstance(url);
}

async function showError(isError) {
  if (!isError && mainWindow.webContents.getURL().includes("error.html")) {
    await mainWindow.loadURL(indexFile);
  }

  if (isError && currentInstance() && !mainWindow.webContents.getURL().includes("error.html")) {
    await mainWindow.loadURL(errorFile);
  }
}

let sleepHandled = false;
let resumeHandled = false;

powerMonitor.on('suspend', () => {
  if (!sleepHandled) {
    logger.info("Home Assistant going to sleep.");
    mainWindow.loadURL(sleepFile);
    clearInterval(availabilityCheckerInterval);
    availabilityCheckerInterval = null;
    sleepHandled = true;
  }
});

powerMonitor.on('resume', async () => {
  if (!resumeHandled) {
    logger.info("Power state resumed, re-launching...");
    const instance = currentInstance();
    const maxRetries = 2;
    let attempts = 0;

    while (attempts < maxRetries) {
      try {
        const statusCode = await getResponse(instance);
        if (statusCode === 200) {
          app.relaunch();
          app.exit();
          return;
        }
      } catch {
      }
      attempts++;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    logger.error("Network wasn't ready, retrying...");
    app.relaunch();
    app.exit();
    resumeHandled = true;
  }
});

powerMonitor.on('shutdown', () => {
  logger.info("shutdown initiated, quitting...");
  clearInterval(availabilityCheckerInterval);
  availabilityCheckerInterval = null;
  app.quit();
});

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, _commandLine, _workingDirectory) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

  app.whenReady().then(async () => {
    checkAutoStart();
    sleepHandled = false;
    resumeHandled = false;

    await createMainWindow(!config.has("currentInstance"));

    if (config.get("autoUpdate") === true) {
      checkForUpdates();
    }

    if (process.platform === "linux") {
      tray.setContextMenu(getMenu());
    }

    if (!availabilityCheckerInterval) {
      logger.info("Initialized availability check");
      availabilityCheckerInterval = setInterval(availabilityCheck, 3000);
    }

    if (config.get("shortcutEnabled")) {
      registerKeyboardShortcut();
    }

    if (config.get("shortcutFullscreenEnabled")) {
      globalShortcut.register("CommandOrControl+Alt+Return", () => {
        toggleFullScreen();
      });
    }

    if (!config.has("currentInstance")) {
      config.set("disableHover", true);
    }

    if (!config.has("autoUpdate")) {
      config.set("autoUpdate", true);
    }
  });

app.on("will-quit", () => {
  unregisterKeyboardShortcut();
});

app.on("window-all-closed", () => {
  // if (process.platform !== 'darwin') {
  //   app.quit();
  // }
});

ipcMain.on("get-instances", async (event) => {
  const instances = await getBonjourResult(config.get("allInstances") || []);
  event.reply("receive-instances", instances);
});

ipcMain.on("get-ha-instance", (event, url) => {
  if (url) {
    addInstance(url);
  }

  if (currentInstance()) {
    event.reply("receive-ha-instance", currentInstance());
  }
});

ipcMain.on("reconnect", async () => {
  await reinitMainWindow();
});

ipcMain.on("restart", () => {
  app.relaunch();
  app.exit();
});
