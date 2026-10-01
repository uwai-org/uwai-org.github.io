/* Interactive Prefix Reuse FLOPs figures for the Suffix Cache Reuse post.
 *
 * Markup:  ::: {.flops-sim mode="standard"}  caption  :::   (or mode="scr")
 *
 * The context before the turn is A B C (N tokens). An edit at position p replaces B with B',
 * then the model generates a G-token response. FLOPs use the Qwen3.6-27B constants from the
 * paper's Appendix C: linear layers cost the same per processed token, and the 16
 * full-attention layers add a cost per query-key pair.
 *   mode "standard": the turn with the edit, with no cache vs. under prefix caching.
 *   mode "scr":      the turn with the edit under prefix caching vs. prefix caching + SCR.
 */
(function () {
  "use strict";

  var PER_TOKEN = 34.23e9 + 11.12e9 + 3.36e9; // MLP + Gated DeltaNet + full-attention projections
  var PER_PAIR = 3.93216e5;                    // full-attention query-key pair
  var G = 500;                                 // response tokens

  var COL = { cached: "#d8d3c7", prefill: "#e39bb0", reused: "#3d9a50", gen: "#0668E1", removed: "#e39bb0" };

  var PRESETS = [
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
  function num(x) { return Math.round(x).toLocaleString("en-US"); }
  function e14(x) { return (x / 1e14).toFixed(2); }

  // FLOPs of one turn: `proc` prompt tokens processed with `pairs` query-key pairs, on a prompt
  // of P tokens, followed by G generated tokens.
  function flops(proc, pairs, P) {
    var lin = PER_TOKEN * (proc + G);
    var att = PER_PAIR * (pairs + G * P + 0.5 * G * G);
    return { lin: lin, att: att, total: lin + att, proc: proc };
  }
  function model(st) {
    var N = st.N, p = st.p, del = st.del, ins = st.ins, C = N - p - del, P = p + ins + C;
    return {
      N: N, p: p, del: del, ins: ins, C: C, P: P,
      none: flops(P, 0.5 * P * P, P),
      std: flops(P - p, 0.5 * (P * P - p * p), P),
      scr: flops(ins, ins * p + 0.5 * ins * ins, P)
          };
  }

  function mount(node) {
    var mode = node.getAttribute("data-mode") === "scr" ? "scr" : "standard";
    Array.prototype.forEach.call(node.children, function (c) { if (c.tagName === "P") c.classList.add("chart-caption"); });

    var st = { N: 20000, p: 10000, del: 1000, ins: 1000 };
    var box = el("div", "fs-box");
    node.insertBefore(box, node.firstChild);

    var main = el("div", "fs-main"); box.appendChild(main);
    var left = el("div", "fs-left"), right = el("div", "fs-right");
    main.appendChild(left); main.appendChild(right);

    var W = 600, LBL = 128, BAR = W - LBL - 8;
    var strips = sv("svg", { class: "fs-svg", role: "img", "aria-label": "Tokens of the turn" }, left);
    var BW = 250;
    var bars = sv("svg", { class: "fs-svg fs-bars", role: "img", "aria-label": "Prefix Reuse FLOPs of the turn" }, right);
    var stats = el("div", "fs-stats"); left.appendChild(stats);
    var tip = el("div", "fs-tip"); box.appendChild(tip);

    var ctl = el("div", "fs-controls"); box.appendChild(ctl);
    var row = el("div", "fs-row"); ctl.appendChild(row);
    row.appendChild(el("span", "fs-lab", "Examples"));
    var pbtn = {};
    PRESETS.forEach(function (pr) {
      var b = el("button", "fs-pill", pr.label); b.type = "button";
      b.addEventListener("click", function () { Object.keys(pr.st).forEach(function (k) { st[k] = pr.st[k]; }); sync(); });
      pbtn[pr.key] = b; row.appendChild(b);
    });
    var grid = el("div", "fs-grid"); ctl.appendChild(grid);
    var sliders = {};
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
        if (changed === "p") st.del = st.N - st.p;
        else if (changed === "del") st.p = Math.max(0, st.N - st.del);
        else st.del = Math.max(0, st.N - st.p);
      }
    }
    function sync() {
      sliders.p.inp.max = st.N; sliders.del.inp.max = st.N;
      Object.keys(sliders).forEach(function (k) {
        sliders[k].inp.value = st[k];
        sliders[k].val.textContent = (k === "p" ? "token " : "") + num(st[k]) + (k === "p" ? "" : " tokens");
      });
      PRESETS.forEach(function (pr) {
        pbtn[pr.key].classList.toggle("on", Object.keys(pr.st).every(function (x) { return pr.st[x] === st[x]; }));
      });
      draw();
    }

    function hover(n, html) {
      n.addEventListener("mousemove", function (e) {
        tip.innerHTML = html; tip.style.display = "block";
        var r = box.getBoundingClientRect(), x = e.clientX - r.left + 14, y = e.clientY - r.top + 14;
        if (x + 250 > r.width) x = e.clientX - r.left - 260;
        tip.style.left = x + "px"; tip.style.top = y + "px";
      });
      n.addEventListener("mouseleave", function () { tip.style.display = "none"; });
    }
    function text(svg, x, y, s, cls, anchor) {
      var t = sv("text", { x: x, y: y, class: cls || "", "text-anchor": anchor || "start" }, svg);
      t.textContent = s; return t;
    }

    function draw() {
      var t = model(st);
      // ---------------- token strips
      while (strips.firstChild) strips.removeChild(strips.firstChild);
      var defs = sv("defs", {}, strips);
      var pat = sv("pattern", { id: "fs-hatch-" + mode, width: 6, height: 6, patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)" }, defs);
      sv("rect", { width: 6, height: 6, fill: "#f6dbe3" }, pat);
      sv("line", { x1: 0, y1: 0, x2: 0, y2: 6, stroke: COL.removed, "stroke-width": 2.2 }, pat);
      var hatch = "url(#fs-hatch-" + mode + ")";

      var lanes = [{ label: "before the edit", segs: [
        { n: t.p, fill: COL.cached, tag: "A", name: "A", note: "cached from earlier turns" },
        { n: t.del, fill: hatch, tag: "B", name: "B", note: "replaced by the edit" },
        { n: t.C, fill: COL.cached, tag: "C", name: "C", note: "cached from earlier turns" }] }];
      var out = { n: G, fill: COL.gen, tag: "out", dark: true, name: "response", note: "generated" };
      if (mode === "standard") {
        lanes.push({ label: "after the edit", sub: "prefix caching", segs: [
          { n: t.p, fill: COL.cached, tag: "A", name: "A", note: "reused from the prefix cache" },
          { n: t.ins, fill: COL.prefill, tag: "B′", name: "B′, written by the edit", note: "processed" },
          { n: t.C, fill: COL.prefill, tag: "C", name: "C, unchanged", note: "processed again: the prefix cache stops at the first changed token" }, out] });
      } else {
        lanes.push({ label: "prefix caching", segs: [
          { n: t.p, fill: COL.cached, tag: "A", name: "A", note: "reused from the prefix cache" },
          { n: t.ins, fill: COL.prefill, tag: "B′", name: "B′, written by the edit", note: "processed" },
          { n: t.C, fill: COL.prefill, tag: "C", name: "C, unchanged", note: "processed again: the prefix cache stops at the first changed token" }, out] });
        lanes.push({ label: "+ Suffix Cache Reuse", segs: [
          { n: t.p, fill: COL.cached, tag: "A", name: "A", note: "reused from the prefix cache" },
          { n: t.ins, fill: COL.prefill, tag: "B′", name: "B′, written by the edit", note: "processed" },
          { n: t.C, fill: COL.reused, tag: "C", dark: true, name: "C, unchanged", note: "cache relocated to its new positions instead of recomputed" }, out] });
      }
      var maxTok = Math.max.apply(null, lanes.map(function (l) { return l.segs.reduce(function (a, s) { return a + Math.max(0, s.n); }, 0); }));
      var sx = function (k) { return LBL + BAR * k / maxTok; };
      var y = 4;
      text(strips, LBL, y + 8, "TOKENS OF THE TURN", "fs-cap");
      y += 18;
      lanes.forEach(function (l) {
        text(strips, LBL - 12, y + 13, l.label, "fs-lane", "end");
        if (l.sub) text(strips, LBL - 12, y + 26, l.sub, "fs-lane-sub", "end");
        var x = 0;
        l.segs.forEach(function (s) {
          if (s.n <= 0) return;
          var r = sv("rect", { x: sx(x), y: y, width: Math.max(0.6, sx(x + s.n) - sx(x) - 1), height: 20, rx: 2, fill: s.fill }, strips);
          hover(r, "<b>" + s.name + "</b> · " + num(s.n) + " tokens<br><span>" + s.note + "</span>");
          if (sx(x + s.n) - sx(x) > 24) {
            var lt = text(strips, (sx(x) + sx(x + s.n)) / 2, y + 14, s.tag, s.dark ? "fs-seg fs-seg-dark" : "fs-seg", "middle");
            lt.style.pointerEvents = "none";
          }
          x += s.n;
        });
        y += 36;
      });
      var lx = LBL, ly = y;
      var legend = [["cached", COL.cached], ["processed", COL.prefill]];
      if (mode === "scr") legend.push(["reused by SCR", COL.reused]);
      legend.push(["generated", COL.gen], ["replaced", hatch]);
      legend.forEach(function (g) {
        sv("rect", { x: lx, y: ly, width: 11, height: 11, rx: 2, fill: g[1] }, strips);
        var tt = text(strips, lx + 16, ly + 10, g[0], "fs-leg");
        lx += 16 + tt.getComputedTextLength() + 16;
      });
      strips.setAttribute("viewBox", "0 0 " + W + " " + (ly + 16));

      // ---------------- FLOPs bars
      while (bars.firstChild) bars.removeChild(bars.firstChild);
      // FLOPs of the edited turn under prefix caching, split by what is processed (top to bottom of the bar).
      function segsOf(t) {
        var segs = [
          { tag: "decode", name: "response, generated", tok: G, lin: PER_TOKEN * G, att: PER_PAIR * (G * t.P + 0.5 * G * G), fill: COL.gen, dark: true },
          { tag: "B′ prefill", name: "B′, written by the edit: prefilled", tok: t.ins, lin: PER_TOKEN * t.ins, att: PER_PAIR * (t.ins * t.p + 0.5 * t.ins * t.ins), fill: "#c23a63", dark: true },
          { tag: "C re-prefill", name: "C, unchanged: prefilled again", tok: t.C, lin: PER_TOKEN * t.C, att: PER_PAIR * 0.5 * (t.P * t.P - (t.p + t.ins) * (t.p + t.ins)), fill: COL.prefill }
        ];
        segs.forEach(function (s) { s.total = s.lin + s.att; });
        return segs;
      }
      function stackBar(svg, segs, cx, bw, baseY, plotH, maxV, labels, lastLabelY) {
        var y = baseY, tot = segs.reduce(function (a, s) { return a + s.total; }, 0);
        segs.slice().reverse().forEach(function (s) {
          var h = plotH * s.total / maxV; y -= h;
          var r = sv("rect", { x: cx - bw / 2, y: y, width: bw, height: Math.max(h, 0.5), fill: s.fill }, svg);
          hover(r, "<b>" + s.name + "</b> · " + e14(s.total) + " × 10¹⁴ FLOPs (" + (100 * s.total / tot).toFixed(0) + "% of the bar)<br><span>" +
            num(s.tok) + " tokens · linear layers " + e14(s.lin) + " · attention " + e14(s.att) + "</span>");
          var pct = (100 * s.total / tot).toFixed(0) + "%";
          if (h > 15) { var tv = text(svg, cx, y + h / 2 + 4, pct, "fs-seg-v", "middle"); if (s.dark) tv.setAttribute("fill", "#fff"); }
          if (labels) { var ly = Math.min(y + h / 2 + 4, lastLabelY - 13); lastLabelY = ly; text(svg, cx + bw / 2 + 8, ly, s.tag + (h > 15 ? "" : " " + pct), "fs-bar-l", "start"); }
        });
        return y;
      }
      if (mode === "standard") {
        // One bar: the composition of the turn's Prefix Reuse FLOPs under prefix caching
        // (Rulin 2026-09-30): B' prefill vs the re-prefill of the unchanged C, plus decode.
        var H = 230, top = 34, bot = 40, plotH = H - top - bot, x0 = 40;
        var segs = segsOf(t);
        var tot = segs.reduce(function (a, s) { return a + s.total; }, 0);
        var maxV = tot * 1.18;
        var yv = function (v) { return top + plotH * (1 - v / maxV); };
        text(bars, 0, 12, "PREFIX REUSE FLOPS (×10¹⁴)", "fs-cap");
        var step = maxV / 1e14 > 12 ? 5 : maxV / 1e14 > 5 ? 2 : maxV / 1e14 > 2.5 ? 1 : 0.5;
        for (var v = 0; v <= maxV / 1e14 + 1e-9; v += step) {
          var yy = yv(v * 1e14);
          sv("line", { x1: x0, x2: BW - 4, y1: yy, y2: yy, class: "fs-grid-line" }, bars);
          text(bars, x0 - 6, yy + 4, (step < 1 ? v.toFixed(1) : String(Math.round(v))), "fs-tick", "end");
        }
        text(bars, BW - 4, 27, "no cache " + e14(t.none.total), "fs-ref-t", "end");
        var cx = x0 + 62, bw = 60;
        stackBar(bars, segs, cx, bw, top + plotH, plotH, maxV, true, 1e9);
        text(bars, cx, yv(tot) - 6, e14(tot), "fs-bar-v", "middle");
        text(bars, cx, top + plotH + 16, "prefix caching", "fs-bar-l", "middle");
        var cseg = segs[2];
        text(bars, x0 + (BW - x0) / 2, H - 4, "C re-prefill = " + (100 * cseg.total / tot).toFixed(0) + "% of the turn", "fs-bar-note", "middle");
        bars.setAttribute("viewBox", "0 0 " + BW + " " + H);
      } else {
        // Two stacked bars with the same composition as the first figure; the C re-prefill that
        // Suffix Cache Reuse removes is drawn as a dashed green outline on the SCR bar.
        var H = 230, top = 34, bot = 40, plotH = H - top - bot, x0 = 40;
        var segs = segsOf(t), tot = segs.reduce(function (a, s) { return a + s.total; }, 0);
        var kept = segs.slice(0, 2), ktot = kept[0].total + kept[1].total, cseg = segs[2];
        var maxV = tot * 1.18;
        var yv = function (v) { return top + plotH * (1 - v / maxV); };
        text(bars, 0, 12, "PREFIX REUSE FLOPS (×10¹⁴)", "fs-cap");
        text(bars, BW - 4, 27, "no cache " + e14(t.none.total), "fs-ref-t", "end");
        var step = maxV / 1e14 > 12 ? 5 : maxV / 1e14 > 5 ? 2 : maxV / 1e14 > 2.5 ? 1 : 0.5;
        for (var v = 0; v <= maxV / 1e14 + 1e-9; v += step) {
          var yy = yv(v * 1e14);
          sv("line", { x1: x0, x2: BW - 4, y1: yy, y2: yy, class: "fs-grid-line" }, bars);
          text(bars, x0 - 6, yy + 4, (step < 1 ? v.toFixed(1) : String(Math.round(v))), "fs-tick", "end");
        }
        var colW = (BW - x0 - 8) / 2, bw = 54, c1 = x0 + colW * 0.5, c2 = x0 + colW * 1.5, base = top + plotH;
        stackBar(bars, segs, c1, bw, base, plotH, maxV, false, 1e9);
        text(bars, c1, yv(tot) - 6, e14(tot), "fs-bar-v", "middle");
        text(bars, c1, base + 16, "prefix caching", "fs-bar-l", "middle");
        var ytop = stackBar(bars, kept, c2, bw, base, plotH, maxV, false, 1e9);
        var gh = plotH * cseg.total / maxV;
        var ghost = sv("rect", { x: c2 - bw / 2, y: ytop - gh, width: bw, height: gh, fill: "rgba(61,154,80,0.10)", stroke: COL.reused, "stroke-width": 1.4, "stroke-dasharray": "4 3" }, bars);
        hover(ghost, "<b>saved by Suffix Cache Reuse</b> · " + e14(cseg.total) + " × 10¹⁴ FLOPs<br><span>the re-prefill of " + num(t.C) + " unchanged tokens; their cache is relocated instead</span>");
        if (gh > 28) { var g1 = text(bars, c2, ytop - gh / 2 - 2, "saved", "fs-seg-v", "middle"); g1.setAttribute("fill", COL.reused); var g2 = text(bars, c2, ytop - gh / 2 + 11, "by SCR", "fs-seg-v", "middle"); g2.setAttribute("fill", COL.reused); }
        text(bars, c2, ytop - 6, e14(ktot), "fs-bar-v", "middle");
        text(bars, c2, base + 16, "+ SCR", "fs-bar-l", "middle");
        text(bars, x0 + (BW - x0) / 2, H - 4, "SCR: " + (tot / ktot).toFixed(1) + "× fewer FLOPs", "fs-bar-note", "middle");
        bars.setAttribute("viewBox", "0 0 " + BW + " " + H);
      }
      stats.innerHTML = mode === "standard"
        ? "prompt <b>" + num(t.P) + "</b> tokens · the edit makes the server process <b>" + num(t.C) + "</b> unchanged tokens again"
        : "SCR reuses the cache of <b>" + num(t.C) + "</b> unchanged tokens and processes only B′ (<b>" + num(t.ins) + "</b> tokens)";
    }

    sync();
  }

  function init() { document.querySelectorAll(".flops-sim").forEach(mount); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
