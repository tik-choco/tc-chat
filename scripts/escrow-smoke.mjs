// Production UI smoke; stops only the exact preview/Chrome PIDs it starts.
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const cwd = resolve(import.meta.dirname, '..');
const output = resolve(cwd, 'node_modules/.tmp/escrow-smoke');
await mkdir(output, { recursive: true });
const chromePath = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const started = [];
function launch(exe, args) {
  const child = spawn(exe, args, { cwd, windowsHide: true });
  started.push(child); console.log('Started PID', child.pid);
  child.on('error', e => console.error(e)); return child;
}
async function poll(fn, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch { /* awaiting server/page */ } await new Promise(r => setTimeout(r, 100)); }
  throw new Error('Smoke check timed out');
}
let socket;
try {
  launch(process.execPath, [resolve(cwd, 'node_modules/vite/bin/vite.js'), 'preview', '--host', '127.0.0.1', '--port', '4175', '--strictPort']);
  const url = 'http://127.0.0.1:4175/tc-chat/';
  await poll(async () => (await fetch(url)).ok);
  const browser = launch(chromePath, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--remote-debugging-port=0', '--user-data-dir=' + resolve(output, 'profile-' + Date.now()), 'about:blank']);
  let stderr = ''; browser.stderr.on('data', d => { stderr += d; }); browser.on('exit', (code) => { console.log('Chrome exit', code, stderr.slice(-3000)); });
  const wsUrl = await poll(() => stderr.match(new RegExp('DevTools listening on (ws:.*)'))?.[1]?.trim());
    const pages = await (await fetch('http://127.0.0.1:' + new URL(wsUrl).port + '/json/list')).json();
  socket = new WebSocket(pages.find(p => p.type === 'page').webSocketDebuggerUrl); await new Promise((res, rej) => { socket.onopen = res; socket.onerror = rej; setTimeout(() => rej(new Error('WebSocket connection timeout')), 5000).unref(); });
  let id = 0; const pending = new Map(); const errors = [];
  socket.onmessage = e => { const m = JSON.parse(e.data); if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.text); if (m.id) { const p = pending.get(m.id); pending.delete(m.id); if (m.error) p.reject(new Error(JSON.stringify(m.error))); else p.resolve(m.result); } };
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => { const key = ++id; pending.set(key, { resolve, reject }); setTimeout(() => { if (pending.delete(key)) reject(new Error(method + " timed out")); }, 5000).unref(); socket.send(JSON.stringify({ id: key, method, params, ...(sessionId && { sessionId }) })); });
  const call = (method, params) => send(method, params);
  const evaluate = async expression => (await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result.value;
  await call('Runtime.enable'); await call('Page.enable'); await call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await call('Page.navigate', { url });
  await poll(() => evaluate('location.origin === "http://127.0.0.1:4175"'));
  await evaluate('localStorage.setItem("tc-chat:username", "Escrow smoke"); localStorage.setItem("tc-chat:onboarding-done", "1"); localStorage.setItem("tc-chat:locale", "en");');
  await call('Page.navigate', { url: url + '#/escrow-smoke-' + Date.now() });
  const label = await poll(() => evaluate('Array.from(document.querySelectorAll(".room-tabs button")).find(b => /escrow|エスクロー/i.test(b.textContent))?.textContent'));
  console.log('Escrow header action:', label);
  await evaluate('Array.from(document.querySelectorAll(".room-tabs button")).find(b => /escrow|エスクロー/i.test(b.textContent)).click()');
  const state = await poll(() => evaluate('document.querySelector("[role=dialog]")?.innerText'));
  if (!/mistl/.test(state)) throw new Error('Escrow panel failed to render');
  await new Promise(r => setTimeout(r, 500)); // Let the modal entrance animation settle before visual QA.
  const screenshot = await call('Page.captureScreenshot', { format: 'png' });
  await writeFile(resolve(output, 'panel.png'), Buffer.from(screenshot.data, 'base64'));
  await writeFile(resolve(output, 'panel.txt'), state);
  console.log(state); console.log('Runtime exceptions:', errors);
  if (errors.length) throw new Error('Browser runtime exceptions');
  console.log('PASS: production escrow panel rendered; screenshot:', resolve(output, 'panel.png'));
} finally {
  socket?.close();
  for (const child of started.reverse()) {
    if (!child.pid || child.exitCode !== null) continue;
    child.kill('SIGTERM');
    console.log('Stopped recorded PID', child.pid);
  }
}
