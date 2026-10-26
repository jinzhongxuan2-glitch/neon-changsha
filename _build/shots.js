/* 固定机位截图 + 指标采集
 *
 *   node shots.js --tag baseline --mode diff
 *   node shots.js --tag look --mode pretty --only day_cbd
 *
 * diff   : 隐藏 UI / 关烟花·车流·行人·雨 / 去胶片颗粒 / 冻结时钟
 *          -> 除水波外全部静态，可以跟另一版本做像素对比
 * pretty : 保留完整观感（含 UI），用于人眼看效果
 *
 * 产物：_audit/<tag>/<scene>.png + _audit/<tag>/meta.json
 */
const { chromium } = require('C:/Users/<user>/.workbuddy/binaries/node/workspace/node_modules/playwright-core');
const fs = require('fs');
const path = require('path');

const ROOT = 'C:/Users/<user>/Desktop/neon-changsha';
const EXE = 'C:/Users/<user>/AppData/Local/ms-playwright/chromium_headless_shell-1194/chrome-win/headless_shell.exe';

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };
const has = (k) => argv.includes('--' + k);

const TAG = arg('tag', 'baseline');
const MODE = arg('mode', 'diff');
const ONLY = arg('only', null);
const FPS = !has('no-fps');
const OUT = path.join(ROOT, '_audit', TAG);

/* 机位：view 用应用内置预设；cam 是 [x, 离地高度, z] + target；
   street 表示在离 IFS 最近的次干道上自动落脚，朝路面方向看 */
const SCENES = [
  { name: 'day_cbd',     hour: 14.0, view: 'cbd' },
  { name: 'day_all',     hour: 14.0, view: 'all' },
  { name: 'day_street',  hour: 10.0, street: { x: -145, z: -261 } },
  { name: 'day_old',     hour: 10.0, street: { x: -900, z: -500 } },
  { name: 'dusk_cbd',    hour: 18.6, view: 'cbd' },
  { name: 'night_cbd',   hour: 21.0, view: 'cbd' },
  { name: 'night_all',   hour: 21.0, view: 'all' },
  { name: 'night_isle',  hour: 21.0, view: 'isle' },
  { name: 'night_street', hour: 21.0, street: { x: -145, z: -261 } },
  /* 低层商业街：招牌/店面/人行道只在这种街上看得出来，高塔街景里全是玻璃幕墙 */
  { name: 'day_shop',    hour: 10.0, street: { x: -629, z: -1151 } },
  { name: 'night_shop',  hour: 21.0, street: { x: -629, z: -1151 } },
  /* 人眼高度沿街近看：专门给「店面凸出件」用 —— 俯角小、尺度近，
     台阶/雨棚/门套柱的视差只在这个视角下成立 */
  { name: 'day_close',   hour: 10.5, street: { x: -629, z: -1151 }, near: true, eye: 2.05 },
  { name: 'night_close', hour: 21.0, street: { x: -629, z: -1151 }, near: true, eye: 2.05 },
  /* 正对一栋 15m 临街楼的墙脚。早期版本（cam y=1.22 + 仰角 60°）把沿街店面
     全压到地平线附近成一条横带，看不出层次，已废弃；横看机位 side 取代它。 */
  /* 横看店面：站在人行道上把视线转 90°，正对街对面的底层。
     沿街机位里店面只占几个像素，这是唯一能判断「像不像店铺」的机位。 */
  { name: 'day_side',    hour: 10.5, street: { x: -629, z: -1151 }, eye: 2.05, side: 24 },
  { name: 'day_side2',   hour: 10.5, street: { x: -629, z: -1151 }, eye: 2.05, side: -24 },
  { name: 'night_side',  hour: 21.0, street: { x: -629, z: -1151 }, eye: 2.05, side: 24 },
];

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  fs.mkdirSync(OUT, { recursive: true });

  const browser = await chromium.launch({
    executablePath: EXE, headless: true,
    args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--allow-file-access-from-files'],
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });

  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });

  /* 两个确定性措施：
     1) 固定 Math.random —— 树/停车/灯杆/山间灯火都是随机的，不固定就无法做像素回归；
     2) 可冻结时钟 —— 冻住 performance.now 后 THREE.Clock.getDelta() 恒为 0，
        elapsed 不再前进，所有 uTime 驱动的动画（信号灯/星星/水波/航空灯）全部静止。 */
  await page.addInitScript(() => {
    let s = 20261021 >>> 0;
    Math.random = () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
    const orig = performance.now.bind(performance);
    let frozen = null;
    window.__freezeClock = () => { frozen = orig(); };
    performance.now = () => (frozen === null ? orig() : frozen);
  });

  const url = 'file:///' + ROOT + '/index.html?t=2&view=cbd&hour=21' + arg('extra', '');
  const t0 = Date.now();
  await page.goto(url, { waitUntil: 'load', timeout: 240000 });
  await page.waitForFunction('window.__dbg && window.__dbg.veg()', null, { timeout: 180000 });
  await page.waitForTimeout(2600);

  const boot = await page.evaluate(() => {
    const d = window.__dbg;
    const gl = d.renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    let triAll = 0, triVis = 0, meshes = 0;
    d.scene.traverse(o => {
      if (!o.geometry || !o.geometry.attributes || !o.geometry.attributes.position) return;
      meshes++;
      const g = o.geometry;
      const n = g.index ? g.index.count / 3 : g.attributes.position.count / 3;
      const inst = g.instanceCount || 1;
      const t = Math.round(n * inst);
      triAll += t;
      if (o.visible) triVis += t;
    });
    return {
      gpu: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'n/a',
      marks: performance.getEntriesByType('mark').map(m => [m.name, Math.round(m.startTime)]),
      paint: window.__paint ? window.__paint.first : -1,
      programs: d.stats().programs,
      textures: d.stats().textures,
      geometries: d.stats().geometries,
      heap: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : -1,
      meshes, triAll, triVis,
      roofVerts: d.getRoofV(),
      pixelRatio: d.renderer.getPixelRatio(),
    };
  });

  const fps = {};
  if (FPS) {
    for (const view of ['cbd', 'all', 'isle']) {
      await page.evaluate((v) => {
        const d = window.__dbg, h = d.HOME[v];
        d.applyTime(21);
        d.camera.position.copy(h.p); d.controls.target.copy(h.t); d.controls.update();
      }, view);
      await page.waitForTimeout(2200);
      const arr = [];
      for (let i = 0; i < 3; i++) {
        await page.waitForTimeout(700);
        arr.push(await page.evaluate(() => document.getElementById('s-fps').textContent));
      }
      fps[view] = arr.map(Number);
    }
  }

  if (MODE === 'diff') {
    await page.evaluate(() => {
      const d = window.__dbg;
      document.querySelectorAll('.ui, .label, #load, .vign, .topline')
        .forEach(e => { e.style.display = 'none'; });
      document.querySelectorAll('.chip[data-t]').forEach(c => {
        const k = c.dataset.t;
        if ((k === 'fire' || k === 'traffic' || k === 'ped' || k === 'rain') && c.classList.contains('on')) c.click();
      });
      d.trafficGroup.visible = false;
      d.scene.traverse(o => {
        if (o.isPoints && o.material && o.material.uniforms && o.material.uniforms.uBirth) o.visible = false;
        if (o.isLineSegments) o.visible = false;
      });
      for (const p of d.composer.passes) {
        if (p.uniforms && p.uniforms.uGrain) p.uniforms.uGrain.value = 0;
      }
      d.controls.enableDamping = false;
      d.controls.autoRotate = false;
    });
    await page.evaluate(() => window.__freezeClock());
    await page.evaluate(() => window.__dbg.setTime(6.0));
    await sleep(400);
  }

  const shots = [];
  for (const s of SCENES) {
    if (ONLY && !ONLY.split(',').includes(s.name)) continue;
    await page.evaluate((scene) => {
      const d = window.__dbg;
      d.controls.autoRotate = false;
      d.applyTime(scene.hour);
      if (scene.view) {
        const h = d.HOME[scene.view];
        d.camera.position.copy(h.p);
        d.controls.target.copy(h.t);
      } else if (scene.street) {
        /* 离给定点最近的次干道以上路段：站到路上、朝路面前方看 */
        const IX = scene.street.x, IZ = scene.street.z;
        let best = null, bd = 1e18;
        for (const r of d.RNB.roads) {
          if (r.cls > 4 || r.n < 3) continue;
          for (let k = 1; k < r.n - 1; k++) {
            const x = r.pts[k * 2], z = r.pts[k * 2 + 1];
            const dd = (x - IX) ** 2 + (z - IZ) ** 2;
            if (dd < bd) { bd = dd; best = { r, k }; }
          }
        }
        const { r, k } = best;
        const ax = r.pts[(k - 1) * 2], az = r.pts[(k - 1) * 2 + 1];
        const bx = r.pts[(k + 1) * 2], bz = r.pts[(k + 1) * 2 + 1];
        const dx = bx - ax, dz = bz - az;
        const len = Math.hypot(dx, dz) || 1;
        const tx = dx / len, tz = dz / len;
        const px = r.pts[k * 2] - tz * 4.0;
        const pz = r.pts[k * 2 + 1] + tx * 4.0;
        /* 路面基准从 terrain+1.2 降到 terrain+0.20（人行道 +0.35）之后，
           机位高度必须跟着降，否则「人眼高度」会变成 2.9m 的俯视。
           eye 存的是「相对地形」，所以 = 0.35（人行道）+ 1.70（眼高）。 */
        const py = d.terrainAt(px, pz) + (scene.eye || 2.05);
        d.camera.position.set(px, py, pz);
        /* near: 视线收到 28m、只抬 1m —— 人眼高度沿街看，店面凸出件才有画面 */
        const span = scene.near ? 26 : 140;
        const rise = scene.near ? 0.9 : 26;
        d.controls.target.set(px + tx * span, py + rise, pz + tz * span);
        /* side: 把视线转 90° 横看街对面。沿街视角下店面只是一条线（几个像素），
           只有「站在人行道上正对店面」才看得出台基/玻璃/亮框/雨棚的层次。
           正数看相机所在那一侧，负数看对面。 */
        if(scene.side){
          const sx = -tz, sz = tx, sgn = scene.side < 0 ? -1 : 1;
          d.controls.target.set(px + sx * sgn * Math.abs(scene.side), py - 0.30,
                                 pz + sz * sgn * Math.abs(scene.side));
        }
      } else {
        const y = d.terrainAt(scene.cam[0], scene.cam[2]) + scene.cam[1];
        d.camera.position.set(scene.cam[0], y, scene.cam[2]);
        d.controls.target.set(scene.target[0], scene.target[1], scene.target[2]);
      }
      d.controls.update();
    }, s);
    await sleep(MODE === 'diff' ? 500 : 1100);
    const file = path.join(OUT, s.name + '.png');
    await page.screenshot({ path: file, timeout: 120000 });
    /* 把实际相机写进 meta：后处理探针 / 局部放大可以直接复用这个视角，
       不必再猜坐标（猜坐标是这个项目最耗时的一类返工） */
    const cv = await page.evaluate(() => ({
      cam: __dbg.camera.position.toArray().map(v => +v.toFixed(2)),
      target: __dbg.controls.target.toArray().map(v => +v.toFixed(2)),
    }));
    shots.push({ name: s.name, hour: s.hour, file, ...cv });
    process.stdout.write('  ' + s.name + '  cam ' + JSON.stringify(cv.cam) + '\n');
  }

  /* meta 按 name 合并旧记录，不要直接覆盖：`--only` 分批拍 16 个机位时，
     第二批复写会把第一批的机位从 meta 里抹掉，gate 只按 meta 里的机位比对，
     于是「16 机位回归」会静默缩水成 8 个（这个坑踩过一次）。 */
  const metaPath = path.join(OUT, 'meta.json');
  let prev = [];
  try {
    const old = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    if (old && Array.isArray(old.scenes)) prev = old.scenes;
  } catch (e) { prev = []; }
  const byName = new Map(prev.map(s => [s.name, s]));
  for (const s of shots) byName.set(s.name, s);
  const merged = [...byName.values()];

  const meta = {
    tag: TAG, mode: MODE, when: new Date().toISOString(),
    wallMs: Date.now() - t0, boot, fps, scenes: merged, errors: errors.slice(0, 8),
  };
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 1), 'utf8');

  console.log(JSON.stringify({
    tag: TAG, mode: MODE, shots: shots.length, inMeta: merged.length,
    paint: boot.paint, programs: boot.programs, heap: boot.heap,
    triAll: boot.triAll, fps, errors: errors.length,
  }));

  await browser.close();
  if (errors.length) process.exitCode = 2;
})();
