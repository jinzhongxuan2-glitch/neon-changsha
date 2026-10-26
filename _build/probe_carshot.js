/* 近景车头验收：把车流冻结，相机贴到一辆车的前 3/4 / 正前 / 正侧 / 后 3/4 拍 4 张。
   用途：车模型改动前后的目视对比 —— **gate 完全看不见车**（shots.js 主动关车流），
   车模型的任何改动像素回归都是 0.0000，只能靠这个探针 + 肉眼。

   用法：
     node _build/probe_carshot.js before     文件名带前缀，方便 A/B 对照
     node _build/probe_carshot.js after
*/
const { chromium, ROOT, EXE } = require('./_pw');
const fs = require('fs');
const OUT = ROOT + '/_audit/car/';
fs.mkdirSync(OUT, { recursive: true });
const TAG = process.argv[2] || 'now';

/* 四个机位：f=沿车头方向的进深（负=车后），r=向右的偏移，h=相机高，ty=看向车身上的高度。
   相机是 FOV 38° 的窄视场、near=1，所以「人眼高度 + 3~4m」才是一个接近肉眼的比例；
   5m 以上会被压缩得像俯视。 */
const VIEWS = {
  front34: [4.6, 2.4, 1.28, 0.62],
  front:   [5.4, 0.0, 1.15, 0.64],
  side:    [0.1, 5.4, 1.15, 0.60],
  rear34:  [-4.6, 2.4, 1.28, 0.62],
};

(async () => {
  const b = await chromium.launch({ executablePath: EXE, headless: true,
    args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--allow-file-access-from-files'] });
  const p = await b.newPage({ viewport: { width: 900, height: 560 } });
  p.on('pageerror', e => console.log('ERR', e.message));
  await p.goto('file:///' + ROOT + '/index.html?t=2&q=high&view=cbd&hour=15', { waitUntil: 'load', timeout: 240000 });
  /* 等主场景整段同步构建走完（B:done 是 performance.mark）。
     只等 __dbg.veg() 会早 —— 植被是分帧构建的，比主场景先就绪，那时还在 BUILDING。 */
  await p.waitForFunction("performance.getEntriesByName('B:done').length > 0", null, { timeout: 240000 });
  await p.waitForTimeout(2600);          /* 让车跑起来、mesh.visible 被置 true */

  /* 加载遮罩 #load 的淡出走 CSS transition（1.1s），而 headless 空闲时 rAF 会停 ——
     过渡冻在中间 opacity，截图是一张压着黑纱的图。直接抹掉，别等过渡。 */
  await p.evaluate(() => {
    const el = document.getElementById('load');
    if (el) { el.classList.add('done'); el.style.display = 'none'; }
    document.querySelectorAll('.ui').forEach(e => { e.style.display = 'none'; });
  });

  /* 冻结车流：updateTraffic 里 `if(window.__TRAFFIC_FREEZE) return` 在 visible 同步之前，
     所以必须先跑够帧数再冻。冻住之后 aPos/aYaw 就停在最后一帧的值。 */
  const geo = await p.evaluate(() => {
    window.__TRAFFIC_FREEZE = true;
    const d = window.__dbg;
    /* 车流里车辆间距只有 9m（CAR_STEP），相机贴到 6m 会正好钻进前面那辆车的车身里 ——
       第一版拍出来是一整片浅灰平面。冻住之后把**除目标车以外**的实例 scale 清零，
       零面积三角形不产生像素，画面就只剩这一辆。位置仍是真实位置，地面仍是真实道路。 */
    const meshes = [];
    d.scene.traverse(o => {
      if (o.isMesh && o.geometry && o.geometry.attributes &&
          o.geometry.attributes.aPart && o.geometry.attributes.aYaw &&
          o.geometry.attributes.aScale) meshes.push(o);
    });
    if (!meshes.length) return { err: 'no car mesh' };
    const mesh = meshes[0];
    const pos = mesh.geometry.attributes.aPos, yaw = mesh.geometry.attributes.aYaw;
    const scl = mesh.geometry.attributes.aScale, col = mesh.geometry.attributes.aCol;
    /* 选一辆「周围 11m 没有建筑 + 车漆够亮」的车：
       相机要贴到 6m，落在楼里就是一张全黑图；而 CAR_COLS 里有 2/12 是纯黑（0.030），
       逆光时车身细节全被吞掉 —— 拍车头细节必须是浅色车。BD.near 返回
       min(到最近楼的距离, thr)，比逐栋遍历快得多。 */
    let bi = 0, bd = -1, tried = 0;
    const n = pos.count;
    for (let i = 0; i < n; i += 7) {
      const x = pos.array[i * 3], z = pos.array[i * 3 + 2];
      tried++;
      const lum = (col.array[i * 3] * 0.299 + col.array[i * 3 + 1] * 0.587 + col.array[i * 3 + 2] * 0.114);
      if (lum < 0.30) continue;
      if (d.BD.near(x, z, 12) < 12) continue;
      /* 在开阔的浅色车里挑离 CBD 最近的，保证背景是城市而不是空滩 */
      const dd = Math.hypot(x - 40, z + 260);
      if (bd < 0 || dd < bd) { bd = dd; bi = i; }
    }
    const keepScl = scl.array[bi];
    for (const m of meshes) {
      const a = m.geometry.attributes.aScale;
      a.array.fill(0);
      a.needsUpdate = true;
    }
    scl.array[bi] = keepScl;
    scl.needsUpdate = true;
    const x = pos.array[bi * 3], y = pos.array[bi * 3 + 1], z = pos.array[bi * 3 + 2];
    const tri = mesh.geometry.attributes.position.count / 3;
    return { tri, verts: mesh.geometry.attributes.position.count,
             attrs: Object.keys(mesh.geometry.attributes),
             car: { i: bi, x: +x.toFixed(2), y: +y.toFixed(2), z: +z.toFixed(2) },
             yaw: +yaw.array[bi], scl: +scl.array[bi].toFixed(2),
             lum: +(col.array[bi * 3] * 0.299 + col.array[bi * 3 + 1] * 0.587 + col.array[bi * 3 + 2] * 0.114).toFixed(3),
             inst: mesh.geometry.instanceCount, tried,
             open: +d.BD.near(x, z, 12).toFixed(1) };
  });
  console.log('GEO', JSON.stringify(geo));
  if (geo.err) { await b.close(); return; }

  for (const [n, S] of Object.entries(VIEWS)) {
    await p.evaluate(({ cx, cy, cz, yaw, S }) => {
      const d = window.__dbg;
      /* controls.minDistance 是 30 —— 近景必须临时放开，否则 update() 会把相机推回 30m，
         设完读到的是「被推开之后」的位置（第一次拍出来是一张 30m 外的街景）。 */
      d.controls.minDistance = 1.5;
      /* 车头方向：顶点着色器 p=(1,0,0) → (cos yaw, 0, -sin yaw) */
      const fx = Math.cos(yaw), fz = -Math.sin(yaw);
      const rx = -fz, rz = fx;
      d.camera.position.set(cx + fx * S[0] + rx * S[1], cy + S[2], cz + fz * S[0] + rz * S[1]);
      d.controls.target.set(cx, cy + S[3], cz);
      d.controls.update();
      return null;
    }, { cx: geo.car.x, cy: geo.car.y, cz: geo.car.z, yaw: geo.yaw, S });
    await p.waitForTimeout(280);
    const got = await p.evaluate(() => ({
      cam: window.__dbg.camera.position.toArray().map(v => +v.toFixed(1)),
      dist: +window.__dbg.camera.position.distanceTo(window.__dbg.controls.target).toFixed(2),
    }));
    await p.screenshot({ path: OUT + TAG + '_' + n + '.png', timeout: 60000 });
    console.log('SHOT', n, JSON.stringify(got));
  }

  await b.close();
})();
