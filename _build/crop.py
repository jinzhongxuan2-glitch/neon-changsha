# -*- coding: utf-8 -*-
"""裁一块图并放大，用于肉眼验伤：python crop.py in.png out.png x y w h scale"""
import sys, struct, zlib

def load(path):
    d = open(path, "rb").read(); pos = 8; idat = b""; w = h = ct = 0
    while pos < len(d):
        ln = struct.unpack(">I", d[pos:pos+4])[0]; typ = d[pos+4:pos+8]
        data = d[pos+8:pos+8+ln]; pos += 12 + ln
        if typ == b"IHDR": w, h, bd, ct = struct.unpack(">IIBB", data[:10])
        elif typ == b"IDAT": idat += data
    raw = zlib.decompress(idat); bpp = {0:1,2:3,4:2,6:4}[ct]
    stride = w*bpp; out = bytearray(h*stride); prev = bytearray(stride); o = 0
    for y in range(h):
        f = raw[o]; o += 1
        line = bytearray(raw[o:o+stride]); o += stride
        if f == 1:
            for i in range(bpp, stride): line[i] = (line[i]+line[i-bpp]) & 255
        elif f == 2:
            for i in range(stride): line[i] = (line[i]+prev[i]) & 255
        elif f == 3:
            for i in range(stride):
                a = line[i-bpp] if i >= bpp else 0
                line[i] = (line[i] + ((a+prev[i])>>1)) & 255
        elif f == 4:
            for i in range(stride):
                a = line[i-bpp] if i >= bpp else 0
                c = prev[i-bpp] if i >= bpp else 0
                b = prev[i]
                pa, pb, pc = abs(b-c), abs(a-c), abs(a+b-2*c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[i] = (line[i]+pr) & 255
        out[y*stride:(y+1)*stride] = line; prev = line
    return w, h, bpp, out

def save(path, w, h, bpp, buf):
    raw = bytearray()
    stride = w*bpp
    for y in range(h):
        raw.append(0); raw += buf[y*stride:(y+1)*stride]
    ct = {1:0,3:2,4:6}[bpp]
    def chunk(t, d):
        c = struct.pack(">I", len(d)) + t + d
        return c + struct.pack(">I", zlib.crc32(t+d) & 0xffffffff)
    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, ct, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(bytes(raw), 6))
    png += chunk(b"IEND", b"")
    open(path, "wb").write(png)

inp, outp, x, y, cw, ch, sc = sys.argv[1], sys.argv[2], *map(int, sys.argv[3:8])
W, H, bpp, buf = load(inp)
cw = min(cw, W-x); ch = min(ch, H-y)
ow, oh = cw*sc, ch*sc
out = bytearray(ow*oh*bpp)
for j in range(oh):
    sy = y + j//sc
    for i in range(ow):
        sx = x + i//sc
        s = (sy*W+sx)*bpp; d = (j*ow+i)*bpp
        out[d:d+bpp] = buf[s:s+bpp]
save(outp, ow, oh, bpp, out)
print(outp, ow, oh)
