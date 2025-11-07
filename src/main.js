const { app, BrowserWindow, Tray, Menu, ipcMain, shell, nativeImage, dialog } = require('electron');
const path = require('path');
const { exec } = require('child_process');
const fs = require('fs');

let tray = null;
let mainWindow = null;
let currentProject = null;
const configPath = path.join(app.getPath('userData'), 'projects.json');

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
  tray.setToolTip(currentProject ? `Launcher - ${currentProject.name}` : 'Launcher');
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

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', (event) => {
  event.preventDefault();
});

// IPC Handlers
ipcMain.handle('get-projects', async () => {
  return loadProjects();
});

ipcMain.handle('save-projects', async (event, projects) => {
  return saveProjects(projects);
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
