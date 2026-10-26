/* 移动端布局检查：390×844（iPhone 14 逻辑分辨率），小地图 + 检视卡片是否越界/遮挡 */
const { chromium, ROOT, EXE } = require('./_pw');
const fs = require('fs');
const OUT = ROOT + '/_audit/mm/';
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const b = await chromium.launch({ executablePath: EXE, headless: true,
    args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--allow-file-access-from-files'] });
  const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  p.on('pageerror', e => console.log('ERR', e.message));
  await p.goto('file:///' + ROOT + '/index.html?t=2&hour=15', { waitUntil: 'load', timeout: 240000 });
  await p.waitForFunction('window.__dbg && window.__dbg.veg()', null, { timeout: 180000 });
  await p.waitForFunction('window.__dbg.MM && window.__dbg.MM.built', null, { timeout: 60000 })
    .catch(() => console.log('MM.built TIMEOUT'));
  await p.waitForTimeout(1200);

  const boxes = await p.evaluate(() => {
    const g = id => { const e = document.getElementById(id); if (!e) return null;
      const r = e.getBoundingClientRect(); return { x: +r.x.toFixed(0), y: +r.y.toFixed(0), w: +r.width.toFixed(0), h: +r.height.toFixed(0) }; };
    return { mm: g('mm'), brand: g('brand'), nav: g('nav'), panel: g('panel'),
             q: getComputedStyle(document.documentElement).getPropertyValue('--x'),
             W: innerWidth, H: innerHeight };
  });
  console.log('BOXES', JSON.stringify(boxes));
  await p.screenshot({ path: OUT + 'mobile.png', timeout: 120000 });

  /* 点一栋楼看卡片在窄屏上的样子 */
  const hit = await p.evaluate(() => {
    const d = window.__dbg, W = innerWidth, H = innerHeight;
    for (let gy = 0.30; gy < 0.85; gy += 0.04)
      for (let gx = 0.20; gx < 0.85; gx += 0.04) {
        const h = d.PICK.at(W * gx, H * gy);
        if (h && h.b.h > 30) { d.PICK.open(h); return { h: +h.b.h.toFixed(0), sx: +(W*gx).toFixed(0), sy: +(H*gy).toFixed(0) }; }
      }
    return null;
  });
  console.log('HIT', JSON.stringify(hit));
  await p.waitForTimeout(900);
  const card = await p.evaluate(() => {
    const r = document.getElementById('inspect').getBoundingClientRect();
    return { x: +r.x.toFixed(0), y: +r.y.toFixed(0), w: +r.width.toFixed(0), h: +r.height.toFixed(0),
             on: document.getElementById('inspect').classList.contains('on') };
  });
  console.log('CARD', JSON.stringify(card));
  await p.screenshot({ path: OUT + 'mobile_card.png', timeout: 120000 });

  await b.close();
})();
