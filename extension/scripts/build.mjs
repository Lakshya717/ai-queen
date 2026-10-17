import * as esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';

const distDir = path.resolve('dist');

async function build() {
  console.log('Building Chrome MV3 Extension...');
  fs.rmSync(distDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(distDir, 'src/contexts'), { recursive: true });
  fs.mkdirSync(path.join(distDir, 'src/extensions/badges'), { recursive: true });

  // 1. Bundle content.ts as self-contained IIFE
  await esbuild.build({
    entryPoints: ['src/contexts/content.ts'],
    outfile: 'dist/src/contexts/content.js',
    bundle: true,
    format: 'iife',
    target: ['chrome110'],
    minify: false,
    sourcemap: true,
  });

  // 2. Bundle background.ts as ESM service worker
  await esbuild.build({
    entryPoints: ['src/contexts/background.ts'],
    outfile: 'dist/src/contexts/background.js',
    bundle: true,
    format: 'esm',
    target: ['chrome110'],
    minify: false,
    sourcemap: true,
  });

  // 3. Bundle popup.ts
  await esbuild.build({
    entryPoints: ['src/contexts/popup.ts'],
    outfile: 'dist/src/contexts/popup.js',
    bundle: true,
    format: 'esm',
    target: ['chrome110'],
    minify: false,
    sourcemap: true,
  });

  // 4. Copy manifest.json (updating paths to .js)
  const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
  manifest.background.service_worker = 'src/contexts/background.js';
  manifest.content_scripts[0].js = ['src/contexts/content.js'];
  manifest.content_scripts[0].css = ['src/extensions/badges/badge.css'];
  fs.writeFileSync(path.join(distDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  // 5. Copy HTML and CSS assets
  fs.copyFileSync('src/contexts/popup.html', path.join(distDir, 'src/contexts/popup.html'));
  fs.copyFileSync('src/contexts/popup.css', path.join(distDir, 'src/contexts/popup.css'));
  fs.copyFileSync('src/extensions/badges/badge.css', path.join(distDir, 'src/extensions/badges/badge.css'));

  // Update script tags in HTML from .ts to .js
  let popupHtml = fs.readFileSync(path.join(distDir, 'src/contexts/popup.html'), 'utf8');
  popupHtml = popupHtml.replace('src="./popup.ts"', 'src="./popup.js"');
  fs.writeFileSync(path.join(distDir, 'src/contexts/popup.html'), popupHtml);

  console.log('Build complete! Output emitted to dist/');
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
