import { launchEdge, newTarget, CDP, killEdge, cleanupDir } from './cdp.mjs';
import { setTimeout as sleep } from 'node:timers/promises';
import { join } from 'node:path';

const URL = process.argv[2] || 'https://www.bilibili.com/video/BV1GJ411x7h7/';
const profileDir = join(process.cwd(), '.tmp', 'edge-inspect');
cleanupDir(profileDir);

const edge = await launchEdge({ port: 9333, profileDir });
console.log('edge:', edge.info['Browser'], '| headless');

const target = await newTarget(edge.base, URL);
const cdp = new CDP(target.webSocketDebuggerUrl);
await cdp.ready;
await cdp.send('Runtime.enable');
await cdp.send('Page.enable');

await sleep(9000);

const dump = await cdp.eval(`(() => {
  const out = { url: location.href, title: document.title };
  out.videos = [...document.querySelectorAll('video')].map(v => ({
    cls: v.className, src: (v.src||'').slice(0,80), w: v.videoWidth, h: v.videoHeight,
    paused: v.paused, ready: v.readyState, rect: v.getBoundingClientRect().toJSON(),
    parentChain: (() => { const a=[]; let el=v; for(let i=0;i<7&&el;i++){ a.push(el.tagName+'.'+(el.className||'').toString().slice(0,80)); el=el.parentElement; } return a; })(),
  }));
  out.containers = [...document.querySelectorAll('[class*="bpx-player"], [class*="bilibili-player"]')]
    .slice(0, 40).map(el => el.tagName + '.' + el.className);
  const root = document.querySelector('.bpx-player-container') || document.querySelector('#bilibili-player') || document.querySelector('[class*="player-container"]');
  out.root = root ? root.outerHTML.slice(0, 6000) : null;
  return out;
})()`);

console.log(JSON.stringify(dump, null, 2).slice(0, 12000));
cdp.close();
killEdge(edge.child);
cleanupDir(profileDir);
