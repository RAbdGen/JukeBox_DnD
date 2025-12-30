const { contextBridge, ipcRenderer } = require('electron');

// Exposer des APIs sécurisées au renderer process
contextBridge.exposeInMainWorld('electronAPI', {
    // Exemple d'API pour la communication avec le main process
    // send: (channel, data) => {
    //   ipcRenderer.send(channel, data);
    // },
    // receive: (channel, func) => {
    //   ipcRenderer.on(channel, (event, ...args) => func(...args));
    // }
});

// Exposer Howler si nécessaire
// Note: Howler sera importé directement dans le renderer process via le bundler
