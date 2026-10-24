/* 色彩基准：固定三个机位拍图，并输出画面亮度分布，用于改前/改后对比 */
const { chromium } = require('C:/Users/<user>/.workbuddy/binaries/node/workspace/node_modules/playwright-core');
const EXE = 'C:/Users/<user>/AppData/Local/ms-playwright/chromium_headless_shell-1194/chrome-win/headless_shell.exe';
const OUT = 'C:/Users/<user>/Desktop/neon-changsha/_shots/';
const TAG = process.argv[2] || 'before';

const SHOTS = [
  { name: 'day_cbd',  hour: 12, view: 'cbd' },
  { name: 'dusk',     hour: 18.6, view: 'cbd' },
  { name: 'night',    hour: 21, view: 'cbd' },
  { name: 'all_day',  hour: 11, view: 'all' },
];

(async () => {
  const b = await chromium.launch({ executablePath: EXE, headless: true,
    args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--allow-file-access-from-files'] });
  const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.goto('file:///C:/Users/<user>/Desktop/neon-changsha/index.html?t=2',
    { waitUntil: 'load', timeout: 240000 });
  await p.waitForFunction('window.__dbg && window.__dbg.veg()', null, { timeout: 180000 });
  await p.waitForTimeout(2500);

  for (const s of SHOTS) {
    const stat = await p.evaluate((s) => {
      const d = window.__dbg;
      d.applyTime(s.hour);
      const h = d.HOME[s.view];
      d.camera.position.copy(h.p);
      d.controls.target.copy(h.t);
      d.controls.update();
      return {
        fog: d.scene.fog ? d.scene.fog.color.toArray().map(v => +v.toFixed(4)) : null,
        exp: d.renderer.toneMappingExposure
      };
    }, s);
    await p.waitForTimeout(1600);
    await p.screenshot({ path: OUT + 'color_' + TAG + '_' + s.name + '.png', timeout: 180000 });

    // 从 canvas 直接取样：均值与分位（避免再解码 png）
    const px = await p.evaluate(() => {
      const c = document.querySelector('canvas');
      const cv = document.createElement('canvas');
      cv.width = 320; cv.height = 180;
      const g = cv.getContext('2d');
      g.drawImage(c, 0, 0, 320, 180);
      const a = g.getImageData(0, 0, 320, 180).data;
      const lum = [];
      let rs = 0, gs = 0, bs = 0;
      for (let i = 0; i < a.length; i += 4) {
        rs += a[i]; gs += a[i + 1]; bs += a[i + 2];
        lum.push(0.299 * a[i] + 0.587 * a[i + 1] + 0.114 * a[i + 2]);
      }
      const n = lum.length;
      lum.sort((x, y) => x - y);
      return {
        rgb: [Math.round(rs / n), Math.round(gs / n), Math.round(bs / n)],
        p10: Math.round(lum[(n * 0.1) | 0]),
        p50: Math.round(lum[(n * 0.5) | 0]),
        p90: Math.round(lum[(n * 0.9) | 0])
      };
    });
    console.log(s.name.padEnd(9), JSON.stringify(px), 'fog', JSON.stringify(stat.fog), 'exp', stat.exp);
  }
  console.log('errors:', errs.slice(0, 2).join('|') || 'none');
  await b.close();
})();
