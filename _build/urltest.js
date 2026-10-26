
const { chromium, ROOT, EXE } = require('./_pw');
const OUT=ROOT + '/_shots/';
(async()=>{
  const b = await chromium.launch({ executablePath: EXE, headless:true, args:['--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist'] });
  // 1) URL 参数：低画质 + 橘子洲 + 傍晚
  const p = await b.newPage({ viewport:{width:1400,height:800} });
  const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  await p.goto('http://127.0.0.1:3010/dev.html?t=2&q=low&hour=18.5&wx=cloudy&view=isle',{waitUntil:'load',timeout:200000});
  await p.waitForFunction('window.__dbg && window.__dbg.veg()',null,{timeout:150000});
  await p.waitForTimeout(2500);
  console.log('low:', JSON.stringify(await p.evaluate(()=>({
    q: document.querySelector('.chip.q.on') ? document.querySelector('.chip.q.on').dataset.q : null,
    pr: window.__dbg.scene ? 1 : 1,
    hour: window.__dbg.getHour(),
    wx: window.__dbg.scene.fog.density.toFixed(6)
  }))));
  await p.screenshot({path: OUT+'url_low.png', timeout:180000});
  // 2) 高档 + 全城 + 正午
  const p2 = await b.newPage({ viewport:{width:1400,height:800} });
  p2.on('pageerror',e=>errs.push(e.message));
  await p2.goto('http://127.0.0.1:3010/dev.html?t=2&q=high&hour=12&view=all',{waitUntil:'load',timeout:200000});
  await p2.waitForFunction('window.__dbg && window.__dbg.veg()',null,{timeout:150000});
  await p2.waitForTimeout(2500);
  await p2.screenshot({path: OUT+'url_high.png', timeout:180000});
  console.log('errors:', errs.slice(0,3).join('|')||'none');
  await b.close();
})();
