import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

/** The Chrome (or Edge) executable to start: `CHROME` if set, else the first usual install found for this OS. */
export function findChrome(env = process.env, platform = process.platform) {
  if (env.CHROME) return env.CHROME;
  const onPath = name => (env.PATH || '').split(delimiter).some(dir => dir && existsSync(join(dir, name)));
  if (platform === 'darwin') {
    const apps = ['/Applications', join(homedir(), 'Applications')];
    const bundles = ['Google Chrome.app/Contents/MacOS/Google Chrome', 'Microsoft Edge.app/Contents/MacOS/Microsoft Edge'];
    return bundles.flatMap(bundle => apps.map(dir => join(dir, bundle))).find(existsSync) || 'google-chrome';
  }
  if (platform === 'win32') {
    const roots = [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA].filter(Boolean);
    const exes = ['Google/Chrome/Application/chrome.exe', 'Microsoft/Edge/Application/msedge.exe'];
    return exes.flatMap(exe => roots.map(dir => join(dir, exe))).find(existsSync) || 'chrome';
  }
  return ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'].find(onPath) || 'google-chrome';
}

export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
// `profileDir` keeps the browser profile (and any downloaded model) between runs. Without it, each run starts clean.
export async function launch({ softwareGpu = false, hardwareGpu = false, profileDir = null } = {}) {
  const profile = profileDir || await mkdtemp(join(tmpdir(), 'pmlq-chrome-'));
  if (profileDir) { await mkdir(profileDir, { recursive: true }); await rm(join(profileDir, 'DevToolsActivePort'), { force: true }); }
  const flags = ['--headless=new', '--no-sandbox', '--no-first-run', '--no-default-browser-check', '--disable-dev-shm-usage', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--mute-audio'];
  if (softwareGpu) flags.push('--enable-unsafe-webgpu', '--use-angle=swiftshader', '--enable-unsafe-swiftshader');
  else if (hardwareGpu) flags.push('--enable-unsafe-webgpu', '--use-angle=vulkan', '--enable-features=Vulkan', '--disable-vulkan-surface');
  const proc = spawn(findChrome(), [...flags, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  proc.stderr.on('data', data => { stderr = (stderr + data.toString()).slice(-8000); });
  let spawnError;
  proc.once('error', error => { spawnError = error; });
  let port;
  for (let i=0;i<150;i++) {
    if (spawnError) throw spawnError;
    if (proc.exitCode !== null) throw new Error(`Chrome stopped: ${stderr}`);
    try { port = Number((await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); } catch { /* Chrome has not written its port yet. */ }
    if (port) break;
    await sleep(100);
  }
  if (!port) { proc.kill(); throw new Error(`Chrome did not become ready: ${stderr}`); }
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const target = targets.find(t => t.type === 'page');
  if (!target) { proc.kill(); throw new Error('Chrome has no test page.'); }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve,reject) => { ws.addEventListener('open',resolve,{once:true}); ws.addEventListener('error',reject,{once:true}); });
  const pending = new Map();
  const errors = [];
  const logs = [];
  let sequence = 0;
  ws.addEventListener('message', ({ data }) => {
    const msg = JSON.parse(data);
    if (msg.id) {
      const job = pending.get(msg.id);
      if (!job) return;
      clearTimeout(job.timeout);
      pending.delete(msg.id);
      msg.error ? job.reject(new Error(JSON.stringify(msg.error))) : job.resolve(msg.result);
    }
    if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
    if (msg.method === 'Runtime.consoleAPICalled') {
      const text = msg.params.args.map(a => a.value ?? a.description).join(' ');
      logs.push({ type: msg.params.type, text });
      if (msg.params.type === 'error') errors.push(text);
    }
    if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') errors.push(msg.params.entry.text);
  });
  const send = (method, params = {}) => new Promise((resolve,reject) => {
    const id = ++sequence;
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 20000);
    pending.set(id,{resolve,reject,timeout});
    ws.send(JSON.stringify({ id, method, params }));
  });
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Log.enable');
  const page = {
    errors, logs, send,
    async eval(expression) {
      const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      return result.result.value;
    },
    async goto(url) {
      await send('Page.navigate', {url});
      await page.waitFor('document.readyState === "complete" && Boolean(window.QuestDemo)', 20000);
    },
    async waitFor(expression, timeout = 10000) {
      const started = Date.now();
      while (Date.now()-started < timeout) { if (await page.eval(`Boolean(${expression})`)) return; await sleep(150); }
      throw new Error(`Timed out: ${expression}`);
    },
    async viewport(width,height,mobile=false) { await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile}); },
    // Waits for the control to exist and be enabled, since options return only after a turn has finished playing.
    async click(selector, timeout = 8000) {
      const started = Date.now();
      while (Date.now()-started < timeout && !(await page.eval(`(() => { const e=document.querySelector(${JSON.stringify(selector)}); return Boolean(e && !e.disabled); })()`))) await sleep(60);
      await page.eval(`document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({ block: 'center' })`);
      const point = await page.eval(`(() => { const e=document.querySelector(${JSON.stringify(selector)}); if (!e || e.disabled) throw Error('Missing or disabled control'); const r=e.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
      await send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point});
      await send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...point});
    },
    async screenshot(path) { const result=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true}); await writeFile(path,Buffer.from(result.data,'base64')); },
    async close() {
      ws.close();
      proc.kill();
      for (const job of pending.values()) { clearTimeout(job.timeout); job.reject(new Error('Browser closed')); }
      pending.clear();
      await new Promise(resolve => { if (proc.exitCode!==null) resolve(); else { proc.once('exit',resolve); setTimeout(resolve,3000); } });
      if (!profileDir) await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:100}).catch(()=>{});
    },
  };
  return page;
}
