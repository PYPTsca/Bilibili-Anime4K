import { spawn } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const EDGE =
  process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

export async function launchEdge({ port = 9333, profileDir, headless = true } = {}) {
  if (!profileDir) throw new Error('profileDir required');
  mkdirSync(profileDir, { recursive: true });
  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-features=msEdgeSidebarV2',
    '--autoplay-policy=no-user-gesture-required',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--enable-unsafe-swiftshader',
    '--force-device-scale-factor=1',
    '--window-size=1280,800',
    'about:blank',
  ];
  if (headless) args.unshift('--headless=new');
  const child = spawn(EDGE, args, { stdio: 'ignore', detached: false });
  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${base}/json/version`);
      if (r.ok) {
        const info = await r.json();
        return { child, base, info, profileDir };
      }
    } catch {}
    await sleep(200);
  }
  child.kill();
  throw new Error('Edge did not expose CDP in time');
}

export async function newTarget(base, url) {
  const r = await fetch(`${base}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
  if (!r.ok) throw new Error(`new target failed: ${r.status}`);
  return r.json();
}

export class CDP {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl.replace('://localhost:', '://127.0.0.1:'));
    this.id = 0;
    this.pending = new Map();
    this.events = new Map();
    this.ready = new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = (e) => reject(new Error('ws error'));
    });
    this.ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      } else if (msg.method) {
        const list = this.events.get(msg.method) || [];
        for (const fn of list) fn(msg.params);
      }
    };
  }
  on(method, fn) {
    if (!this.events.has(method)) this.events.set(method, []);
    this.events.get(method).push(fn);
  }
  send(method, params = {}, timeout = 60000) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP timeout: ${method}`));
        }
      }, timeout);
    });
  }
  async eval(expression, { awaitPromise = true, returnByValue = true } = {}) {
    const res = await this.send(
      'Runtime.evaluate',
      { expression, awaitPromise, returnByValue, userGesture: true },
      180000,
    );
    if (res.exceptionDetails) {
      throw new Error(`eval failed: ${res.exceptionDetails.text} ${res.exceptionDetails.exception?.description || ''}`);
    }
    return res.result?.value;
  }
  close() { this.ws.close(); }
}

export function killEdge(child) {
  try { child.kill('SIGKILL'); } catch {}
}

export function cleanupDir(dir) {
  try { rmSync(dir, { recursive: true, force: true }); } catch {}
}
