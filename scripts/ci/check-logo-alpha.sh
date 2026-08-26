#!/usr/bin/env bash
# The hero logo must be a CLEANLY MATTED cut-out, not a white-keyed one.
#
# §3, 2026-08-26. The previous asset had been composited on white and then keyed
# out: 71.5% of its semi-transparent edge pixels were near-white, and only 1.1%
# of the image was anti-aliased at all. On the hero's tinted panel
# (`--color-on-primary-panel`, not white) that reads as a pale halo around hard,
# jagged edges — which is what "the logo does not look good" meant.
#
# The property is measurable, so it is measured rather than left to whoever
# looks at it next. A replacement matted on white would fail here.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

python3 - <<'PY'
import sys, zlib, struct

TARGET = 'frontend/public/logo-large.png'

def rows_of(path):
    d = open(path, 'rb').read()
    i, idat, meta = 8, b'', {}
    while i < len(d):
        ln = struct.unpack('>I', d[i:i+4])[0]; typ = d[i+4:i+8]; data = d[i+8:i+8+ln]
        if typ == b'IHDR':
            w, h, _bd, ct, _, _, _ = struct.unpack('>IIBBBBB', data)
            meta.update(w=w, h=h, ct=ct)
        elif typ == b'IDAT':
            idat += data
        i += 12 + ln
    ch = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[meta['ct']]
    raw = zlib.decompress(idat)
    w, h, stride = meta['w'], meta['h'], meta['w'] * ch
    out, prev, p = [], bytearray(stride), 0
    for _ in range(h):
        f = raw[p]; p += 1
        line = bytearray(raw[p:p+stride]); p += stride
        for x in range(stride):
            a = line[x-ch] if x >= ch else 0
            b = prev[x]; c = prev[x-ch] if x >= ch else 0
            if f == 1: line[x] = (line[x] + a) & 255
            elif f == 2: line[x] = (line[x] + b) & 255
            elif f == 3: line[x] = (line[x] + ((a + b) >> 1)) & 255
            elif f == 4:
                pa, pb, pc = abs(b-c), abs(a-c), abs(a+b-2*c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[x] = (line[x] + pr) & 255
        out.append(bytes(line)); prev = line
    return meta, out, ch

meta, rows, ch = rows_of(TARGET)
if ch != 4:
    print(f'::error file={TARGET}::the hero logo has no alpha channel at all')
    sys.exit(1)

w, h = meta['w'], meta['h']
fringe = [(r[x*4], r[x*4+1], r[x*4+2]) for r in rows for x in range(w) if 0 < r[x*4+3] < 255]
total = w * h

if not fringe:
    print(f'::error file={TARGET}::no anti-aliased edge at all — a hard 1-bit mask reads as jagged')
    sys.exit(1)

near_white = sum(1 for (r, g, b) in fringe if (r + g + b) / 3 > 235) / len(fringe) * 100
antialiased = len(fringe) / total * 100

fail = 0
# A white-matted cut-out shows a pale halo on the hero's tinted panel.
if near_white > 25:
    print(f'::error file={TARGET}::{near_white:.1f}% of the semi-transparent edge is near-white — '
          f'this looks matted on white and will halo on the tinted hero panel')
    fail = 1
# Too little soft edge means hard, stair-stepped outlines at hero size.
if antialiased < 3:
    print(f'::error file={TARGET}::only {antialiased:.1f}% of the image is anti-aliased — edges will look jagged')
    fail = 1
# A logo whose corners are opaque is a rectangle, not a cut-out.
for (cy, cx) in [(0, 0), (0, w-1), (h-1, 0), (h-1, w-1)]:
    if rows[cy][cx*4+3] != 0:
        print(f'::error file={TARGET}::corner ({cx},{cy}) is not transparent — the asset carries a background')
        fail = 1
        break

if fail:
    sys.exit(1)
print(f'Hero logo OK — {antialiased:.1f}% anti-aliased edge, {near_white:.1f}% of it near-white, corners clear.')
PY
