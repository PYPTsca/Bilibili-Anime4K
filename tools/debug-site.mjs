import { launchEdge, newTarget, CDP, killEdge, cleanupDir } from './cdp.mjs';
import { readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { join } from 'node:path';

const URL = process.argv[2] || 'https://www.w3schools.com/html/html5_video.asp';
const profileDir = join(process.cwd(), '.tmp', 'edge-site');
cleanupDir(profileDir);
const edge = await launchEdge({ port: 9336, profileDir });
let cdp;

async function until(fn, timeout = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const v = await fn();
      if (v) return v;
    } catch (e) {}
    await sleep(300);
  }
  return null;
}

try {
  const target = await newTarget(edge.base, URL);
  cdp = new CDP(target.webSocketDebuggerUrl);
  await cdp.ready;
  await cdp.send('Runtime.enable');
  await sleep(3000);

  const code = readFileSync('Bilibili-Anime4K.user.js', 'utf8');
  await cdp.eval(code, { awaitPromise: false });
  const ready = await until(() => cdp.eval('!!window.__BILI_A4K__'));
  console.log('api ready:', !!ready);

  const before = await cdp.eval(`(() => {
    const a = window.__BILI_A4K__;
    return { profile: a.profile, config: a.config, status: a.status };
  })()`);
  console.log('before:', JSON.stringify(before));

  await cdp.eval(`(() => {
    const a = window.__BILI_A4K__;
    a.set({ mode: 'A', secondary: 'none', variant: 'S', output: '1080', strength: 50, showStats: true });
    a.setEnabled(true);
  })()`);

  await cdp.eval(`(() => { const v = document.querySelectorAll('video')[0]; if (v) { v.scrollIntoView({ block: 'center' }); v.play().catch(() => {}); } })()`);
  await sleep(4000);
  const after = await cdp.eval(`(() => {
    const a = window.__BILI_A4K__;
    const host = document.querySelector('[data-bilia4k-ui]');
    const sr = host && host.shadowRoot;
    const chip = sr && sr.querySelector('.stats-chip');
    const btn = sr && sr.querySelector('.btn');
    return {
      profile: a.profile,
      config: a.config,
      status: a.status,
      hostParent: host && host.parentElement && host.parentElement.tagName,
      hostPos: host && getComputedStyle(host).position,
      hostRect: host && host.getBoundingClientRect().toJSON(),
      chipClass: chip && chip.className,
      chipText: chip && chip.textContent,
      chipDisplay: chip && getComputedStyle(chip).display,
      btnRect: btn && btn.getBoundingClientRect().toJSON(),
      videos: [...document.querySelectorAll('video')].map(v => ({ w: v.videoWidth, h: v.videoHeight, paused: v.paused, controls: v.controls, rect: v.getBoundingClientRect().toJSON() })),
    };
  })()`);
  console.log('after:', JSON.stringify(after, null, 2));

  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  (await import('node:fs')).writeFileSync(join(process.cwd(), 'test', 'out', 'site-debug.png'), Buffer.from(shot.data, 'base64'));
} catch (e) {
  console.error('ERR', e);
} finally {
  if (cdp) cdp.close();
  killEdge(edge.child);
  cleanupDir(profileDir);
  process.exit(0);
}
