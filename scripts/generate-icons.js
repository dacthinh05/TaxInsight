import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const buildDir = path.join(rootDir, 'build');
if (!fs.existsSync(buildDir)) {
  fs.mkdirSync(buildDir, { recursive: true });
}

const publicDir = path.join(rootDir, 'public');
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}

const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
  <defs>
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#087F74" />
      <stop offset="50%" stop-color="#066C64" />
      <stop offset="100%" stop-color="#044D47" />
    </linearGradient>
    <linearGradient id="foldGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#CBD5E1" />
      <stop offset="100%" stop-color="#94A3B8" />
    </linearGradient>
    <linearGradient id="sealGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#10B981" />
      <stop offset="100%" stop-color="#059669" />
    </linearGradient>
    <filter id="shadow" x="-5%" y="-5%" width="110%" height="115%">
      <feDropShadow dx="0" dy="16" stdDeviation="24" flood-color="#000000" flood-opacity="0.3" />
    </filter>
  </defs>

  <!-- App Rounded Tile Container (Windows Fluent / Modern Desktop Style) -->
  <rect x="48" y="48" width="928" height="928" rx="208" fill="url(#bgGrad)" filter="url(#shadow)" />
  <rect x="48" y="48" width="928" height="928" rx="208" fill="none" stroke="#2DD4BF" stroke-width="6" stroke-opacity="0.3" />

  <!-- Main Document Sheet (Crisp White Tax Filing) -->
  <g filter="url(#shadow)">
    <path d="M 272 208 L 640 208 L 776 344 L 776 824 C 776 848 756 868 732 868 L 272 868 C 248 868 228 848 228 824 L 228 252 C 228 228 248 208 272 208 Z" fill="#FFFFFF" />
    <!-- Folded Corner -->
    <path d="M 640 208 L 640 344 L 776 344 Z" fill="url(#foldGrad)" />
  </g>

  <!-- Tax Header Stripe -->
  <rect x="292" y="296" width="280" height="32" rx="16" fill="#087F74" />

  <!-- Data / Tax Grid Rows -->
  <rect x="292" y="368" width="432" height="20" rx="10" fill="#E2E8F0" />
  <rect x="292" y="416" width="432" height="20" rx="10" fill="#E2E8F0" />
  <rect x="292" y="464" width="300" height="20" rx="10" fill="#E2E8F0" />

  <!-- TR Badge + Verified Accounting Checkmark Group -->
  <g transform="translate(284, 532)">
    <!-- Plate Background -->
    <rect x="0" y="0" width="448" height="272" rx="40" fill="#F0FDFA" stroke="#0D9488" stroke-width="7" />
    
    <!-- TR Monogram Typography -->
    <text x="44" y="188" font-family="'Segoe UI', -apple-system, sans-serif" font-weight="900" font-size="152" fill="#087F74" letter-spacing="-6">TR</text>
    
    <!-- Verified Accounting Seal -->
    <circle cx="336" cy="136" r="72" fill="url(#sealGrad)" />
    <circle cx="336" cy="136" r="64" fill="none" stroke="#A7F3D0" stroke-width="4" />
    <path d="M 304 136 L 328 160 L 372 112" fill="none" stroke="#FFFFFF" stroke-width="14" stroke-linecap="round" stroke-linejoin="round" />
  </g>
</svg>`;

fs.writeFileSync(path.join(buildDir, 'icon.svg'), svgContent, 'utf-8');
fs.writeFileSync(path.join(publicDir, 'icon.svg'), svgContent, 'utf-8');

console.log('Saved SVG icon master artwork.');
