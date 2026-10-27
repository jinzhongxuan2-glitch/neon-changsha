/* 烟花爆炸声：声学调度数值验证（不拍图、不听）。

   为什么要专门写探针：`boom()` 里真正决定「像不像」的是四个数 ——
   延迟（d/340）、距离衰减 k、空气吸收截止频率 cut、声像 pan。
   这四个数错一个，声音就变成「按下按钮的电子音」，但**画面上一点痕迹都没有**，
   gate 更是完全看不见（音频根本不在渲染管线里）。所以只能读逻辑值。

   注意：不读 `AudioParam.value`。`setTargetAtTime` / `setValueAtTime` 的
   `.value` 只在音频量子被处理时更新，headless 里音频线程被渲染饿死会滞后一两秒。
   探针读的是 `AUD.dbg().fw` —— boom 算完立刻写进去的纯 JS 数字。

   用法：node _build/probe_fw_boom.js
*/
const { chromium, ROOT, EXE } = require('./_pw');

(async () => {
  const b = await chromium.launch({ executablePath: EXE, headless: true,
    args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist',
           '--allow-file-access-from-files', '--autoplay-policy=no-user-gesture-required'] });
  /* viewport 必须过 820px 断点：#btn-snd 在 #panel 里，窄屏默认收起 → 点不到 */
  const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
  p.on('pageerror', e => console.log('ERR', e.message));
  await p.goto('file:///' + ROOT + '/index.html?t=2&q=low&hour=21', { waitUntil: 'load', timeout: 240000 });
  await p.waitForFunction("performance.getEntriesByName('B:done').length > 0", null, { timeout: 240000 });
  await p.waitForTimeout(700);

  /* ---------- ① 冷启动：没开声时必须是纯 no-op ---------- */
  const cold = await p.evaluate(() => {
    const A = window.__dbg.AUD;
    const d = A.dbg();
    let threw = null;
    try { A.boom(0, 200, 0); } catch (e) { threw = e.message; }
    return { on: d.on, ctx: A.ctx ? A.ctx.state : null, fwN: d.fw.n, threw };
  });
  console.log('COLD ' + JSON.stringify(cold));

  /* ---------- ② 开声（必须真点按钮：AudioContext 只在用户手势里建） ---------- */
  await p.click('#btn-snd');
  await p.waitForTimeout(500);
  const warm = await p.evaluate(() => {
    const A = window.__dbg.AUD;
    return { on: A.on, ctx: A.ctx ? A.ctx.state : null, sr: A.ctx ? A.ctx.sampleRate : 0 };
  });
  console.log('WARM ' + JSON.stringify(warm));

  /* ---------- ③ 把相机钉死：正北朝向，爆心逐方向试 ----------
     相机 (0,60,0) 朝 -z（默认 forward），右向量 = +x。
     所以「正东的爆心」应当 pan=+1，「正西」pan=-1，正前/正后 pan=0。 */
  const r = await p.evaluate(() => {
    const D = window.__dbg, A = D.AUD, c = D.camera, ct = D.controls;
    if (typeof D.enterFree === 'function') D.enterFree();
    ct.autoRotate = false;
    ct.minDistance = 1;
    function place(px, py, pz, tx, ty, tz){
      c.position.set(px, py, pz);
      ct.target.set(tx, ty, tz);
      c.up.set(0, 1, 0);
      ct.update();
    }
    const out = {};
    function shot(name, wx, wy, wz){
      const n0 = A.dbg().fw.n;
      A.boom(wx, wy, wz);
      const f = A.dbg().fw;
      out[name] = { d: f.d, delay: f.delay, k: f.k, pan: f.pan, cut: f.cut,
                    fired: f.n - n0, n: f.n };
    }

    /* 相机在原点、朝正北 */
    place(0, 60, 0, 0, 60, -100);
    shot('east',   1000, 60, 0);
    shot('west',  -1000, 60, 0);
    shot('front',     0, 60, -1000);
    shot('back',      0, 60, 1000);
    shot('above',     0, 1060, 0);         /* 正上方：水平距离 0，不该偏到任何一边 */

    /* 距离梯度（同一方向，只变距离）：k / cut 必须单调降，delay 单调升 */
    const dist = {};
    for (const dd of [400, 800, 1600, 3200]){
      place(0, 60, 0, 0, 60, -100);
      shot('d' + dd, dd, 60, 0);
      dist['d' + dd] = { ...A.dbg().fw };
    }
    /* 3500m 外：必须被挡掉，n 不动 */
    const nBefore = A.dbg().fw.n;
    A.boom(5000, 60, 0);
    dist.blocked = { nBefore, nAfter: A.dbg().fw.n };

    /* 抬头 45° 看远处的爆心：俯仰不该改变左右声像 */
    place(0, 60, 0, 0, 600, -100);
    shot('pitch45', 1000, 60, 0);

    /* 转头 90°（朝正东）：同一个爆心应当从「正前」变成「正右」→ pan 归 0 */
    place(0, 60, 0, 1000, 60, 0);
    shot('turnE', 1000, 60, 0);

    /* ---------- ④ 真实放一发：爆心由烟花系统给，不在探针里编 ---------- */
    place(0, 60, 0, 0, 60, -100);
    /* 昼夜门控：烟花白天也 spawn（既有行为），但声音不能跟着响 */
    D.applyTime(13);
    const dayNight = { nightAt13: D.nightNow };
    const nDay0 = A.dbg().fw.n;
    A.boom(1000, 60, 0);
    dayNight.nAfterDay = A.dbg().fw.n - nDay0;
    D.applyTime(21);
    dayNight.nightAt21 = D.nightNow;
    const nNight0 = A.dbg().fw.n;
    A.boom(1000, 60, 0);
    dayNight.nAfterNight = A.dbg().fw.n - nNight0;

    const n1 = A.dbg().fw.n;
    D.FW.spawn(0);
    const real = { ...A.dbg().fw };
    const org = D.FW.bursts[0].mat.uniforms.uOrigin.value;
    return { out, dist, real, realN: real.n - n1, dayNight,
             realOrigin: [Math.round(org.x), Math.round(org.y), Math.round(org.z)],
             camAt: [c.position.x, c.position.y, c.position.z] };
  });

  /* ---------- ⑤ 断言 ---------- */
  const R = [];
  const ok = (name, cond, got) => R.push([cond ? 'PASS' : 'FAIL', name, got]);
  const near = (a, b, e) => Math.abs(a - b) <= e;
  const o = r.out, ds = r.dist;

  ok('冷启动不开声：boom 是 no-op', cold.ctx === null && cold.fwN === 0 && cold.threw === null,
     JSON.stringify(cold));
  ok('开声后 ctx 建立且 on', warm.on === true && warm.sr > 0, JSON.stringify(warm));

  ok('正东爆心 pan=+1', near(o.east.pan, 1, 0.02), o.east.pan);
  ok('正西爆心 pan=-1', near(o.west.pan, -1, 0.02), o.west.pan);
  ok('正前爆心 pan=0', near(o.front.pan, 0, 0.02), o.front.pan);
  ok('正后爆心 pan=0', near(o.back.pan, 0, 0.02), o.back.pan);
  ok('正上方爆心 pan=0', near(o.above.pan, 0, 0.02), o.above.pan);

  ok('1000m → 延迟 2.98s', near(o.east.delay, 2.98, 0.03), o.east.delay);
  ok('400m 延迟 ≈1.22s', near(ds.d400.delay, 1.22, 0.03), ds.d400.delay);
  ok('3200m 延迟 ≈9.45s', near(ds.d3200.delay, 9.45, 0.05), ds.d3200.delay);

  ok('k 随距离单调降', ds.d400.k > ds.d800.k && ds.d800.k > ds.d1600.k && ds.d1600.k > ds.d3200.k,
     [ds.d400.k, ds.d800.k, ds.d1600.k, ds.d3200.k].join(' > '));
  ok('cut 随距离单调降（远处只剩低频）',
     ds.d400.cut > ds.d800.cut && ds.d800.cut > ds.d1600.cut && ds.d1600.cut > ds.d3200.cut,
     [ds.d400.cut, ds.d800.cut, ds.d1600.cut, ds.d3200.cut].join(' > '));
  /* 绝对阈值不给死数：衰减曲线是**艺术化的**，不是 ISO 9613 物理场。
     真按 2km 的大气吸收（30~60dB）做，烟花就完全听不见了 —— 这是视觉作品，
     声音要能听见。所以只验「相对关系」：3.2km 处的带宽必须掉到 400m 的五分之一以下。 */
  ok('3200m 高频滤光（cut 掉到 400m 的 1/5 以下，且 <1200Hz）',
     ds.d3200.cut < 1200 && ds.d3200.cut * 5 < ds.d400.cut,
     ds.d400.cut + 'Hz → ' + ds.d3200.cut + 'Hz');

  ok('3500m 外不发声（n 不动）', ds.blocked.nBefore === ds.blocked.nAfter,
     JSON.stringify(ds.blocked));

  ok('抬头 45° 不改变左右声像', near(o.pitch45.pan, o.east.pan, 0.02),
     'east=' + o.east.pan + ' pitch45=' + o.pitch45.pan);
  ok('转头朝东后同一爆心归中', near(o.turnE.pan, 0, 0.02), o.turnE.pan);

  ok('烟花系统放一发 → 声源被触发', r.realN === 1, r.realN);
  ok('真实爆心距离在橘子洲量级（1600~2100m）',
     r.real.d > 1600 && r.real.d < 2100, r.real.d);

  const dn = r.dayNight;
  ok('白天（13 时）不出声：烟花在放但不该有「看不见的响」',
     dn.nightAt13 < 0.05 && dn.nAfterDay === 0,
     'uNight=' + dn.nightAt13 + ' fired=' + dn.nAfterDay);
  ok('夜里（21 时）出声', dn.nightAt21 > 0.9 && dn.nAfterNight === 1,
     'uNight=' + dn.nightAt21 + ' fired=' + dn.nAfterNight);

  for (const row of R) console.log(row[0].padEnd(4), row[1], '  →', row[2]);
  const bad = R.filter(x => x[0] === 'FAIL');
  console.log('---', bad.length ? bad.length + ' FAIL' : 'ALL PASS');

  console.log('\nDETAIL ' + JSON.stringify({ out: o, dist: ds, real: r.real,
    origin: r.realOrigin, cam: r.camAt }, null, 1));
  await b.close();
  process.exit(bad.length ? 1 : 0);
})();
