/* 桥面标线 vs 车流：横向基准一致性（数值，不拍图）。

   判据：车流最终落在**桥走线坐标系**的 `off = (lane+0.5)*laneW` 附近
   （`lat = off - dof` 只是把桥坐标换算到 OSM 坐标，渲染时又按 OSM 中线加回来）。
   如果桥面标线也用桥走线坐标（`oo = o`），两者应当重合；
   如果标线用了 `oo = o - dof`，就会整体偏 dof —— 这个探针把它量出来。

   输出：车上桥位置的横向坐标直方图 + 标线实际横向坐标。

   用法：node _build/probe_bridge_lat.js [id]
*/
const { chromium, ROOT, EXE } = require('./_pw');

const ID = process.argv[2] || 'fuyuanlu';

(async () => {
  const b = await chromium.launch({ executablePath: EXE, headless: true,
    args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--allow-file-access-from-files'] });
  const p = await b.newPage({ viewport: { width: 600, height: 400 } });
  p.on('pageerror', e => console.log('ERR', e.message));
  await p.goto('file:///' + ROOT + '/index.html?t=2&q=high&hour=13', { waitUntil: 'load', timeout: 240000 });
  await p.waitForFunction("performance.getEntriesByName('B:done').length > 0", null, { timeout: 240000 });
  /* 让车流跑几帧，aPos 才有值；不冻结 */
  await p.waitForTimeout(1500);

  const r = await p.evaluate((id) => {
    const d = window.__dbg.BRIDGE_DECKS.find(x => x.id === id);
    if (!d) return { err: 'no deck ' + id };
    const n = d.path.length;

    /* 桥上车辆：逐车找最近桥节点（沿桥 4m 一个点），距离 < 24m 且高差 < 3m */
    const lats = [];
    let total = 0;
    window.__dbg.scene.traverse(o => {
      const a = o.geometry && o.geometry.attributes;
      if (!o.isMesh || !a || !a.aPos || !a.aPart) return;
      const P = a.aPos.array, S = a.aScale.array;
      const cnt = a.aPos.count;
      total += cnt;
      for (let i = 0; i < cnt; i++) {
        if (S[i] <= 0) continue;
        const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
        let bi = -1, bd = 1e18;
        for (let k = 0; k < n; k++) {
          const q = d.path[k];
          const dd = (q.x - x) * (q.x - x) + (q.z - z) * (q.z - z);
          if (dd < bd) { bd = dd; bi = k; }
        }
        if (bd > 24 * 24) continue;
        if (Math.abs(y - d.ys[bi]) > 3) continue;
        const lat = (x - d.path[bi].x) * d.px[bi] + (z - d.path[bi].z) * d.pz[bi];
        if (Math.abs(lat) > d.half) continue;
        lats.push({ lat, bi });
      }
    });

    /* 直方图 0.5m 一桶 */
    const B = 0.5, H = {};
    for (const v of lats) {
      const k = Math.round(v.lat / B) * B;
      H[k.toFixed(1)] = (H[k.toFixed(1)] || 0) + 1;
    }
    const keys = Object.keys(H).map(Number).sort((a, b) => a - b);

    /* 标线现在画在哪（template 里 mark() 的 oo 值） */
    const S = window.__dbg.deckSection(d.half * 2, d.mw);
    const mi = n >> 1;
    const dof = d.dof[mi];
    const mk = (o) => +(o - dof).toFixed(2);      // 当前公式（含 -dof）
    const mk0 = (o) => +o.toFixed(2);             // 纯桥坐标系
    const yo = S.m2 + (S.mw > 0 ? 0.22 : 0.145);  // 双黄线：有中央锚固带时贴带边
    const marks = [];
    marks.push({ what: 'doubleYellow', now: [mk(yo), mk(-yo)], plain: [mk0(yo), mk0(-yo)] });
    for (let k = 1; k < S.per; k++) {
      const kd = S.m2 + k * S.laneW;
      marks.push({ what: 'dash' + k, now: [mk(kd), mk(-kd)], plain: [mk0(kd), mk0(-kd)] });
    }
    marks.push({ what: 'edge', now: [mk(S.cw - 0.25), mk(-(S.cw - 0.25))], plain: [mk0(S.cw - 0.25), mk0(-(S.cw - 0.25))] });
    /* 期望：车落在 ±(m2 + (lane+0.5)*laneW) */
    const wantLanes = [];
    for (let k = 0; k < S.per; k++) wantLanes.push(+(S.m2 + (k + 0.5) * S.laneW).toFixed(2));

    return {
      id, half: d.half, dof: +dof.toFixed(2),
      section: { cw: +S.cw.toFixed(2), mw: S.mw, m2: +S.m2.toFixed(2),
                 per: S.per, laneW: +S.laneW.toFixed(2) },
      wantLanes,
      carsTotal: total, carsOnBridge: lats.length,
      hist: keys.map(k => [k, H[k.toFixed(1)]]),
      marks,
    };
  }, ID);
  console.log(JSON.stringify(r, null, 1));
  await b.close();
})();
