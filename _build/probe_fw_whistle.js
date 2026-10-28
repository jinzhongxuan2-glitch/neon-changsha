/* 烟花升空段（§42）：哨音调度 + 火星轨迹。

   以前烟花是「凭空在 200m 高空炸开」。现在每发先升 1.5s：一颗火星从地面爬到爆心、
   拖一条尾迹，同时一声上扬的哨音，**在爆点那一刻收尾**。
   这两件事都不进渲染管线的「画面对照」：轨迹是 2km 外的 1~2px，哨音根本不在图里。
   所以只能读逻辑值 —— 而且**不读 `AudioParam.value`**（headless 里音频线程被渲染饿死，
   `.value` 会滞后一整个量子，§31/§37 都踩过），读的是算完立刻写进 `wDbg` 的纯 JS 数字。

   判据：
   ① 冷启动（没开声）是纯 no-op，且 `blocked` 字段同形状；
   ② 夜里 1000m：f0∈[380,470]、f1/f0∈[2.5,3.0]、dur=1.5、delay=0.04+d/340、cut 对得公式；
   ③ **boom 的 delay 比 whistle 多整整一个升空时长**（否则「哨音还在响，砰已经炸了」）；
   ④ 白天门控 / 3500m 外不发声；
   ⑤ 轨迹：h 单调上升、末点 == 爆心、升空段内爆点不可见（`uBirth` 在未来）；
   ⑥ 升空点在爆心的水平 70~150m 内、贴地（6~40m），不是从水里/天上冒出来。

   用法：node _build/probe_fw_whistle.js
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
  await p.goto('file:///' + ROOT + '/index.html?t=2&q=low&hour=21', { waitUntil: 'load', timeout: 240000 });
  await p.waitForFunction("performance.getEntriesByName('B:done').length > 0", null, { timeout: 240000 });
  await p.waitForTimeout(500);

  /* ---------- ① 冷启动 ---------- */
  const cold = await p.evaluate(() => {
    const A = window.__dbg.AUD;
    let threw = null;
    try { A.whistle(0, 200, 0, 1.5); } catch (e) { threw = e.message; }
    const w = A.dbg().w;
    return { ctx: A.ctx ? A.ctx.state : null, n: w.n, blocked: w.blocked, threw };
  });
  ok('冷启动不开声：whistle 是 no-op 且不抛错', cold.ctx === null && cold.n === 0 && !cold.threw, cold);
  ok('冷启动也给同形状的 w（blocked=audio）', cold.blocked === 'audio', cold.blocked);

  /* ---------- ② 开声（必须真点按钮：AudioContext 只在手势里建） ---------- */
  await p.click('#btn-snd');
  await p.waitForTimeout(400);

  /* ---------- ③ 声学调度（相机钉死，爆心逐方向试） ---------- */
  const sched = await p.evaluate(() => {
    const D = window.__dbg, A = D.AUD, c = D.camera, ct = D.controls;
    if (typeof D.enterFree === 'function') D.enterFree();
    ct.autoRotate = false; ct.minDistance = 1;
    const place = (px, py, pz, tx, ty, tz) => {
      c.position.set(px, py, pz); ct.target.set(tx, ty, tz); c.up.set(0, 1, 0); ct.update();
    };
    const out = {};
    const shot = (name, gx, gy, gz, wx, wy, wz) => {
      const n0 = A.dbg().w.n;
      A.whistle(wx, wy, wz, 1.5);
      out[name] = Object.assign({ fired: A.dbg().w.n - n0 }, A.dbg().w);
    };
    place(0, 60, 0, 0, 60, -100);               /* 原点，朝正北：右向量 = +x */
    shot('east', 0, 6, 0, 1000, 200, 0);
    shot('west', 0, 6, 0, -1000, 200, 0);
    shot('front', 0, 6, 0, 0, 200, -1000);

    /* 同一位置：boom 的 delay 必须比 whistle 多一个升空时长 */
    const w0 = (A.whistle(1000, 200, 0, 1.5), A.dbg().w.delay);
    A.boom(1000, 200, 0, 1.5);
    const bHold = A.dbg().fw.delay;
    A.boom(1000, 200, 0, 0);
    const bNo = A.dbg().fw.delay;

    /* 距离梯度：delay 单调升、cut 单调降 */
    const dist = {};
    for (const dd of [400, 1000, 2400]){
      place(0, 60, 0, 0, 60, -100);
      A.whistle(dd, 200, 0, 1.5);
      dist['d' + dd] = { ...A.dbg().w };
    }
    /* 3500m 外 / 白天 */
    const nFar0 = A.dbg().w.n;
    A.whistle(5000, 200, 0, 1.5);
    const far = { n0: nFar0, n1: A.dbg().w.n, blocked: A.dbg().w.blocked };
    D.applyTime(13);
    const nDay0 = A.dbg().w.n;
    A.whistle(1000, 200, 0, 1.5);
    const day = { n0: nDay0, n1: A.dbg().w.n, blocked: A.dbg().w.blocked, night: D.nightNow };
    D.applyTime(21);
    place(0, 60, 0, 0, 60, -100);
    return { out, w0, bHold, bNo, dist, far, day, night: D.nightNow };
  });

  const o = sched.out;
  ok('正东爆心 pan=+1', near(o.east.pan, 1, 0.02), o.east.pan);
  ok('正西爆心 pan=-1', near(o.west.pan, -1, 0.02), o.west.pan);
  ok('正前爆心 pan=0', near(o.front.pan, 0, 0.02), o.front.pan);
  ok('哨音确实发出（n 自增）', o.east.fired === 1 && o.west.fired === 1, [o.east.fired, o.west.fired]);
  ok('f0 在 380~470Hz（三角波基线）', o.east.f0 >= 380 && o.east.f0 <= 470, o.east.f0);
  ok('f1/f0 在 2.5~3.0（上扬，气压随高度降低）',
     o.east.f1 / o.east.f0 > 2.45 && o.east.f1 / o.east.f0 < 3.05, (o.east.f1 / o.east.f0).toFixed(2));
  ok('dur = 升空时长 1.5s', near(o.east.dur, 1.5, 0.01), o.east.dur);
  ok('1000m → 延迟 2.98s（0.04 + d/340）', near(o.east.delay, 2.98, 0.03), o.east.delay);
  /* 用**报告的 d** 复算，不用猜的 1000m：相机在 (0,60,0)、爆心 (1000,200,0) → 1009.7m */
  ok('cut 对得上 500 + 5200·e^(-d/900)',
     near(o.east.cut, Math.round(500 + 5200 * Math.exp(-o.east.d / 900)), 2),
     { d: o.east.d, cut: o.east.cut, want: Math.round(500 + 5200 * Math.exp(-o.east.d / 900)) });

  ok('boom 的 delay 比 whistle 多整整一个升空时长（1.5s）',
     near(sched.bHold - sched.w0, 1.5, 0.01), { whistle: sched.w0, boomHold: sched.bHold });
  ok('boom 不传 hold 时与老行为一致', near(sched.bNo, sched.w0, 0.01), sched.bNo);

  const ds = sched.dist;
  ok('delay 随距离单调升',
     ds.d400.delay < ds.d1000.delay && ds.d1000.delay < ds.d2400.delay,
     [ds.d400.delay, ds.d1000.delay, ds.d2400.delay].join(' < '));
  ok('cut 随距离单调降',
     ds.d400.cut > ds.d1000.cut && ds.d1000.cut > ds.d2400.cut,
     [ds.d400.cut, ds.d1000.cut, ds.d2400.cut].join(' > '));
  ok('k 随距离单调降', ds.d400.k > ds.d1000.k && ds.d1000.k > ds.d2400.k,
     [ds.d400.k, ds.d1000.k, ds.d2400.k].join(' > '));
  ok('3500m 外不发声（blocked=far，n 不动）',
     sched.far.n0 === sched.far.n1 && sched.far.blocked === 'far', sched.far);
  ok('白天（13 时）不发声（blocked=day，n 不动）',
     sched.day.night < 0.05 && sched.day.n0 === sched.day.n1 && sched.day.blocked === 'day', sched.day);

  /* ---------- ④ 轨迹：手动放一发，把时钟推着走 ---------- */
  await p.evaluate(() => {
    const D = window.__dbg;
    D.FW.setOn(false);                    /* 关掉自动放，避免和探针这一发抢槽位 */
    D.setTime(40);
    D.FW.spawn(40);
  });
  const steps = [];
  for (const adv of [0, 0.4, 0.8, 1.2, 1.7]){
    steps.push(await p.evaluate(async (adv) => {
      const D = window.__dbg;
      D.setTime(40 + adv);
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      const f = D.FW.flight().find(s => Math.abs(s.t0 - 40) < 0.01);
      const pend = D.FW.pending();
      return { adv, f: f || null, pend,
               burstVis: D.FW.bursts.some(b2 => b2.pts.visible) };
    }, adv));
  }

  const live = steps.filter(s => s.f);
  const ys = live.map(s => s.f.y);
  ok('升空段有火星在飞（q∈[0,1]）', live.length >= 3, live.map(s => s.f.q));
  ok('高度单调上升', ys.every((v, i) => i === 0 || v >= ys[i - 1] - 0.5), ys);
  ok('出膛快、末段慢（0.4/0.8/1.2s 的增量递减）',
     (ys[1] - ys[0]) > (ys[2] - ys[1]) && (ys[2] - ys[1]) > (ys[3] - ys[2]) * 0.6,
     [ys[1] - ys[0], ys[2] - ys[1], ys[3] - ys[2]].map(v => Math.round(v)));
  ok('升空段内爆点不可见（pending 里有 1.5s 的倒计时）',
     steps[0].pend.length === 1 && near(steps[0].pend[0], 1.5, 0.15), steps[0].pend);
  const last = steps[steps.length - 1];
  ok('升空结束：火星消失、爆点已到', !last.f && last.pend.length === 0, { f: last.f, pend: last.pend });

  const endPt = await p.evaluate(() => {
    const D = window.__dbg;
    const f = D.FW.flight();
    return { live: f.length };
  });
  ok('没有残留的飞行火星', endPt.live === 0, endPt);

  const geo = await p.evaluate(() => {
    const D = window.__dbg;
    const f = D.FW.flight();
    /* 再放一发，量「升空点 vs 爆心」的几何关系 */
    D.setTime(80); D.FW.spawn(80);
    const s = D.FW.flight().find(q => Math.abs(q.t0 - 80) < 0.01);
    return s || null;
  });
  const dh = geo ? Math.hypot(geo.bx - geo.ax, geo.bz - geo.az) : -1;
  const dv = geo ? geo.by - geo.ay : -1;
  /* 升空点可能落在橘子洲陆地上（terrain 10~30m），所以 dv 的下限放到 90：
     这一条验的是「火星从地面附近出发」，不是「从水面出发」。 */
  ok('升空点贴地（6~45m）', geo && geo.ay >= 5.9 && geo.ay <= 45, geo && geo.ay);
  ok('升空点在爆心水平 70~150m 内（斜着飞）', dh >= 68 && dh <= 155, Math.round(dh));
  ok('爆心比升空点高 90~320m', dv >= 90 && dv <= 320, Math.round(dv));

  const bad = R.filter(r => !r.ok);
  console.log(bad.length ? ('--- ' + bad.length + ' FAIL') : '--- ALL PASS');
  await b.close();
  process.exit(bad.length ? 1 : 0);
})();
