// Assembles the published site: only what the page loads at runtime (index.html, style.css, src/, assets/art/,
// assets/music/ and the vendored music player), then checks that every file it refers to exists and that no path is
// root-absolute, so the site works under /per-my-last-request/ on GitHub Pages.
//
//   node tools/build.mjs [outdir=_site]
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { ROOT } from './serve.mjs';
import { TILE_ART } from '../src/view.js';

const out = resolve(process.argv[2] || join(ROOT, '_site'));
const SHIP = ['index.html', 'style.css', 'src', 'assets/art', 'assets/music', 'vendor'];

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const path of SHIP) cpSync(join(ROOT, path), join(out, path), { recursive: true });

const missing = [];
const check = (path, from) => { if (!existsSync(join(out, path))) missing.push(`${path} (from ${from})`); };
const html = readFileSync(join(out, 'index.html'), 'utf8');
for (const [, ref] of html.matchAll(/(?:src|href)="([^"]+)"/g)) if (!/^(https?:|#|data:|mailto:)/.test(ref)) check(ref.replace(/^\.\//, ''), 'index.html');
if (/\b(?:src|href)="\//.test(html)) missing.push('index.html uses a root-absolute path; use relative paths so /<repo>/ works');
// Every script's relative imports and URLs, including ../ ones such as the vendored music player and the score.
const scripts = dir => !existsSync(join(out, dir)) ? [] : readdirSync(join(out, dir), { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? scripts(join(dir, entry.name)) : entry.name.endsWith('.js') ? [join(dir, entry.name)] : []);
for (const file of [...scripts('src'), ...scripts('vendor')]) {
  const js = readFileSync(join(out, file), 'utf8');
  for (const [, ref] of js.matchAll(/(?:from|import\(|new URL\()\s*'(\.\.?\/[^']+)'/g)) {
    const target = join(dirname(file), ref);
    if (target.startsWith('..')) missing.push(`${ref} (from ${file}) points outside the site`);
    else check(target, file);
  }
  if (/['"`]\/(?:src|assets|vendor)\//.test(js)) missing.push(`${file} uses a root-absolute path`);
}
// Portraits are named in code: one per stop, plus the hero.
for (const name of [...TILE_ART, 'hero']) check(`assets/art/${name}.webp`, 'portraits');

if (missing.length) { console.error(`Missing or misaddressed files:\n  ${missing.join('\n  ')}`); process.exit(1); }
const size = dir => readdirSync(dir, { withFileTypes: true }).reduce((sum, entry) => sum + (entry.isDirectory() ? size(join(dir, entry.name)) : statSync(join(dir, entry.name)).size), 0);
console.log(`Built ${relative(ROOT, out) || out}: ${(size(out) / 1048576).toFixed(1)} MB`);
