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
    checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
    quitAndInstall: () => ipcRenderer.invoke('quit-and-install'),

    onBackupStarted: (callback) => {
        const listener = () => callback();
        ipcRenderer.on('backup-started', listener);
        return () => ipcRenderer.removeListener('backup-started', listener);
    },
    onBackupProgress: (callback) => {
        const listener = (event, data) => callback(data);
        ipcRenderer.on('backup-progress', listener);
        return () => ipcRenderer.removeListener('backup-progress', listener);
    },
    onBackupCompleted: (callback) => {
        const listener = (event, result) => callback(result);
        ipcRenderer.on('backup-completed', listener);
        return () => ipcRenderer.removeListener('backup-completed', listener);
    },
    onUpdateStatus: (callback) => {
        const listener = (event, data) => callback(data);
        ipcRenderer.on('update-status', listener);
        return () => ipcRenderer.removeListener('update-status', listener);
    }
});