const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1024,
    height: 1024,
    show: false,
    frame: false,
    transparent: true,
    webPreferences: {
      offscreen: true
    }
  });

  const svgPath = path.join(__dirname, '../build/icon.svg');
  const svgData = fs.readFileSync(svgPath, 'utf8');
  const base64 = Buffer.from(svgData).toString('base64');
  const dataUrl = `data:image/svg+xml;base64,${base64}`;

  await win.loadURL(`data:text/html;charset=utf-8,<!DOCTYPE html><html><body style="margin:0;overflow:hidden;background:transparent;"><img src="${dataUrl}" width="1024" height="1024" /></body></html>`);

  // Wait for rendering
  await new Promise(resolve => setTimeout(resolve, 600));

  const image = await win.capturePage();
  const buildDir = path.join(__dirname, '../build');
  const iconsDir = path.join(buildDir, 'icons');
  const publicDir = path.join(__dirname, '../public');

  if (!fs.existsSync(iconsDir)) {
    fs.mkdirSync(iconsDir, { recursive: true });
  }

  // 1. Generate all individual standard PNG resolutions (16 to 1024)
  const allSizes = [1024, 512, 256, 128, 64, 48, 32, 24, 16];
  for (const size of allSizes) {
    const resized = size === 1024 ? image : image.resize({ width: size, height: size, quality: 'best' });
    const buf = resized.toPNG();
    fs.writeFileSync(path.join(iconsDir, `icon_${size}x${size}.png`), buf);
  }

  // 2. Main app icon PNGs
  const png512 = image.resize({ width: 512, height: 512, quality: 'best' }).toPNG();
  fs.writeFileSync(path.join(buildDir, 'icon.png'), png512);
  fs.writeFileSync(path.join(publicDir, 'icon.png'), png512);

  // 3. Multi-resolution sizes for Windows ICO container: 256, 128, 64, 48, 32, 24, 16
  const icoSizes = [256, 128, 64, 48, 32, 24, 16];
  const pngBuffers = [];

  for (const size of icoSizes) {
    const resized = image.resize({ width: size, height: size, quality: 'best' });
    const buf = resized.toPNG();
    pngBuffers.push({ size, buffer: buf });
  }

  // Pack into standard Windows ICO file format
  // ICO Header: 2 bytes reserved (0), 2 bytes type (1 for ICO), 2 bytes count
  const count = pngBuffers.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(count, 4);

  // Directory entries (16 bytes per image)
  const dirSize = count * 16;
  const dirBuffer = Buffer.alloc(dirSize);
  let currentOffset = 6 + dirSize;

  const dataBuffers = [];

  for (let i = 0; i < count; i++) {
    const { size, buffer } = pngBuffers[i];
    const widthByte = size >= 256 ? 0 : size;
    const heightByte = size >= 256 ? 0 : size;

    dirBuffer.writeUInt8(widthByte, i * 16 + 0); // width
    dirBuffer.writeUInt8(heightByte, i * 16 + 1); // height
    dirBuffer.writeUInt8(0, i * 16 + 2); // color palette (0)
    dirBuffer.writeUInt8(0, i * 16 + 3); // reserved (0)
    dirBuffer.writeUInt16LE(1, i * 16 + 4); // color planes (1)
    dirBuffer.writeUInt16LE(32, i * 16 + 6); // bits per pixel (32)
    dirBuffer.writeUInt32LE(buffer.length, i * 16 + 8); // size of image data
    dirBuffer.writeUInt32LE(currentOffset, i * 16 + 12); // offset of image data

    currentOffset += buffer.length;
    dataBuffers.push(buffer);
  }

  const icoBuffer = Buffer.concat([header, dirBuffer, ...dataBuffers]);
  fs.writeFileSync(path.join(buildDir, 'icon.ico'), icoBuffer);
  fs.writeFileSync(path.join(publicDir, 'favicon.ico'), icoBuffer);

  console.log(`Successfully generated:
- ${allSizes.length} individual PNGs in build/icons/ (1024, 512, 256, 128, 64, 48, 32, 24, 16)
- Master 512x512 build/icon.png
- Windows Multi-resolution build/icon.ico with ${count} layers (256, 128, 64, 48, 32, 24, 16)!`);
  app.exit(0);
});
