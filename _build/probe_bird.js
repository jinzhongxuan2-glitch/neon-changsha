/* 鸟叫方位（§43）：从真实的那棵树出发。

   以前 `pan = rnd()*1.7 - 0.85` —— 鸟永远在相机正前方左右某个随机位置叫，
   转身 180° 它还在原地，跟场景里 3.6 万棵树毫无关系。现在：
   ① 在 `vegBuilt.nearArr`（11 float/棵）里取 14~170m 内最近的 6 棵；
   ② 按 1/(30+d) 加权抽一棵（只取最近那棵 → 同一机位永远同一丛灌木，像循环采样）；
   ③ 方位投影到相机右向量（跟江水同一条公式），距离定音量、树冠定低通、`occlK` 再压一档。

   判据（**不读 `AudioParam.value`**：headless 里音频线程被渲染饿死会滞后一整个量子，
   §31/§37/§42 都踩过；读的是算完立刻写进 `bDbg` 的纯 JS 数字）：

   ① 冷启动 / 静音 / 附近没树 —— 三条早退路径形状一致、n 不动；
   ② 方位：`pan == dot(normalize(tree-cam) , camera 右向量)`，**四个朝向各验一遍**
      —— 只验正北的话，「pan 写死不跟相机转」也能过；
   ③ 距离：`d == hypot(tree-cam)`、`d ∈ [14,170]`、`cand ∈ [1,6]`；
   ④ 选树：被选中的那一棵，环内比它更近的树 **必须 ≤ 5 棵**（这就是「最近 6 棵」的定义）；
   ⑤ 衰减：`k`、`cut` 对得上公式，`occ` 只取 occlK 的三个离散值 1 / 0.69 / 0.38；
   ⑥ 那棵树真的存在：`(x,y,z)` 逐字出现在 `nearArr` 里。

   用法：node _build/probe_bird.js
*/
const { chromium, ROOT, EXE } = require('./_pw');

const R = [];
const ok = (name, cond, got) => {
  R.push({ ok: !!cond, name, got });
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (got !== undefined ? '  → ' + JSON.stringify(got) : ''));
};
const near = (a, b, e) => Math.abs(a - b) <= e;

(async () => {
  const b = await chromium.launch({ executablePath: EXE, headless: true,
    args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist',
           '--allow-file-access-from-files', '--autoplay-policy=no-user-gesture-required'] });
  /* 1280×800：`#btn-snd` 在 `#panel` 里，820px 断点以下默认收起 → 点不到 */
  const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
  p.on('pageerror', e => console.log('ERR', e.message));
  await p.goto('file:///' + ROOT + '/index.html?t=2&q=low&hour=13', { waitUntil: 'load', timeout: 240000 });
  await p.waitForFunction("performance.getEntriesByName('B:done').length > 0", null, { timeout: 240000 });
  await p.waitForTimeout(500);

  /* ---------- ① 冷启动 ---------- */
  const cold = await p.evaluate(() => {
    const A = window.__dbg.AUD;
    let threw = null;
    try { A.chirp(); } catch (e) { threw = e.message; }
    const bb = A.dbg().b;
    return { ctx: A.ctx ? A.ctx.state : null, n: bb.n, blocked: bb.blocked, threw,
             keys: Object.keys(bb).sort().join(',') };
  });
  ok('冷启动不开声：chirp 是 no-op 且不抛错', cold.ctx === null && cold.n === 0 && !cold.threw, cold);
  ok('冷启动也给同形状的 b（blocked=audio）', cold.blocked === 'audio', cold.blocked);

  /* ---------- ② 开声（必须真点按钮：AudioContext 只在手势里建） ---------- */
  await p.click('#btn-snd');
  await p.waitForTimeout(400);
  const onNow = await p.evaluate(() => window.__dbg.AUD.on);
  ok('按钮已开声', onNow === true, onNow);

  /* ---------- ③ 找一处「附近有树」的机位：拿真树当锚点，相机退到它 45m 外 ---------- */
  const anchor = await p.evaluate(() => {
    const D = window.__dbg, A = D.AUD, c = D.camera, ct = D.controls;
    if (typeof D.enterFree === 'function') D.enterFree();
    ct.autoRotate = false; ct.minDistance = 0.5;
    const arr = D.veg().nearArr;
    if (!arr || !arr.length) return { bad: 'nearArr 空' };
    /* 找一处「附近有树、且能隔着楼叫」的落脚点。
       乡道树旁边一栋楼都没有，`occlK` 恒等于 1，遮挡那一支就白测了 ——
       所以每个候选树试 4 个方位的 45m 落脚点，**落脚点本身不能在楼里**
       （`BD.near < 0.6` 就是墙内，那样 `occlK` 会假命中），再试叫 3 次看有没有 `occ < 1`。
       试叫是真叫（会建振荡器），所以候选树封顶 8 棵。 */
    const OFF = [[0, 45], [45, 0], [0, -45], [-45, 0]];
    let first = null, trees = 0;
    for (let i = 0; i < arr.length && trees < 8; i += 11 * 7) {
      const tx = arr[i], tz = arr[i + 1], ty = arr[i + 2];
      if (Math.hypot(tx, tz) > 2200 || ty > 30) continue;
      trees++;
      for (const [ox, oz] of OFF) {
        const cx = tx + ox, cz = tz + oz;
        if (D.BD.near(cx, cz, 0.6) < 0.6) continue;      /* 站在墙里，不算 */
        c.position.set(cx, ty + 2, cz);
        ct.target.set(tx, ty, tz); c.up.set(0, 1, 0); ct.update();
        const sp = A.birdSpot();
        if (!sp || sp.cand < 3) continue;
        let blocked = 0;
        for (let k = 0; k < 3; k++) { A.chirp(); if (A.dbg().b.occ < 0.999) blocked++; }
        const rec = { x: tx, y: ty, z: tz, cx, cz, cand: sp.cand, i: i / 11, blocked, trees };
        if (!first) first = rec;
        if (blocked >= 1) return rec;
      }
    }
    return first || { bad: '找不到候选数 >=3 的落脚点' };
  });
  ok('找到一处「附近有树且能隔着楼叫」的机位', !anchor.bad && anchor.blocked >= 1, anchor.bad || anchor);

  /* ---------- ④ 四个朝向各抽 6 次：方位 / 距离 / 选树 / 衰减 ---------- */
  const YAW = [['N', 0], ['E', 90], ['S', 180], ['W', 270]];
  const samples = [];
  for (const [tag, deg] of YAW) {
    const got = await p.evaluate(async ({ ax, ay, az, deg }) => {
      const D = window.__dbg, A = D.AUD, c = D.camera, ct = D.controls;
      /* 相机钉在锚点的落脚点上；每 90° 转一圈看同一个地点 */
      const r = deg * Math.PI / 180;
      const dx = Math.sin(r) * 100, dz = -Math.cos(r) * 100;
      c.position.set(ax, ay + 2, az);
      ct.target.set(ax + dx, ay, az + 45 + dz); c.up.set(0, 1, 0); ct.update();
      /* matrixWorld 只在 render 里更新 —— 两个真 rAF 之后再读，否则读的是上一个朝向 */
      await new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));

      const arr = D.veg().nearArr;
      const m = c.matrixWorld.elements;
      const rx = m[0], rz = m[2];                   /* 第 0 列 = 相机右向量 */
      const out = [];
      for (let k = 0; k < 6; k++) {
        A.chirp();
        const bb = A.dbg().b;
        if (bb.blocked) { out.push({ blocked: bb.blocked }); continue; }
        /* 先按 1 位小数找回那棵树的**精确**坐标 —— 直接拿 b.x/b.z 算，
           45m 处的 5cm 舍入会在「比它更近的树有几棵」上判错。 */
        let inVeg = 0, ex = 0, ez = 0, ey = 0;
        for (let i = 0; i < arr.length; i += 11) {
          if (Math.abs(arr[i] - bb.x) < 0.06 && Math.abs(arr[i + 1] - bb.z) < 0.06 &&
              Math.abs(arr[i + 2] - bb.y) < 0.06) {
            inVeg = 1; ex = arr[i]; ez = arr[i + 1]; ey = arr[i + 2]; break;
          }
        }
        const vx = ex - c.position.x, vz = ez - c.position.z;
        const L = Math.max(1e-6, Math.hypot(vx, vz));
        /* 期望值：把「树的方向」投影到**这一帧的**相机右向量上。
           只验正北的话，`pan` 写死不跟相机转也能过 —— 四个朝向才是真判据。 */
        const wantPan = Math.max(-1, Math.min(1, (vx / L) * rx + (vz / L) * rz));
        /* 「最近 6 棵」的定义：环内比它更近的树不能超过 5 棵 */
        let closer = 0;
        const L2 = L * L;
        for (let i = 0; i < arr.length; i += 11) {
          const qx = arr[i] - c.position.x, qz = arr[i + 1] - c.position.z;
          const q2 = qx * qx + qz * qz;
          if (q2 >= 14 * 14 && q2 <= 170 * 170 && q2 < L2 - 1e-6) closer++;
        }
        out.push({ ...bb, wantPan: +wantPan.toFixed(3), dGeo: +L.toFixed(2),
                   closer, inVeg, ey: +ey.toFixed(2), right: [+rx.toFixed(3), +rz.toFixed(3)] });
      }
      return out;
    }, { ax: anchor.cx, ay: anchor.y, az: anchor.cz, deg });
    for (const s of got) samples.push({ tag, ...s });
  }

  const good = samples.filter(s => !s.blocked);
  ok('24 次里绝大多数真的叫了（>=20）', good.length >= 20, good.length + '/24');
  ok('没有一次 blocked=notree（这里四周都是树）',
     !samples.some(s => s.blocked === 'notree'), samples.filter(s => s.blocked).map(s => s.blocked));

  const panBad = good.filter(s => !near(s.pan, s.wantPan, 0.01));
  ok('pan == 树方向在相机右向量上的投影（四朝向）', panBad.length === 0,
     panBad.length ? panBad.slice(0, 3).map(s => [s.tag, s.pan, s.wantPan, s.right]) : good.length + ' 次');

  /* 分朝向看：只要有一个朝向的右向量真的转了，pan 才算「跟相机走」 */
  const byTag = {};
  for (const s of good) (byTag[s.tag] = byTag[s.tag] || []).push(s.pan);
  const signs = YAW.every(([t]) => byTag[t] && byTag[t].length >= 4);
  ok('四个朝向都抽到 >=4 个样本', signs, Object.keys(byTag).map(t => t + ':' + byTag[t].length).join(' '));

  const dBad = good.filter(s => !near(s.d, s.dGeo, 0.02));
  ok('d == hypot(树 - 相机)', dBad.length === 0, dBad.length ? dBad.slice(0, 3).map(s => [s.d, s.dGeo]) : 'ok');
  ok('d 全部落在 [14,170]',
     good.every(s => s.d >= 13.9 && s.d <= 170.1),
     [Math.min(...good.map(s => s.d)), Math.max(...good.map(s => s.d))]);
  ok('cand ∈ [1,6]', good.every(s => s.cand >= 1 && s.cand <= 6),
     [...new Set(good.map(s => s.cand))].sort());

  ok('选中的树在环内「比它更近的」不超过 5 棵（= 最近 6 棵）',
     good.every(s => s.closer <= 5), [Math.min(...good.map(s => s.closer)), Math.max(...good.map(s => s.closer))]);
  ok('选中的那棵逐字存在于 nearArr', good.every(s => s.inVeg === 1), good.filter(s => !s.inVeg).length);
  ok('树根不上天也不入水（y > 0.5）', good.every(s => s.ey > 0.5),
     [Math.min(...good.map(s => s.ey)), Math.max(...good.map(s => s.ey))]);

  const kBad = good.filter(s => !near(s.k,
    (1 / (1 + s.d / 70)) * (0.42 + 0.58 * s.occ), 0.002));
  ok('k == 1/(1+d/70) × (0.42+0.58·occ)', kBad.length === 0,
     kBad.length ? kBad.slice(0, 3).map(s => [s.k, s.d, s.occ]) : 'ok');
  const cBad = good.filter(s => !near(s.cut,
    Math.round(Math.min(12000, (3400 + 8600 * Math.exp(-s.d / 60)) * (0.55 + 0.45 * s.occ))), 2));
  ok('cut 对得上 3400 + 8600·e^(-d/60)', cBad.length === 0,
     cBad.length ? cBad.slice(0, 3).map(s => [s.cut, s.d, s.occ]) : 'ok');
  const occSet = [...new Set(good.map(s => s.occ))].sort();
  ok('occ 只取 occlK 的三个离散值（1 / 0.69 / 0.38）',
     occSet.every(v => near(v, 1, 0.002) || near(v, 0.69, 0.002) || near(v, 0.38, 0.002)), occSet);
  /* 城圈里必须有几次真的「隔着楼叫」—— 否则遮挡那一支等于没接上，k/cut 的 occ 因子只是空转 */
  ok('城圈机位出现过被楼挡住的鸟（occ < 1）',
     good.some(s => s.occ < 0.999), occSet);

  ok('pan 不是常数（不是写死的随机值）',
     new Set(good.map(s => s.pan)).size >= 5, new Set(good.map(s => s.pan)).size);
  ok('pan 全部在 [-1,1]', good.every(s => s.pan >= -1.001 && s.pan <= 1.001),
     [Math.min(...good.map(s => s.pan)), Math.max(...good.map(s => s.pan))]);
  ok('ms 是 0.4~2.5s 的一段', good.every(s => s.ms >= 400 && s.ms <= 2500),
     [Math.min(...good.map(s => s.ms)), Math.max(...good.map(s => s.ms))]);

  /* ---------- ⑤ 附近没树 → notree（把 nearArr 抽掉再还原，只动这一步） ---------- */
  const nt = await p.evaluate(() => {
    const D = window.__dbg, A = D.AUD, veg = D.veg();
    const keep = veg.nearArr;
    veg.nearArr = [];
    const n0 = A.dbg().b.n;
    A.chirp();
    const bb = A.dbg().b;
    veg.nearArr = keep;
    return { n0, n1: bb.n, blocked: bb.blocked, d: bb.d, pan: bb.pan,
             restored: veg.nearArr === keep && keep.length > 0 };
  });
  ok('附近一棵树都没有 → 不叫（blocked=notree，n 不动）',
     nt.n0 === nt.n1 && nt.blocked === 'notree', nt);
  ok('探针已把 nearArr 原样装回去', nt.restored, nt.restored);

  /* ---------- ⑥ 静音 → audio（不是靠 tick 拦，chirp 自己也要拦） ---------- */
  await p.click('#btn-snd');
  await p.waitForTimeout(200);
  const muted = await p.evaluate(() => {
    const A = window.__dbg.AUD;
    const n0 = A.dbg().b.n;
    A.chirp();
    const bb = A.dbg().b;
    return { on: A.on, n0, n1: bb.n, blocked: bb.blocked };
  });
  ok('静音时 chirp 自己就拦（blocked=audio，n 不动）',
     muted.on === false && muted.n0 === muted.n1 && muted.blocked === 'audio', muted);

  const bad = R.filter(r => !r.ok);
  console.log(bad.length ? ('--- ' + bad.length + ' FAIL') : '--- ALL PASS');
  await b.close();
  process.exit(bad.length ? 1 : 0);
})();
