"""本机 node / node_modules 的定位，集中一处。

和 `_pw.js` 是同一套思路：**脚本里不写死 `C:/Users/<用户名>/...`**。
以前 build.py / gate.py / externalize.py / prune_baselines.py 各自抄了一份绝对路径，
换台机器要么改四个文件，要么直接崩。

解析顺序（每一级都能被环境变量顶掉）：
  NEON_NODE          —— 指定 node.exe
  NEON_NODE_MODULES  —— 指定 NODE_PATH（playwright-core 所在）
  %LOCALAPPDATA%/../.workbuddy/binaries/node/versions/*/node.exe  —— 本机默认位置
  PATH 里的 node     —— 最后兜底
"""
import os
import pathlib
import shutil

LOCAL = os.environ.get("LOCALAPPDATA") or str(pathlib.Path.home() / "AppData" / "Local")
HOME = pathlib.Path(LOCAL).resolve().parent.parent
WB_NODE = HOME / ".workbuddy" / "binaries" / "node"


def node_candidates():
    """workbuddy 自带的 node，版本目录带哈希（22.22.2-6 之类），用 glob 找而不写死。"""
    cands = [os.environ.get("NEON_NODE") or ""]
    d = WB_NODE / "versions"
    if d.is_dir():
        cands += sorted(str(p) for p in d.glob("*/node.exe"))
    cands += [shutil.which("node") or "", r"D:/Program Files/node.js/node.exe"]
    return [c for c in cands if c]


def find_node():
    for c in node_candidates():
        if os.path.isfile(c):
            return c
    raise SystemExit("找不到 node.exe：设 NEON_NODE=<path>，或把 node 加进 PATH")


def node_modules():
    return os.environ.get("NEON_NODE_MODULES") or str(WB_NODE / "workspace" / "node_modules")
