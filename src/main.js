const { app, BrowserWindow, Tray, Menu, ipcMain, shell, nativeImage, dialog } = require('electron');
const path = require('path');
const { exec } = require('child_process');
const fs = require('fs');
const tracker = require('./tracker');

let tray = null;
let mainWindow = null;
let currentProject = null;
let trackerStatus = { tracking: false, paused: false, todayActiveMs: 0 };
const configPath = path.join(app.getPath('userData'), 'projects.json');

// Format a ms duration as "2h13m" / "47m" / "12s" for compact tray/status display.
function formatDuration(ms) {
  const totalSec = Math.max(0, Math.round((ms || 0) / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  if (h > 0) return `${h}h${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m`;
  return `${totalSec}s`;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    show: false,
    frame: false,
    transparent: true,
    resizable: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true
    },
    icon: path.join(__dirname, '../assets/icon.ico')
  });

  mainWindow.loadFile('src/index.html');

  mainWindow.on('close', (event) => {
    if (!app.isQuiting) {
      event.preventDefault();
      mainWindow.hide();
    }
    return false;
  });
}

function createTray() {
  // Create a simple tray icon
  const trayIconPath = path.join(__dirname, '../assets/icon.ico');

  let trayIcon;
  if (fs.existsSync(trayIconPath)) {
    trayIcon = nativeImage.createFromPath(trayIconPath);
  } else {
    // Create a simple icon programmatically
    // Create a 16x16 canvas with a blue circle and white arrow
    const size = 16;
    const canvas = `
    <svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:#005288;stop-opacity:1" />
          <stop offset="100%" style="stop-color:#00a8e8;stop-opacity:1" />
        </linearGradient>
      </defs>
      <circle cx="8" cy="8" r="7" fill="url(#grad)"/>
      <path d="M 8 4 L 10 10 L 8 9 L 6 10 Z" fill="white"/>
    </svg>
    `;
    trayIcon = nativeImage.createFromDataURL('data:image/svg+xml;base64,' + Buffer.from(canvas).toString('base64'));
  }

  // Ensure the icon is the right size for Windows tray
  if (!trayIcon.isEmpty()) {
    trayIcon = trayIcon.resize({ width: 16, height: 16 });
  }

  tray = new Tray(trayIcon);

  updateTrayMenu();

  tray.on('click', () => {
    mainWindow.show();
  });
}

function updateTrayMenu() {
  if (!tray) return;

  const menuTemplate = [
    {
      label: 'Open Launcher',
      click: () => {
        mainWindow.show();
      }
    }
  ];

  // Time-tracking live status + pause toggle
  menuTemplate.push({ type: 'separator' });
  menuTemplate.push({
    label: `⏱ Today: ${formatDuration(trackerStatus.todayActiveMs)}${trackerStatus.paused ? ' (paused)' : ''}`,
    enabled: false
  });
  menuTemplate.push({
    label: trackerStatus.paused ? '▶ Resume tracking' : '⏸ Pause tracking',
    click: () => {
      if (trackerStatus.paused) tracker.resume(); else tracker.pause();
    }
  });

  // Add current project tools if available
  if (currentProject) {
    menuTemplate.push({ type: 'separator' });
    menuTemplate.push({
      label: `📦 ${currentProject.name}`,
      enabled: false
    });

    // Add "Launch All" option
    if (currentProject.tools && currentProject.tools.length > 0) {
      menuTemplate.push({
        label: '🚀 Launch All',
        click: () => {
          launchAllTools(currentProject.tools);
        }
      });
      menuTemplate.push({ type: 'separator' });

      // Add individual tools
      currentProject.tools.forEach(tool => {
        const toolIcons = {
          vscode: '📝',
          terminal: '💻',
          powershell: '⚡',
          'powershell-command': '⚡',
          browser: '🌐',
          'docker-compose': '🐳',
          command: '⚙️',
          file: '📁'
        };
        const icon = toolIcons[tool.type] || '⚙️';

        menuTemplate.push({
          label: `${icon} ${tool.name}`,
          click: () => {
            launchTool(tool);
          }
        });
      });
    }
  }

  menuTemplate.push({ type: 'separator' });
  menuTemplate.push({
    label: 'Quit',
    click: () => {
      app.isQuiting = true;
      app.quit();
    }
  });

  const contextMenu = Menu.buildFromTemplate(menuTemplate);
  const today = formatDuration(trackerStatus.todayActiveMs);
  const base = currentProject ? `Launcher - ${currentProject.name}` : 'Launcher';
  tray.setToolTip(`${base}\nToday: ${today}${trackerStatus.paused ? ' (paused)' : ''}`);
  tray.setContextMenu(contextMenu);
}

function launchTool(tool) {
  return new Promise((resolve, reject) => {
    let command = '';

    switch (tool.type) {
      case 'vscode':
        command = `code "${tool.path}"`;
        break;
      case 'terminal':
        command = `start cmd /K "cd /d "${tool.path}""`;
        break;
      case 'powershell':
        command = `start powershell -NoExit -Command "cd '${tool.path}'"`;
        break;
      case 'powershell-command':
        if (tool.path) {
          command = `start powershell -NoExit -Command "cd '${tool.path}'; ${tool.command}"`;
        } else {
          command = `start powershell -NoExit -Command "${tool.command}"`;
        }
        break;
      case 'browser':
        shell.openExternal(tool.url);
        resolve({ success: true });
        return;
      case 'docker-compose':
        command = `start cmd /K "cd /d "${tool.path}" && docker-compose up"`;
        break;
      case 'command':
        command = tool.command;
        break;
      case 'file':
        shell.openPath(tool.path);
        resolve({ success: true });
        return;
      default:
        reject({ success: false, error: 'Unknown tool type' });
        return;
    }

    exec(command, (error, stdout, stderr) => {
      if (error) {
        console.error(`Error launching ${tool.type}:`, error);
        resolve({ success: false, error: error.message });
      } else {
        resolve({ success: true });
      }
    });
  });
}

async function launchAllTools(tools) {
  for (const tool of tools) {
    await launchTool(tool);
    // Small delay between launches
    await new Promise(resolve => setTimeout(resolve, 500));
  }
}

function loadProjects() {
  try {
    if (fs.existsSync(configPath)) {
      const data = fs.readFileSync(configPath, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('Error loading projects:', error);
  }
  return [];
}

function saveProjects(projects) {
  try {
    fs.writeFileSync(configPath, JSON.stringify(projects, null, 2), 'utf8');
    return true;
  } catch (error) {
    console.error('Error saving projects:', error);
    return false;
  }
}

app.whenReady().then(() => {
  createWindow();
  createTray();
  initTracker();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Start the time tracker and route its live updates to the renderer + tray.
function initTracker() {
  tracker.init({
    userDataPath: app.getPath('userData'),
    getProjects: loadProjects,
    onUpdate: (evt) => {
      if (evt && evt.status) trackerStatus = evt.status;
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('tracker-update', evt);
      }
      updateTrayMenu();
    }
  }).catch((err) => {
    console.error('[tracking] failed to initialize tracker:', err);
  });

  // Refresh the tray's "Today" total roughly once a minute even when focus is stable.
  setInterval(() => {
    try {
      trackerStatus = tracker.getStatus();
      updateTrayMenu();
    } catch (_) { /* tracker not ready */ }
  }, 60 * 1000);
}

app.on('window-all-closed', (event) => {
  event.preventDefault();
});

// Flush the open segment + pending batch before the process exits.
app.on('before-quit', () => {
  try { tracker.stop(); } catch (err) { console.error('[tracking] stop failed:', err); }
});

// IPC Handlers
ipcMain.handle('get-projects', async () => {
  return loadProjects();
});

ipcMain.handle('save-projects', async (event, projects) => {
  const ok = saveProjects(projects);
  // New/changed project paths should immediately affect auto-matching.
  try { tracker.reloadProjects(); } catch (_) { /* tracker not ready */ }
  return ok;
});

ipcMain.handle('launch-tool', async (event, tool) => {
  return launchTool(tool);
});

ipcMain.handle('minimize-window', () => {
  mainWindow.hide();
});

ipcMain.handle('close-window', () => {
  mainWindow.hide();
});

ipcMain.handle('select-directory', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });

  if (!result.canceled && result.filePaths.length > 0) {
    return { success: true, path: result.filePaths[0] };
  }

  return { success: false };
});

ipcMain.handle('select-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile']
  });

  if (!result.canceled && result.filePaths.length > 0) {
    return { success: true, path: result.filePaths[0] };
  }

  return { success: false };
});

ipcMain.handle('set-current-project', async (event, project) => {
  currentProject = project;
  updateTrayMenu();
  return true;
});

// ---- Time tracking IPC ----
const timeStore = require('./timeStore');

ipcMain.handle('get-time-segments', async (event, range) => {
  try {
    return timeStore.getSegments(range.from, range.to);
  } catch (err) {
    console.error('[tracking] get-time-segments failed:', err.message);
    return [];
  }
});

ipcMain.handle('get-rollups', async (event, { range, groupBy }) => {
  try {
    return timeStore.getRollups(range.from, range.to, groupBy);
  } catch (err) {
    console.error('[tracking] get-rollups failed:', err.message);
    return [];
  }
});

ipcMain.handle('get-tracker-status', async () => {
  try { return tracker.getStatus(); } catch (_) { return trackerStatus; }
});

ipcMain.handle('update-segment', async (event, { id, fields }) => {
  return timeStore.updateSegment(id, fields || {});
});

ipcMain.handle('update-segments', async (event, { ids, fields }) => {
  return timeStore.updateSegments(ids || [], fields || {});
});

ipcMain.handle('delete-segments', async (event, ids) => {
  timeStore.deleteSegments(ids || []);
  return true;
});

ipcMain.handle('add-manual-segment', async (event, seg) => {
  return timeStore.addManualSegment(seg);
});

ipcMain.handle('merge-segments', async (event, { ids, override }) => {
  return timeStore.mergeSegments(ids, override || {});
});

ipcMain.handle('delete-segment', async (event, id) => {
  timeStore.deleteSegment(id);
  return true;
});

ipcMain.handle('set-tracking-paused', async (event, wantPaused) => {
  if (wantPaused) tracker.pause(); else tracker.resume();
  return tracker.getStatus();
});

ipcMain.handle('clear-time-data', async () => {
  timeStore.deleteAll();
  return true;
});

ipcMain.handle('reload-tracking-config', async () => {
  tracker.reloadConfig(app.getPath('userData'));
  return true;
});
