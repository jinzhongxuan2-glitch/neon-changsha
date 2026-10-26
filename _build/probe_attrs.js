/* 全场景体检：shader 声明的 attribute 是否都能在 geometry 上找到
   —— 名字不匹配 = 取默认 0 = 顶点塌成一点，完全静默 */
const { chromium, ROOT, EXE } = require('./_pw');
const BUILTIN = new Set(['position', 'normal', 'uv', 'uv2', 'color', 'tangent', 'skinIndex', 'skinWeight', 'morphTarget']);
(async () => {
  const b = await chromium.launch({ executablePath: EXE, headless: true,
    args: ['--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist','--allow-file-access-from-files'] });
  const p = await b.newPage({ viewport: { width: 1400, height: 800 } });
  p.on('pageerror', e => console.log('ERR', e.message));
  await p.goto('file:///' + ROOT + '/index.html?t=2&q=high', { waitUntil: 'load', timeout: 240000 });
  await p.waitForFunction('window.__dbg && window.__dbg.veg()', null, { timeout: 180000 });
  await p.waitForTimeout(1500);

  const r = await p.evaluate((builtinArr) => {
    const builtin = new Set(builtinArr);
    const d = window.__dbg;
    const scene = d.scene || (d.camera && d.camera.parent) || null;
    if (!scene) return { err: 'no scene' };
    // __dbg 可能不暴露 scene，退一步：从 world 出发（trafficMeshes 的 parent）
    const roots = [];
    if (d.scene) roots.push(d.scene);
    else if (d.trafficMeshes && d.trafficMeshes[0] && d.trafficMeshes[0].parent) {
      let q = d.trafficMeshes[0].parent; while (q.parent) q = q.parent; roots.push(q);
    }
    const seen = new Set(), bad = [], meshes = [];
    const walk = (o) => {
      if (!o || seen.has(o)) return; seen.add(o);
      if (o.isMesh || o.isPoints || o.isLine) {
        const m = o.material;
        const mats = Array.isArray(m) ? m : [m];
        for (const mat of mats) {
          if (!mat || !mat.isShaderMaterial) continue;
          const vs = mat.vertexShader || '';
          const decl = [...vs.matchAll(/attribute\s+(?:float|vec2|vec3|vec4|int|ivec2|ivec3|ivec4)\s+(\w+)\s*;/g)].map(x => x[1]);
          const have = new Set(Object.keys(o.geometry.attributes));
          const missing = decl.filter(n => !have.has(n));
          const extra = [...have].filter(n => !builtin.has(n) && !decl.includes(n));
          meshes.push({ name: o.name || o.type, tris: o.geometry.index ? o.geometry.index.count / 3 : (o.geometry.attributes.position ? o.geometry.attributes.position.count / 3 : 0),
                        inst: o.geometry.instanceCount || 0, decl: decl.join(','), have: [...have].join(',') });
          if (missing.length) bad.push({ name: o.name || o.type, inst: o.geometry.instanceCount || 0,
            count: o.geometry.attributes.position ? (o.geometry.attributes.position.count * (o.geometry.instanceCount || 1)) : 0,
            missing, decl: decl.join(','), have: [...have].join(',') });
        }
      }
      for (const c of o.children || []) walk(c);
    };
    roots.forEach(walk);
    return { total: meshes.length, bad, sample: meshes.slice(0, 6) };
  }, [...BUILTIN]);
  console.log(JSON.stringify(r, null, 1));
  await b.close();
})();
