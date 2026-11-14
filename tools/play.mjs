import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { serve, ROOT } from './serve.mjs';

// A dedicated browser profile keeps model downloads cached without changing a personal profile.
const profile = join(ROOT, 'artifacts', 'play-browser-profile');
await mkdir(profile, { recursive: true });
const server = await serve(Number(process.env.PORT || 4173));
const url = `http://localhost:${server.address().port}/`;
const headless = process.argv.includes('--headless');
const flags = [`--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check'];
if (process.platform === 'linux') flags.push('--enable-unsafe-webgpu', '--use-angle=vulkan', '--enable-features=Vulkan');
if (headless) flags.push('--headless=new', '--disable-vulkan-surface', url);
else flags.push(`--app=${url}`);
console.log(`Per My Last ReQuest → ${url}`);
console.log('Opening a dedicated Chrome window. Close it or press Ctrl+C to stop.');
const chrome = spawn(process.env.CHROME || 'google-chrome', flags, { stdio: 'ignore' });
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  chrome.kill();
  server.closeAllConnections();
  server.close();
}
chrome.once('error', error => { console.error(`Could not open Chrome: ${error.message}. Open ${url} in your browser instead. Press Ctrl+C when finished.`); });
chrome.once('exit', () => stop());
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
