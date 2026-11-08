import { launchEdge, newTarget, CDP, killEdge, cleanupDir } from './cdp.mjs';
import { startServer } from '../test/serve.mjs';
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const PORT = 4173;
const BASE = `http://127.0.0.1:${PORT}`;
const profileDir = join(ROOT, '.tmp', 'edge-geom');
cleanupDir(profileDir);
const server = await startServer(ROOT, PORT);
const edge = await launchEdge({ port: 9334, profileDir });
let cdp;

const geom = `(() => {
  const p = document.getElementById('player');
  const w = p.querySelector('.bpx-player-video-wrap');
  const v = document.getElementById('v');
  const c = document.querySelector('.bilia4k-canvas');
  const r = (el) => el ? { x: Math.round(el.getBoundingClientRect().x), y: Math.round(el.getBoundingClientRect().y), w: Math.round(el.getBoundingClientRect().width), h: Math.round(el.getBoundingClientRect().height) } : null;
  return JSON.stringify({
    player: r(p), wrap: r(w), video: r(v), canvas: r(c),
    canvasStyle: c ? { top: c.style.top, left: c.style.left, width: c.style.width, height: c.style.height } : null,
    wrapPos: w ? getComputedStyle(w).position : null,
    src: v ? [v.videoWidth, v.videoHeight] : null,
    target: window.__BILI_A4K__ ? window.__BILI_A4K__.status.target : null,
  });
})()`;

try {
  const target = await newTarget(edge.base, `${BASE}/video?bilia4k-test=1`);
  cdp = new CDP(target.webSocketDebuggerUrl);
  await cdp.ready;
  await cdp.send('Runtime.enable');
  await sleep(1500);
  await cdp.eval('window.__BILI_A4K__.setEnabled(true)');
  await sleep(1200);
  console.log('initial   ', await cdp.eval(geom));
  await cdp.eval(`document.getElementById('player').style.width='640px'; document.getElementById('player').style.height='360px'`);
  await sleep(600);
  console.log('640x360   ', await cdp.eval(geom));
  await cdp.eval(`document.getElementById('player').style.width='960px'; document.getElementById('player').style.height='540px'`);
  await sleep(600);
  console.log('restored  ', await cdp.eval(geom));
  await cdp.eval('window.__BILI_A4K__.openPanel(true)');
  await sleep(400);
  console.log('panel open', await cdp.eval(geom));
  await cdp.eval('window.__BILI_A4K__.openPanel(false)');
  await sleep(600);
  console.log('panel shut', await cdp.eval(geom));
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(ROOT, 'test', 'out', 'geom-shut.png'), Buffer.from(shot.data, 'base64'));
  const px = await cdp.eval(`(() => {
    const c = document.querySelector('.bilia4k-canvas');
    const gl = c.getContext('webgl');
    const buf = new Uint8Array(4);
    gl.readPixels(10, c.height - 10, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    return [buf[0], buf[1], buf[2], buf[3]];
  })()`);
  console.log('top-left pixel', px);
} catch (e) {
  console.error('ERR', e);
} finally {
  if (cdp) cdp.close();
  killEdge(edge.child);
  server.close();
  cleanupDir(profileDir);
  process.exit(0);
}
