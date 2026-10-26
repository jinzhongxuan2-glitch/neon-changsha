const { chromium } = require('C:/Users/<user>/.workbuddy/binaries/node/workspace/node_modules/playwright-core');
const ROOT = 'C:/Users/<user>/Desktop/neon-changsha';
const EXE = 'C:/Users/<user>/AppData/Local/ms-playwright/chromium_headless_shell-1194/chrome-win/headless_shell.exe';
(async () => {
  const b = await chromium.launch({ executablePath: EXE, headless: true,
    args: ['--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist','--allow-file-access-from-files'] });
  const p = await b.newPage({ viewport: { width: 800, height: 450 } });
  await p.goto('file:///' + ROOT + '/index.html?t=2&q=high', { waitUntil: 'load', timeout: 240000 });
  await p.waitForFunction('window.__dbg && window.__dbg.veg()', null, { timeout: 180000 });
  const o = await p.evaluate(() => {
    const d = window.__dbg; let t = 0, n = 0;
    d.scene.traverse(o => {
      if (!o.isMesh || !o.geometry) return;
      const g = o.geometry;
      const k = g.index ? g.index.count / 3 : (g.attributes.position ? g.attributes.position.count / 3 : 0);
      t += k * (o.isInstancedMesh ? o.count : 1); n++;
    });
    return { total: Math.round(t), meshObjs: n, roads: d.roadsBuilt.tris || d.roadsBuilt.geo.index.count / 3 };
  });
  console.log(JSON.stringify(o));
  await b.close();
})();
