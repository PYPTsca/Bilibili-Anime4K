(function () {
  if (!/[?&]bilia4k-test=1/.test(location.search)) return;
  if (localStorage.getItem('bilia4k.config.v3')) return;
  var cheap = {
    enabled: false,
    mode: 'A',
    secondary: 'none',
    variant: 'S',
    strength: 60,
    output: '1080',
    fps: 30,
    fxaa: false,
    upscale: 'bicubic',
    sharpen: 0,
    lineThreshold: 80,
    perfGuard: true,
    showStats: true,
    forceHdr: false
  };
  var data = {
    video: cheap,
    bangumi: Object.assign({}, cheap, { enabled: true })
  };
  data['site:' + location.hostname] = Object.assign({}, cheap, {
    enabled: false,
    showStats: false
  });
  localStorage.setItem('bilia4k.config.v3', JSON.stringify(data));
})();
