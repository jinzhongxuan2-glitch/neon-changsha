# -*- coding: utf-8 -*-
"""把 city.json 与水面遮罩注入模板，生成 dev.html"""
import base64, pathlib

root = pathlib.Path(__file__).resolve().parent.parent
tpl = (root / "_build" / "template_dev.html").read_text(encoding="utf-8")
city = (root / "_data" / "out" / "city.json").read_text(encoding="utf-8")
png = (root / "_data" / "out" / "water.png").read_bytes()
mask = "data:image/png;base64," + base64.b64encode(png).decode()

out = tpl.replace("__CITY_DATA__", city).replace("__WATER_MASK__", mask)
(root / "dev.html").write_text(out, encoding="utf-8")
print("dev.html MB:", round(len(out.encode("utf-8")) / 1048576, 2))
