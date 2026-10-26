/* 诊断：高亮顶面填充为什么降 opacity 不变淡。
   做法：读 composer 各 pass 参数，再对 hlFill / hlRib / hlMesh 逐层隐藏做 A/B 采样。 */
const { chromium } = require('C:/Users/<user>/.workbuddy/binaries/node/workspace/node_modules/playwright-core');
const fs = require('fs');
const ROOT = 'C:/Users/<user>/Desktop/neon-changsha';
const EXE = 'C:/Users/<user>/AppData/Local/ms-playwright/chromium_headless_shell-1194/chrome-win/headless_shell.exe';
const OUT = ROOT + '/_audit/pick/';

(async () => {
  const b = await chromium.launch({ executablePath: EXE, headless: true,
    args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--allow-file-access-from-files'] });
  const p = await b.newPage({ viewport: { width: 1400, height: 800 } });
  p.on('pageerror', e => console.log('ERR', e.message));
  await p.goto('file:///' + ROOT + '/index.html?t=2&q=high&view=cbd&hour=15', { waitUntil: 'load', timeout: 240000 });
  await p.waitForFunction('window.__dbg && window.__dbg.veg()', null, { timeout: 180000 });
  await p.evaluate(() => {
    document.querySelectorAll('.ui,#load').forEach(e => e.style.display = 'none');
    const d = window.__dbg;
    d.controls.enableDamping = false; d.controls.autoRotate = false;
  });
  await p.waitForTimeout(1200);

  const passes = await p.evaluate(() => {
    const c = window.__dbg.composer;
    return (c && c.passes || []).map(ps => ({ t: ps.constructor.name, on: ps.enabled,
      th: ps.threshold, st: ps.strength, rad: ps.radius }));
  });
  console.log('PASSES', JSON.stringify(passes));
  const tm = await p.evaluate(() => {
    const r = window.__dbg.renderer;
    return { toneMapping: r.toneMapping, exposure: r.toneMappingExposure, ocs: r.outputColorSpace };
  });
  console.log('RENDERER', JSON.stringify(tm));

  /* 选中同楼，固定机位 */
  const cam = await p.evaluate(() => {
    const d = window.__dbg, P = d.PICK, W = innerWidth, H = innerHeight;
    let bb = null;
    for (let gy = 0.20; gy < 0.90 && !bb; gy += 0.05)
      for (let gx = 0.20; gx < 0.86 && !bb; gx += 0.05) {
        const h = P.at(W * gx, H * gy);
        if (h && h.b.h > 60 && h.b.h < 140 && h.t > 450 && h.t < 950) bb = h.b;
      }
    let cx = 0, cz = 0;
    for (let k = 0; k < bb.n; k++) { cx += bb.pts[k * 2]; cz += bb.pts[k * 2 + 1]; }
    cx /= bb.n; cz /= bb.n;
    const yc = bb.y0 + bb.h * 0.55;
    d.camera.position.set(cx + 97.9, yc + 141.8 - 46.8, cz - 118.1);
    d.controls.target.set(cx, yc, cz);
    d.controls.update();
    d.camera.updateMatrixWorld(true);
    const t = d.camera.position.distanceTo(new (d.camera.position.constructor)(cx, yc, cz));
    d.PICK.open({ b: bb, t, x: cx, y: yc, z: cz });
    return { cx: +cx.toFixed(1), cz: +cz.toFixed(1), t: +t.toFixed(0), n: bb.n };
  });
  console.log('CAM', JSON.stringify(cam));
  await p.waitForTimeout(900);

  const mats = await p.evaluate(() => {
    const out = {};
    window.__dbg.scene.traverse(o => {
      if (o.name && o.name.startsWith('hl') && o.material) {
        const m = o.material;
        out[o.name] = { visible: o.visible, ro: o.renderOrder,
          opacity: m.opacity, transparent: m.transparent, blending: m.blending,
          depthTest: m.depthTest, depthWrite: m.depthWrite, toneMapped: m.toneMapped,
          color: m.color ? m.color.getHexString() : null,
          colorLinear: m.color ? [+m.color.r.toFixed(3), +m.color.g.toFixed(3), +m.color.b.toFixed(3)] : null,
          verts: o.geometry.attributes.position.count };
      }
    });
    return out;
  });
  console.log('MATS', JSON.stringify(mats, null, 1));

  await p.screenshot({ path: OUT + 'diag_all.png', timeout: 120000 });

  /* 逐层隐藏，各拍一张 */
  for (const nm of ['hlFill', 'hlRib', 'hlMesh']) {
    await p.evaluate((nm) => {
      window.__dbg.scene.traverse(o => { if (o.name === nm) o.visible = false; });
    }, nm);
    await p.waitForTimeout(500);
    await p.screenshot({ path: OUT + 'diag_no_' + nm + '.png', timeout: 120000 });
    await p.evaluate((nm) => {
      window.__dbg.scene.traverse(o => { if (o.name === nm) o.visible = true; });
    }, nm);
  }

  /* opacity 调到 0.005 —— 如果画面还是青的，说明 alpha 根本没参与混合 */
  await p.evaluate(() => {
    window.__dbg.scene.traverse(o => {
      if (o.name === 'hlFill') { o.material.opacity = 0.005; o.material.needsUpdate = true; }
    });
  });
  await p.waitForTimeout(500);
  await p.screenshot({ path: OUT + 'diag_op005.png', timeout: 120000 });
  console.log('OP005 shot');

  /* 把填充关掉 bloom 影响：临时把 composer 的泛光 pass 停掉 */
  const bloomOff = await p.evaluate(() => {
    window.__dbg.scene.traverse(o => { if (o.name === 'hlFill') o.material.opacity = 0.085; });
    const c = window.__dbg.composer;
    let n = 0;
    (c.passes || []).forEach(ps => { if (ps.constructor.name === 'UnrealBloomPass') { ps.enabled = false; n++; } });
    return n;
  });
  console.log('BLOOM_OFF', bloomOff);
  await p.waitForTimeout(600);
  await p.screenshot({ path: OUT + 'diag_nobloom.png', timeout: 120000 });

  await b.close();
})();
