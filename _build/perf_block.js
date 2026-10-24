composer.addPass(gradePass);

/* ============================================================
   7d. 性能面板（?perf=1）
   逐 pass 计时 + 整帧三角/绘制调用；有 EXT_disjoint_timer_query_webgl2 时再叠一层 GPU 时间。
   headless / 部分驱动没有这个扩展，所以面板会显示 gpu n/a —— 那说明只能用 CPU 侧时间参考。
   ============================================================ */
const PERF_ON = /[?&]perf=1/.test(location.search);
const PERF_NAMES = ['render', 'ao', 'bloom', 'output', 'grade'];
const PERF_MS = new Array(8).fill(0);
const PERF = { el: null, acc: 0, tris: 0, calls: 0, gpuMs: 0, gpuOk: false, q: null };

if (PERF_ON) {
  PERF.el = document.createElement('div');
  PERF.el.style.cssText = [
    'position:fixed', 'left:12px', 'bottom:12px', 'z-index:99',
    'font:11px/1.55 ui-monospace,SFMono-Regular,Consolas,monospace',
    'color:#cfe3ff', 'background:rgba(6,10,16,.82)',
    'border:1px solid rgba(120,170,255,.28)', 'border-radius:8px',
    'padding:8px 11px', 'white-space:pre', 'pointer-events:none',
    'letter-spacing:.02em'
  ].join(';');
  document.body.appendChild(PERF.el);
  renderer.info.autoReset = false;

  /* 逐 pass 包一层计时 */
  composer.passes.forEach((pass, i) => {
    const orig = pass.render ? pass.render.bind(pass) : null;
    if(!orig) return;
    pass.render = function(){
      const t0 = performance.now();
      const r = orig.apply(null, arguments);
      PERF_MS[i] = PERF_MS[i] * 0.86 + (performance.now() - t0) * 0.14;
      return r;
    };
  });

  /* GPU 计时（可选） */
  try{
    const gl = renderer.getContext();
    const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    if(ext){
      PERF.ext = ext; PERF.gl = gl; PERF.gpuOk = true;
      PERF.q = gl.createQuery();
      PERF.qBusy = false;
      PERF.qPending = [];
    }
  }catch(e){ PERF.gpuOk = false; }
}

function perfFrameStats(){
  if(!PERF_ON || !PERF.el) return;
  PERF.acc += 0.016;
  if(PERF.acc < 0.35) return;
  PERF.acc = 0;
  const info = renderer.info.render;
  const sum = PERF_MS.slice(0, composer.passes.length).reduce((a, b) => a + b, 0);
  const fps = fpsEl ? fpsEl.textContent : '?';
  const lines = [
    'FPS ' + fps + '   frame ' + sum.toFixed(1) + 'ms (cpu)',
    '─────────────────────────'
  ];
  for(let i = 0; i < composer.passes.length; i++){
    if(!composer.passes[i].enabled) { lines.push('  ' + (PERF_NAMES[i] || ('pass' + i)).padEnd(7) + '  off'); continue; }
    const v = PERF_MS[i];
    const bar = '█'.repeat(Math.min(14, Math.round(v * 1.6)));
    lines.push('  ' + (PERF_NAMES[i] || ('pass' + i)).padEnd(7) + v.toFixed(1).padStart(5) + 'ms ' + bar);
  }
  lines.push('─────────────────────────');
  lines.push('tris ' + (info.triangles / 1e6).toFixed(2) + 'M   calls ' + info.calls + '   prog ' + renderer.info.programs.length);
  lines.push('gpu  ' + (PERF.gpuOk ? (PERF.gpuMs ? PERF.gpuMs.toFixed(2) + 'ms' : 'measuring') : 'n/a (no timer ext)'));
  PERF.el.textContent = lines.join('\n');
}
