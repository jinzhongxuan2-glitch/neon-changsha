/* 桥面标线基准 —— 逐路分解诊断（数值，不拍图）。
   
   上一版 probe_bridge_dof2 只给出 dof 的统计量，看不出「为什么偏」。
   这一版把每座桥的**自有路集合**拆开看：
     · 每条路的覆盖率 cov（有多少比例的桥节点在 6m 内匹配到它）
     · 每条路的平均横向偏移 avg（桥法线方向，米）
     · 逐节点的匹配条数 cnt 直方图 —— 取平均时成员数在沿桥变化，
       就是 dof 抖动 / 桥头错位的直接原因（cnt=2 与 cnt=1 混在一起）。

   用法：node _build/probe_bridge_dof3.js
*/
const { chromium, ROOT, EXE } = require('./_pw');

(async () => {
  const b = await chromium.launch({ executablePath: EXE, headless: true,
    args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--allow-file-access-from-files'] });
  const p = await b.newPage({ viewport: { width: 600, height: 400 } });
  p.on('pageerror', e => console.log('ERR', e.message));
  await p.goto('file:///' + ROOT + '/index.html?t=2&q=high&hour=13', { waitUntil: 'load', timeout: 240000 });
  await p.waitForFunction("performance.getEntriesByName('B:done').length > 0", null, { timeout: 240000 });

  const r = await p.evaluate(() => {
    const ONE = 6;                       // 与 template 里的 OWN_R 一致
    /* 复刻 bridgeLateralDof 里单个节点的匹配：返回 {d, cnt} */
    const nodeDo = (d, i, list) => {
      const x = d.path[i].x, z = d.path[i].z;
      const tx = -d.pz[i], tz = d.px[i];
      let sum = 0, cnt = 0;
      const per = [];
      for (let ci = 0; ci < list.length; ci++) {
        const rr = list[ci];
        let bd = 1e18, ox = 0, oz = 0;
        for (let k = 0; k + 1 < rr.n; k++) {
          const ax = rr.pts[k * 2], az = rr.pts[k * 2 + 1];
          const ex = rr.pts[k * 2 + 2] - ax, ez = rr.pts[k * 2 + 3] - az;
          const LL = ex * ex + ez * ez;
          if (LL < 1e-9) continue;
          const L2 = Math.sqrt(LL);
          if (Math.abs((ex / L2) * tx + (ez / L2) * tz) < 0.6) continue;   // 横穿的不算
          let t = ((x - ax) * ex + (z - az) * ez) / LL;
          t = t < 0 ? 0 : (t > 1 ? 1 : t);
          const qx = ax + ex * t, qz = az + ez * t;
          const ddx = qx - x, ddz = qz - z;
          const dd = ddx * ddx + ddz * ddz;
          if (dd < bd) { bd = dd; ox = ddx; oz = ddz; }
        }
        let v = null;
        if (bd < 1e18 && bd <= ONE * ONE) {
          const dd = ox * d.px[i] + oz * d.pz[i];
          if (Math.abs(dd) <= ONE) { v = dd; sum += dd; cnt++; }
        }
        per.push(v);
      }
      return { d: cnt ? sum / cnt : 0, cnt, per };
    };

    const out = [];
    for (const d of window.__dbg.BRIDGE_DECKS) {
      const n = d.path.length, own = d.dofOwn;
      const rec = { id: d.id, n, half: d.half, own: own ? own.length : 0, roads: [], cntHist: {}, seq: [] };
      if (!own) { out.push(rec); continue; }

      /* 每条路：覆盖率 / 平均偏移 / 范围 */
      for (let ci = 0; ci < own.length; ci++) {
        const rr = own[ci];
        let cov = 0, sum = 0, cnt = 0, mn = 1e9, mx = -1e9;
        for (let i = 0; i < n; i++) {
          const v = nodeDo(d, i, [rr]).per[0];
          if (v !== null) { cov++; sum += v; cnt++; if (v < mn) mn = v; if (v > mx) mx = v; }
        }
        rec.roads.push({
          i: ci, cls: rr.cls, rn: rr.n,
          cov: +(cov / n).toFixed(2),
          avg: cnt ? +(sum / cnt).toFixed(2) : null,
          mn: cnt ? +mn.toFixed(2) : null, mx: cnt ? +mx.toFixed(2) : null,
          a: [+rr.pts[0].toFixed(0), +rr.pts[1].toFixed(0)],
          b: [+rr.pts[(rr.n - 1) * 2].toFixed(0), +rr.pts[(rr.n - 1) * 2 + 1].toFixed(0)],
        });
      }

      /* 逐节点 cnt（用完整集合） */
      const cnts = [];
      for (let i = 0; i < n; i++) cnts.push(nodeDo(d, i, own).cnt);
      const h = {};
      for (const c of cnts) h[c] = (h[c] || 0) + 1;
      rec.cntHist = h;
      rec.seq = Array.from({ length: 12 }, (_, j) => cnts[Math.floor((n - 1) * j / 11)]);
      rec.cnts = cnts.join('');

      /* 逐节点「每路的贡献」，只打前 8 个和后 8 个节点 —— 桥头看到的就是它们 */
      const headPer = [], tailPer = [];
      for (let i = 0; i < Math.min(8, n); i++) headPer.push(nodeDo(d, i, own).per.map(v => v === null ? null : +v.toFixed(1)));
      for (let i = Math.max(0, n - 8); i < n; i++) tailPer.push(nodeDo(d, i, own).per.map(v => v === null ? null : +v.toFixed(1)));
      rec.headPer = headPer;
      rec.tailPer = tailPer;
      out.push(rec);
    }
    return out;
  });
  console.log(JSON.stringify(r, null, 1));
  await b.close();
})();
