import { launchEdge, newTarget, CDP, killEdge, cleanupDir } from './cdp.mjs';
import { startServer } from '../test/serve.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const ROOT = process.cwd();
const PORT = 4173;
const BASE = `http://127.0.0.1:${PORT}`;
const profileDir = join(ROOT, '.tmp', 'edge-run');

cleanupDir(profileDir);
mkdirSync(join(ROOT, 'test', 'out'), { recursive: true });

const server = await startServer(ROOT, PORT);
const edge = await launchEdge({ port: 9333, profileDir });
const errors = [];
let cdp = null;

async function waitReady(timeout = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const s = await cdp.eval('document.readyState + ":" + (typeof window.__runA4K === "function")', {
        awaitPromise: false,
      });
      if (s === 'complete:true') return;
    } catch (e) {
      /* navigation in progress */
    }
    await sleep(250);
  }
  throw new Error('page did not become ready');
}

async function shot(name) {
  const res = await cdp.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(ROOT, 'test', 'out', name), Buffer.from(res.data, 'base64'));
}

try {
  const target = await newTarget(edge.base, `${BASE}/video?bilia4k-test=1`);
  cdp = new CDP(target.webSocketDebuggerUrl);
  await cdp.ready;
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  cdp.on('Runtime.exceptionThrown', (p) => {
    errors.push('exception: ' + (p.exceptionDetails?.exception?.description || p.exceptionDetails?.text || ''));
  });
  cdp.on('Runtime.consoleAPICalled', (p) => {
    if (p.type === 'error') {
      errors.push('console.error: ' + p.args.map((a) => a.value ?? a.description ?? '').join(' '));
    }
  });

  await waitReady();
  const r1 = await cdp.eval('window.__runA4K("video-initial")');

  await cdp.eval('window.__BILI_A4K__.openPanel(true)');
  await sleep(500);
  await shot('panel.png');
  await cdp.eval('window.__BILI_A4K__.openPanel(false)');
  await sleep(400);
  await shot('filtered.png');

  await cdp.send('Page.navigate', { url: `${BASE}/bangumi/play/ep1?bilia4k-test=1` });
  await waitReady();
  const r2 = await cdp.eval('window.__runA4K("bangumi")');

  await cdp.send('Page.navigate', { url: `${BASE}/video?bilia4k-test=1` });
  await waitReady();
  const r3 = await cdp.eval('window.__runA4K("video-reload")');

  const all = [...r1.results, ...r2.results, ...r3.results];
  let fails = 0;
  for (const r of all) {
    if (!r.pass) fails++;
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.extra !== null ? '  ' + JSON.stringify(r.extra) : ''}`);
  }
  console.log(`\n${all.length - fails}/${all.length} passed`);
  console.log('status video:', JSON.stringify(r1.status));
  console.log('status bangumi:', JSON.stringify(r2.status));
  if (errors.length) {
    console.log('\nerrors:');
    for (const e of errors.slice(0, 12)) console.log('  ' + e);
  }
  process.exitCode = fails ? 1 : 0;
} catch (e) {
  console.error('RUNNER ERROR:', e && e.stack ? e.stack : e);
  process.exitCode = 2;
} finally {
  if (cdp) cdp.close();
  killEdge(edge.child);
  try {
    spawnSync('taskkill', ['/PID', String(edge.child.pid), '/T', '/F'], { stdio: 'ignore' });
  } catch (e) {}
  server.close();
  cleanupDir(profileDir);
  setTimeout(() => process.exit(process.exitCode || 0), 300);
}
