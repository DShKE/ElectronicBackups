const { app, BrowserWindow, ipcMain, dialog, Tray, Menu, nativeImage, powerMonitor } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow = null;
let tray = null;
let isQuitting = false;
let autoBackupTimer = null;
let isBackingUp = false;

if (require('electron-squirrel-startup')) {
    const cmd = process.argv[1];
    if (cmd === '--squirrel-uninstall') cleanUpUserData();
    app.quit();
}

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
    app.quit();
} else {
    app.on('second-instance', () => {
        showWindow();
    });
}

function cleanUpUserData() {
    try {
        app.setLoginItemSettings({ openAtLogin: false });
        const userDataPath = app.getPath('userData');
        if (fs.existsSync(userDataPath)) {
            fs.rmSync(userDataPath, { recursive: true, force: true });
        }
    } catch (err) {
        console.error('Failed to clean up user data during uninstall:', err);
    }
}

const iconpath = path.join(__dirname, '../assets/icon.jpg');
const configFilePath = path.join(app.getPath('userData'), 'app-state.json');

function loadState() {
    try {
        if (fs.existsSync(configFilePath)) {
            const raw = fs.readFileSync(configFilePath, 'utf8');
            return JSON.parse(raw);
        }
    } catch (err) {
        console.error('Failed to load state, resetting to default:', err);
    }
    return {
        queue: [],
        schedule: { enabled: false, intervalValue: 1, intervalUnit: 'hours' },
        lastBackupTime: null
    };
}

function saveState(data) {
    try {
        const current = loadState();
        const updated = {
            ...current,
            ...data,
            schedule: {
                ...current.schedule,
                ...(data.schedule || {})
            }
        };
        const tempPath = `${configFilePath}.tmp`;

        fs.writeFileSync(tempPath, JSON.stringify(updated, null, 2), 'utf8');
        fs.renameSync(tempPath, configFilePath);
    } catch (err) {
        console.error('Failed to save state atomically:', err);
    }
}

function showWindow() {
    if (!mainWindow || mainWindow.isDestroyed()) {
        createWindow();
    } else {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
    }
}

function destroyWindow() {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.destroy();
        mainWindow = null;
    }
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 900,
        height: 700,
        minWidth: 750,
        minHeight: 550,
        title: 'ElectronicBackups',
        icon: iconpath,
        backgroundColor: '#0f172a',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true
        }
    });

    mainWindow.removeMenu();
    mainWindow.loadFile(path.join(__dirname, 'index.html'));

    mainWindow.on('close', (event) => {
        if (!isQuitting) {
            event.preventDefault();
            destroyWindow();
        }
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

function createTrayIcon() {
    tray = new Tray(nativeImage.createFromPath(iconpath));
    tray.setToolTip('ElectronicBackups');

    const contextMenu = Menu.buildFromTemplate([
        { label: 'Open ElectronicBackups', click: () => { showWindow(); } },
        {
            label: 'Run Backup Now',
            click: () => { executeBackup(); }
        },
        { type: 'separator' },
        { label: 'Exit', click: () => { isQuitting = true; app.quit(); } }
    ]);

    tray.setContextMenu(contextMenu);
    tray.on('double-click', () => { showWindow(); });
}

function sendToUI(channel, data) {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isLoading()) {
        mainWindow.webContents.send(channel, data);
    }
}

function getIntervalMs(value, unit) {
    const multipliers = {
        minutes: 60 * 1000,
        hours: 60 * 60 * 1000,
        days: 24 * 60 * 60 * 1000
    };
    
    const multiplier = multipliers[unit] || (60 * 1000);
    const MAX_TIMEOUT = 2147483647; 
    return Math.min(MAX_TIMEOUT, Math.max(1, value) * multiplier);
}

async function executeBackup(queueSource = null) {
    if (isBackingUp) return { success: false, error: 'Backup process already running' };

    if (queueSource) {
        saveState({ queue: queueSource });
    }
    const queue = loadState().queue;
    if (!queue || queue.length === 0) {
        return { success: false, error: 'Queue is empty' };
    }
    if (queue.some(item => !item.destination)) {
        return { success: false, error: 'Some items missing target destination' };
    }

    isBackingUp = true;
    sendToUI('backup-started');

    try {
        const fileList = [];
        async function collectFiles(sourcePath, baseDir, targetDestination) {
            const absSource = path.resolve(sourcePath);
            const absDest = path.resolve(targetDestination);

            if (absDest.startsWith(absSource + path.sep) || absDest === absSource) {
                return; 
            }

            const stats = await fs.promises.lstat(absSource);
            if (stats.isSymbolicLink()) return;

            if (stats.isDirectory()) {
                const entries = await fs.promises.readdir(absSource);
                for (const entry of entries) {
                    await collectFiles(path.join(absSource, entry), baseDir, targetDestination);
                }
            } else if (stats.isFile()) {
                fileList.push({
                    absolutePath: absSource,
                    relativePath: path.relative(baseDir, absSource),
                    destination: targetDestination
                });
            }
        }

        for (const item of queue) {
            try {
                const stats = await fs.promises.stat(item.path);
                if (stats.isDirectory()) {
                    const parentDir = path.dirname(item.path);
                    await collectFiles(item.path, parentDir, item.destination);
                } else if (stats.isFile()) {
                    fileList.push({
                        absolutePath: item.path,
                        relativePath: path.basename(item.path),
                        destination: item.destination
                    });
                }
            } catch (err) {
                console.warn(`Skipping unreadable source path: ${item.path}`, err);
            }
        }

        const totalFiles = fileList.length;
        if (totalFiles === 0) {
            isBackingUp = false;
            const res = { success: true, filesCopied: 0, lastBackupTime: new Date().toISOString() };
            sendToUI('backup-completed', res);
            return res;
        }

        let copiedCount = 0;
        for (let index = 0; index < totalFiles; index++) {
            const item = fileList[index];
            const targetFilePath = path.join(item.destination, item.relativePath);
            const targetDir = path.dirname(targetFilePath);

            try {
                const targetRoot = path.parse(targetDir).root;
                if (!fs.existsSync(targetRoot)) {
                    console.warn(`Skipping file: Target drive ${targetRoot} is unplugged/unavailable.`);
                    
                    const percent = Math.round(((index + 1) / totalFiles) * 100);
                    sendToUI('backup-progress', {
                        current: index + 1,
                        total: totalFiles,
                        percentage: percent,
                        filename: item.relativePath
                    });
                    
                    continue;
                }

                const isRoot = (targetDir === targetRoot);
                if (!isRoot && !fs.existsSync(targetDir)) {
                    await fs.promises.mkdir(targetDir, { recursive: true });
                }

                let shouldCopy = true;
                try {
                    const sourceStats = await fs.promises.stat(item.absolutePath);
                    if (fs.existsSync(targetFilePath)) {
                        const targetStats = await fs.promises.stat(targetFilePath);
                        if (sourceStats.size === targetStats.size && 
                            Math.floor(sourceStats.mtimeMs) <= Math.floor(targetStats.mtimeMs)) {
                            shouldCopy = false;
                        }
                    }
                } catch {
                    shouldCopy = true;
                }

                if (shouldCopy) {
                    await fs.promises.copyFile(item.absolutePath, targetFilePath);
                    copiedCount++;
                }
            } catch (fileErr) {
                console.warn(`Failed to process file ${item.absolutePath}:`, fileErr.message);
            }

            const percent = Math.round(((index + 1) / totalFiles) * 100);
            sendToUI('backup-progress', {
                current: index + 1,
                total: totalFiles,
                percentage: percent,
                filename: item.relativePath
            });
        }

        const nowIso = new Date().toISOString();
        saveState({ lastBackupTime: nowIso });

        const result = { success: true, filesCopied: copiedCount, lastBackupTime: nowIso };
        sendToUI('backup-completed', result);
        isBackingUp = false;
        return result;

    } catch (err) {
        isBackingUp = false;
        const failure = { success: false, error: err.message };
        sendToUI('backup-completed', failure);
        return failure;
    } finally {
        scheduleNextBackup();
    }
}

function scheduleNextBackup() {
    if (autoBackupTimer) {
        clearTimeout(autoBackupTimer);
        autoBackupTimer = null;
    }

    const state = loadState();
    if (!state.schedule || !state.schedule.enabled) return;

    const intervalMs = getIntervalMs(state.schedule.intervalValue, state.schedule.intervalUnit);
    autoBackupTimer = setTimeout(async () => {
        await executeBackup();
    }, intervalMs);
}

function evaluateSchedule() {
    if (autoBackupTimer) {
        clearTimeout(autoBackupTimer);
        autoBackupTimer = null;
    }
    const state = loadState();
    if (!state.schedule || !state.schedule.enabled) return;
    const intervalMs = getIntervalMs(state.schedule.intervalValue, state.schedule.intervalUnit);
    if (state.lastBackupTime) {
        const elapsed = Date.now() - new Date(state.lastBackupTime).getTime();
        if (elapsed >= intervalMs) {
            executeBackup();
            return;
        } else {
            autoBackupTimer = setTimeout(async () => {
                await executeBackup();
            }, intervalMs - elapsed);
            return;
        }
    }
    scheduleNextBackup();
}

ipcMain.handle('get-app-state', () => loadState());
ipcMain.handle('save-app-state', (event, data) => { saveState(data); return true; });

ipcMain.handle('get-auto-launch', () => app.getLoginItemSettings().openAtLogin);
ipcMain.handle('set-auto-launch', (event, enable) => {
    app.setLoginItemSettings({ openAtLogin: enable, path: app.getPath('exe') });
    return app.getLoginItemSettings().openAtLogin;
});

ipcMain.handle('select-files', async () => {
    const parentWindow = (mainWindow && !mainWindow.isDestroyed()) ? mainWindow : null;
    const result = await dialog.showOpenDialog(parentWindow, { properties: ['openFile', 'multiSelections'], title: 'Select Files to Backup' });
    return result.canceled ? [] : result.filePaths;
});

ipcMain.handle('select-folders', async () => {
    const parentWindow = (mainWindow && !mainWindow.isDestroyed()) ? mainWindow : null;
    const result = await dialog.showOpenDialog(parentWindow, { properties: ['openDirectory', 'multiSelections'], title: 'Select Folders to Backup' });
    return result.canceled ? [] : result.filePaths;
});

ipcMain.handle('select-destination', async () => {
    const parentWindow = (mainWindow && !mainWindow.isDestroyed()) ? mainWindow : null;
    const result = await dialog.showOpenDialog(parentWindow, { properties: ['openDirectory'], title: 'Select Target Destination' });
    return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('execute-backup', async (event, payload) => {
    return await executeBackup(payload?.queue);
});

ipcMain.handle('configure-schedule', (event, settings) => {
    saveState({ schedule: settings });
    scheduleNextBackup();
    return true;
});

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('js-flags', '--expose-gc');

app.whenReady().then(() => {
    createWindow();
    createTrayIcon();
    evaluateSchedule();

    powerMonitor.on('resume', () => {
        evaluateSchedule();
    });

    powerMonitor.on('suspend', () => {
        if (autoBackupTimer) {
            clearTimeout(autoBackupTimer);
            autoBackupTimer = null;
        }
    });

    app.on('activate', () => {
        showWindow();
    });
});

app.on('before-quit', () => { isQuitting = true; });

app.on('window-all-closed', (event) => {
    if (isQuitting) {
        if (process.platform !== 'darwin') app.quit();
    } else {
        event.preventDefault();
    }
});