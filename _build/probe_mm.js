/* 小地图验收：底图是否画出来 / 水陆建筑分得开 / 相机标记与朝向对不对 / 点击跳转是否准确 */
const { chromium, ROOT, EXE } = require('./_pw');
const fs = require('fs');
const OUT = ROOT + '/_audit/mm/';
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const b = await chromium.launch({ executablePath: EXE, headless: true,
    args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--allow-file-access-from-files'] });
  const p = await b.newPage({ viewport: { width: 1400, height: 800 } });
  p.on('pageerror', e => console.log('ERR', e.message));
  await p.goto('file:///' + ROOT + '/index.html?t=2&q=high&view=cbd&hour=15', { waitUntil: 'load', timeout: 240000 });
  await p.waitForFunction('window.__dbg && window.__dbg.veg()', null, { timeout: 180000 });
  await p.waitForFunction('window.__dbg.MM && window.__dbg.MM.built', null, { timeout: 60000 })
    .catch(() => console.log('MM.built TIMEOUT'));
  await p.waitForTimeout(900);

  /* 1) 底图统计：非背景像素占比 + 水域/建筑色块是否都在 */
  const stat = await p.evaluate(() => {
    const d = window.__dbg;
    const cv = document.getElementById('mm-c');
    const g = cv.getContext('2d');
    const im = g.getImageData(0, 0, cv.width, cv.height).data;
    const hist = {};
    let nonBg = 0, water = 0, bldg = 0, bright = 0;
    for (let i = 0; i < im.length; i += 4) {
      const r = im[i], gg = im[i + 1], bb = im[i + 2];
      const key = r + ',' + gg + ',' + bb;
      hist[key] = (hist[key] || 0) + 1;
      if (r === 5 && gg === 8 && bb === 14) continue;   // 背景 #05080e
      nonBg++;
      if (r === 10 && gg === 26 && bb === 42) water++;
      if (r > 20 && bb > r) bldg++;
      if (r > 70) bright++;
    }
    const top = Object.entries(hist).sort((a, b) => b[1] - a[1]).slice(0, 6);
    return { built: d.MM.built, tot: im.length / 4, nonBg, water, bldg, bright,
             top, box: document.getElementById('mm').getBoundingClientRect().toJSON() };
  });
  console.log('BASE', JSON.stringify(stat));

  /* 2) 相机标记投影：把世界原点投到地图坐标，跟手算的应一致 */
  const proj = await p.evaluate(() => {
    const d = window.__dbg, MM = d.MM;
    const cam = d.camera.position;
    const pts = [[0, 0], [-6132.1, -7682.5], [7358.5, 7516.7], [cam.x, cam.z]];
    return pts.map(([x, z]) => ({ x, z, px: +MM.wx(x).toFixed(1), py: +MM.wz(z).toFixed(1) }));
  });
  console.log('PROJ', JSON.stringify(proj));

  await p.screenshot({ path: OUT + 'full.png', timeout: 120000 });
  await p.locator('#mm .box').screenshot({ path: OUT + 'box.png', timeout: 60000 });

  /* 3) 悬停读经纬度 */
  const box = await p.locator('#mm .box').boundingBox();
  await p.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await p.waitForTimeout(200);
  const hov = await p.evaluate(() => document.getElementById('mm-co').textContent);
  console.log('HOVER_CENTER', hov, '(应≈ 28.1930N 112.9750E)');

  /* 4) 点击小地图右下角 → 相机应该朝东南飞过去 */
  const before = await p.evaluate(() => window.__dbg.camera.position.toArray().map(v => +v.toFixed(1)));
  const clickPt = { sx: box.x + box.width * 0.78, sy: box.y + box.height * 0.80 };
  const expect = await p.evaluate(({ sx, sy }) => {
    const cv = document.getElementById('mm-c');
    const r = cv.getBoundingClientRect();
    const px = (sx - r.left) / r.width * cv.width;
    const py = (sy - r.top) / r.height * cv.height;
    const MM = window.__dbg.MM;
    return { rect: [r.left, r.top, r.width, r.height], px: +px.toFixed(1), py: +py.toFixed(1),
             X: +MM.ux(px).toFixed(0), Z: +MM.uz(py).toFixed(0) };
  }, clickPt);
  console.log('CLICK_PT', JSON.stringify(clickPt), '→', JSON.stringify(expect));

  await p.mouse.click(clickPt.sx, clickPt.sy);
  await p.waitForTimeout(120);
  const mid = await p.evaluate(() => ({
    tgt: window.__dbg.controls.target.toArray().map(v => +v.toFixed(1)),
    enabled: window.__dbg.controls.enabled,
    jump: window.__dbg.MM.lastJump,
    fly: window.__dbg.fly ? { k: +window.__dbg.fly.k.toFixed(3), t1: window.__dbg.fly.t1.toArray().map(v => +v.toFixed(0)) } : null,
    mode: window.__dbg.mode,
  }));
  console.log('AFTER_120ms', JSON.stringify(mid));

  /* 等飞行结束（headless 的 rAF 节流会让 1.25s 的飞行拖到好几秒，不能写死等待） */
  let waited = 0;
  while (waited < 12000) {
    await p.waitForTimeout(250); waited += 250;
    if (await p.evaluate(() => window.__dbg.controls.enabled)) break;
  }
  const after = await p.evaluate(() => ({
    cam: window.__dbg.camera.position.toArray().map(v => +v.toFixed(1)),
    tgt: window.__dbg.controls.target.toArray().map(v => +v.toFixed(1)),
  }));
  console.log('CLICK_JUMP', JSON.stringify({ before, after, waitMs: waited,
    errX: +(after.tgt[0] - expect.X).toFixed(0), errZ: +(after.tgt[2] - expect.Z).toFixed(0) }));
  await p.screenshot({ path: OUT + 'jump.png', timeout: 120000 });

  /* 5) 联动：选中一栋楼，小地图上应该出现方框（读像素没有，改用几何断言） */
  const link = await p.evaluate(() => {
    const d = window.__dbg, W = innerWidth, H = innerHeight;
    /* 点击跳转之后相机在城郊，屏幕中心未必有楼 —— 扫一块找一栋 */
    for (let gy = 0.30; gy < 0.92; gy += 0.04) {
      for (let gx = 0.28; gx < 0.84; gx += 0.04) {
        const h = d.PICK.at(W * gx, H * gy);
        if (h && h.b.h > 30) {
          d.PICK.open(h);
          return { ok: true, h: +h.b.h.toFixed(1), sel: !!d.PICK.selected,
                   sx: +(W * gx).toFixed(0), sy: +(H * gy).toFixed(0) };
        }
      }
    }
    return { ok: false, why: 'no hit' };
  });
  console.log('LINK', JSON.stringify(link));
  await p.waitForTimeout(700);
  await p.locator('#mm .box').screenshot({ path: OUT + 'box_sel.png', timeout: 60000 });

  /* 帧率影响：小地图每帧 drawImage 352² 是否拖慢 */
  const fps = await p.evaluate(async () => {
    const el = document.getElementById('s-fps');
    const out = [];
    for (let i = 0; i < 3; i++) {
      await new Promise(r => setTimeout(r, 900));
      out.push(+el.textContent);
    }
    return out;
  });
  console.log('FPS', JSON.stringify(fps));

  await b.close();
})();
