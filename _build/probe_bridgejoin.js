/* 桥头标线衔接：先拍整桥全景（看清标线在不在），再拍桥头。

   背景（ROADMAP 风险 14）：桥面走 `deckSection(W)` 的断面，桥头以外走路面 shader
   的 `aw/3.5` 断面，两套车道线在引桥端点横向可能跳几米。

   用法：node _build/probe_bridgejoin.js [tag] [--end]
        不带 --end 只拍整桥（快）
*/
const { chromium, ROOT, EXE } = require('./_pw');
const fs = require('fs');
const OUT = ROOT + '/_audit/bridge/';
fs.mkdirSync(OUT, { recursive: true });
const TAG = process.argv[2] || 'now';
const DO_END = process.argv.includes('--end');

(async () => {
  const b = await chromium.launch({ executablePath: EXE, headless: true,
    args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--allow-file-access-from-files'] });
  const p = await b.newPage({ viewport: { width: 900, height: 620 } });
  p.on('pageerror', e => console.log('ERR', e.message));
  await p.goto('file:///' + ROOT + '/index.html?t=2&q=high&hour=13', { waitUntil: 'load', timeout: 240000 });
  await p.waitForFunction("performance.getEntriesByName('B:done').length > 0", null, { timeout: 240000 });
  await p.waitForTimeout(2200);
  await p.evaluate(() => {
    const el = document.getElementById('load');
    if (el) { el.classList.add('done'); el.style.display = 'none'; }
    document.querySelectorAll('.ui').forEach(e => { e.style.display = 'none'; });
    /* 车和行人挡标线，全清掉（改 aScale，不碰实例矩阵） */
    window.__TRAFFIC_FREEZE = true;
    window.__dbg.scene.traverse(o => {
      const a = o.geometry && o.geometry.attributes;
      if (o.isMesh && a && a.aScale && a.aYaw) { a.aScale.array.fill(0); a.aScale.needsUpdate = true; }
    });
  });

  const info = await p.evaluate(() => window.__dbg.BRIDGES.map(br => {
    const pts = br.pts, n = pts.length, mid = pts[(n / 2) | 0];
    /* 桥走线整体方向，用来把相机放到「侧面」（俯视整桥时最舒服的角度） */
    const dx = pts[n - 1][0] - pts[0][0], dz = pts[n - 1][1] - pts[0][1];
    const L = Math.hypot(dx, dz) || 1;
    return {
      id: br.id, n,
      mid: [mid[0], mid[1]],
      deckY: window.__dbg.deckY(mid[0], mid[1]),
      len: Math.round(L),
      nx: -dz / L, nz: dx / L,          /* 桥的横向法线 */
      end0: pts[0], end1: pts[n - 1],
    };
  }));
  console.log('BRIDGES', JSON.stringify(info.map(b => ({ id: b.id, len: b.len, deckY: +b.deckY.toFixed(1) }))));

  for (const br of info) {
    /* 整桥：相机退到桥中点侧向 260m、上方 220m，看向桥中点 */
    await p.evaluate(({ mid, deckY, nx, nz, len }) => {
      const d = window.__dbg;
      const R = Math.max(200, len * 0.55);
      d.controls.minDistance = 5;
      d.camera.position.set(mid[0] + nx * R, deckY + R * 0.85, mid[1] + nz * R);
      d.controls.target.set(mid[0], deckY, mid[1]);
      d.controls.update();
    }, br);
    await p.waitForTimeout(260);
    await p.screenshot({ path: OUT + TAG + '_' + br.id + '_full.png', timeout: 60000 });
    console.log('SHOT', br.id, 'full');
  }

  if (DO_END) {
    for (const br of info) {
      /* 端点机位改成 45° 斜视：垂直俯视只能看标线，看不到桥体与路面的错位，
         而「桥头标线接不上」到底是标线的问题还是桥体本身偏了，必须一起看。
         相机从端点往桥内退 100m、横向偏 55m、高 62m，看向端点内 25m 处。 */
      for (const [endName, e, inner] of [['head', br.end0, br.end1], ['tail', br.end1, br.end0]]) {
        await p.evaluate(({ x, z, deckY, inner, nx, nz }) => {
          const d = window.__dbg;
          const dx = inner[0] - x, dz = inner[1] - z;
          const L = Math.hypot(dx, dz) || 1;
          const ux = dx / L, uz = dz / L;
          d.controls.minDistance = 5;
          d.camera.position.set(x + ux * 100 + nx * 55, deckY + 62, z + uz * 100 + nz * 55);
          d.controls.target.set(x + ux * 25, deckY, z + uz * 25);
          d.controls.update();
        }, { x: e[0], z: e[1], deckY: br.deckY, inner, nx: br.nx, nz: br.nz });
        await p.waitForTimeout(240);
        await p.screenshot({ path: OUT + TAG + '_' + br.id + '_' + endName + '.png', timeout: 60000 });
        console.log('SHOT', br.id, endName);
      }
    }
  }

  await b.close();
})();
