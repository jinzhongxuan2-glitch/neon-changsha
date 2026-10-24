CHANGSHA · 湘江 — 外置资源版
============================

index.html            页面骨架 + 逻辑（不含数据与贴图）
assets/city.<hash>.js 城市几何数据，必须早于主包加载
assets/*.<hash>.jpg   1024² 材质贴图
assets/*.gz           预压缩副本，配合 nginx gzip_static

文件名里的哈希是内容 sha1 前 8 位，内容一变名字就变，
所以 assets 可以安全地打一年 immutable 缓存。

本地预览（带正确的缓存头）：
    python _build/serve.py
    打开 http://127.0.0.1:8099/

部署：把 dist/ 整个丢到任意静态服务器；
      nginx 参考 nginx.conf.example，Apache 直接用 .htaccess。

贴图来源：Poly Haven（https://polyhaven.com），CC0 公共领域授权，可商用。
  asphalt ← asphalt_02 · pavers ← concrete_floor_02 · facade ← concrete_tile_facade
  asphaltN / facadeN 为对应法线贴图
