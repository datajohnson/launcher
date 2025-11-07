// Creates simple PNG icons using Canvas
const fs = require('fs');
const path = require('path');

// For the tray icon, we'll create a simple data URI that Electron can use
// This creates a 16x16 icon with a rocket shape

const { createCanvas } = require('canvas');

function createTrayIcon() {
  const canvas = createCanvas(16, 16);
  const ctx = canvas.getContext('2d');

  // Fill with gradient
  const gradient = ctx.createLinearGradient(0, 0, 16, 16);
  gradient.addColorStop(0, '#005288');
  gradient.addColorStop(1, '#00a8e8');

  // Draw circle
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(8, 8, 7, 0, Math.PI * 2);
  ctx.fill();

  // Draw rocket/arrow
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(8, 4);
  ctx.lineTo(10, 10);
  ctx.lineTo(8, 9);
  ctx.lineTo(6, 10);
  ctx.closePath();
  ctx.fill();

  return canvas.toBuffer('image/png');
}

function createAppIcon() {
  const canvas = createCanvas(256, 256);
  const ctx = canvas.getContext('2d');

  // Fill with gradient
  const gradient = ctx.createLinearGradient(0, 0, 256, 256);
  gradient.addColorStop(0, '#005288');
  gradient.addColorStop(1, '#00a8e8');

  // Draw circle
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(128, 128, 120, 0, Math.PI * 2);
  ctx.fill();

  // Draw rocket/arrow
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(128, 80);
  ctx.lineTo(160, 140);
  ctx.lineTo(128, 125);
  ctx.lineTo(96, 140);
  ctx.closePath();
  ctx.fill();

  return canvas.toBuffer('image/png');
}

try {
  const trayIcon = createTrayIcon();
  fs.writeFileSync(path.join(__dirname, 'tray-icon.png'), trayIcon);
  console.log('✓ tray-icon.png created');

  const appIcon = createAppIcon();
  fs.writeFileSync(path.join(__dirname, 'icon.png'), appIcon);
  console.log('✓ icon.png created');

  console.log('\nIcons created successfully!');
} catch (error) {
  console.error('Error creating icons:', error.message);
  console.log('\nNote: This requires the "canvas" package. Install it with:');
  console.log('  npm install canvas');
}
