# -*- coding: utf-8 -*-
"""回归闸门：拍一套新图 -> 跟基线逐张比 -> 给结论。

    python _build/gate.py                 # 拍 candidate 并与 baseline 比（夜间严格，白天只报告）
    python _build/gate.py --strict all    # 白天也严格
    python _build/gate.py --tag look --mode pretty --no-compare

判定阈值来自实测噪声地板（同版本连拍两次）：
    mean <= 0.046 / pct8 <= 0.051%   -> 默认闸门取 5 倍余量：0.20 / 0.15%
"""

import argparse
import json
import os
import subprocess
import sys
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
BUILD = ROOT / "_build"
AUDIT = ROOT / "_audit"

NODE = os.environ.get("NEON_NODE") or r"C:/Users/<user>/.workbuddy/binaries/node/versions/22.22.2-6/node.exe"
if not os.path.isfile(NODE):
    import shutil
    NODE = shutil.which("node") or "node"

SCENES = ["day_cbd", "day_all", "day_street", "day_old", "dusk_cbd",
          "night_cbd", "night_all", "night_isle", "night_street"]


def scenes_from_baseline(base: pathlib.Path):
    """以基线 meta.json 里的机位为准，避免改了 shots.js 之后两边对不上"""
    meta = base / "meta.json"
    if meta.is_file():
        try:
            names = [s["name"] for s in json.loads(meta.read_text(encoding="utf-8"))["scenes"]]
            if names:
                return names
        except Exception:
            pass
    return SCENES


def compare(a: pathlib.Path, b: pathlib.Path) -> dict:
    p = subprocess.run([NODE, str(BUILD / "diff.js"), str(a), str(b)],
                       capture_output=True, text=True, encoding="utf-8", errors="replace")
    out = (p.stdout or "").strip().splitlines()
    if not out:
        return {"error": (p.stderr or "").strip()[:200]}
    return json.loads(out[-1])


def imgstat(paths):
    """用 Node + canvas 做空图判定（纯 Python 侧没有 PIL）。
    返回 {path: flat?}；全黑或一整片平都算坏 —— 两张坏图差异恒为 0，会骗过任何阈值。"""
    out = {}
    if not paths:
        return out
    env = os.environ.copy()
    env["NODE_PATH"] = r"C:/Users/<user>/.workbuddy/binaries/node/workspace/node_modules"
    try:
        r = subprocess.run([NODE, str(BUILD / "imgstat.js")] + [str(p) for p in paths],
                           capture_output=True, text=True, env=env, timeout=240)
        for line in r.stdout.splitlines():
            line = line.strip()
            if not line.startswith("{"):
                continue
            import json as _json
            d = _json.loads(line)
            out[d["file"]] = bool(d.get("flat"))
    except Exception:
        pass
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tag", default="candidate")
    ap.add_argument("--mode", default="diff", choices=["diff", "pretty"])
    ap.add_argument("--strict", default="night", choices=["night", "all", "none"])
    ap.add_argument("--max-mean", type=float, default=0.20)
    ap.add_argument("--max-pct8", type=float, default=0.15)
    ap.add_argument("--no-shots", action="store_true", help="不重新拍，只比对已有目录")
    ap.add_argument("--no-compare", action="store_true")
    ap.add_argument("--no-fps", action="store_true", help="跳过帧率采样（省 ~15s）")
    args = ap.parse_args()

    base = AUDIT / "baseline"
    if not base.is_dir():
        raise SystemExit("没有基线：先跑 python _build/build.py --shots baseline")

    if not args.no_shots:
        print("拍 %s (%s)" % (args.tag, args.mode))
        env = dict(os.environ)
        env["NODE_PATH"] = r"C:/Users/<user>/.workbuddy/binaries/node/workspace/node_modules"
        cmd = [NODE, str(BUILD / "shots.js"), "--tag", args.tag, "--mode", args.mode]
        if args.no_fps:
            cmd.append("--no-fps")
        subprocess.run(cmd, cwd=str(BUILD), env=env, check=True)

    if args.no_compare or args.mode != "diff":
        return 0

    cur = AUDIT / args.tag
    scenes = list(scenes_from_baseline(base))
    STATS = imgstat([p for s in scenes for p in (base / (s + ".png"), cur / (s + ".png")) if p.is_file()])
    print()
    print("%-14s %8s %8s  %s" % ("scene", "mean", "pct8", "verdict"))
    print("-" * 62)
    bad = 0
    for s in scenes:
        a, b = base / (s + ".png"), cur / (s + ".png")
        if not b.is_file():
            print("%-14s %8s %8s  MISSING" % (s, "-", "-"))
            bad += 1
            continue
        r = compare(a, b)
        if "error" in r:
            print("%-14s %8s %8s  %s" % (s, "-", "-", r["error"]))
            bad += 1
            continue
        empty = [n for n, q in (("baseline", a), ("current", b)) if STATS.get(str(q).replace(chr(92), "/"))]
        if empty:
            print("%-14s %8s %8s  EMPTY(%s)" % (s, "-", "-", ",".join(empty)))
            bad += 1
            continue
        strict = args.strict == "all" or (args.strict == "night" and s.startswith("night"))
        ok = (r["mean"] <= args.max_mean) and (r["pct8"] <= args.max_pct8)
        verdict = ("PASS" if ok else "FAIL") if strict else "report"
        if strict and not ok:
            bad += 1
        print("%-14s %8.4f %7.4f%%  %s" % (s, r["mean"], r["pct8"], verdict))

    print("-" * 62)
    print("阈值 mean<=%.2f  pct8<=%.2f%%   严格范围=%s" % (args.max_mean, args.max_pct8, args.strict))
    if bad:
        print("结论：%d 张不通过" % bad)
        return 1
    print("结论：通过")
    return 0


if __name__ == "__main__":
    sys.exit(main())
