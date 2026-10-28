/* 车在桥面上的「横向落点」直方图（相对桥走线的有符号偏移，世界坐标）
   用 updateTraffic 的同一套公式重算每车位置，不做近似。
   同时打印该处桥走线的半宽，用来判断车有没有贴到护栏 / 压到标线上。 */
const { chromium, ROOT, EXE } = require('./_pw');
(async () => {
  const b = await chromium.launch({ executablePath: EXE, headless: true,
    args: ['--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist','--allow-file-access-from-files'] });
  const p = await b.newPage({ viewport: { width: 800, height: 500 } });
  p.on('pageerror', e => console.log('ERR', e.message));
  await p.goto('file:///' + ROOT + '/index.html?t=2&q=low', { waitUntil: 'load', timeout: 240000 });
  await p.waitForFunction('window.__dbg && window.__dbg.veg()', null, { timeout: 180000 });
  await p.waitForTimeout(800);

  const r = await p.evaluate(() => {
    const d = window.__dbg;


    const near = (bp, bn, x, z) => {
      let best = null;
      for (let j = 0; j + 1 < bn; j++) {
        const x0 = bp[j*2], z0 = bp[j*2+1];
        const ex = bp[(j+1)*2] - x0, ez = bp[(j+1)*2+1] - z0;
        const LL = ex*ex + ez*ez; if (LL < 1e-9) continue;
        let t = ((x-x0)*ex + (z-z0)*ez) / LL;
        t = t < 0 ? 0 : (t > 1 ? 1 : t);
        const qx = x0 + ex*t, qz = z0 + ez*t;
        const dist = Math.hypot(qx-x, qz-z);
        if (!best || dist < best.dist) best = { dist, qx, qz, tx: ex, tz: ez };
      }
      return best;
    };

    const paths = d.BRIDGES.map(B => {
      const bp = [];
      for (const q of B.pts) bp.push(q[0], q[1]);
      const S = d.deckSection(d.BRIDGE_WIDTH[B.id] || 26, d.BRIDGE_MEDIAN[B.id] || 0);
      return { id: B.id, bp, bn: B.pts.length, half: S.half, S };
    });

    const hist = {};   // id -> Map(bucket -> count)
    for (const P of paths) hist[P.id] = new Map();

    const list = d.TRAFFIC.list, cars = d.TRAFFIC.cars;
    let checked = 0;
    for (let ci = 0; ci < cars.length; ci++) {
      const c = cars[ci], e = list[c.li];
      if (!e.isBridge) continue;
      checked++;
      const rr = e.r, cum = e.cum;
      // 弧长定位（与 updateTraffic 一致：二分找段）
      let lo = 0, hi = rr.n - 1;
      while (lo < hi - 1) { const m = (lo + hi) >> 1; if (cum[m] <= c.s) lo = m; else hi = m; }
      const i = lo;
      const ax = rr.pts[i*2], az = rr.pts[i*2+1];
      const bx = rr.pts[(i+1)*2], bz = rr.pts[(i+1)*2+1];
      const dx = bx-ax, dz = bz-az, len = Math.hypot(dx,dz) || 1;
      const t = Math.min(1, Math.max(0, (c.s - cum[i]) / len));
      const tx = dx/len, tz = dz/len, nx = -tz, nz = tx;
      const off = ((e.m2 || 0) + (c.lane + 0.5) * e.laneW) * c.dir;
      let px, pz;
      if (e.dof) {
        const dofv = e.dof[i] + (e.dof[i+1] - e.dof[i]) * t;
        const lat = off - dofv;
        px = ax + dx*t + e.dnx[i]*lat;
        pz = az + dz*t + e.dnz[i]*lat;
      } else {
        px = ax + dx*t + nx*off;
        pz = az + dz*t + nz*off;
      }

      let bpick = null, bd = 1e9;
      for (const P of paths) {
        const h = near(P.bp, P.bn, px, pz);
        if (h && h.dist < bd) { bd = h.dist; bpick = { P, h }; }
      }
      if (!bpick || bd > 30) continue;
      const { P, h } = bpick;
      const L = Math.hypot(h.tx, h.tz) || 1;
      const sx = -h.tz / L, sz = h.tx / L;
      const signed = (px - h.qx) * sx + (pz - h.qz) * sz;
      const k = Math.round(signed * 5) / 5;   // 0.2m 桶
      hist[P.id].set(k, (hist[P.id].get(k) || 0) + 1);
    }

    return {
      checkedBridgeCars: checked,
      decks: paths.map(P => {
        const m = hist[P.id];
        const arr = [...m.entries()].sort((a, b) => a[0] - b[0]);
        const tot = arr.reduce((s, x) => s + x[1], 0);
        let mx = 0;
        for (const [k, v] of arr) mx = Math.max(mx, Math.abs(k));
        /* 期望的车道中心：±(m2 + (k+0.5)*laneW)，有中央锚固带时从带边起算 */
        const want = [];
        for (let k = 0; k < P.S.per; k++) want.push(+((P.S.m2 + (k + 0.5) * P.S.laneW).toFixed(2)));
        return { id: P.id, half: P.half, per: P.S.per, laneW: +P.S.laneW.toFixed(3),
                 mw: P.S.mw, m2: +P.S.m2.toFixed(2),
                 cw: +P.S.cw.toFixed(2), sw: P.S.sw, want,
                 total: tot, maxAbs: +mx.toFixed(2),
                 lanes: arr.filter(x => x[1] >= Math.max(2, tot * 0.02)) };
      }),
    };
  });
  console.log(JSON.stringify(r, null, 1));
  await b.close();
})();
