/* 统计桥路上的车辆：数量 / 位置 / 与桥面高差，不靠肉眼 */
const { chromium } = require('C:/Users/<user>/.workbuddy/binaries/node/workspace/node_modules/playwright-core');
const fs = require('fs');
const ROOT = 'C:/Users/<user>/Desktop/neon-changsha';
const EXE = 'C:/Users/<user>/AppData/Local/ms-playwright/chromium_headless_shell-1194/chrome-win/headless_shell.exe';
const OUT = ROOT + '/_audit/deck/';
fs.mkdirSync(OUT, { recursive: true });
(async () => {
  const b = await chromium.launch({ executablePath: EXE, headless: true,
    args: ['--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist','--allow-file-access-from-files'] });
  const p = await b.newPage({ viewport: { width: 1400, height: 800 } });
  p.on('pageerror', e => console.log('ERR', e.message));
  await p.goto('file:///' + ROOT + '/index.html?t=2&q=high', { waitUntil: 'load', timeout: 240000 });
  await p.waitForFunction('window.__dbg && window.__dbg.veg()', null, { timeout: 180000 });
  await p.waitForTimeout(1500);

  const r = await p.evaluate(() => {
    const d = window.__dbg, T = d.TRAFFIC, L = T.list;
    const nB = L.filter(e => e.isBridge).length;
    const rows = [];
    for (const e of L) if (e.isBridge) rows.push({ ri: e.ri, cls: e.r.cls, L: Math.round(e.L), n: e.r.n, lanes: Math.round(e.w * 2 / e.laneW), laneW: +e.laneW.toFixed(2), nl: e.nl });
    // 逐车统计
    let tot = 0, onB = 0, badY = 0, maxErr = 0;
    const perRoad = {};
    for (const g of T.groups) {
      for (const c of g) {
        tot++;
        const rd = L[c.li]; if (!rd) continue;
        if (!rd.isBridge) continue;
        onB++;
        perRoad[rd.ri] = (perRoad[rd.ri] || 0) + 1;
        // 位置
        const pts = rd.r.pts, cum = rd.cum;
        let lo = 0, hi = rd.r.n - 1;
        while (lo + 1 < hi) { const m = (lo + hi) >> 1; if (cum[m] <= c.s) lo = m; else hi = m; }
        const seg = Math.max(1e-3, cum[lo + 1] - cum[lo]);
        const t = (c.s - cum[lo]) / seg;
        const ax = pts[lo * 2], az = pts[lo * 2 + 1];
        const bx = pts[(lo + 1) * 2], bz = pts[(lo + 1) * 2 + 1];
        const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz) || 1;
        const nx = -dz / len, nz = dx / len;
        const off = ((c.lane + 0.5) * rd.laneW) * c.dir;
        const px = ax + dx * t + nx * off, pz = az + dz * t + nz * off;
        const dy = d.deckY(px, pz);
        if (dy > -1e8 && c._py !== undefined) {
          const err = Math.abs(c._py - dy);
          if (err > 0.5) badY++;
          if (err > maxErr) maxErr = err;
        }
      }
    }
    // 每座桥中心 300m 内有多少桥路车（判断"看得见"与否）
    const near = d.BRIDGES.map(B => {
      const n = B.pts.length, a = B.pts[Math.floor(n * 0.30)];
      let k = 0;
      for (const g of T.groups) for (const c of g) {
        const rd = L[c.li]; if (!rd || !rd.isBridge) continue;
        const pts = rd.r.pts, cum = rd.cum;
        let lo = 0, hi = rd.r.n - 1;
        while (lo + 1 < hi) { const m = (lo + hi) >> 1; if (cum[m] <= c.s) lo = m; else hi = m; }
        const seg = Math.max(1e-3, cum[lo + 1] - cum[lo]);
        const t = (c.s - cum[lo]) / seg;
        const px = pts[lo * 2] + (pts[(lo + 1) * 2] - pts[lo * 2]) * t;
        const pz = pts[lo * 2 + 1] + (pts[(lo + 1) * 2 + 1] - pts[lo * 2 + 1]) * t;
        if (Math.hypot(px - a[0], pz - a[1]) < 300) k++;
      }
      return { id: B.id, k };
    });
    return { nB, tot, onB, badY, maxErr: +maxErr.toFixed(3), rows, perRoad, near };
  });
  console.log(JSON.stringify(r, null, 1));
  await b.close();
})();
