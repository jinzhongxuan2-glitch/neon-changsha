/* 拾取验收：命中率 / 单次耗时 / 卡片内容 / 高亮是否出现 */
const { chromium, ROOT, EXE } = require('./_pw');
const fs = require('fs');
const OUT = ROOT + '/_audit/pick/';
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const b = await chromium.launch({ executablePath: EXE, headless: true,
    args: ['--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist','--allow-file-access-from-files'] });
  const p = await b.newPage({ viewport: { width: 1400, height: 800 } });
  p.on('pageerror', e => console.log('ERR', e.message));
  await p.goto('file:///' + ROOT + '/index.html?t=2&q=high&view=cbd&hour=15', { waitUntil: 'load', timeout: 240000 });
  await p.waitForFunction('window.__dbg && window.__dbg.veg()', null, { timeout: 180000 });
  await p.evaluate(() => {
    document.querySelectorAll('.ui,#load').forEach(e => e.style.display = 'none');
    const d = window.__dbg;
    d.controls.enableDamping = false; d.controls.autoRotate = false;
  });
  await p.waitForTimeout(1500);

  /* 1) 扫屏幕网格，找命中，挑最高的那栋 */
  const scan = await p.evaluate(() => {
    const d = window.__dbg, P = d.PICK, W = innerWidth, H = innerHeight;
    let hits = 0, tot = 0, t0 = performance.now(), best = null, tMax = 0, nullPt = null, mid = null;
    for (let gy = 0.15; gy < 0.92; gy += 0.06) {
      for (let gx = 0.10; gx < 0.92; gx += 0.045) {
        const sx = W * gx, sy = H * gy;
        const a = performance.now();
        const h = P.at(sx, sy);
        const dt = performance.now() - a;
        if (dt > tMax) tMax = dt;
        tot++;
        if (h) {
          hits++;
          if (!best || h.b.h > best.h) best = { h: +h.b.h.toFixed(1), sx, sy, func: h.b.func, t: +h.t.toFixed(0) };
          /* 视觉验收用一栋「楼顶在画面里」的中层楼：40~110m、离相机 300~800m */
          if (!mid && h.b.h > 40 && h.b.h < 110 && h.t > 300 && h.t < 800) {
            mid = { h: +h.b.h.toFixed(1), sx, sy, t: +h.t.toFixed(0) };
          }
        } else if (!nullPt) {
          nullPt = { sx, sy };
        }
      }
    }
    return { tot, hits, avgMs: +((performance.now() - t0) / tot).toFixed(3),
             maxMs: +tMax.toFixed(2), best, mid, nullPt };
  });
  console.log('SCAN', JSON.stringify(scan));

  if (!scan.best) { console.log('NO HIT'); await b.close(); return; }

  /* 2) 真点一下中层楼：验证事件链路（拖拽判定 + 卡片 + 高亮入镜） */
  await p.evaluate(() => document.querySelectorAll('.ui').forEach(e => e.style.display = ''));
  const aim = scan.mid || scan.best;
  console.log('AIM', JSON.stringify(aim));
  await p.mouse.move(aim.sx, aim.sy);
  await p.waitForTimeout(200);
  await p.screenshot({ path: OUT + 'hover.png', timeout: 120000 });
  await p.mouse.down();
  await p.waitForTimeout(40);
  await p.mouse.up();
  await p.waitForTimeout(520);

  const res = await p.evaluate(() => {
    const q = id => (document.getElementById(id) || {}).textContent;
    const box = document.getElementById('inspect');
    const hls = [];
    /* 按 name 筛：场景里别的物体也用 renderOrder 3，只按序号抓会混进不相干的东西 */
    window.__dbg.scene.traverse(o => { if (o.name && o.name.indexOf('hl') === 0) hls.push(o); });
    const card = box.querySelector('.card');
    return {
      cardOn: box.classList.contains('on'),
      fn: q('insp-fn'), sub: q('insp-sub'), h: q('insp-h'), fl: q('insp-fl'),
      ar: q('insp-ar'), cp: q('insp-cp'), d: q('insp-d'),
      selected: !!window.__dbg.PICK.selected,
      hlCount: hls.length,
      hlVis: hls.map(o => o.visible),
      hlVerts: hls.map(o => (o.geometry.attributes.position ? o.geometry.attributes.position.count : 0)),
      backdrop: getComputedStyle(card).backdropFilter || getComputedStyle(card).webkitBackdropFilter,
    };
  });
  console.log('CLICK', JSON.stringify(res, null, 1));
  await p.screenshot({ path: OUT + 'picked.png', timeout: 120000 });

  /* 3) 点一个「确认无命中」的位置应关闭；Esc 也应关闭 */
  const np = scan.nullPt;
  console.log('NULLPT', JSON.stringify(np));
  if (np) {
    await p.mouse.click(np.sx, np.sy);
    await p.waitForTimeout(420);
    const c1 = await p.evaluate(() => document.getElementById('inspect').classList.contains('on'));
    console.log('CLOSE_ON_MISS', c1 ? 'STILL OPEN (bad)' : 'closed (ok)');
  }
  /* 重开一次再测 Esc */
  await p.mouse.click(aim.sx, aim.sy);
  await p.waitForTimeout(360);
  const reOpened = await p.evaluate(() => document.getElementById('inspect').classList.contains('on'));
  await p.keyboard.press('Escape');
  await p.waitForTimeout(420);
  const escClosed = await p.evaluate(() => document.getElementById('inspect').classList.contains('on'));
  console.log('REOPEN', reOpened ? 'ok' : 'FAIL', '· ESC_CLOSE', escClosed ? 'FAIL' : 'ok');

  await b.close();
})();
