# Generates assets/img/clm/scr-rope-rotation.svg: how Suffix Cache Reuse relocates cached KV entries
# (diff -> position shift -> rotate keys / copy values). Palette = the blog's token strip.
import html
W = 800
PROSE = '"Iowan Old Style","Iowan Old Style BT","Palatino Linotype","Book Antiqua",Georgia,serif'
SANS = 'system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif'
COL = {"prev": ("#e6e3dc", "#8a857b"), "hit": ("#bcd8ee", "#1179b5"), "pre": ("#f4c8d6", "#c23962"), "reu": ("#cfe8d4", "#2f7d3f")}
INK = "#2b2a27"; MUTED = "#6f6b64"; ROSE = "#c23962"
out = []
def add(s): out.append(s)
def text(x, y, s, size=12, fill=INK, anchor="start", family=SANS, style="", weight="normal", extra=""):
    add(f'<text x="{x:.1f}" y="{y:.1f}" font-family=\'{family}\' font-size="{size}" fill="{fill}" text-anchor="{anchor}" font-style="{style or "normal"}" font-weight="{weight}" {extra}>{s}</text>')
def chip(x, y, w, h, kind, label, dashed=False):
    fill, ink = COL[kind]
    add(f'<rect x="{x:.1f}" y="{y:.1f}" width="{w:.1f}" height="{h:.1f}" rx="4" fill="{fill}" stroke="{ink}" stroke-width="1" {"stroke-dasharray=\"4 3\"" if dashed else ""}/>')
    text(x + w / 2, y + h / 2 + 5, label, 14, INK, "middle", PROSE)
def bracket(x1, x2, y, ink, label, label_html=None):
    add(f'<path d="M{x1:.1f},{y-6:.1f} V{y:.1f} H{x2:.1f} V{y-6:.1f}" fill="none" stroke="{ink}" stroke-width="1.5"/>')
    add(f'<text x="{(x1+x2)/2:.1f}" y="{y+16:.1f}" font-family=\'{SANS}\' font-size="12" fill="{ink}" text-anchor="middle">{label_html or label}</text>')
def em(s): return f'<tspan font-family=\'{PROSE}\' font-style="italic" font-size="13">{s}</tspan>'
CH, GAP, GGAP = 26, 4, 16
def cw(t): return 12 + 7.2 * len(t)   # chip width from the label length
X0 = 150
def row(y, groups):
    """groups: list of (kind, tokens, positions, dashed). returns dict name->(x1,x2) and per-token x."""
    x = X0; spans = {}; xs = []
    for kind, toks, poss, dashed, name in groups:
        gx = x
        for t, p in zip(toks, poss):
            w = cw(t); chip(x, y, w, CH, kind, t, dashed)
            if p is not None: text(x + w / 2, y + CH + 12, str(p), 10.5, MUTED, "middle")
            xs.append((name, x + w / 2)); x += w + GAP
        spans[name] = (gx, x - GAP); x += GGAP - GAP
    return spans, xs
add(f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="442" viewBox="0 0 {W} 442" font-family=\'{SANS}\'>')
add('<defs><marker id="arr" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="#2f7d3f"/></marker>'
    '<marker id="arrg" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="#8a857b"/></marker></defs>')
# ---- step 1: previous prompt, cached, with position ids
y1 = 22
text(12, y1 + 17, "① previous prompt", 12, INK, "start", weight="600"); text(12, y1 + 31, "cached with position ids", 10.5, MUTED)
A = ["this", "is", "sentence", "A"]; B = ["this", "is", "sentence", "B"]; C = ["this", "is", "sentence", "C"]; Bp = ["compacted", "B"]
sp1, xs1 = row(y1, [("prev", A, range(0, 4), False, "A"), ("prev", B, range(4, 8), False, "B"), ("prev", C, range(8, 12), False, "C")])
for n, lab in (("A", em("A")), ("B", em("B")), ("C", em("C"))):
    x1, x2 = sp1[n]; bracket(x1, x2, y1 + CH + 24, COL["prev"][1], None, lab + ' <tspan font-size="11">· one KV entry per token</tspan>' if n == "C" else lab)
# ---- step 2: new prompt diffed; C shifted
y2 = 154
text(12, y2 + 17, "② new prompt", 12, INK, "start", weight="600"); text(12, y2 + 31, "diffed against ①", 10.5, MUTED)
sp2, xs2 = row(y2, [("hit", A, range(0, 4), False, "A"), ("pre", Bp, range(4, 6), False, "B′"), ("reu", C, range(6, 10), False, "C")])
# first-mismatch cross
bx = sp2["B′"][0]; text(bx - 8, y2 + CH / 2 + 5, "×", 13, ROSE, "middle", weight="700")
bracket(*sp2["A"], y2 + CH + 24, COL["hit"][1], None, em("A") + " · hit prefix cache")
bracket(*sp2["B′"], y2 + CH + 24, COL["pre"][1], None, em("B′") + " · prefilled")
bracket(*sp2["C"], y2 + CH + 24, COL["reu"][1], None, em("C") + " · KV entries relocated")
# shift arrows from old C chips to new C chips
oldC = [x for n, x in xs1 if n == "C"]; newC = [x for n, x in xs2 if n == "C"]
for xo, xn in zip(oldC, newC):
    add(f'<path d="M{xo:.1f},{y1+CH+48:.1f} C{xo:.1f},{y1+CH+76:.1f} {xn:.1f},{y2-30:.1f} {xn:.1f},{y2-3:.1f}" fill="none" stroke="#2f7d3f" stroke-width="1.2" stroke-dasharray="3 3" marker-end="url(#arr)" opacity="0.85"/>')
# delta label to the right of the arrows
dx = X0
text(dx, y1 + CH + 64, "Δ = |" + em("B′") + "| − |" + em("B") + "| = 2 − 4 = −2", 11.5, "#2f7d3f", "start", weight="600")
text(dx, y1 + CH + 79, "every token of " + em("C") + " moves by Δ positions; its cached KV entries move with it", 10.5, MUTED)
# ---- step 3: one relocated entry
y3 = 266
text(12, y3 + 17, "③ one entry of " + em("C"), 12, INK, "start", weight="600")
text(12, y3 + 31, "position 8 → 6", 10.5, MUTED)
# cached entry box
bxw, bxh = 236, 110
cx = X0; add(f'<rect x="{cx}" y="{y3}" width="{bxw}" height="{bxh}" rx="6" fill="#faf9f6" stroke="#8a857b" stroke-width="1"/>')
text(cx + 12, y3 + 20, "cached entry, position 8", 11.5, MUTED)
text(cx + 12, y3 + 46, 'K<tspan baseline-shift="sub" font-size="9">cached</tspan> = R(8) · k', 13, INK, family=PROSE, style="italic")
text(cx + 12, y3 + 70, 'V<tspan baseline-shift="sub" font-size="9">cached</tspan> = v', 13, INK, family=PROSE, style="italic")
text(cx + 12, y3 + 94, "R(p): rotary rotation at position p", 10.5, MUTED)
# arrow box
ax = cx + bxw + 14; add(f'<path d="M{ax},{y3+bxh/2} H{ax+58}" stroke="#2f7d3f" stroke-width="1.6" marker-end="url(#arr)"/>')
text(ax + 29, y3 + bxh / 2 - 10, "rotate by Δ", 11, "#2f7d3f", "middle", weight="600")
text(ax + 29, y3 + bxh / 2 + 20, "copy", 11, "#2f7d3f", "middle", weight="600")
# new entry box
nx = ax + 76; add(f'<rect x="{nx}" y="{y3}" width="{W-nx-12}" height="{bxh}" rx="6" fill="{COL["reu"][0]}" stroke="{COL["reu"][1]}" stroke-width="1"/>')
text(nx + 12, y3 + 20, "relocated entry, position 6 · session-private slot", 11.5, COL["reu"][1])
text(nx + 12, y3 + 46, 'K<tspan baseline-shift="sub" font-size="9">new</tspan> = R(6) · k = R(Δ) · K<tspan baseline-shift="sub" font-size="9">cached</tspan>', 13, INK, family=PROSE, style="italic")
text(nx + 12, y3 + 70, 'V<tspan baseline-shift="sub" font-size="9">new</tspan> = V<tspan baseline-shift="sub" font-size="9">cached</tspan>', 13, INK, family=PROSE, style="italic")
text(nx + 12, y3 + 94, "values carry no position; keys need one rotation", 10.5, MUTED)
# footer notes
fy = y3 + bxh + 26
text(X0, fy, "Decoding then attends over [ " + em("A") + " | " + em("B′") + " | " + em("C") + " ] as if the whole prompt had been prefilled.", 11, INK)
text(X0, fy + 15, "Linear-attention layers have no per-token entries; they continue from the recurrent-state", 11, INK)
text(X0, fy + 30, "snapshot taken before the edit.", 11, INK)
add('</svg>')
svg = "\n".join(out)
import sys
open(sys.argv[1], "w").write(svg); print("wrote", sys.argv[1], len(svg))
