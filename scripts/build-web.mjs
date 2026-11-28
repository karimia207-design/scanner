import { mkdir, rm, copyFile, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'web');
const out = path.join(root, 'www');

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

// Android launches the touch-optimized layout as its root screen.
await copyFile(path.join(source, 'mobile-index.html'), path.join(out, 'index.html'));
await copyFile(path.join(source, 'mobile-index.html'), path.join(out, 'mobile-index.html'));
await copyFile(path.join(source, 'index.html'), path.join(out, 'desktop-index.html'));
for (const name of ['nobitex-account.js', 'icon.svg', 'manifest.webmanifest', 'sw.js', 'vendor-lightweight-charts.js', 'app.js', 'pwa-register.js']) {
  await copyFile(path.join(source, name), path.join(out, name));
}

// Keep the displayed PWA name in sync with the shipped application version.
const manifestPath = path.join(out, 'manifest.webmanifest');
let manifest = await readFile(manifestPath, 'utf8');
manifest = manifest.replace('نوبیتکس ۷٫۵٫۹', 'نوبیتکس ۷٫۶٫۰');
await writeFile(manifestPath, manifest, 'utf8');

await build({
  entryPoints: [path.join(root, 'src', 'native-bridge.js')],
  outfile: path.join(out, 'native-bridge.js'),
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: ['es2020'],
  minify: false,
  sourcemap: false,
  legalComments: 'none'
});

console.log('Web assets for Android prepared in ./www');
