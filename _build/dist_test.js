const { chromium } = require('C:/Users/<user>/.workbuddy/binaries/node/workspace/node_modules/playwright-core');
const EXE = 'C:/Users/<user>/AppData/Local/ms-playwright/chromium_headless_shell-1194/chrome-win/headless_shell.exe';
const OUT = 'C:/Users/<user>/Desktop/neon-changsha/_shots/';
const URL = 'file:///C:/Users/<user>/Desktop/neon-changsha/dist/index.html?t=2';

(async () => {
  const b = await chromium.launch({ executablePath: EXE, headless: true,
    args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--allow-file-access-from-files'] });
  const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 160)); });
  await p.goto(URL, { waitUntil: 'load', timeout: 200000 });
  await p.waitForFunction('window.__dbg && window.__dbg.veg()', null, { timeout: 150000 });
  await p.waitForTimeout(3000);

  console.log('file:// tex:', JSON.stringify(await p.evaluate(() => ({
    road: window.__dbg.roadMesh.material.uniforms.uHasTex.value,
    city: window.__dbg.cityMesh.material.uniforms.uHasTexC.value,
    w: window.__dbg.roadMesh.material.uniforms.uAsphalt.value.image
        ? window.__dbg.roadMesh.material.uniforms.uAsphalt.value.image.width : 0,
  }))));

  // 街景机位：找一条主干道
  const base = await p.evaluate(() => {
    let bi = 0, bd = 1e18, bk = 0;
    const R = window.__dbg.RNB.roads;
    for (let i = 0; i < R.length; i++) {
      const r = R[i];
      if (r.cls !== 2) continue;
      for (let k = 0; k < r.n - 1; k++) {
        const dx = r.pts[k*2] + 204, dz = r.pts[k*2+1] + 616;
        const q = dx*dx + dz*dz;
        if (q < bd) { bd = q; bi = i; bk = k; }
      }
    }
    const r = R[bi];
    return { ax: r.pts[bk*2], az: r.pts[bk*2+1], bx: r.pts[(bk+1)*2], bz: r.pts[(bk+1)*2+1] };
  });

  await p.evaluate((o) => {
    const d = window.__dbg;
    d.applyTime(10);
    const L = Math.hypot(o.bx-o.ax, o.bz-o.az) || 1;
    const tx = (o.bx-o.ax)/L, tz = (o.bz-o.az)/L;
    const gy = d.terrainAt(o.ax, o.az);
    d.camera.position.set(o.ax - tx*14, gy+11, o.az - tz*14);
    d.controls.target.set(o.ax + tx*80, gy+4, o.az + tz*80);
    d.controls.update();
  }, base);
  await p.waitForTimeout(1800);
  await p.screenshot({ path: OUT + 'dist_street.png', timeout: 180000 });
  console.log('errors:', errs.slice(0, 3).join('|') || 'none');
  await b.close();
})();
