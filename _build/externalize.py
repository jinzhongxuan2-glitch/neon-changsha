# -*- coding: utf-8 -*-
"""
生成可部署的 dist/ 目录。

  dist/index.html              页面骨架 + 逻辑，引用带内容哈希的资源
  dist/assets/city.<hash>.js   城市几何数据（window.__CITY）
  dist/assets/*.<hash>.jpg     1024² CC0 贴图
  dist/assets/*.gz             预压缩副本（配合 gzip_static）
  dist/nginx.conf.example      缓存策略参考
  dist/.htaccess               Apache 缓存策略

文件名带 sha1 前 8 位，因此可以安全地给 assets 打一年 immutable 缓存；
index.html 本身不缓存，改了代码只会失效它自己。

单文件版 index.html 不受影响，仍然可直接双击。
"""
import gzip
import hashlib
import os
import re
import shutil
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUILD = os.path.join(ROOT, "_build")
DIST = os.path.join(ROOT, "dist")
ASSETS = os.path.join(DIST, "assets")
TEX_DIR = os.path.join(ROOT, "_tex", "1k")    # 质量优先：用 1024²

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _env  # noqa: E402  —— node / node_modules 的定位，见 _env.py
NODE = _env.find_node()
ESBUILD = os.path.join(BUILD, "node_modules", "esbuild", "bin", "esbuild")

KEYS = ["asphalt", "pavers", "facade", "asphaltN", "facadeN"]


def sha8(path):
    h = hashlib.sha1()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()[:8]


def extract_city(app):
    head = "const CITY = window.__CITY || "
    i = app.index(head)
    j = app.index("const WATER_MASK_URL")
    blob = app[i + len(head):j].rstrip()
    if not blob.endswith(";"):
        raise SystemExit("城市数据段格式异常")
    return app[:i] + "const CITY = window.__CITY;\n" + app[j:], blob[:-1].strip()


def gz_write(path):
    """把文件压一份 .gz 放在旁边（仅对文本有意义）"""
    with open(path, "rb") as f:
        raw = f.read()
    out = path + ".gz"
    with gzip.GzipFile(out, "wb", compresslevel=9, mtime=0) as g:
        g.write(raw)
    return len(raw), os.path.getsize(out)


def main():
    os.makedirs(ASSETS, exist_ok=True)
    # 清掉上一轮产物，避免哈希文件堆积
    for f in os.listdir(ASSETS):
        os.remove(os.path.join(ASSETS, f))

    # ---------- 1) 剥离城市数据 ----------
    app = open(os.path.join(BUILD, "app.js"), encoding="utf-8").read()
    new_app, city_json = extract_city(app)
    app_ext = os.path.join(BUILD, "app_ext.js")
    open(app_ext, "w", encoding="utf-8").write(new_app)

    bundle_ext = os.path.join(BUILD, "bundle_ext.js")
    subprocess.run([
        NODE, ESBUILD, app_ext,
        "--bundle", "--format=iife", "--minify", "--target=es2020",
        "--alias:three=" + os.path.join(ROOT, "vendor", "three.module.js"),
        "--outfile=" + bundle_ext,
    ], check=True, stdout=subprocess.DEVNULL)

    # ---------- 2) 城市数据落地 ----------
    city_path = os.path.join(ASSETS, "city.js")
    open(city_path, "w", encoding="utf-8").write("window.__CITY=" + city_json + ";\n")
    city_name = "city.%s.js" % sha8(city_path)
    os.replace(city_path, os.path.join(ASSETS, city_name))
    city_size = os.path.getsize(os.path.join(ASSETS, city_name))
    city_gz = gz_write(os.path.join(ASSETS, city_name))

    # ---------- 3) 贴图落地 ----------
    tex_map = {}
    tex_total = 0
    for k in KEYS:
        dst = os.path.join(ASSETS, k + ".jpg")
        shutil.copyfile(os.path.join(TEX_DIR, k + ".jpg"), dst)
        name = "%s.%s.jpg" % (k, sha8(dst))
        os.replace(dst, os.path.join(ASSETS, name))
        tex_map[k] = name
        tex_total += os.path.getsize(os.path.join(ASSETS, name))

    # ---------- 4) 改写引用 ----------
    js = open(bundle_ext, encoding="utf-8").read().replace("</script", "<\\/script")
    for k in KEYS:
        pat = re.compile(r"\b" + re.escape(k) + r":\s*\"data:image/jpeg;base64,[A-Za-z0-9+/=]+\"")
        js, n = pat.subn('%s: "./assets/%s"' % (k, tex_map[k]), js)
        if n != 1:
            raise SystemExit("贴图占位替换失败: " + k)
    if "data:image/jpeg;base64," in js:
        raise SystemExit("仍有内联贴图未替换")

    tpl = open(os.path.join(BUILD, "template.html"), encoding="utf-8").read()
    out = tpl.replace(
        "<!--BUNDLE-->",
        '<script src="./assets/%s"></script>\n<script>\n%s\n</script>' % (city_name, js),
    )
    idx = os.path.join(DIST, "index.html")
    open(idx, "w", encoding="utf-8").write(out)
    html_gz = gz_write(idx)

    # ---------- 5) 缓存策略示例 ----------
    open(os.path.join(DIST, "nginx.conf.example"), "w", encoding="utf-8").write(
        "# 放到 server { } 里\n"
        "gzip_static on;              # 优先发预压缩的 .gz\n"
        "gzip_types text/css application/javascript image/svg+xml;\n\n"
        "location = /index.html {\n"
        "    add_header Cache-Control \"no-cache\";        # 每次都校验，保证拿到新版本\n"
        "}\n\n"
        "location /assets/ {\n"
        "    add_header Cache-Control \"public, max-age=31536000, immutable\";\n"
        "}\n"
    )
    open(os.path.join(DIST, ".htaccess"), "w", encoding="utf-8").write(
        "<IfModule mod_headers.c>\n"
        "  <FilesMatch \"\\.(js|jpg|png)$\">\n"
        "    Header set Cache-Control \"public, max-age=31536000, immutable\"\n"
        "  </FilesMatch>\n"
        "  <FilesMatch \"^index\\.html$\">\n"
        "    Header set Cache-Control \"no-cache\"\n"
        "  </FilesMatch>\n"
        "</IfModule>\n"
    )

    # ---------- 6) 说明 ----------
    open(os.path.join(DIST, "README.txt"), "w", encoding="utf-8").write(
        "CHANGSHA · 湘江 — 外置资源版\n"
        "============================\n\n"
        "index.html            页面骨架 + 逻辑（不含数据与贴图）\n"
        "assets/city.<hash>.js 城市几何数据，必须早于主包加载\n"
        "assets/*.<hash>.jpg   1024² 材质贴图\n"
        "assets/*.gz           预压缩副本，配合 nginx gzip_static\n\n"
        "文件名里的哈希是内容 sha1 前 8 位，内容一变名字就变，\n"
        "所以 assets 可以安全地打一年 immutable 缓存。\n\n"
        "本地预览（带正确的缓存头）：\n"
        "    python _build/serve.py\n"
        "    打开 http://127.0.0.1:8099/\n\n"
        "部署：把 dist/ 整个丢到任意静态服务器；\n"
        "      nginx 参考 nginx.conf.example，Apache 直接用 .htaccess。\n\n"
        "贴图来源：Poly Haven（https://polyhaven.com），CC0 公共领域授权，可商用。\n"
        "  asphalt ← asphalt_02 · pavers ← concrete_floor_02 · facade ← concrete_tile_facade\n"
        "  asphaltN / facadeN 为对应法线贴图\n"
    )

    print("dist/index.html  %.2f MB  (gz %.2f MB)" % (html_gz[0]/1048576, html_gz[1]/1048576))
    print("  %-18s %.2f MB  (gz %.2f MB)" % (city_name, city_size/1048576, city_gz[1]/1048576))
    print("  贴图 x5        %.2f MB" % (tex_total/1048576))
    print("  合计           %.2f MB  (gz %.2f MB)"
          % ((html_gz[0]+city_size+tex_total)/1048576, (html_gz[1]+city_gz[1]+tex_total)/1048576))


if __name__ == "__main__":
    main()
