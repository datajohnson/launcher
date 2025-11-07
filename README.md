# Launcher

A SpaceX-inspired Windows system tray application for launching development tools and managing projects.

## Features

- **System Tray Integration**: Sits quietly in your system tray, always accessible
- **Project Management**: Create and manage multiple project configurations
- **Multi-Tool Launcher**: Launch all your tools with a single click
- **SpaceX-Inspired Design**: Sleek, modern UI with dark theme and blue accents
- **Supported Tools**:
  - VS Code (in specific directory)
  - Terminal / PowerShell (in specific directory)
  - Browser (to specific URLs)
  - Docker Compose
  - Custom commands
  - Files and applications

## Installation

1. Install dependencies:
```bash
npm install
```

2. Create icon assets:
   - Follow instructions in `assets/README.md` to create proper icon files
   - Or use the provided SVG files and convert them to PNG/ICO

## Usage

### Development Mode

Run the app in development mode:
```bash
npm start
```

Or with dev flag:
```bash
npm run dev
```

### Building for Production

Build the app for Windows:
```bash
npm run build
```

This will create an installer in the `dist` folder.

## Creating a Project

1. Click the system tray icon or right-click and select "Open Launcher"
2. Click "+ NEW" button
3. Enter project details:
   - **Name**: Your project name
   - **Description**: Brief description
4. Add tools by clicking "+ ADD TOOL"
5. For each tool:
   - **Name**: Display name for the tool
   - **Type**: Select tool type (VS Code, Terminal, Browser, etc.)
   - **Configuration**: Enter path, URL, or command based on type
6. Click "SAVE PROJECT"

## Example Project Configuration

**Project: E-Commerce Site**
- VS Code: `C:\dev\ecommerce`
- Terminal: `C:\dev\ecommerce`
- Docker Compose: `C:\dev\ecommerce`
- Browser: `http://localhost:8080`
- Browser: `https://portal.azure.com`

## Tool Types

### VS Code
- Opens VS Code in the specified directory
- Field: `path` - Directory path

### Terminal / PowerShell
- Opens Command Prompt or PowerShell in the specified directory
- Field: `path` - Directory path

### Browser
- Opens the specified URL in your default browser
- Field: `url` - Full URL including http/https

### Docker Compose
- Opens terminal and runs `docker-compose up` in the specified directory
- Field: `path` - Directory containing docker-compose.yml

### Custom Command
- Runs any custom command
- Field: `command` - Command to execute

### Open File
- Opens a file or application
- Field: `path` - File or application path

## Keyboard Shortcuts

- `Esc` - Close/minimize window
- Click tool card - Launch individual tool
- "LAUNCH ALL" button - Launch all tools in sequence

## Configuration Storage

Projects are stored in:
```
%APPDATA%\launcher\projects.json
```

You can manually edit this file to backup or transfer configurations.

## Tech Stack

- **Electron** - Cross-platform desktop framework
- **Node.js** - JavaScript runtime
- **HTML/CSS/JavaScript** - UI layer

## Design Philosophy

Inspired by SpaceX's clean, futuristic aesthetic:
- Dark theme with deep blacks
- Blue gradient accents (#005288 to #00a8e8)
- Condensed sans-serif fonts (Roboto Condensed)
- Minimal, functional design
- Focus on efficiency and speed

## Troubleshooting

### Icons not showing
- Make sure you've created PNG/ICO files in the `assets` folder
- See `assets/README.md` for instructions

### Tools not launching
- Verify paths are correct and accessible
- For VS Code, ensure `code` command is in PATH
- For terminal commands, use full paths if needed

### System tray icon missing
- Check Windows system tray settings
- Ensure app has permission to show notifications

## Future Enhancements

- Auto-start with Windows
- Global keyboard shortcuts
- Import/export project configurations
- Cloud sync for projects
- More tool integrations
- Themes and customization
- Launch profiles (dev, staging, production)

## License

MIT License - Feel free to use and modify!

## Contributing

Feel free to submit issues and enhancement requests!
