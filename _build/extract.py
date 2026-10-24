import re, pathlib

root = pathlib.Path(__file__).resolve().parent.parent
src = (root / "dev.html").read_text(encoding="utf-8")

# 去掉仅开发版需要的 file:// 提示块
src = re.sub(r"<!--DEV_GUARD_START-->.*?<!--DEV_GUARD_END-->\s*", "", src, flags=re.S)

m = re.search(r'<script type="module">(.*?)</script>', src, re.S)
assert m, "module script not found"
code = m.group(1).replace("'./vendor/", "'../vendor/")
(root / "_build" / "app.js").write_text(code, encoding="utf-8")

tpl = re.sub(r'<script type="importmap">.*?</script>\s*', '', src, flags=re.S)
tpl = re.sub(r'<script type="module">.*?</script>', '<!--BUNDLE-->', tpl, flags=re.S)
(root / "_build" / "template.html").write_text(tpl, encoding="utf-8")

print("app.js lines:", code.count("\n"), "| placeholder:", "<!--BUNDLE-->" in tpl)
