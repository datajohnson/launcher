const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const toIco = require('to-ico');

async function createIcoIcon() {
  const svgPath = path.join(__dirname, 'icon.svg');
  const icoPath = path.join(__dirname, 'icon.ico');

  try {
    // Read SVG file
    const svgBuffer = fs.readFileSync(svgPath);

    // Create PNG buffers at different sizes for ICO (Windows needs multiple resolutions)
    const sizes = [16, 32, 48, 64, 128, 256];
    const pngBuffers = await Promise.all(
      sizes.map(size =>
        sharp(svgBuffer)
          .resize(size, size)
          .png()
          .toBuffer()
      )
    );

    // Convert to ICO
    const icoBuffer = await toIco(pngBuffers);
    fs.writeFileSync(icoPath, icoBuffer);

    console.log('✓ icon.ico created successfully!');
    console.log(`  Location: ${icoPath}`);
    console.log('  Sizes included: 16x16, 32x32, 48x48, 64x64, 128x128, 256x256');
  } catch (error) {
    console.error('Error creating ICO file:', error.message);
    process.exit(1);
  }
}

createIcoIcon();
