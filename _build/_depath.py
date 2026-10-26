#!/usr/bin/env python3
"""把已跟踪脚本里的本机绝对路径改成相对路径 / 环境变量。

规则（按顺序，先吃长匹配）：
  1. require('<...>/playwright-core')  →  require('./_pw') 并解构 { chromium, ROOT, EXE }
  2. 'file:///C:/Users/<u>/Desktop/neon-changsha/xxx'  →  'file:///' + ROOT + 'xxx'
  3. 'C:/Users/<u>/Desktop/neon-changsha/xxx'          →  ROOT + 'xxx'
  4. const ROOT = 'C:/Users/<u>/Desktop/neon-changsha' →  const ROOT = require('path').resolve(__dirname, '..')
  5. const EXE  = 'C:/Users/<u>/AppData/...'           →  删掉（_pw 提供）

  --write 才会真改；默认只打印将要改的行。
"""
import re, subprocess, sys, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
WRITE = '--write' in sys.argv

# 从本机自动推导，不把用户名写死在脚本里（否则这个脚本自己就成了泄露源）
HOME_NEEDLE = str(pathlib.Path.home()).replace('\\', '/')
PROJ = HOME_NEEDLE + '/Desktop/neon-changsha'

# 只处理被 git 跟踪的 JS（公开面）。Python 文件里是 r"..." 原始字符串，
# 机械替换会产出 r"str(Path(...))/x" 这种语法错误的死字符串，必须逐个手改。
tracked = subprocess.run(['git', 'ls-files', '*.js'],
                         cwd=ROOT, capture_output=True, text=True, encoding='utf-8').stdout.split()
files = [f for f in tracked if HOME_NEEDLE in (ROOT / f).read_text(encoding='utf-8', errors='ignore')]

print(f'含本机路径的已跟踪文件：{len(files)}\n')
total = 0
for f in files:
    p = ROOT / f
    src = p.read_text(encoding='utf-8')
    orig = src

    if f.endswith('.js'):
        # 1. playwright-core 的 require
        src = re.sub(
            r"^const \{ chromium \} = require\('" + re.escape(HOME_NEEDLE) + r"/\.workbuddy[^']*playwright-core'\);\n",
            "const { chromium, ROOT, EXE } = require('./_pw');\n",
            src, flags=re.M)
        # 4/5. ROOT / EXE 的字面量声明（_pw 已经给）
        src = re.sub(r"^const ROOT\s*=\s*'" + re.escape(PROJ) + r"';\n", '', src, flags=re.M)
        src = re.sub(r"^const EXE\s*=\s*'" + re.escape(HOME_NEEDLE) + r"/AppData/[^']*';\n", '', src, flags=re.M)
        # 2. file:/// 开头的 URL
        src = re.sub(r"'file:///" + re.escape(PROJ) + r"([^']*)'", r"'file:///' + ROOT + '\1'", src)
        # 3. 其余裸路径
        src = re.sub(r"'" + re.escape(PROJ) + r"([^']*)'", r"ROOT + '\1'", src)
        # 如果文件里既没 require _pw 又用了 ROOT/EXE，补一行
        if "require('./_pw')" not in src and re.search(r'\b(ROOT|EXE)\b', src):
            src = "const { ROOT, EXE } = require('./_pw');\n" + src

    elif f.endswith('.py'):
        src = src.replace("'" + PROJ + "'", "str(Path(__file__).resolve().parent.parent)")
        src = src.replace('"' + PROJ + '"', 'str(Path(__file__).resolve().parent.parent)')
        src = src.replace(PROJ, "str(Path(__file__).resolve().parent.parent)")

    if src != orig:
        total += 1
        left = [l for l in src.splitlines() if HOME_NEEDLE in l]
        print(f'{"改" if WRITE else "将改"}  {f}   （剩余本机路径 {len(left)} 行）')
        for l in left[:3]:
            print('      ! ' + l.strip()[:120])
        if WRITE:
            p.write_text(src, encoding='utf-8')

print(f'\n共 {total} 个文件{"已改写" if WRITE else "待改写"}')
