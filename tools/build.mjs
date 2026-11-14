// Assembles the published site: only what the page loads at runtime (index.html, style.css, src/, assets/art/),
// then checks that every file it refers to exists and that no path is root-absolute, so the site works under
// /per-my-last-request/ on GitHub Pages.
//
//   node tools/build.mjs [outdir=_site]
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { ROOT } from './serve.mjs';
import { TILE_ART } from '../src/view.js';

const out = resolve(process.argv[2] || join(ROOT, '_site'));
const SHIP = ['index.html', 'style.css', 'src', 'assets/art'];

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const path of SHIP) cpSync(join(ROOT, path), join(out, path), { recursive: true });

const missing = [];
const check = (path, from) => { if (!existsSync(join(out, path))) missing.push(`${path} (from ${from})`); };
const html = readFileSync(join(out, 'index.html'), 'utf8');
for (const [, ref] of html.matchAll(/(?:src|href)="([^"]+)"/g)) if (!/^(https?:|#|data:|mailto:)/.test(ref)) check(ref.replace(/^\.\//, ''), 'index.html');
if (/\b(?:src|href)="\//.test(html)) missing.push('index.html uses a root-absolute path; use relative paths so /<repo>/ works');
for (const file of readdirSync(join(out, 'src'))) {
  const js = readFileSync(join(out, 'src', file), 'utf8');
  for (const [, ref] of js.matchAll(/(?:from|import\(|new URL\()\s*'(\.\/[^']+)'/g)) check(join('src', ref), `src/${file}`);
  if (/['"`]\/(?:src|assets)\//.test(js)) missing.push(`src/${file} uses a root-absolute path`);
}
// Portraits are named in code: one per stop, plus the hero.
for (const name of [...TILE_ART, 'hero']) check(`assets/art/${name}.webp`, 'portraits');

if (missing.length) { console.error(`Missing or misaddressed files:\n  ${missing.join('\n  ')}`); process.exit(1); }
const size = dir => readdirSync(dir, { withFileTypes: true }).reduce((sum, entry) => sum + (entry.isDirectory() ? size(join(dir, entry.name)) : statSync(join(dir, entry.name)).size), 0);
console.log(`Built ${relative(ROOT, out) || out}: ${(size(out) / 1048576).toFixed(1)} MB`);
