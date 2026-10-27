/* 桥面标线基准：正上方俯视诊断（判断标线在桥面横断面上是否居中）。

   背景：`bridgeCore` 里 `oo = o - dof[i]` 把标线从「桥走线坐标」换到
   「桥下 OSM 路中线坐标」，目的是让桥头和路面标线接上。但桥体几何
   （护栏 / 人行道 / 车行道）是按**桥走线**建的 —— 如果 dof 又大又乱，
   标线会在桥面上整体歪向一侧，桥上看着比桥头不接更糟。
   这个探针拍「桥中段正俯视」，桥两侧护栏都在画面里，一眼能看出偏没偏。

   用法：node _build/probe_bridgehead.js [tag] [--id=fuyuanlu]
*/
const { chromium, ROOT, EXE } = require('./_pw');
const fs = require('fs');
const OUT = ROOT + '/_audit/bridge/';
fs.mkdirSync(OUT, { recursive: true });
const TAG = process.argv[2] || 'hd';
const arg = process.argv.find(s => s.startsWith('--id='));
const ONLY = arg ? arg.slice(5) : null;
/* 带车拍：判「桥上车是不是跑在标线画出来的车道里」。
   车流最后落在桥坐标系的 off 处（`lat = off - dof` 只是坐标系平移，
   渲染又按 OSM 中线加回来），标线却是直接按世界坐标 push 的 ——
   两者基准不同，带车一眼就能看出标线偏没偏。 */
const CARS = process.argv.includes('--cars');
const hArg = process.argv.find(s => s.startsWith('--hour='));
const HOUR = hArg ? hArg.slice(7) : '13';

(async () => {
  const b = await chromium.launch({ executablePath: EXE, headless: true,
    args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--allow-file-access-from-files'] });
  const p = await b.newPage({ viewport: { width: 900, height: 700 } });
  p.on('pageerror', e => console.log('ERR', e.message));
  await p.goto('file:///' + ROOT + '/index.html?t=2&q=high&hour=' + HOUR, { waitUntil: 'load', timeout: 240000 });
  await p.waitForFunction("performance.getEntriesByName('B:done').length > 0", null, { timeout: 240000 });
  await p.waitForTimeout(1800);
  await p.evaluate((cars) => {
    const el = document.getElementById('load');
    if (el) { el.classList.add('done'); el.style.display = 'none'; }
    document.querySelectorAll('.ui').forEach(e => { e.style.display = 'none'; });
    window.__TRAFFIC_FREEZE = true;
    /* 行人（aScale + aYaw 但没有 aPart 的车属性）会挡标线，一律清掉；
       车在 --cars 时保留 —— 它正是判据。 */
    window.__dbg.scene.traverse(o => {
      const a = o.geometry && o.geometry.attributes;
      if (!o.isMesh || !a || !a.aScale || !a.aYaw) return;
      if (cars && a.aPart) return;
      a.aScale.array.fill(0); a.aScale.needsUpdate = true;
    });
  }, CARS);

  /* 用 BRIDGE_DECKS（4m 重采样、带 dLand）而不是 BRIDGE_PATHS（稀疏控制点），
     这样「桥中段」取的是真正在江面上的那一段。 */
  const decks = await p.evaluate(() => window.__dbg.BRIDGE_DECKS.map(d => {
    const n = d.path.length;
    /* 找 dLand 最大的那一半的中点，保证在江面上而不是引桥上 */
    let lo = 0, hi = n - 1;
    for (let i = 0; i < n; i++) if (d.dLand[i] >= 6) { lo = hi = i; break; }
    for (let i = n - 1; i >= 0; i--) if (d.dLand[i] >= 6) { lo = i; break; }
    const mi = ((lo + hi) / 2) | 0;
    const q = Math.max(0, Math.min(n - 1, mi));
    return {
      id: d.id, n, mi: q, half: d.half,
      x: d.path[q].x, z: d.path[q].z,
      y: d.ys[q],
      px: d.px[q], pz: d.pz[q],
      dof: +d.dof[q].toFixed(2),
      dLand: +d.dLand[q].toFixed(2),
      h0: { x: d.path[0].x, z: d.path[0].z, y: d.ys[0] },
      hLast: { x: d.path[n - 1].x, z: d.path[n - 1].z, y: d.ys[n - 1] },
      dofHead: +d.dof[0].toFixed(2), dofTail: +d.dof[n - 1].toFixed(2),
    };
  }));
  console.log('DECKS', JSON.stringify(decks.map(d => ({
    id: d.id, dof: d.dof, dLand: d.dLand, half: d.half, dofHead: d.dofHead, dofTail: d.dofTail,
  }))));

  for (const d of decks) {
    if (ONLY && d.id !== ONLY) continue;
    /* 机位 1：桥中段正上方 62m —— 桥宽 2*half，画面高 2*62*tan(fov/2)≈58m */
    await p.evaluate(({ x, z, y, half }) => {
      const c = window.__dbg;
      c.controls.minDistance = 5;
      c.camera.position.set(x, y + half * 2.0 + 24, z + 0.01);
      c.controls.target.set(x, y, z);
      c.controls.update();
    }, d);
    await p.waitForTimeout(220);
    await p.screenshot({ path: OUT + TAG + '_' + d.id + '_mid.png', timeout: 60000 });
    console.log('SHOT', d.id, 'mid');

    /* 机位 2：桥头正上方（从桥内 40m 处，看得到过渡段） */
    for (const [nm, pt] of [['h', d.h0], ['t', d.hLast]]) {
      await p.evaluate(({ x, z, y }) => {
        const c = window.__dbg;
        c.controls.minDistance = 5;
        c.camera.position.set(x, y + 68, z + 0.01);
        c.controls.target.set(x, y, z);
        c.controls.update();
      }, { x: pt.x, z: pt.z, y: pt.y });
      await p.waitForTimeout(200);
      await p.screenshot({ path: OUT + TAG + '_' + d.id + '_end' + nm + '.png', timeout: 60000 });
      console.log('SHOT', d.id, 'end' + nm);
    }
  }
  await b.close();
})();
