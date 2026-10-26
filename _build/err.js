const { chromium, ROOT, EXE } = require('./_pw');
const fs = require('fs');

(async () => {
  const b = await chromium.launch({ executablePath: EXE, headless: true,
    args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: 900, height: 600 } });
  const out = [];
  p.on('console', m => { if (m.type() === 'error') out.push(m.text()); });
  p.on('pageerror', e => out.push('PAGEERROR ' + e.message));
  await p.goto('http://127.0.0.1:3010/dev.html?t=2', { waitUntil: 'load', timeout: 180000 });
  await p.waitForTimeout(7000);
  fs.writeFileSync(ROOT + '/_build/_err3.txt', out.join('\n=== \n'));
  console.log('errs', out.length);
  await b.close();
})();
