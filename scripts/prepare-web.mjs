import { mkdir, copyFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(process.cwd());
const destination = resolve(root, 'www');
const assets = [
  'index.html',
  'manifest.webmanifest',
  'icon.svg',
  'icon-192.png',
  'icon-512.png',
  'native-bridge.js',
  'nobitex-account.js',
  'sw.js'
];

await mkdir(destination, { recursive: true });
for (const file of assets) {
  const source = resolve(root, file);
  try {
    await access(source);
  } catch {
    throw new Error(`Required web asset is missing: ${file}`);
  }
  await copyFile(source, resolve(destination, file));
}
console.log(`Prepared ${assets.length} web assets in ./www for Capacitor.`);
