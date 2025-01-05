//const Store = require('electron-store');
import Store from 'electron-store';

const store = new Store({
  defaults: {
    autoUpdate: false,
    automaticSwitching: true,
    detachedMode: false,
    disableHover: false,
    stayOnTop: false,
    fullScreen: false,
    shortcutEnabled: true,
    shortcutFullscreenEnabled: false,
    userShortcut: "CommandOrControl+Alt+X",
    allInstances: [],
  },
});

export default store;