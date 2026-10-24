# -*- coding: utf-8 -*-
"""极简 GeoTIFF 头解析：读尺寸/像元大小/地理定位点"""
import struct

TAG_W, TAG_H = 256, 257
TAG_BITS = 258
TAG_COMP = 259
TAG_TILEW, TAG_TILEH = 322, 323
TAG_SCALE = 33550
TAG_TIEPOINT = 33922


def read_tags(path, max_entries=80):
    with open(path, "rb") as f:
        head = f.read(8)
        if head[:2] == b"II":
            en = "<"
        else:
            en = ">"
        magic = struct.unpack(en + "H", head[2:4])[0]
        big = (magic == 43)
        if big:
            f.seek(8)
            off = struct.unpack(en + "Q", f.read(8))[0]
            f.seek(off)
            n = struct.unpack(en + "Q", f.read(8))[0]
        elif magic == 42:
            off = struct.unpack(en + "I", head[4:8])[0]
            f.seek(off)
            n = struct.unpack(en + "H", f.read(2))[0]
        else:
            raise ValueError("not TIFF")
        tags = {}
        esz = 20 if big else 12
        for _ in range(min(n, max_entries)):
            raw = f.read(esz)
            if len(raw) < esz:
                break
            if big:
                tag, typ, cnt = struct.unpack(en + "HHQ", raw[:12])
                val = raw[12:20]
            else:
                tag, typ, cnt = struct.unpack(en + "HHI", raw[:8])
                val = raw[8:12]
            sizes = {1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 11: 4, 12: 8, 16: 8}
            sz = sizes.get(typ, 1) * cnt
            lim = 8 if big else 4
            if sz > lim:
                p = struct.unpack(en + "Q" if big else en + "I", val)[:1][0]
                cur = f.tell()
                f.seek(p)
                data = f.read(sz)
                f.seek(cur)
            else:
                data = val[:sz]
            if typ == 3:
                tags[tag] = list(struct.unpack(en + "%dH" % cnt, data))
            elif typ == 4:
                tags[tag] = list(struct.unpack(en + "%dI" % cnt, data))
            elif typ == 12:
                tags[tag] = list(struct.unpack(en + "%dd" % cnt, data))
            elif typ == 11:
                tags[tag] = list(struct.unpack(en + "%df" % cnt, data))
        return tags, en


if __name__ == "__main__":
    import sys
    t, en = read_tags(sys.argv[1])
    print("endian", en)
    print("W,H", t.get(TAG_W), t.get(TAG_H))
    print("tileW,tileH", t.get(TAG_TILEW), t.get(TAG_TILEH))
    print("compression", t.get(TAG_COMP), "bits", t.get(TAG_BITS))
    print("pixelScale", t.get(TAG_SCALE))
    print("tiepoint", t.get(TAG_TIEPOINT))
