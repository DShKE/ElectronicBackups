let backupQueue = [];
let isBackingUp = false;

// DOM Elements
const btnAddFile = document.getElementById('btn-add-file');
const btnAddFolder = document.getElementById('btn-add-folder');
const btnClearQueue = document.getElementById('btn-clear-queue');
const queueList = document.getElementById('queue-list');
const emptyState = document.getElementById('empty-state');

const toggleStartup = document.getElementById('toggle-startup');
const toggleSchedule = document.getElementById('toggle-schedule');
const scheduleControls = document.getElementById('schedule-controls');
const scheduleValue = document.getElementById('schedule-value');
const scheduleUnit = document.getElementById('schedule-unit');

const btnStartBackup = document.getElementById('btn-start-backup');
const progressBarFill = document.getElementById('progress-bar-fill');
const progressPercent = document.getElementById('progress-percent');
const progressText = document.getElementById('progress-text');
const lastBackupTime = document.getElementById('last-backup-time');
const statusBadge = document.getElementById('status-badge');

const ICONS = {
    folder: '<svg class="item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>',
    file: '<svg class="item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>'
};

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function updateScheduleUI() {
    if (scheduleControls) {
        scheduleControls.style.display = toggleSchedule.checked ? 'flex' : 'none';
    }
}

function setupIPCListeners() {
    window.electronAPI.onBackupStarted(() => {
        isBackingUp = true;
        btnStartBackup.disabled = true;
        statusBadge.textContent = 'Backing up...';
        progressText.textContent = 'Starting process...';
        progressBarFill.style.width = '0%';
        progressPercent.textContent = '0%';
    });

    window.electronAPI.onBackupProgress((data) => {
        progressBarFill.style.width = `${data.percentage}%`;
        progressPercent.textContent = `${data.percentage}%`;
        progressText.textContent = `Copying: ${data.filename}`;
    });

    window.electronAPI.onBackupCompleted((result) => {
        isBackingUp = false;
        btnStartBackup.disabled = false;

        if (result.success) {
            statusBadge.textContent = 'System Ready';
            progressText.textContent = `Backup Complete (${result.filesCopied} files copied)`;
            progressBarFill.style.width = '100%';
            progressPercent.textContent = '100%';
            lastBackupTime.textContent = `Last backup: ${new Date(result.lastBackupTime).toLocaleString()}`;
        } else {
            statusBadge.textContent = 'Error';
            progressText.textContent = `Error: ${result.error}`;
        }
    });
}

async function init() {
    setupIPCListeners();
    try {
        const isAutoLaunch = await window.electronAPI.getAutoLaunch();
        toggleStartup.checked = isAutoLaunch;

        const state = await window.electronAPI.getAppState();

        if (state.queue) backupQueue = state.queue;
        if (state.schedule) {
            toggleSchedule.checked = state.schedule.enabled || false;
            scheduleValue.value = state.schedule.intervalValue || 1;
            scheduleUnit.value = state.schedule.intervalUnit || 'hours';
        }
        if (state.lastBackupTime) {
            lastBackupTime.textContent = `Last backup: ${new Date(state.lastBackupTime).toLocaleString()}`;
        }
    } catch (err) {
        console.error('Failed to load initial state:', err);
    }
    updateScheduleUI();
    renderQueue();
}

queueList.addEventListener('click', async (e) => {
    const removeBtn = e.target.closest('.btn-remove');
    if (removeBtn) {
        const id = removeBtn.getAttribute('data-id');
        backupQueue = backupQueue.filter(item => item.id !== id);
        window.electronAPI.saveAppState({ queue: backupQueue });
        renderQueue();
        return;
    }

    const browseBtn = e.target.closest('.btn-dest-browse');
    if (browseBtn) {
        const id = browseBtn.getAttribute('data-id');
        const targetDir = await window.electronAPI.selectDestination();
        if (targetDir) {
            const item = backupQueue.find(i => i.id === id);
            if (item) {
                item.destination = targetDir;
                window.electronAPI.saveAppState({ queue: backupQueue });
                renderQueue();
            }
        }
    }
});

function renderQueue() {
    queueList.innerHTML = '';

    if (backupQueue.length === 0) {
        emptyState.style.display = 'block';
        return;
    }

    emptyState.style.display = 'none';

    backupQueue.forEach((item) => {
        const li = document.createElement('li');
        li.className = 'queue-item';

        const iconSvg = item.type === 'folder' ? ICONS.folder : ICONS.file;
        const filename = item.path.split(/[\\/]/).pop() || item.path;
        const destDisplay = item.destination || 'No target destination set...';

        li.innerHTML = `
            <div class="item-info">
                ${iconSvg}
                <div class="item-details">
                    <span class="item-name">${escapeHtml(filename)}</span>
                    <span class="item-path">${escapeHtml(item.path)}</span>
                    <div class="item-dest-row">
                        <span class="item-dest-label">Target:</span>
                        <input type="text" class="item-dest-input" readonly />
                        <button class="btn btn-secondary btn-dest-browse" data-id="${escapeHtml(item.id)}">Browse...</button>
                    </div>
                </div>
            </div>
            <button class="btn-remove" data-id="${escapeHtml(item.id)}">&times;</button>
        `;

        li.querySelector('.item-dest-input').value = destDisplay;
        queueList.appendChild(li);
    });
}

function addToQueue(paths, type) {
    paths.forEach(p => {
        if (!backupQueue.some(item => item.path === p)) {
            backupQueue.push({ 
                id: Date.now().toString(36) + Math.random().toString(36).substring(2, 7),
                path: p, 
                type: type, 
                destination: '' 
            });
        }
    });
    window.electronAPI.saveAppState({ queue: backupQueue });
    renderQueue();
}

btnAddFile.addEventListener('click', async () => {
    const files = await window.electronAPI.selectFiles();
    if (files && files.length > 0) addToQueue(files, 'file');
});

btnAddFolder.addEventListener('click', async () => {
    const folders = await window.electronAPI.selectFolders();
    if (folders && folders.length > 0) addToQueue(folders, 'folder');
});

btnClearQueue.addEventListener('click', () => {
    backupQueue = [];
    window.electronAPI.saveAppState({ queue: backupQueue });
    renderQueue();
});

toggleStartup.addEventListener('change', async (e) => {
    await window.electronAPI.setAutoLaunch(e.target.checked);
});

function updateScheduleConfig() {
    window.electronAPI.configureSchedule({
        enabled: toggleSchedule.checked,
        intervalValue: parseInt(scheduleValue.value, 10) || 1,
        intervalUnit: scheduleUnit.value
    });
}

toggleSchedule.addEventListener('change', () => {
    updateScheduleUI();
    updateScheduleConfig();
});

scheduleValue.addEventListener('change', updateScheduleConfig);
scheduleUnit.addEventListener('change', updateScheduleConfig);

async function runBackup() {
    if (isBackingUp) return;
    if (backupQueue.length === 0) {
        alert('Please add files or folders to the queue before running a backup.');
        return;
    }
    if (backupQueue.some(item => !item.destination)) {
        alert('Please ensure all items in your queue have a target destination directory set.');
        return;
    }

    await window.electronAPI.executeBackup({ queue: backupQueue });
}

btnStartBackup.addEventListener('click', runBackup);

document.addEventListener('DOMContentLoaded', init);