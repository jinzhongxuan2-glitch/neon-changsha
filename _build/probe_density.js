/* 车流密度评估：全路网总长 / 各等级密度 / 桥路配额 */
const { chromium } = require('C:/Users/<user>/.workbuddy/binaries/node/workspace/node_modules/playwright-core');
const ROOT = 'C:/Users/<user>/Desktop/neon-changsha';
const EXE = 'C:/Users/<user>/AppData/Local/ms-playwright/chromium_headless_shell-1194/chrome-win/headless_shell.exe';
(async () => {
  const b = await chromium.launch({ executablePath: EXE, headless: true,
    args: ['--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist','--allow-file-access-from-files'] });
  const p = await b.newPage({ viewport: { width: 800, height: 500 } });
  await p.goto('file:///' + ROOT + '/index.html?t=2&q=low', { waitUntil: 'load', timeout: 240000 });
  await p.waitForFunction('window.__dbg && window.__dbg.veg()', null, { timeout: 180000 });
  await p.waitForTimeout(800);

  const r = await p.evaluate(() => {
    const d = window.__dbg, T = d.TRAFFIC, L = T.list;
    let Lall = 0, Lb = 0;
    const perCls = {};
    for (const e of L) {
      Lall += e.L;
      if (e.isBridge) Lb += e.L;
      const k = 'cls' + e.r.cls;
      perCls[k] = perCls[k] || { n: 0, L: 0, cars: 0 };
      perCls[k].n++; perCls[k].L += e.L;
    }
    // 按当前分配算每 cls 的车
    const carPer = {};
    for (const c of T.cars) {
      const e = L[c.li]; if (!e) continue;
      const k = 'cls' + e.r.cls;
      carPer[k] = (carPer[k] || 0) + 1;
    }
    for (const k in perCls) perCls[k].cars = carPer[k] || 0;
    // 长度加权后各 cls 期望车数
    const expd = {};
    for (const k in perCls) expd[k] = Math.round(18000 * perCls[k].L / Lall);
    return {
      roads: L.length, Lall: Math.round(Lall), Lb: Math.round(Lb),
      bridgeSharePct: +(Lb / Lall * 100).toFixed(2),
      roadSharePct: +(Lb ? (Lb / Lall * 100) : 0).toFixed(2),
      perCls: Object.fromEntries(Object.entries(perCls).sort().map(([k, v]) =>
        [k, { roads: v.n, Lkm: +(v.L / 1000).toFixed(1), cars: v.cars,
              perKm: +(v.cars / (v.L / 1000)).toFixed(1), ifLenWeighted: expd[k] }]))
    };
  });
  console.log(JSON.stringify(r, null, 1));
  await b.close();
})();
