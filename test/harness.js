(function () {
  'use strict';

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  async function until(fn, timeout = 8000, interval = 100) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      try {
        const value = await fn();
        if (value) return value;
      } catch (e) {
        /* retry */
      }
      await wait(interval);
    }
    return null;
  }

  const approx = (a, b, tol = 3) => Math.abs(a - b) <= tol;
  const SITE_KEY = 'site:' + location.hostname;

  window.__wheelHits = 0;
  window.addEventListener('wheel', () => {
    window.__wheelHits++;
  });

  window.__runA4K = async function (mode) {
    const results = [];
    const push = (name, pass, extra) => {
      results.push({ name, pass: !!pass, extra: extra === undefined ? null : extra });
    };

    const api = await until(() => window.__BILI_A4K__, 12000);
    if (!api) return { results: [{ name: 'api exists', pass: false }], fatal: true };

    const video = document.getElementById('v');
    try {
      video.muted = true;
      await video.play();
    } catch (e) {}
    await until(() => video.readyState >= 2, 8000);
    await until(() => video.videoWidth > 0, 8000);

    const canvas = () => document.querySelector('.bilia4k-canvas');
    const host = () => document.querySelector('[data-bilia4k-ui]');
    const sr = () => (host() ? host().shadowRoot : null);

    const attached = await until(() => api.status.attached, 8000);
    push('player attached', !!attached, api.status.kind);

    if (mode === 'video-initial') {
      const chipBefore = sr() && sr().querySelector('.stats-chip');
      push(
        'stats chip shows inactive state',
        !!chipBefore && chipBefore.classList.contains('show') && chipBefore.textContent.includes('滤镜已关闭'),
        chipBefore && chipBefore.textContent,
      );
    }

    if (mode === 'video-initial') {
      push('video profile', api.profile === 'video', api.profile);
      push('video disabled by seed', api.config.enabled === false, api.config.enabled);
      push('canvas mounted', !!canvas());
      push('canvas hidden while disabled', !!canvas() && getComputedStyle(canvas()).display === 'none');
      push('ui host mounted', !!host());
      push('ui host inside player', !!host() && document.getElementById('player').contains(host()));

      api.setEnabled(true);
      const active = await until(() => api.status.active, 8000);
      push('filter activates', !!active, api.status.blocked);
      push('video visually hidden', getComputedStyle(video).visibility === 'hidden');

      const p1 = await api.probe();
      push('probe returns frame', !!p1 && p1.width > 0, p1 && [p1.width, p1.height]);
      if (p1) {
        push('variant S target height 864', p1.height === 864, p1.height);
        push('frame not black', p1.center[0] + p1.center[1] + p1.center[2] > 30, p1.center);
        const tl = p1.topLeft;
        push('orientation top-left red', tl[0] > 120 && tl[1] < 110 && tl[2] < 110, tl);
      }

      for (const m of ['A', 'B', 'C']) {
        api.set({ mode: m, secondary: 'none' });
        await wait(250);
        const p = await api.probe();
        push('render mode ' + m, !!p && p.width > 0, p && [p.width, p.height]);
      }

      api.set({ mode: 'A', secondary: 'A' });
      await wait(300);
      push('secondary A renders', !!(await api.probe()));

      api.set({ secondary: 'C' });
      await wait(300);
      push('secondary C renders', !!(await api.probe()));

      api.set({ mode: 'C', secondary: 'none' });
      await wait(250);
      push('denoise mode renders', !!(await api.probe()));

      api.set({ mode: 'A', secondary: 'none', variant: 'M' });
      await wait(300);
      const p5 = await api.probe();
      push('variant M target height 1080', !!p5 && p5.height === 1080, p5 && p5.height);

      const rect = canvas().getBoundingClientRect();
      const vrect = video.getBoundingClientRect();
      push(
        'canvas covers video box',
        approx(rect.width, vrect.width) && approx(rect.height, vrect.height),
        [rect.width, rect.height, vrect.width, vrect.height],
      );

      api.openPanel(true);
      await wait(250);
      const wrap = sr() && sr().querySelector('.wrap');
      push('panel opens', !!wrap && wrap.classList.contains('open'));

      const segBtn = sr() && sr().querySelector('[data-seg="variant"] button[data-v="L"]');
      if (segBtn) {
        segBtn.click();
        await wait(300);
      }
      push('seg button updates config', api.config.variant === 'L', api.config.variant);

      const statsCb = sr() && sr().querySelector('input[data-k="showStats"]');
      if (statsCb) {
        statsCb.checked = false;
        statsCb.dispatchEvent(new Event('change', { bubbles: true }));
        await wait(250);
        const off = api.config.showStats === false;
        statsCb.checked = true;
        statsCb.dispatchEvent(new Event('change', { bubbles: true }));
        await wait(250);
        push('stats toggle via UI', off && api.config.showStats === true, api.config.showStats);
      } else {
        push('stats toggle via UI', false, 'checkbox missing');
      }

      const info = sr() && sr().querySelector('.info');
      const tip = sr() && sr().querySelector('.tip');
      if (info && tip) {
        info.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, composed: true }));
        await wait(120);
        push('tooltip shows', tip.classList.contains('show') && tip.textContent.length > 10, tip.textContent.slice(0, 24));
        info.dispatchEvent(new PointerEvent('pointerout', { bubbles: true, composed: true }));
      } else {
        push('tooltip shows', false, 'missing tip/info');
      }

      api.set({ showStats: true, variant: 'S' });
      await wait(800);
      const chip = sr() && sr().querySelector('.stats-chip');
      push('stats chip visible', !!chip && chip.classList.contains('show'), chip && chip.textContent);

      window.__wheelHits = 0;
      const panel = sr() && sr().querySelector('.panel');
      panel.dispatchEvent(new WheelEvent('wheel', { bubbles: true, composed: true, cancelable: true }));
      const panelHits = window.__wheelHits;
      document.getElementById('player').dispatchEvent(new WheelEvent('wheel', { bubbles: true, composed: true, cancelable: true }));
      const playerHits = window.__wheelHits;
      push('wheel over panel intercepted', panelHits === 0, panelHits);
      push('wheel over player not intercepted', playerHits === 1, playerHits);

      const player = document.getElementById('player');
      player.style.width = '640px';
      player.style.height = '360px';
      await wait(500);
      const cw = canvas().getBoundingClientRect().width;
      push('resize relayouts canvas', approx(cw, 640), cw);
      player.style.width = '960px';
      player.style.height = '540px';
      await wait(400);

      await wait(1200);
      push('button hit-test sees host', host().getAttribute('data-hit') === 'self', host().getAttribute('data-hit'));

      api.set({ strength: 85 });
      await wait(250);
      push('strength saved', api.config.strength === 85, api.config.strength);

      return { results, status: api.status, probe: api.lastProbe };
    }

    if (mode === 'bangumi') {
      push('bangumi profile', api.profile === 'bangumi', api.profile);
      push('bangumi enabled by seed', api.config.enabled === true, api.config.enabled);
      const active = await until(() => api.status.active, 8000);
      push('bangumi filter auto starts', !!active, api.status.blocked);
      const probe = await api.probe();
      push('bangumi renders', !!probe && probe.width > 0, probe && [probe.width, probe.height]);

      api.set({ strength: 40, enabled: false });
      await wait(250);
      push('bangumi remembers 40', api.config.strength === 40, api.config.strength);

      const quality = document.getElementById('quality');
      quality.textContent = 'HDR 真彩';
      quality.style.display = 'block';
      api.setEnabled(true);
      const blocked = await until(() => api.status.blocked === 'hdr', 5000);
      push('HDR blocks filter', !!blocked, api.status.blocked);
      push('HDR stops rendering', api.status.active === false, api.status.active);
      api.set({ forceHdr: true });
      const forced = await until(() => api.status.active, 5000);
      push('forceHdr overrides block', !!forced, api.status.blocked);
      api.set({ forceHdr: false });
      quality.textContent = '';
      quality.style.display = 'none';
      return { results, status: api.status, probe: api.lastProbe };
    }

    if (mode === 'site-initial') {
      push('site profile', api.profile === SITE_KEY, api.profile);
      push('site default disabled', api.config.enabled === false, api.config.enabled);
      push('site default hides stats', api.config.showStats === false, api.config.showStats);
      api.setEnabled(true);
      const active = await until(() => api.status.active, 8000);
      push('site filter activates', !!active, api.status.blocked);
      push('site kind bpx', api.status.kind === 'bpx', api.status.kind);
      const p = await api.probe();
      push('site renders', !!p && p.width > 0, p && [p.width, p.height]);
      api.set({ showStats: true, strength: 55 });
      await wait(800);
      const chip = sr() && sr().querySelector('.stats-chip');
      push('site stats chip visible', !!chip && chip.classList.contains('show'), chip && chip.textContent);
      return { results, status: api.status, probe: api.lastProbe };
    }

    if (mode === 'generic-initial') {
      push('site profile persists', api.profile === SITE_KEY, api.profile);
      push('site enabled persists', api.config.enabled === true, api.config.enabled);
      push('generic kind', api.status.kind === 'generic', api.status.kind);
      push('canvas mounted', !!canvas());
      push('ui host on body', !!host() && host().parentElement === document.body, host() && host().parentElement && host().parentElement.tagName);
      push('ui host fixed', !!host() && getComputedStyle(host()).position === 'fixed', host() && getComputedStyle(host()).position);
      push('native controls flagged', api.status.nativeControls === true, api.status.nativeControls);

      const p = await api.probe();
      push('generic renders', !!p && p.width > 0, p && [p.width, p.height]);
      push('generic target 864', !!p && p.height === 864, p && p.height);

      const vr = video.getBoundingClientRect();
      const hr = host().getBoundingClientRect();
      push('host anchored near video', approx(hr.left, vr.left + 12, 4) && approx(hr.top, vr.top + 10, 4), [hr.left, hr.top, vr.left, vr.top]);

      const crect = canvas().getBoundingClientRect();
      push('generic canvas covers video', approx(crect.width, vr.width, 4) && approx(crect.height, vr.height, 4), [crect.width, crect.height]);

      api.openPanel(true);
      await wait(250);
      const warn = sr() && sr().querySelector('.warnline');
      push('native controls warning', !!warn && warn.textContent.indexOf('原生控件') >= 0, warn && warn.textContent);

      window.__wheelHits = 0;
      const panel = sr() && sr().querySelector('.panel');
      panel.dispatchEvent(new WheelEvent('wheel', { bubbles: true, composed: true, cancelable: true }));
      push('generic wheel intercepted', window.__wheelHits === 0, window.__wheelHits);

      window.scrollTo(0, 120);
      await wait(350);
      const vr2 = video.getBoundingClientRect();
      const hr2 = host().getBoundingClientRect();
      push('host follows scroll', approx(hr2.top, vr2.top + 10, 4), [hr2.top, vr2.top]);
      window.scrollTo(0, 0);
      await wait(200);
      return { results, status: api.status, probe: api.lastProbe };
    }

    if (mode === 'video-reload') {
      push('video profile after reload', api.profile === 'video', api.profile);
      push('video strength persisted 85', api.config.strength === 85, api.config.strength);
      push('video enabled persisted', api.config.enabled === true, api.config.enabled);
      return { results, status: api.status, probe: api.lastProbe };
    }

    if (mode === 'site-reload') {
      push('site profile after reload', api.profile === SITE_KEY, api.profile);
      push('site strength persisted 55', api.config.strength === 55, api.config.strength);
      push('site enabled persisted', api.config.enabled === true, api.config.enabled);
      push(
        'video profile isolated (85)',
        (() => {
          try {
            const raw = JSON.parse(localStorage.getItem('bilia4k.config.v3') || '{}');
            return raw.video && raw.video.strength === 85;
          } catch (e) {
            return false;
          }
        })(),
      );
      return { results, status: api.status, probe: api.lastProbe };
    }

    return { results };
  };
})();
