/* Interactive "FLOPs of one Qwen3.6-27B turn" figure for the Suffix Cache Reuse post.
 *
 * Markup:  ::: {.flops-sim}  caption paragraph(s)  :::
 *
 * The context before the turn is A B C (N tokens). The edit at position p replaces B with B'.
 * One response of G tokens is then generated. For each way of serving the turn we count
 * prefix-reuse FLOPs with the per-token and per-query-key-pair constants of Qwen3.6-27B
 * (paper, Appendix C): linear layers cost the same for every processed token, and the
 * 16 full-attention layers add a cost per query-key pair.
 */
(function () {
  "use strict";

  // Qwen3.6-27B constants (FLOPs), two FLOPs per multiply-add.
  var OPS = [
    { key: "mlp", label: "MLP", per: 34.23e9, color: "#6f88a8" },
    { key: "gdn", label: "Gated DeltaNet projections", per: 11.12e9, color: "#c9a57a" },
    { key: "fap", label: "Full-attention projections", per: 3.36e9, color: "#9db08c" },
    { key: "qk", label: "Full-attention query-key pairs", per: 3.93216e5, color: "#b07a8c" }
  ];
  var G = 500; // response tokens
  var C_TOKEN = OPS[0].per + OPS[1].per + OPS[2].per;

  var COL = {
    cached: "#d8d3c7", prefill: "#e39bb0", reused: "#3d9a50", gen: "#0668E1", removed: "#e39bb0", avoided: "#e7e4dd"
  };

  var PRESETS = [
    { key: "end", label: "append only", st: { N: 18000, p: 18000, del: 0, ins: 2000 } },
    { key: "mid", label: "edit in the middle", st: { N: 20000, p: 10000, del: 1000, ins: 1000 } },
    { key: "start", label: "edit at the start", st: { N: 20000, p: 0, del: 1000, ins: 1000 } },
    { key: "compact", label: "compact old turns", st: { N: 28000, p: 2000, del: 18000, ins: 1500 } }
  ];

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  var SVGNS = "http://www.w3.org/2000/svg";
  function sv(tag, attrs, parent) {
    var n = document.createElementNS(SVGNS, tag);
    Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    if (parent) parent.appendChild(n);
    return n;
  }
  function fmtTok(x) {
    x = Math.round(x);
    if (x >= 1000) return (x / 1000).toFixed(x % 1000 === 0 ? 0 : 1) + "K";
    return String(x);
  }
  function fmtTokFull(x) { return Math.round(x).toLocaleString("en-US"); }
  function e14(x) { return (x / 1e14).toFixed(2); }

  // ------------------------------------------------------------------ cost model
  function turn(st) {
    var N = st.N, p = st.p, del = st.del, ins = st.ins;
    var C = N - p - del;          // unchanged text after the edit
    var P = p + ins + C;          // prompt after the edit
    var dec = G * P + 0.5 * G * G; // query-key pairs while decoding
    function cost(processed, pairs) {
      var r = { mlp: 0, gdn: 0, fap: 0, qk: 0 };
      var toks = processed + G;
      r.mlp = OPS[0].per * toks; r.gdn = OPS[1].per * toks; r.fap = OPS[2].per * toks;
      r.qk = OPS[3].per * (pairs + dec);
      r.total = r.mlp + r.gdn + r.fap + r.qk;
      return r;
    }
    var none = cost(P, 0.5 * P * P);
    var std = cost(P - p, 0.5 * (P * P - p * p));
    var scr = cost(ins, ins * p + 0.5 * ins * ins);
    var app = cost(ins, 0.5 * (P * P - (P - ins) * (P - ins)));
    return { N: N, p: p, del: del, ins: ins, C: C, P: P, none: none, std: std, scr: scr, app: app };
  }

  // ------------------------------------------------------------------ widget
  function mount(node) {
    var caption = Array.prototype.filter.call(node.children, function (c) { return c.tagName === "P"; });
    caption.forEach(function (c) { c.classList.add("chart-caption"); });

    var st = { N: 20000, p: 10000, del: 1000, ins: 1000 };
    var box = el("div", "fs-box");
    node.insertBefore(box, node.firstChild);

    var head = el("div", "fs-head");
    head.appendChild(el("span", "fs-fig", "Interactive"));
    head.appendChild(el("span", "fs-title", "FLOPs of one Qwen3.6-27B turn"));
    box.appendChild(head);
    box.appendChild(el("div", "fs-sub", "move the edit, change what it removes and inserts, grow the context: see what prefix caching saves and what Suffix Cache Reuse adds"));

    var W = 860, LBL = 150, RGT = 196, BAR = W - LBL - RGT;
    var svg = sv("svg", { viewBox: "0 0 " + W + " 330", class: "fs-svg", role: "img", "aria-label": "Token strips and FLOPs bars for one turn" });
    box.appendChild(svg);
    var tip = el("div", "fs-tip"); box.appendChild(tip);

    var stats = el("div", "fs-stats"); box.appendChild(stats);

    var ctl = el("div", "fs-controls"); box.appendChild(ctl);
    var presetRow = el("div", "fs-row"); ctl.appendChild(presetRow);
    presetRow.appendChild(el("span", "fs-lab", "Examples"));
    var pbtn = {};
    PRESETS.forEach(function (pr) {
      var b = el("button", "fs-pill", pr.label); b.type = "button";
      b.addEventListener("click", function () { Object.keys(pr.st).forEach(function (k) { st[k] = pr.st[k]; }); sync(); });
      pbtn[pr.key] = b; presetRow.appendChild(b);
    });

    var sliders = {};
    var grid = el("div", "fs-grid"); ctl.appendChild(grid);
    function slider(key, label, min, max, step) {
      var w = el("label", "fs-slider");
      w.appendChild(el("span", "fs-lab", label));
      var inp = el("input"); inp.type = "range"; inp.min = min; inp.max = max; inp.step = step;
      var val = el("span", "fs-val");
      inp.addEventListener("input", function () { st[key] = +inp.value; clamp(key); sync(); });
      w.appendChild(inp); w.appendChild(val); grid.appendChild(w);
      sliders[key] = { inp: inp, val: val };
    }
    slider("N", "Context length", 2000, 64000, 500);
    slider("p", "Edit at", 0, 64000, 250);
    slider("del", "Removes (B)", 0, 64000, 250);
    slider("ins", "Inserts (B′)", 0, 8000, 100);

    function clamp(changed) {
      if (st.p > st.N) st.p = st.N;
      if (st.p + st.del > st.N) {
        if (changed === "p") st.del = st.N - st.p; else if (changed === "del") st.p = Math.max(0, st.N - st.del); else st.del = Math.max(0, st.N - st.p);
      }
    }

    function sync() {
      sliders.p.inp.max = st.N; sliders.del.inp.max = st.N;
      Object.keys(sliders).forEach(function (k) {
        sliders[k].inp.value = st[k];
        sliders[k].val.textContent = (k === "p" ? "token " : "") + fmtTokFull(st[k]) + (k === "p" ? "" : " tokens");
      });
      Object.keys(pbtn).forEach(function (k) {
        var pr = PRESETS.filter(function (x) { return x.key === k; })[0].st;
        pbtn[k].classList.toggle("on", Object.keys(pr).every(function (x) { return pr[x] === st[x]; }));
      });
      draw();
    }

    function showTip(evt, html) {
      tip.innerHTML = html; tip.style.display = "block";
      var r = box.getBoundingClientRect();
      var x = evt.clientX - r.left + 14, y = evt.clientY - r.top + 14;
      if (x + 260 > r.width) x = evt.clientX - r.left - 270;
      tip.style.left = x + "px"; tip.style.top = y + "px";
    }
    function hideTip() { tip.style.display = "none"; }
    function hover(n, html) {
      n.addEventListener("mousemove", function (e) { showTip(e, html); });
      n.addEventListener("mouseleave", hideTip);
    }

    function text(x, y, s, cls, anchor) {
      var t = sv("text", { x: x, y: y, class: cls || "fs-t", "text-anchor": anchor || "start" }, svg);
      t.textContent = s; return t;
    }

    function draw() {
      var t = turn(st);
      while (svg.firstChild) svg.removeChild(svg.firstChild);
      var defs = sv("defs", {}, svg);
      var pat = sv("pattern", { id: "fs-hatch", width: 6, height: 6, patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)" }, defs);
      sv("rect", { width: 6, height: 6, fill: "#f6dbe3" }, pat);
      sv("line", { x1: 0, y1: 0, x2: 0, y2: 6, stroke: COL.removed, "stroke-width": 2.2 }, pat);

      // ---------- token strips (shared token scale)
      var maxTok = Math.max(t.N, t.P + G);
      var sx = function (tok) { return LBL + BAR * tok / maxTok; };
      var y = 22;
      text(LBL, 12, "TOKENS", "fs-cap");
      function strip(label, sub, segs) {
        text(LBL - 12, y + 12, label, "fs-lane", "end");
        if (sub) text(LBL - 12, y + 25, sub, "fs-lane-sub", "end");
        var x = 0;
        segs.forEach(function (s) {
          if (s.n <= 0) return;
          var r = sv("rect", { x: sx(x), y: y, width: Math.max(0.5, sx(x + s.n) - sx(x) - 1), height: 18, rx: 2, fill: s.fill }, svg);
          hover(r, "<b>" + s.name + "</b><br>" + fmtTokFull(s.n) + " tokens" + (s.note ? "<br><span>" + s.note + "</span>" : ""));
          if (sx(x + s.n) - sx(x) > 26) {
            var lt = text((sx(x) + sx(x + s.n)) / 2, y + 13, s.tag, s.dark ? "fs-seg fs-seg-dark" : "fs-seg", "middle");
            lt.style.pointerEvents = "none";
          }
          x += s.n;
        });
        y += 34;
      }
      strip("before the edit", null, [
        { n: t.p, fill: COL.cached, tag: "A", name: "A, before the edit", note: "in the cache from earlier turns" },
        { n: t.del, fill: "url(#fs-hatch)", tag: "B", name: "B, replaced by the edit" },
        { n: t.C, fill: COL.cached, tag: "C", name: "C, unchanged text after the edit", note: "in the cache from earlier turns" }
      ]);
      var lanes = [
        { key: "none", label: "no cache", segs: [
          { n: t.p, fill: COL.prefill, tag: "A", name: "A", note: "processed" },
          { n: t.ins, fill: COL.prefill, tag: "B′", name: "B′, inserted by the edit", note: "processed" },
          { n: t.C, fill: COL.prefill, tag: "C", name: "C", note: "processed" },
          { n: G, fill: COL.gen, tag: "out", dark: true, name: "response", note: "generated" }] },
        { key: "std", label: "prefix caching", sub: "standard serving", segs: [
          { n: t.p, fill: COL.cached, tag: "A", name: "A", note: "reused from the prefix cache" },
          { n: t.ins, fill: COL.prefill, tag: "B′", name: "B′, inserted by the edit", note: "processed" },
          { n: t.C, fill: COL.prefill, tag: "C", name: "C, unchanged but after the edit", note: "processed again: the prefix cache stops at the first changed token" },
          { n: G, fill: COL.gen, tag: "out", dark: true, name: "response", note: "generated" }] },
        { key: "scr", label: "Suffix Cache Reuse", segs: [
          { n: t.p, fill: COL.cached, tag: "A", name: "A", note: "reused from the prefix cache" },
          { n: t.ins, fill: COL.prefill, tag: "B′", name: "B′, inserted by the edit", note: "processed" },
          { n: t.C, fill: COL.reused, tag: "C", dark: true, name: "C, unchanged text after the edit", note: "cache relocated to its new positions instead of recomputed" },
          { n: G, fill: COL.gen, tag: "out", dark: true, name: "response", note: "generated" }] }
      ];
      lanes.forEach(function (l) { strip(l.label, l.sub, l.segs); });

      // legend for strips
      var lx = LBL, ly = y + 2;
      [["in the cache", COL.cached], ["processed", COL.prefill], ["reused by SCR", COL.reused], ["generated", COL.gen], ["replaced", "url(#fs-hatch)"]].forEach(function (g) {
        sv("rect", { x: lx, y: ly, width: 11, height: 11, rx: 2, fill: g[1] }, svg);
        var tt = text(lx + 16, ly + 10, g[0], "fs-leg");
        lx += 16 + tt.getComputedTextLength() + 18;
      });

      // ---------- FLOPs bars (shared FLOPs scale)
      y = ly + 34;
      text(LBL, y, "FLOPS OF THE TURN", "fs-cap");
      y += 10;
      var maxF = t.none.total;
      var fx = function (f) { return LBL + BAR * f / maxF; };
      lanes.forEach(function (l) {
        var c = t[l.key];
        text(LBL - 12, y + 15, l.label, "fs-lane", "end");
        var x = 0;
        OPS.forEach(function (o) {
          var v = c[o.key];
          var r = sv("rect", { x: fx(x), y: y, width: Math.max(0, fx(x + v) - fx(x) - (v > 0 ? 1 : 0)), height: 22, rx: 2, fill: o.color }, svg);
          hover(r, "<b>" + o.label + "</b><br>" + e14(v) + " × 10¹⁴ FLOPs<br><span>" + (100 * v / c.total).toFixed(0) + "% of this turn</span>");
          x += v;
        });
        if (maxF - c.total > maxF * 0.002) {
          var ra = sv("rect", { x: fx(c.total), y: y, width: fx(maxF) - fx(c.total), height: 22, rx: 2, fill: COL.avoided, class: "fs-avoided" }, svg);
          hover(ra, "<b>avoided by caching</b><br>" + e14(maxF - c.total) + " × 10¹⁴ FLOPs");
        }
        var tv = text(LBL + BAR + 10, y + 11, e14(c.total) + " × 10¹⁴", "fs-num");
        text(LBL + BAR + 10, y + 24, l.key === "none" ? "baseline" : (100 * (1 - c.total / maxF)).toFixed(0) + "% avoided", "fs-num-sub");
        y += 32;
      });
      var lx2 = LBL, ly2 = y + 4;
      OPS.concat([{ label: "avoided by caching", color: COL.avoided }]).forEach(function (o) {
        var probe = text(0, -100, o.label, "fs-leg"), w = 16 + probe.getComputedTextLength();
        svg.removeChild(probe);
        if (lx2 + w > W - 4) { lx2 = LBL; ly2 += 18; }
        sv("rect", { x: lx2, y: ly2, width: 11, height: 11, rx: 2, fill: o.color, class: o.key ? "" : "fs-avoided" }, svg);
        text(lx2 + 16, ly2 + 10, o.label, "fs-leg");
        lx2 += w + 16;
      });
      svg.setAttribute("viewBox", "0 0 " + W + " " + (ly2 + 18));

      // ---------- stats line
      var recomputed = t.C;
      var ratio = t.std.total / Math.max(1, t.scr.total);
      var vsApp = t.std.total / t.app.total;
      stats.innerHTML =
        "prompt <b>" + fmtTokFull(t.P) + "</b> tokens · standard serving recomputes <b>" + fmtTokFull(recomputed) + "</b> unchanged tokens" +
        " · standard <b>" + e14(t.std.total) + "</b> vs SCR <b>" + e14(t.scr.total) + "</b> × 10¹⁴" +
        (t.std.total > t.scr.total * 1.0005 ? " (<b>" + ratio.toFixed(1) + "×</b> less)" : "") +
        " · under standard serving, this edit costs <b>" + vsApp.toFixed(1) + "×</b> as much as appending B′ at the end";
    }

    sync();
    window.addEventListener("resize", function () { draw(); });
  }

  function init() { document.querySelectorAll(".flops-sim").forEach(mount); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
