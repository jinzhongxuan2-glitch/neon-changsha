import pathlib

root = pathlib.Path(__file__).resolve().parent.parent
tpl = (root / "_build" / "template.html").read_text(encoding="utf-8")
js = (root / "_build" / "bundle.js").read_text(encoding="utf-8")
js = js.replace("</script", "<\\/script")
out = tpl.replace("<!--BUNDLE-->", "<script>\n" + js + "\n</script>")
(root / "index.html").write_text(out, encoding="utf-8")
print("index.html KB:", round(len(out.encode("utf-8")) / 1024))
