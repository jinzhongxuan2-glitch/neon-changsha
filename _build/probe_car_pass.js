/* 车流 pass-by：声学调度数值验证（不拍图、不听）。

   在这之前「车流」只是**一层连续噪声**（`street`），听不出「一辆车从身边开过去」。
   这个探针验的是「最近那几辆车真的被拆成独立声源、并且跟着它们动」：

   - 站街面：`live >= 2`（附近确实有车被绑上槽位）
   - 距离在 110m 半径内、包络随距离单调
   - 声像 ∈ [-1,1]，且**相机转 180° 后同一辆车的 pan 反号**
   - 多普勒比在 0.9~1.15（15m/s 的车只有 ±4.6%）
   - 抬到 200m 高空：`live === 0`（那一层被风盖住，pass-by 不该有）
   - 不开声：`cars` 是纯 no-op 的形状，不报错

   车流用 `__TRAFFIC_FREEZE` 钉住，否则 100ms 内参数就变了，测不出确定结论。

   用法：node _build/probe_car_pass.js
*/
const { chromium, ROOT, EXE } = require('./_pw');

(async () => {
  const b = await chromium.launch({ executablePath: EXE, headless: true,
    args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist',
           '--allow-file-access-from-files', '--autoplay-policy=no-user-gesture-required'] });
  /* 桌面视口：#btn-snd 在 #panel 里，820px 断点以下默认收起就点不到 */
  const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
  p.on('pageerror', e => console.log('ERR', e.message));
  /* q 必须是 high/mid：low 档 `crowd=false` 会把 trafficGroup.visible 关掉，
     车流整个不画 —— 那时候 pass-by 不响是对的（省性能档不该有声音），但探针就测不到东西。 */
  await p.goto('file:///' + ROOT + '/index.html?t=2&q=high&hour=21', { waitUntil: 'load', timeout: 240000 });
  await p.waitForFunction("performance.getEntriesByName('B:done').length > 0", null, { timeout: 240000 });
  await p.waitForTimeout(900);

  /* 车流位置是**分帧算的**（`updateTraffic` 每帧只更一个 mesh），而 headless 空闲时
     rAF 会停 —— 加载完之后大多数 mesh 的 `aPos` 还是 0，全都堆在原点，
     离相机 300m 远、直接被 110m 半径滤掉。所以先手工把每个 mesh 推两遍再冻。 */
  const warmup = await p.evaluate(() => {
    const D = window.__dbg;
    const stat = () => {
      let n = 0, nz = 0;
      for (const m of D.trafficMeshes) {
        const P = m.geometry.attributes.aPos.array;
        for (let i = 0; i < P.length; i += 3) { n++; if (P[i] || P[i + 2]) nz++; }
      }
      return { n, nz };
    };
    const before = stat();
    const rounds = D.trafficMeshes.length * 2;
    for (let k = 0; k < rounds; k++) D.updateTraffic(1 / 60);
    const after = stat();
    window.__TRAFFIC_FREEZE = true;      /* 钉住：不冻的话车 100ms 走 1.5m，测不出确定结论 */
    return { meshes: D.trafficMeshes.length, rounds, before, after };
  });
  console.log('WARMUP ' + JSON.stringify(warmup));

  const cold = await p.evaluate(() => {
    const A = window.__dbg.AUD;
    const d = A.dbg();
    let threw = null;
    try { A.tick(); } catch (e) { threw = e.message; }
    return { on: d.on, ctx: A.ctx ? A.ctx.state : null, cars: d.cars, threw };
  });
  console.log('COLD ' + JSON.stringify(cold));

  await p.click('#btn-snd');
  await p.waitForTimeout(500);
  const warm = await p.evaluate(() => {
    const A = window.__dbg.AUD;
    return { on: A.on, ctx: A.ctx ? A.ctx.state : null };
  });
  console.log('WARM ' + JSON.stringify(warm));

  /* 用 setTimeout 连驱三次 AUD.tick（10Hz 节流：每次间隔必须 > 100ms）。
     不能用 waitForTimeout 等 rAF —— headless 空闲时不发帧，nTick 会冻住。 */
  async function drive(n) {
    for (let i = 0; i < n; i++) {
      await p.evaluate(() => new Promise(r => setTimeout(() => { window.__dbg.AUD.tick(); r(); }, 150)));
    }
  }

  const r = await p.evaluate(async () => {
    const D = window.__dbg, A = D.AUD, c = D.camera, ct = D.controls;
    if (typeof D.enterFree === 'function') D.enterFree();
    ct.autoRotate = false; ct.minDistance = 1;
    const place = (px, py, pz, tx, ty, tz) => {
      c.position.set(px, py, pz); ct.target.set(tx, ty, tz); c.up.set(0, 1, 0); ct.update();
    };
    const drive = (n) => new Promise(res => {
      let i = 0;
      const step = () => { A.tick(); if (++i < n) setTimeout(step, 150); else res(); };
      step();
    });

    /* 一个**街面**机位。但不能死站 `(-145,-261)`：18,000 辆撒在整个长沙路网
       （~34 辆/km²），110m 圆内期望只有 1.3 辆，实测那个点最近的车在 351m 外。
       先找离候选点最近的那辆，把相机摆到它旁边 8m —— 这才是「一辆车从身边开过」。 */
    const IX = -145, IZ = -261;
    let best = null, bd = 1e18;
    for (const m of D.trafficMeshes){
      const P = m.geometry.attributes.aPos.array;
      for (let i = 0; i < P.length; i += 3){
        const dx = P[i] - IX, dz = P[i + 2] - IZ;
        const dd = dx * dx + dz * dz;
        if (dd < bd){ bd = dd; best = { x: P[i], y: P[i + 1], z: P[i + 2] }; }
      }
    }
    const CX = best.x + 8, CZ = best.z, CY = best.y + 1.7;
    const gy = D.walkTop(CX, CZ);
    const out = { pickup: { best: [+best.x.toFixed(1), +best.z.toFixed(1)], at: +Math.sqrt(bd).toFixed(1) } };

    /* ① 站在车旁边（车在正西 8m），朝北 */
    place(CX, CY, CZ, CX, CY, CZ - 120);
    await drive(3);
    out.street = JSON.parse(JSON.stringify(A.dbg().cars));
    /* 诊断：为什么 live 会是 0 —— 逐条查前置条件 */
    out.diag = {
      tgVis: (typeof D.trafficGroup !== 'undefined') ? D.trafficGroup.visible : 'no tg',
      meshVis: D.trafficMeshes.map(m => m.visible),
      meshes: D.trafficMeshes.length,
      gh: +(D.camera.position.y - D.walkTop(D.camera.position.x, D.camera.position.z)).toFixed(2),
      nScan: A.dbg().cars.n,
      nVoices: A.dbg().cars.slots.length,
      cam: c.position.toArray().map(v => +v.toFixed(1)),
      ix: [IX, IZ, +gy.toFixed(1)], pickup: out.pickup,
      /* 相机周围的车距分布 —— 判断是「半径太小」还是「坐标根本不是世界坐标」 */
      near: (() => {
        const px = c.position.x, pz = c.position.z;
        const bins = [0, 0, 0, 0, 0];
        let mn = 1e9, mnAt = null;
        for (const m of D.trafficMeshes) {
          const P2 = m.geometry.attributes.aPos.array;
          for (let i = 0; i < P2.length; i += 3) {
            const dx = P2[i] - px, dz = P2[i + 2] - pz;
            const dd = Math.sqrt(dx * dx + dz * dz);
            if (dd < mn) { mn = dd; mnAt = [+P2[i].toFixed(1), +P2[i + 2].toFixed(1)]; }
            if (dd < 50) bins[0]++;
            else if (dd < 110) bins[1]++;
            else if (dd < 200) bins[2]++;
            else if (dd < 400) bins[3]++;
            else bins[4]++;
          }
        }
        return { bins: bins, min: +mn.toFixed(1), minAt: mnAt };
      })(),
    };

    /* ② 同一点转 180°（朝南）—— 同一个 key 的 pan 必须反号 */
    place(CX, CY, CZ, CX, CY, CZ + 120);
    await drive(3);
    out.streetS = JSON.parse(JSON.stringify(A.dbg().cars));

    /* ③ 抬到 200m 高空 —— pass-by 必须消失 */
    place(CX, CY + 200, CZ, CX, CY + 200, CZ - 300);
    await drive(3);
    out.high = JSON.parse(JSON.stringify(A.dbg().cars));

    /* ④ 回到街面，换个方向（朝东），再取一组拿来判「换向就变 pan」 */
    place(CX, CY, CZ, CX + 120, CY, CZ);
    await drive(3);
    out.streetE = JSON.parse(JSON.stringify(A.dbg().cars));

    return out;
  });

  /* ---------- 断言 ---------- */
  const R = [];
  const ok = (name, cond, got) => R.push([cond ? 'PASS' : 'FAIL', name, got]);

  ok('冷启动不开声：cars 是零形状，tick 不报错',
     cold.ctx === null && cold.cars && cold.cars.n === 0 && cold.threw === null,
     JSON.stringify({ ctx: cold.ctx, n: cold.cars && cold.cars.n, threw: cold.threw }));
  ok('开声后 ctx running', warm.on === true && warm.ctx === 'running', JSON.stringify(warm));

  ok('站街面：至少绑上 2 辆车', r.street.live >= 2, r.street.live);
  console.log('DIAG ' + JSON.stringify(r.diag));
  ok('最近一辆在 110m 半径内', r.street.d > 0 && r.street.d <= 110, r.street.d);
  ok('包络在合理区间（0 < g < 0.25）', r.street.g > 0 && r.street.g < 0.25, r.street.g);
  ok('声像在 [-1,1]', r.street.pan >= -1 && r.street.pan <= 1, r.street.pan);
  ok('多普勒比在 0.90~1.15（15m/s 只有 ±4.6%）',
     r.street.dop > 0.90 && r.street.dop < 1.15, r.street.dop);
  ok('低通在 900~5500Hz（近车才有「嘶」）',
     r.street.cut >= 900 && r.street.cut <= 5500, r.street.cut);
  ok('5 个槽位都报出距离（key 可为 -1）', Array.isArray(r.street.slots) && r.street.slots.length === 5,
     r.street.slots.length);

  /* 同一个 key 在「朝北 vs 朝南」两组里的 pan 必须反号 */
  const byKey = (snap) => { const m = {}; for (const s of snap.slots) if (s.key >= 0) m[s.key] = s; return m; };
  const a = byKey(r.street), bb = byKey(r.streetS);
  let pair = null;
  for (const k in a) if (bb[k]) { pair = [a[k], bb[k]]; break; }
  ok('转 180° 后同一辆车的 pan 反号',
     pair !== null && Math.sign(pair[0].pan) !== Math.sign(pair[1].pan) && Math.abs(pair[0].pan) > 0.05,
     pair ? ('key=' + (pair[0].key) + ' N=' + pair[0].pan + ' S=' + pair[1].pan) : 'no shared key');

  /* 朝东应当和朝北给出不同的 pan（不是永远 0） */
  ok('换朝向后 pan 分布改变',
     Math.abs(r.streetE.pan - r.street.pan) > 0.05 || r.streetE.live !== r.street.live,
     'N=' + r.street.pan + ' E=' + r.streetE.pan);

  ok('200m 高空：pass-by 全部静音（live === 0）', r.high.live === 0, r.high.live);

  for (const row of R) console.log(row[0].padEnd(4), row[1], '  →', row[2]);
  const bad = R.filter(x => x[0] === 'FAIL');
  console.log('---', bad.length ? bad.length + ' FAIL' : 'ALL PASS');

  console.log('\nDETAIL ' + JSON.stringify(r, null, 1));
  await b.close();
  process.exit(bad.length ? 1 : 0);
})();
