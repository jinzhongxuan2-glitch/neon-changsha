/* 机位所在道路的等级/宽度，以及路网按 cls 的里程分布（决定家具做在哪一级路上） */
const { chromium, ROOT, EXE } = require('./_pw');

(async () => {
  const browser = await chromium.launch({
    executablePath: EXE, headless: true,
    args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--allow-file-access-from-files'],
  });
  const page = await browser.newPage({ viewport: { width: 900, height: 500 }, deviceScaleFactor: 1 });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto('file:///' + ROOT + '/index.html?t=2&view=cbd&hour=21&furn=0', { waitUntil: 'load', timeout: 240000 });
  await page.waitForFunction('window.__dbg && window.__dbg.veg()', null, { timeout: 180000 });
  const d = await page.evaluate(() => {
    const d = window.__dbg, R = d.RNB.roads;
    const pts = { shop: [-629, -1151], street: [-145, -261], old: [-900, -500], cbd: [0, 0] };
    const at = {};
    for (const k in pts) {
      const [X, Z] = pts[k];
      let best = null, bd = 1e18;
      for (const r of R) {
        for (let i = 0; i < r.n; i++) {
          const dd = (r.pts[i * 2] - X) ** 2 + (r.pts[i * 2 + 1] - Z) ** 2;
          if (dd < bd) { bd = dd; best = r; }
        }
      }
      at[k] = { cls: best.cls, dist: +Math.sqrt(bd).toFixed(1), n: best.n };
    }
    /* 按 cls 统计里程，以及「2km 内 + 35m 内有楼」的里程（真正会用得上家具的那部分） */
    const kmByCls = {}, kmUrbanByCls = {};
    for (const r of R) {
      let L = 0;
      for (let k = 0; k < r.n - 1; k++) L += Math.hypot(r.pts[(k + 1) * 2] - r.pts[k * 2], r.pts[(k + 1) * 2 + 1] - r.pts[k * 2 + 1]);
      kmByCls[r.cls] = (kmByCls[r.cls] || 0) + L / 1000;
      /* 抽查中点 */
      let urban = 0;
      for (let k = 0; k < r.n - 1; k++) {
        const x = r.pts[k * 2], z = r.pts[k * 2 + 1];
        if (Math.hypot(x, z) > 2600) continue;
        if (d.BD.near(x, z, 35) < 35) urban += Math.hypot(r.pts[(k + 1) * 2] - x, r.pts[(k + 1) * 2 + 1] - z) / 1000;
      }
      kmUrbanByCls[r.cls] = (kmUrbanByCls[r.cls] || 0) + urban;
    }
    const f = (o) => { const r = {}; for (const k in o) r[k] = +o[k].toFixed(1); return r; };
    return { at, kmByCls: f(kmByCls), kmUrbanByCls: f(kmUrbanByCls), roads: R.length };
  });
  console.log(JSON.stringify({ ...d, errs }, null, 1));
  await browser.close();
})();
