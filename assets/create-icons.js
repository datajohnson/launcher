// Simple script to create icon placeholders
// You can replace these with actual icon files later

const fs = require('fs');
const path = require('path');

// Create a simple SVG icon
const iconSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="256" height="256" viewBox="0 0 256 256" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="grad1" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#005288;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#00a8e8;stop-opacity:1" />
    </linearGradient>
  </defs>
  <circle cx="128" cy="128" r="120" fill="url(#grad1)"/>
  <polygon points="128,80 160,140 128,125 96,140" fill="white"/>
</svg>`;

const trayIconSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="grad2" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#005288;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#00a8e8;stop-opacity:1" />
    </linearGradient>
  </defs>
  <circle cx="16" cy="16" r="14" fill="url(#grad2)"/>
  <polygon points="16,10 20,18 16,16 12,18" fill="white"/>
</svg>`;

fs.writeFileSync(path.join(__dirname, 'icon.svg'), iconSvg);
fs.writeFileSync(path.join(__dirname, 'tray-icon.svg'), trayIconSvg);

console.log('SVG icons created successfully!');
console.log('To use these icons properly, consider converting them to PNG/ICO format using an image converter.');
console.log('For now, you can use online tools or packages like "sharp" to convert SVG to PNG/ICO.');
