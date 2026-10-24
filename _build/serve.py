# -*- coding: utf-8 -*-
"""
本地预览 dist/：带真实的缓存头与 gzip_static 行为，用来验证部署效果。

    python _build/serve.py            → http://127.0.0.1:8099/
    python _build/serve.py 8123       → 指定端口
"""
import http.server
import os
import socketserver
import sys

ROOT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "dist")
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8099


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def log_message(self, fmt, *args):
        sys.stderr.write("  %s\n" % (fmt % args))

    def end_headers(self):
        p = self.path.split("?")[0]
        if "/assets/" in p:
            self.send_header("Cache-Control", "public, max-age=31536000, immutable")
        else:
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def do_GET(self):
        fs = self.translate_path(self.path)
        if os.path.isdir(fs): fs = os.path.join(fs, "index.html")
        gz = fs + ".gz"
        if os.path.isfile(gz) and "gzip" in self.headers.get("Accept-Encoding", ""):
            with open(gz, "rb") as f:
                data = f.read()
            self.send_response(200)
            self.send_header("Content-Type", self.guess_type(fs))
            self.send_header("Content-Encoding", "gzip")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        super().do_GET()


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True


if __name__ == "__main__":
    if not os.path.isdir(ROOT):
        raise SystemExit("找不到 dist/，先跑一次 _build/externalize.py")
    with Server(("127.0.0.1", PORT), Handler) as httpd:
        print("serving dist/ at http://127.0.0.1:%d/" % PORT)
        httpd.serve_forever()
