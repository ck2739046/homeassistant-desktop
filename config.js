const Store = require('electron-store');

module.exports = new Store({
  defaults: {
    autoUpdate: false,
    automaticSwitching: true,
    detachedMode: false,
    disableHover: false,
    stayOnTop: false,
    fullScreen: false,
    shortcutEnabled: true,
    shortcutFullscreenEnabled: false,
    allInstances: [],
  },
});
