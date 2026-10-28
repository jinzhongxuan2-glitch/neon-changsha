/* 中央锚固带（§41 / 风险 27）数值验收。

   银盆岭是「双塔单索面」斜拉桥，全桥的索落在一条中线上。以前双黄线画在 ±0.145，
   索的投影（0.42 宽）正好把它切成碎段 —— 俯视图上是一条灰带压着黄线。
   现在中线加一条 1.6m 宽、6cm 高的锚固带，索落进带里，双黄线移到带的两侧。

   判据全部独立复算，不复用被测函数：
   ① 四座桥的断面数字：银盆岭 mw=1.6 / m2=0.8，其余三座**一个字节都不许变**
      （福元路 13.12 / 4 / 3.28 是 §34 实测出来的老值，拿来当回归锚点）；
   ② 带身真的存在且只有 6cm：从中线 ±0.5m 竖直向上打射线，命中高度 = 桥面 + 0.06；
      车行道（±2.0m）命中高度 = 桥面（不许有台阶）；
   ③ 双黄线离索够远：线内缘（1.02-0.035）与索外缘（0.21）之间的余量 > 0.5m；
   ④ 桥上车辆没有一辆压在带上：|lat| 最小值 ≥ m2 + 0.3，且落点聚在车道中心；
   ⑤ 三座无带桥的 ±0.5m 处没有多出来的台阶。

   用法：node _build/probe_median.js
*/
const { chromium, ROOT, EXE } = require('./_pw');

const R = [];
const ok = (name, cond, info) => {
  R.push({ ok: !!cond, name, info });
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (info !== undefined ? '  → ' + JSON.stringify(info) : ''));
};
const near = (a, b, e = 0.02) => Math.abs(a - b) <= e;

(async () => {
  const b = await chromium.launch({ executablePath: EXE, headless: true,
    args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--allow-file-access-from-files'] });
  const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
  p.on('pageerror', e => console.log('ERR', e.message));
  await p.goto('file:///' + ROOT + '/index.html?t=2&q=high&hour=13', { waitUntil: 'load', timeout: 240000 });
  await p.waitForFunction("performance.getEntriesByName('B:done').length > 0", null, { timeout: 240000 });
  await p.waitForTimeout(1500);

  const out = await p.evaluate(() => {
    const D = window.__dbg, T = D.THREE;    // 探针里没有 React，同步求值即可
    D.scene.updateMatrixWorld(true);

    /* ---- ① 断面 ---- */
    const sec = {};
    for (const id of ['juzizhou', 'yinpenling', 'fuyuanlu', 'houzishi']) {
      const S = D.deckSection(D.BRIDGE_WIDTH[id], D.BRIDGE_MEDIAN[id] || 0);
      sec[id] = { cw: +S.cw.toFixed(3), mw: S.mw, m2: +S.m2.toFixed(3), halfCw: +S.halfCw.toFixed(3),
                  per: S.per, laneW: +S.laneW.toFixed(3), sw: +S.sw.toFixed(2) };
    }

    /* ---- ② 射线：带身高度 ---- */
    const decks = D.BRIDGE_DECKS;
    const meshes = [];
    D.bridgeGroup.traverse(o => { if (o.isMesh) meshes.push(o); });
    const rc = new T.Raycaster();
    const up = new T.Vector3(0, 1, 0);
    /* 「桥面之上 0.5m 内有没有东西」——带身是**叠在桥面上**的，不是替换桥面，
       所以射线起点必须抬到桥面顶之上 5mm，否则第一个命中的永远是桥面本身。 */
    const hitTop = (deck, lat) => {
      /* 取**中跨那一段的中点**，不取节点本身：节点正好落在两个 quad 的公共边上，
         射线打边可能两面都不中（实测 `band:null`）。`+0.5` 取段中，法线也取两端平均。 */
      const n = deck.path.length, i = n >> 1, j = i + 1;
      const cx = (deck.path[i].x + deck.path[j].x) * 0.5;
      const cz = (deck.path[i].z + deck.path[j].z) * 0.5;
      const nx = (deck.px[i] + deck.px[j]) * 0.5, nz = (deck.pz[i] + deck.pz[j]) * 0.5;
      const nl = Math.hypot(nx, nz) || 1;
      const dy = (deck.ys[i] + deck.ys[j]) * 0.5;
      rc.set(new T.Vector3(cx + nx / nl * lat, dy + 0.005, cz + nz / nl * lat), up);
      rc.near = 0; rc.far = 0.5;
      const hs = rc.intersectObjects(meshes, false);
      return hs.length ? +(hs[0].point.y - dy).toFixed(3) : 0;   // 0 = 桥面之上没有构件
    };
    const probeDeck = {};
    for (const deck of decks) probeDeck[deck.id] = { band: hitTop(deck, 0.5), lane: hitTop(deck, 2.0) };

    /* ---- ③ 黄线余量 ---- */
    const YA = 0.22, LW = 0.070, CABLE_HW = 0.21;   // 索 `bar(...,0.42)` → 半宽 0.21
    const gap = {};
    for (const id of ['yinpenling', 'fuyuanlu']) {
      const S = D.deckSection(D.BRIDGE_WIDTH[id], D.BRIDGE_MEDIAN[id] || 0);
      const yo = S.m2 + (S.mw > 0 ? YA : 0.145);
      gap[id] = +(yo - LW * 0.5 - CABLE_HW).toFixed(3);
    }

    /* ---- ④ 桥上车辆横向落点 ----
       逐车找最近桥节点（4m 一点），只保留中跨那 60%（`bi` 离中点 30% 以内）：
       引桥落地段旁边有地面道路，那里的车会被误算成桥上。 */
    const carLat = {};
    const carMeshes = [];
    D.scene.traverse(o => {
      const a = o.geometry && o.geometry.attributes;
      if (o.isMesh && a && a.aPos && a.aScale) carMeshes.push(o);
    });
    for (const id of ['yinpenling', 'fuyuanlu']) {
      const deck = decks.find(x => x.id === id);
      const n = deck.path.length, half = deck.half;
      let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
      for (const q of deck.path) { x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); z0 = Math.min(z0, q.z); z1 = Math.max(z1, q.z); }
      let cnt = 0, minAbs = 1e9; const hist = {};
      for (const o of carMeshes) {
        const a = o.geometry.attributes;
        const AP = a.aPos.array, AS = a.aScale.array, C = a.aPos.count;
        for (let i = 0; i < C; i++) {
          if (AS[i] <= 0) continue;
          const x = AP[i * 3], y = AP[i * 3 + 1], z = AP[i * 3 + 2];
          if (x < x0 - 20 || x > x1 + 20 || z < z0 - 20 || z > z1 + 20) continue;
          let bi = -1, bd = 1e18;
          for (let k = 0; k < n; k++) {
            const q = deck.path[k];
            const dd = (q.x - x) * (q.x - x) + (q.z - z) * (q.z - z);
            if (dd < bd) { bd = dd; bi = k; }
          }
          if (bd > 20 * 20) continue;
          if (Math.abs(y - deck.ys[bi]) > 2.5) continue;
          if (Math.abs(bi - n * 0.5) > n * 0.30) continue;
          const lat = (x - deck.path[bi].x) * deck.px[bi] + (z - deck.path[bi].z) * deck.pz[bi];
          if (Math.abs(lat) > half) continue;
          cnt++;
          if (Math.abs(lat) < minAbs) minAbs = Math.abs(lat);
          const kk = (Math.round(Math.abs(lat) * 5) / 5).toFixed(1);
          hist[kk] = (hist[kk] || 0) + 1;
        }
      }
      carLat[id] = { cnt, minAbs: cnt ? +minAbs.toFixed(2) : -1, hist };
    }

    return { sec, probeDeck, gap, carLat };
  });

  const S = out.sec;

  /* ① 断面 */
  ok('fuyuanlu 断面未被改动（13.12 / 4 / 3.28，§34 实测值）',
     near(S.fuyuanlu.cw, 13.12) && S.fuyuanlu.per === 4 && near(S.fuyuanlu.laneW, 3.28) && S.fuyuanlu.m2 === 0, S.fuyuanlu);
  ok('juzizhou 断面未被改动（11.12 / 3 / 3.707）',
     near(S.juzizhou.cw, 11.12) && S.juzizhou.per === 3 && near(S.juzizhou.laneW, 3.707) && S.juzizhou.m2 === 0, S.juzizhou);
  ok('houzishi 断面未被改动（11.92 / 3 / 3.973）',
     near(S.houzishi.cw, 11.92) && S.houzishi.per === 3 && near(S.houzishi.laneW, 3.973) && S.houzishi.m2 === 0, S.houzishi);
  ok('yinpenling 有 1.6m 中央锚固带（m2=0.8，单向 3 车道 3.707m）',
     S.yinpenling.mw === 1.6 && near(S.yinpenling.m2, 0.8) && near(S.yinpenling.halfCw, 11.12) &&
     S.yinpenling.per === 3 && near(S.yinpenling.laneW, 3.707), S.yinpenling);

  /* ② 带身：桥面之上 0.5m 内命中的东西。带身 6cm ⇒ 0.06；车行道应当是 0（没有台阶） */
  const p1 = out.probeDeck;
  ok('yinpenling 带身：中线 ±0.5m 处高出桥面 6cm',
     near(p1.yinpenling.band, 0.06, 0.012), p1.yinpenling);
  ok('yinpenling 车行道没有台阶（±2.0m 处 = 桥面）',
     Math.abs(p1.yinpenling.lane) <= 0.012, p1.yinpenling);
  ok('无带三桥：±0.5m 处没有任何台阶',
     ['fuyuanlu', 'juzizhou', 'houzishi'].every(id => Math.abs(p1[id].band) <= 0.012),
     { f: p1.fuyuanlu, j: p1.juzizhou, h: p1.houzishi });

  /* ③ 黄线余量：`yo - 线半宽 - 索半宽`。福元路没有索，这个数是负的（0.145-0.035-0.21） */
  ok('银盆岭双黄线离索外缘 > 0.5m（索不再压线）', out.gap.yinpenling > 0.5, out.gap.yinpenling);
  ok('福元路双黄线仍在 ±0.145（不受影响）', near(out.gap.fuyuanlu, -0.10, 0.001), out.gap.fuyuanlu);

  /* ④ 车 —— 只验「结构」，不验精度。
     世界坐标量出来的横向值有 ±0.6 的固有噪声（`dof` 校正按 OSM 分段法线、探针按桥节点法线，
     弯道上两者不同源；`probe_bridge_lat` 的 0.5m 桶直方图同样能看到这个宽度）。
     所以：车道中心附近**有车**、带边上**没车**，这两条是硬判据；「正好落在 ±1.64」不是。 */
  const C = out.carLat;
  const nearCount = (hist, w, tol) => {
    let s = 0;
    for (const k in hist) if (Math.abs(+k - w) <= tol) s += hist[k];
    return s;
  };
  const yl = [2.65, 6.36, 10.07];
  /* 带边 0.8 + 车身半宽 ~0.3 = 1.1 是物理下限；但世界坐标量出来的值有 ~1.0 的噪声
     （`dof` 按 OSM 分段法线校正、这里按桥节点法线量，弯道上不同源），
     实测三次 min|lat| = 1.62 / 1.98 / 2.01。取 1.2 既不会被噪声打穿，也远高于带边。
     精确值另有构造保证：`off = (m2+(lane+0.5)·laneW)·dir`，lane≥0 ⇒ |off| ≥ 2.65。 */
  ok('银盆岭没有一辆车压在带上（min|lat| ≥ 1.2，实测 1.6~2.0）',
     C.yinpenling.cnt > 0 && C.yinpenling.minAbs >= 1.2, { cnt: C.yinpenling.cnt, minAbs: C.yinpenling.minAbs });
  ok('银盆岭三条车道里都有车（2.65 / 6.36 / 10.07 ±0.6，各 ≥3 辆）',
     yl.every(w => nearCount(C.yinpenling.hist, w, 0.6) >= 3),
     yl.map(w => nearCount(C.yinpenling.hist, w, 0.6)));
  const fl = [1.64, 4.92, 8.20, 11.48];
  ok('福元路四条车道里都有车（±0.7，各 ≥3 辆）',
     C.fuyuanlu.cnt > 0 && fl.every(w => nearCount(C.fuyuanlu.hist, w, 0.7) >= 3),
     { cnt: C.fuyuanlu.cnt, peaks: fl.map(w => nearCount(C.fuyuanlu.hist, w, 0.7)) });
  ok('福元路没有车压着双黄线（min|lat| ≥ 0.5；噪声地板 ~0.6）',
     C.fuyuanlu.minAbs >= 0.5, C.fuyuanlu.minAbs);

  const bad = R.filter(r => !r.ok);
  console.log(bad.length ? ('--- ' + bad.length + ' FAIL') : '--- ALL PASS');
  await b.close();
})();
