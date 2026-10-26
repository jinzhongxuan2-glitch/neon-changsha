# -*- coding: utf-8 -*-
"""一条命令重建：template_dev.html -> dev.html -> index.html -> dist/

    python _build/build.py               全量（含 dist）
    python _build/build.py --no-dist     只到 index.html（改样式时快一半）
    python _build/build.py --serve       构建完起本地预览（dist，127.0.0.1:8099）
    python _build/build.py --shots base  构建完顺手截基线（调 _build/shots.js）

为什么不用 rebuild.bat 里的逻辑：cmd 按系统代码页（GBK）解析批处理，
路径里的中文会被拆坏（实测 %NODE% 变成 "=C:\\Users\\闈充腑杞‐..."）。
这里全部用绝对路径 + subprocess 列表参数，不经过 cmd 的字符串解析。
"""

import argparse
import os
import shutil
import subprocess
import sys
import time
import pathlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import _env  # noqa: E402  —— node / node_modules 的定位，见 _env.py

ROOT = pathlib.Path(__file__).resolve().parent.parent
BUILD = ROOT / "_build"
VENDOR = ROOT / "vendor"

NODE_CANDIDATES = _env.node_candidates()


def find_node() -> str:
    return _env.find_node()


def find_esbuild() -> pathlib.Path:
    p = BUILD / "node_modules" / "esbuild" / "bin" / "esbuild"
    if not p.is_file():
        raise SystemExit("缺少 esbuild，先在 _build/ 里跑 npm i esbuild")
    return p


class Step:
    def __init__(self, total: int):
        self.i = 0
        self.total = total
        self.t0 = time.perf_counter()
        self.rows = []

    def run(self, label: str, cmd: list, cwd: pathlib.Path, quiet: bool = False):
        self.i += 1
        t = time.perf_counter()
        env = dict(os.environ)
        env["PYTHONIOENCODING"] = "utf-8"
        env["NEON_NODE"] = find_node()
        p = subprocess.run(
            cmd, cwd=str(cwd), env=env,
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True, encoding="utf-8", errors="replace",
        )
        ms = (time.perf_counter() - t) * 1000
        ok = p.returncode == 0
        mark = "ok  " if ok else "FAIL"
        print("  [%d/%d] %-9s %6.0f ms  %s" % (self.i, self.total, label, ms, mark))
        if not quiet and p.stdout.strip():
            for line in p.stdout.strip().splitlines():
                print("        " + line)
        self.rows.append((label, ms, ok))
        if not ok:
            print("\n构建失败，完整输出：\n" + p.stdout)
            raise SystemExit(1)


def human(n: int) -> str:
    return "%.2f MB" % (n / 1048576) if n > 1048576 else "%.0f KB" % (n / 1024)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-dist", action="store_true", help="跳过 dist/（外置化 + gzip）")
    ap.add_argument("--serve", action="store_true", help="构建后启动 dist 预览服务")
    ap.add_argument("--shots", metavar="TAG", help="构建后截图到 _audit/<TAG>/")
    ap.add_argument("--mode", default="diff", choices=["diff", "pretty"], help="截图模式")
    ap.add_argument("--quiet", action="store_true", help="不打印各步骤的标准输出")
    args = ap.parse_args()

    py = sys.executable
    node = find_node()
    esbuild = find_esbuild()

    print("neon-changsha build")
    print("  root   " + str(ROOT))
    print("  python " + py)
    print("  node   " + node)
    print()

    steps = 4 + (0 if args.no_dist else 1)
    st = Step(steps)

    st.run("make_dev", [py, str(BUILD / "make_dev.py")], BUILD, args.quiet)
    st.run("extract", [py, str(BUILD / "extract.py")], BUILD, args.quiet)
    st.run("esbuild", [
        node, str(esbuild), "app.js",
        "--bundle", "--format=iife", "--minify", "--target=es2020",
        "--alias:three=" + str(VENDOR / "three.module.js"),
        "--outfile=bundle.js",
    ], BUILD, args.quiet)
    st.run("inline", [py, str(BUILD / "inline.py")], BUILD, args.quiet)
    if not args.no_dist:
        st.run("externalize", [py, str(BUILD / "externalize.py")], BUILD, args.quiet)

    print()
    print("产物")
    for f in ["dev.html", "index.html"]:
        p = ROOT / f
        if p.is_file():
            print("  %-22s %s" % (f, human(p.stat().st_size)))
    dist_idx = ROOT / "dist" / "index.html"
    if dist_idx.is_file() and not args.no_dist:
        assets = ROOT / "dist" / "assets"
        total = sum(f.stat().st_size for f in assets.glob("*") if not f.name.endswith(".gz"))
        print("  %-22s %s (+ assets %s)" % ("dist/index.html", human(dist_idx.stat().st_size), human(total)))
    print()
    print("总耗时 %.2fs" % (time.perf_counter() - st.t0))

    if args.shots:
        print()
        print("截图 -> _audit/%s/ (%s)" % (args.shots, args.mode))
        subprocess.run(
            [node, str(BUILD / "shots.js"), "--tag", args.shots, "--mode", args.mode],
            cwd=str(BUILD), check=True,
        )

    if args.serve:
        if args.no_dist:
            raise SystemExit("--serve 需要 dist/，去掉 --no-dist")
        print()
        print("预览 http://127.0.0.1:8099/  (Ctrl+C 退出)")
        subprocess.run([py, str(BUILD / "serve.py")], cwd=str(BUILD))


if __name__ == "__main__":
    main()
