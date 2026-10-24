# 把 roads 改成分帧构建
import io, sys

p = '_build/template_dev.html'
s = open(p, encoding='utf-8').read()
orig = len(s)

def rep(a, b, tag):
    global s
    assert s.count(a) == 1, 'anchor fail: ' + tag
    s = s.replace(a, b)

# ---------- 1) generator 化 ----------
rep("function buildRoads(){", "function* buildRoadsGen(){", 'gen sig')

rep("""    if(np >= 2){
      totalV += np*2 + zc*4;
      totalIdxMain += (np-1)*6;
      totalIdxZm += zc*6;
    }
  }""",
"""    if(np >= 2){
      totalV += np*2 + zc*4;
      totalIdxMain += (np-1)*6;
      totalIdxZm += zc*6;
    }
    yield;
  }""", 'yield 1')

rep("""        wasCr = isCr;
      }
    }
  }

  const g = new THREE.BufferGeometry();""",
"""        wasCr = isCr;
      }
    }
    yield;
  }

  const g = new THREE.BufferGeometry();""", 'yield 2')

# ---------- 2) 顶层占位 ----------
rep("""const roadsBuilt = buildRoads();
performance.mark('B:roads');""",
"""/* 路网改为分帧构建：先挂一个空 geometry，数据由 pump 逐帧填充 */
const roadsBuilt = { geo: new THREE.BufferGeometry(), count: 0, verts: 0 };
let roadsReady = false;""", 'placeholder')

# ---------- 3) 在 roadMesh 后启动 pump ----------
rep("""const roadMesh = new THREE.Mesh(roadsBuilt.geo, roadMat);
roadMesh.renderOrder = 2;
roadMesh.frustumCulled = false;
world.add(roadMesh);""",
"""const roadMesh = new THREE.Mesh(roadsBuilt.geo, roadMat);
roadMesh.renderOrder = 2;
roadMesh.frustumCulled = false;
world.add(roadMesh);

/* ---------- 分帧泵：每帧 ≤9ms，主线程全程可响应 ---------- */
(function pumpRoads(){
  const it = buildRoadsGen();
  const TOTAL = RNB.roads.length * 2;   // 两遍，每遍每条路 yield 一次
  const lbar = document.getElementById('lbar');
  let n = 0, fin = false;
  const t0 = performance.now();

  function step(){
    if(fin) return;
    const s0 = performance.now();
    let r;
    while(performance.now() - s0 < 9){
      r = it.next();
      n++;
      if(r.done) break;
    }
    if(r && r.done){
      fin = true;
      const built = r.value;
      roadMesh.geometry = built.geo;
      roadsBuilt.geo = built.geo;
      roadsBuilt.count = built.count;
      roadsBuilt.verts = built.verts;
      roadsReady = true;
      performance.mark('B:roads');
      if(lbar) lbar.style.width = '100%';
      rebuildTrafficGates();
      createSigLights();
      return;
    }
    if(lbar){
      const f = Math.min(1, n / TOTAL);
      lbar.style.width = (6 + f * 86).toFixed(1) + '%';
    }
    requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
})();""", 'pump')

open(p, 'w', encoding='utf-8').write(s)
print('ok  %d -> %d' % (orig, len(s)))
