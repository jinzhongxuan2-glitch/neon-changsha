# -*- coding: utf-8 -*-
"""重新接入线性深度版 SSAO（含 grade 合成）"""
import pathlib

base = pathlib.Path(__file__).parent
p = base / 'template_dev.html'
s = p.read_text(encoding='utf-8')
block = (base / 'ao_block2.js').read_text(encoding='utf-8').strip()

# 1) grade uniforms
old_u = """  uniforms:{ tDiffuse:{value:null}, uTime:{value:0}, uRes:{value:new THREE.Vector2(innerWidth,innerHeight)},
             uGrain:{value:0.045}, uVig:{value:0.55} },"""
new_u = """  uniforms:{ tDiffuse:{value:null}, tAO:{value:null}, tDepthV:{value:null},
             uAOStr:{value:0.55}, uAODbg:{value:0},
             uTime:{value:0}, uRes:{value:new THREE.Vector2(innerWidth,innerHeight)},
             uGrain:{value:0.045}, uVig:{value:0.55} },"""
assert old_u in s, 'uniforms'
s = s.replace(old_u, new_u, 1)

# 2) 声明
old_d = "    uniform sampler2D tDiffuse; uniform float uTime,uGrain,uVig; uniform vec2 uRes;"
new_d = """    uniform sampler2D tDiffuse, tAO, tDepthV;
    uniform float uTime,uGrain,uVig,uAOStr,uAODbg;
    uniform vec2 uRes;"""
assert old_d in s, 'decl'
s = s.replace(old_d, new_d, 1)

# 3) 合成 + 调试分支
old_b = "      col.b = texture2D(tDiffuse, uv-off).b;"
new_b = """      col.b = texture2D(tDiffuse, uv-off).b;
      /* AO 调试视图 / 接触遮蔽合成 */
      if(uAODbg > 0.5){
        float v = (uAODbg > 1.5) ? texture2D(tDepthV, uv).r : texture2D(tAO, uv).r;
        gl_FragColor = vec4(vec3(v), 1.0);
        return;
      }
      col *= mix(1.0, texture2D(tAO, uv).r, uAOStr);"""
assert old_b in s, 'body'
s = s.replace(old_b, new_b, 1)

# 4) 插入 pass
assert 'composer.addPass(gradePass);' in s
s = s.replace('composer.addPass(gradePass);', block, 1)

p.write_text(s, encoding='utf-8')
print('ssao re-applied')
