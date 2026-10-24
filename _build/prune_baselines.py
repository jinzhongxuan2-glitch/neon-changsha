# -*- coding: utf-8 -*-
"""清理回归基线快照：只保留最近 N 份 baseline-*，baseline 本体永不删。

用法：
    python _build/prune_baselines.py            # 删到只剩最近 2 份
    python _build/prune_baselines.py --keep 3
    python _build/prune_baselines.py --dry-run  # 只看不删
"""
import argparse
import shutil
import sys
from pathlib import Path

AUDIT = Path(__file__).resolve().parent.parent / "_audit"


def human(n):
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024:
            return "%.1f%s" % (n, unit)
        n /= 1024.0
    return "%.1fTB" % n


def bad_frames(d):
    """用 Node + canvas 判空图（Python 侧没有 PIL）。
    全黑或一整片平都算坏 —— 黑图差异恒为 0，留在快照里会骗过阈值。"""
    import json
    import os
    import subprocess

    pngs = sorted(d.glob("*.png"))
    if not pngs:
        return []
    node = os.environ.get("NEON_NODE") or r"C:/Users/<user>/.workbuddy/binaries/node/versions/22.22.2-6/node.exe"
    if not os.path.isfile(node):
        node = "node"
    env = os.environ.copy()
    env["NODE_PATH"] = r"C:/Users/<user>/.workbuddy/binaries/node/workspace/node_modules"
    bad = []
    try:
        r = subprocess.run([node, str(Path(__file__).parent / "imgstat.js")] + [str(x) for x in pngs],
                           capture_output=True, text=True, env=env, timeout=300)
        for line in r.stdout.splitlines():
            line = line.strip()
            if line.startswith("{"):
                j = json.loads(line)
                if j.get("flat"):
                    bad.append(Path(j["file"]).name)
    except Exception:
        pass
    return bad


def dir_size(p):
    return sum(f.stat().st_size for f in p.rglob("*") if f.is_file())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--keep", type=int, default=2, help="保留最近几份快照（不含 baseline 本体）")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    if not AUDIT.is_dir():
        print("没有 _audit 目录：%s" % AUDIT)
        return 1

    snaps = [d for d in AUDIT.iterdir() if d.is_dir() and d.name.startswith("baseline-")]
    # 按目录内文件的最新修改时间排序，最可信
    def mtime(d):
        ts = [f.stat().st_mtime for f in d.rglob("*") if f.is_file()]
        return max(ts) if ts else 0.0

    snaps.sort(key=mtime, reverse=True)
    keep, drop = [], []
    for d in snaps:
        bad = bad_frames(d)
        if bad:
            print("坏快照（空图 %d 张：%s）→ 无条件删除：%s" % (len(bad), ",".join(bad[:3]), d.name))
            drop.append(d)
        elif len(keep) < args.keep:
            keep.append(d)
        else:
            drop.append(d)

    total = 0
    print("保留：")
    for d in keep:
        print("  keep  %-24s %s" % (d.name, human(dir_size(d))))
    if drop:
        print("删除：")
        for d in drop:
            sz = dir_size(d)
            total += sz
            print("  del   %-24s %s" % (d.name, human(sz)))
            if not args.dry_run:
                shutil.rmtree(d)
    print("-" * 46)
    print("%s：%d 份快照，释放 %s" % ("预演" if args.dry_run else "完成", len(drop), human(total)))
    print("baseline 本体不动：%s" % ("存在" if (AUDIT / "baseline").is_dir() else "缺失"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
