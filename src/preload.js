const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    selectFiles: () => ipcRenderer.invoke('select-files'),
    selectFolders: () => ipcRenderer.invoke('select-folders'),
    selectDestination: () => ipcRenderer.invoke('select-destination'),
    executeBackup: (payload) => ipcRenderer.invoke('execute-backup', payload),

    getAppState: () => ipcRenderer.invoke('get-app-state'),
    saveAppState: (data) => ipcRenderer.invoke('save-app-state', data),

    getAutoLaunch: () => ipcRenderer.invoke('get-auto-launch'),
    setAutoLaunch: (enable) => ipcRenderer.invoke('set-auto-launch', enable),

    configureSchedule: (settings) => ipcRenderer.invoke('configure-schedule', settings),

    onBackupStarted: (callback) => {
            ipcRenderer.removeAllListeners('backup-started');
            ipcRenderer.on('backup-started', () => callback());
        },
        onBackupProgress: (callback) => {
            ipcRenderer.removeAllListeners('backup-progress');
            ipcRenderer.on('backup-progress', (event, data) => callback(data));
        },
        onBackupCompleted: (callback) => {
            ipcRenderer.removeAllListeners('backup-completed');
            ipcRenderer.on('backup-completed', (event, result) => callback(result));
        }
});