# 配套改动：闸位可重建、信号灯延后创建、加载层等路网就绪
p = '_build/template_dev.html'
s = open(p, encoding='utf-8').read()
orig = len(s)

def rep(a, b, tag):
    global s
    assert s.count(a) == 1, 'anchor fail: ' + tag
    s = s.replace(a, b)

# ---------- 1) 闸位表抽成可重建函数 ----------
rep("""  // 闸位：按路索引归并、按里程排序
  const gates = new Map();
  for(let i=0;i<RW_GATES.length;i++){
    const g = RW_GATES[i];
    let arr = gates.get(g.ri);
    if(!arr){ arr = []; gates.set(g.ri, arr); }
    arr.push(g);
  }
  for(const arr of gates.values()) arr.sort((a,b)=>a.s-b.s);
  return { list, cars, groups, gates, t: 0 };
})();""",
"""  return { list, cars, groups, gates: new Map(), t: 0 };
})();

/* 闸位表：RW_GATES 由分帧的路网构建产生，故在路网就绪后重建 */
function rebuildTrafficGates(){
  const gates = TRAFFIC.gates;
  if(!gates || gates.size || !RW_GATES.length) return;
  for(let i=0;i<RW_GATES.length;i++){
    const g = RW_GATES[i];
    let arr = gates.get(g.ri);
    if(!arr){ arr = []; gates.set(g.ri, arr); }
    arr.push(g);
  }
  for(const arr of gates.values()) arr.sort((a,b)=>a.s-b.s);
}""", 'gates')

# ---------- 2) 信号灯改为按需创建 ----------
rep("""const sigLightMesh = (()=>{
  const byRi = new Map();""",
"""let sigLightMesh = null;
function createSigLights(){
  if(sigLightMesh) return sigLightMesh;
  sigLightMesh = (()=>{
  const byRi = new Map();""", 'sig head')

rep("""  geo.setAttribute('aPh', new THREE.InstancedBufferAttribute(phArr, 1));
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  world.add(mesh);
  return mesh;
})();""",
"""  geo.setAttribute('aPh', new THREE.InstancedBufferAttribute(phArr, 1));
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  world.add(mesh);
  return mesh;
  })();
  return sigLightMesh;
}""", 'sig tail')

# ---------- 3) 加载层：等路网就绪 ----------
rep("""lbarEl.style.animation = 'none';
lbarEl.style.width = '100%';""",
"""lbarEl.style.animation = 'none';
if(roadsReady) lbarEl.style.width = '100%';""", 'lbar')

rep("""  if(!started){ started = true; setTimeout(()=> loadEl.classList.add('done'), 320); }""",
"""  if(!started && roadsReady){ started = true; setTimeout(()=> loadEl.classList.add('done'), 260); }""", 'done gate')

open(p, 'w', encoding='utf-8').write(s)
print('ok  %d -> %d' % (orig, len(s)))
