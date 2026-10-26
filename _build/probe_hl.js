/* 高亮验收：同一栋楼在 190 / 450 / 950m 三个距离下，选中轮廓是否都看得清。
   远距离是这个功能的真正难点 —— 楼在 700m 外只有几十像素高，一圈线几乎等于没有。 */
const { chromium, ROOT, EXE } = require('./_pw');
const fs = require('fs');
const OUT = ROOT + '/_audit/pick/';
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const b = await chromium.launch({ executablePath: EXE, headless: true,
    args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--allow-file-access-from-files'] });
  const p = await b.newPage({ viewport: { width: 1400, height: 800 } });
  p.on('pageerror', e => console.log('ERR', e.message));
  await p.goto('file:///' + ROOT + '/index.html?t=2&q=high&view=cbd&hour=15', { waitUntil: 'load', timeout: 240000 });
  await p.waitForFunction('window.__dbg && window.__dbg.veg()', null, { timeout: 180000 });
  await p.evaluate(() => {
    const d = window.__dbg;
    d.controls.enableDamping = false; d.controls.autoRotate = false;
  });
  await p.waitForTimeout(1200);

  /* 挑一栋 60~140m、离默认机位 450~950m 的楼，存成 window.__tgt 供后续复用 */
  const info = await p.evaluate(() => {
    const d = window.__dbg, P = d.PICK, W = innerWidth, H = innerHeight;
    for (let gy = 0.20; gy < 0.90; gy += 0.05) {
      for (let gx = 0.20; gx < 0.86; gx += 0.05) {
        const h = P.at(W * gx, H * gy);
        if (h && h.b.h > 60 && h.b.h < 140 && h.t > 450 && h.t < 950) {
          const bb = h.b;
          window.__tgt = bb;
          let cx = 0, cz = 0;
          for (let k = 0; k < bb.n; k++) { cx += bb.pts[k * 2]; cz += bb.pts[k * 2 + 1]; }
          cx /= bb.n; cz /= bb.n;
          return { n: bb.n, h: +bb.h.toFixed(1), func: bb.func,
                   cx: +cx.toFixed(1), cz: +cz.toFixed(1), t0: +h.t.toFixed(0) };
        }
      }
    }
    return null;
  });
  if (!info) { console.log('NO TARGET'); await b.close(); return; }
  console.log('TARGET', JSON.stringify(info));

  /* 近景先拍一张带卡片的完整形态 */
  const shot = async (name, dist, el) => {
    const r = await p.evaluate(({ dist, el }) => {
      const d = window.__dbg, bb = window.__tgt;
      let cx = 0, cz = 0;
      for (let k = 0; k < bb.n; k++) { cx += bb.pts[k * 2]; cz += bb.pts[k * 2 + 1]; }
      cx /= bb.n; cz /= bb.n;
      const yc = bb.y0 + bb.h * 0.55;
      const az = -0.72, R = dist;
      const camX = cx + Math.cos(az) * R * Math.cos(el);
      const camZ = cz + Math.sin(az) * R * Math.cos(el);
      /* 遮挡自检：CBD 里 190m 外很可能正好站在隔壁楼里，拍出来是一面墙。
         屏幕中心打不到目标楼就把相机往上抬，最多 14 次。 */
      let camY = yc + R * Math.sin(el), ok = false, lift = 0;
      for (let i = 0; i < 15 && !ok; i++) {
        d.camera.position.set(camX, camY, camZ);
        d.camera.lookAt(cx, yc, cz);
        d.camera.updateMatrixWorld(true);
        d.controls.target.set(cx, yc, cz);
        d.controls.update();
        d.camera.updateMatrixWorld(true);
        const h = d.PICK.at(innerWidth / 2, innerHeight / 2);
        if (h && h.b === bb) { ok = true; break; }
        camY += Math.max(14, R * 0.085);
        lift += Math.max(14, R * 0.085);
      }
      const t = Math.hypot(camX - cx, camY - yc, camZ - cz);
      d.PICK.open({ b: bb, t, x: cx, y: yc, z: cz });
      return { dist: +t.toFixed(0), camY: +camY.toFixed(1), clear: ok, lift: +lift.toFixed(0),
               cam: [+camX.toFixed(1), +camY.toFixed(1), +camZ.toFixed(1)] };
    }, { dist, el });
    await p.waitForTimeout(800);
    await p.screenshot({ path: OUT + name + '.png', timeout: 120000 });
    console.log('SHOT', name, JSON.stringify(r));
    return r;
  };

  await p.evaluate(() => { document.getElementById('load').style.display = 'none'; });
  await shot('hl_near_card', 150, 0.55);

  await p.evaluate(() => document.querySelectorAll('.ui,#load').forEach(e => e.style.display = 'none'));
  await shot('hl_near', 190, 0.55);
  await shot('hl_mid', 450, 0.44);
  await shot('hl_far', 950, 0.38);

  /* 顺带验一下 hover（不选中）在 450m 的样子：应该只有淡填充 + 细线 */
  const hv = await p.evaluate(() => {
    const d = window.__dbg, bb = window.__tgt;
    let cx = 0, cz = 0;
    for (let k = 0; k < bb.n; k++) { cx += bb.pts[k * 2]; cz += bb.pts[k * 2 + 1]; }
    cx /= bb.n; cz /= bb.n;
    d.PICK.close();
    const mats = [];
    d.scene.traverse(o => { if (o.renderOrder >= 3 && o.renderOrder <= 5) mats.push({ ro: o.renderOrder, vis: o.visible, op: +o.material.opacity.toFixed(3), v: o.geometry.attributes.position.count }); });
    return mats;
  });
  console.log('AFTER_CLOSE', JSON.stringify(hv));

  await b.close();
})();
