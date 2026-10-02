/* Interactive Prefix Reuse FLOPs figures for the Suffix Cache Reuse post.
 *
 * Markup:  ::: {.flops-sim mode="standard"}  caption  :::   (or mode="scr")
 *
 * The context before the turn is A B C (N tokens). An edit at position p replaces B with B',
 * then the model generates a G-token response. FLOPs use the Qwen3.6-27B constants from the
 * paper's Appendix C: linear layers cost the same per processed token, and the 16
 * full-attention layers add a cost per query-key pair.
 *   mode "standard": the turn with the edit under prefix caching.
 *   mode "scr":      the turn with the edit under prefix caching vs. prefix caching + SCR.
 */
(function () {
  "use strict";

  var PER_TOKEN = 34.23e9 + 11.12e9 + 3.36e9; // MLP + Gated DeltaNet + full-attention projections
  var PER_PAIR = 3.93216e5;                    // full-attention query-key pair
  var G = 500;                                 // response tokens

  var MARK = "#1179b5";   // edit-position marker (light blue triangle), also shown after the slider label
  var COL = { cached: "#d8d3c7", prefill: "#e39bb0", edit: "#c23a63", reused: "#3d9a50", gen: "#0668E1", removed: "#e39bb0" };

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

    var st = { N: 40000, p: 18000, del: 12000, ins: 8000 };   // default (Rulin 2026-10-01): a mid-context rewrite in a 40K context
    var box = el("div", "fs-box");
    node.insertBefore(box, node.firstChild);

    var main = el("div", "fs-main"); box.appendChild(main);
    var left = el("div", "fs-left"), right = el("div", "fs-right");
    main.appendChild(left); main.appendChild(right);

    // Panel titles live in HTML so the two line up at the top of both columns (Rulin 2026-10-01);
    // the strips are then centred in the space left under their title.
    left.appendChild(el("div", "fs-ptitle", "Context edit and cache reuse"));
    var rt = el("div", "fs-ptitle", "Prefix Reuse FLOPs"); right.appendChild(rt);
    rt.appendChild(el("span", "fs-ptitle-unit", "\u00d710\u00b9\u2074"));   // unit on its own small line
    var W = 600, LBL = 128, BAR = W - LBL - 8;
    var swrap = el("div", "fs-strips-wrap"); left.appendChild(swrap);
    var strips = sv("svg", { class: "fs-svg", role: "img", "aria-label": "Tokens of the turn" }, swrap);
    var BW = 250;
    var bars = sv("svg", { class: "fs-svg fs-bars", role: "img", "aria-label": "Prefix Reuse FLOPs of the turn" }, right);
    var tip = el("div", "fs-tip"); box.appendChild(tip);

    var ctl = el("div", "fs-controls"); box.appendChild(ctl);
    var grid = el("div", "fs-grid"); ctl.appendChild(grid);
    var sliders = {};
    function slider(key, label, min, max, step) {
      var w = el("label", "fs-slider");
      var lab = el("span", "fs-lab");
      // colour the segment names like the token strip: B = removed (pink), B′ = inserted (rose)
      lab.innerHTML = label.replace(/^B′/, '<span style="color:' + COL.edit + '">B′</span>').replace(/^B /, '<span style="color:#8a857b">B</span> ');   // B is grey like the before-the-edit lane
      if (key === "p") lab.innerHTML += ' <svg class="fs-mark" width="10" height="8" viewBox="0 0 10 8" aria-hidden="true"><polygon points="0,0 10,0 5,8" fill="' + MARK + '"/></svg>';
      w.appendChild(lab);
      var inp = el("input"); inp.type = "range"; inp.min = min; inp.max = max; inp.step = step;
      var val = el("span", "fs-val");
      inp.addEventListener("input", function () { st[key] = +inp.value; clamp(key); sync(); });
      w.appendChild(inp); w.appendChild(val); grid.appendChild(w);
      sliders[key] = { inp: inp, val: val };
    }
    // order (Rulin 2026-10-01): the edit first, then where it sits, then the context size
    slider("p", "Edit Position", 0, 64000, 250);
    slider("del", "B Length (Removed)", 0, 64000, 250);
    slider("ins", "B′ Length (Inserted)", 0, 64000, 250);   // any length, same range as the others (Rulin 2026-10-01)
    slider("N", "Context Length", 2000, 64000, 500);

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
      // Lanes are to scale (Rulin 2026-10-01): the context before the edit in grey, then the
      // same turn after the edit under prefix caching (and under SCR in the second figure).
      var lanes = [{ label: "before the edit", segs: [
        { n: t.p, fill: COL.cached, tag: "A", name: "A", note: "unchanged prefix" },
        { n: t.del, fill: COL.cached, tag: "B", name: "B", note: "replaced by the edit" },
        { n: t.C, fill: COL.cached, tag: "C", name: "C", note: "unchanged suffix" }] }];
      var out = { n: G, fill: COL.gen, tag: "out", dark: true, name: "response", note: "generated" };
      if (mode === "standard") {
        lanes.push({ label: "after the edit", sub: "prefix caching", segs: [
          { n: t.p, fill: COL.cached, tag: "A", name: "A", note: "reused from the prefix cache" },
          { n: t.ins, fill: COL.edit, tag: "B′", dark: true, name: "B′, written by the edit", note: "prefilled" },
          { n: t.C, fill: COL.prefill, tag: "C", name: "C, unchanged", note: "re-prefilled: the prefix cache stops at the first changed token" }, out] });
      } else {
        lanes.push({ label: "after the edit", sub: "prefix caching", segs: [
          { n: t.p, fill: COL.cached, tag: "A", name: "A", note: "reused from the prefix cache" },
          { n: t.ins, fill: COL.edit, tag: "B′", dark: true, name: "B′, written by the edit", note: "prefilled" },
          { n: t.C, fill: COL.prefill, tag: "C", name: "C, unchanged", note: "re-prefilled: the prefix cache stops at the first changed token" }, out] });
        lanes.push({ label: "+ Suffix Cache Reuse", segs: [
          { n: t.p, fill: COL.cached, tag: "A", name: "A", note: "reused from the prefix cache" },
          { n: t.ins, fill: COL.edit, tag: "B′", dark: true, name: "B′, written by the edit", note: "prefilled" },
          { n: t.C, fill: COL.reused, tag: "C", dark: true, name: "C, unchanged", note: "cache relocated to its new positions instead of recomputed" }, out] });
      }
      var maxTok = Math.max.apply(null, lanes.map(function (l) { return l.segs.reduce(function (a, s) { return a + Math.max(0, s.n); }, 0); }));
      var sx = function (k) { return LBL + BAR * k / maxTok; };
      var y = 14;   // room for the edit-position marker above the first lane
      (function () {
        var mx = sx(t.p);
        var tri = sv("polygon", { points: (mx - 5) + "," + (y - 10) + " " + (mx + 5) + "," + (y - 10) + " " + mx + "," + (y - 2), fill: MARK }, strips);
        hover(tri, "<b>edit position</b> · token " + num(t.p) + "<br><span>the first changed token; the prefix cache matches up to here</span>");
      })();
      lanes.forEach(function (l) {
        text(strips, LBL - 12, y + (l.sub ? 9 : 14), l.label, "fs-lane", "end");
        if (l.sub) text(strips, LBL - 12, y + 21, l.sub, "fs-lane-sub", "end");
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
      var legend = [["prefix cached", COL.cached], ["B′ prefilled", COL.edit], ["C re-prefilled", COL.prefill]];
      if (mode === "scr") legend.push(["reused by SCR", COL.reused]);
      legend.push(["generated", COL.gen]);
      legend.forEach(function (g) {
        sv("rect", { x: lx, y: ly, width: 11, height: 11, rx: 2, fill: g[1] }, strips);
        var tt = text(strips, lx + 15, ly + 10, g[0], "fs-leg");
        lx += 15 + tt.getComputedTextLength() + 11;   // tight enough for five entries at 600px (Rulin 2026-10-01)
      });
      strips.setAttribute("viewBox", "0 0 " + W + " " + (ly + 16));

      // ---------------- FLOPs bars
      while (bars.firstChild) bars.removeChild(bars.firstChild);
      // FLOPs of the edited turn under prefix caching, split by what is processed (top to bottom of the bar).
      function segsOf(t) {
        var segs = [
          { tag: "decode", name: "response, generated", tok: G, lin: PER_TOKEN * G, att: PER_PAIR * (G * t.P + 0.5 * G * G), fill: COL.gen, dark: true },
          { tag: "B′ prefill", name: "B′, written by the edit: prefilled", tok: t.ins, lin: PER_TOKEN * t.ins, att: PER_PAIR * (t.ins * t.p + 0.5 * t.ins * t.ins), fill: COL.edit, dark: true },
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
        var H = 244, top = 48, bot = 40, plotH = H - top - bot, x0 = 40;
        var segs = segsOf(t);
        var tot = segs.reduce(function (a, s) { return a + s.total; }, 0);
        var maxV = tot * 1.18;
        var yv = function (v) { return top + plotH * (1 - v / maxV); };
        // legend like the second figure instead of labels beside the bar (Rulin 2026-10-01)
        [[segs[2].fill, "C re-prefill", 0, 0], [segs[1].fill, "B′ prefill", 1, 0], [segs[0].fill, "decode", 0, 1]].forEach(function (g) {
          var lx = 2 + g[2] * 118, ly = 8 + g[3] * 15;
          sv("rect", { x: lx, y: ly, width: 11, height: 10, rx: 2, fill: g[0] }, bars);
          text(bars, lx + 15, ly + 9, g[1], "fs-leg");
        });
        var step = maxV / 1e14 > 60 ? 20 : maxV / 1e14 > 30 ? 10 : maxV / 1e14 > 12 ? 5 : maxV / 1e14 > 5 ? 2 : maxV / 1e14 > 2.5 ? 1 : 0.5;
        for (var v = 0; v <= maxV / 1e14 + 1e-9; v += step) {
          var yy = yv(v * 1e14);
          sv("line", { x1: x0, x2: BW - 4, y1: yy, y2: yy, class: "fs-grid-line" }, bars);
          text(bars, x0 - 6, yy + 4, (step < 1 ? v.toFixed(1) : String(Math.round(v))), "fs-tick", "end");
        }
        var cx = x0 + (BW - x0) / 2, bw = 60;   // centred now that the side labels are gone
        stackBar(bars, segs, cx, bw, top + plotH, plotH, maxV, false, 1e9);
        text(bars, cx, yv(tot) - 6, e14(tot), "fs-bar-v", "middle");
        text(bars, cx, top + plotH + 16, "prefix caching", "fs-bar-l", "middle");
        var cseg = segs[2];
        text(bars, x0 + (BW - x0) / 2, H - 4, "C re-prefill = " + (100 * cseg.total / tot).toFixed(0) + "% of the turn", "fs-bar-note", "middle");
        bars.setAttribute("viewBox", "0 0 " + BW + " " + H);
      } else {
        // Two stacked bars with the same composition as the first figure; the C re-prefill that
        // Suffix Cache Reuse removes is drawn as a dashed green outline on the SCR bar.
        var H = 258, top = 48, bot = 58, plotH = H - top - bot, x0 = 40;
        var segs = segsOf(t), tot = segs.reduce(function (a, s) { return a + s.total; }, 0);
        var kept = segs.slice(0, 2), ktot = kept[0].total + kept[1].total, cseg = segs[2];
        var maxV = tot * 1.18;
        var yv = function (v) { return top + plotH * (1 - v / maxV); };
        // legend for the bar colors (Rulin 2026-09-30): same encoding as the first figure
        var leg = [[segs[2].fill, "C re-prefill", 0, 0], [segs[1].fill, "B′ prefill", 1, 0], [segs[0].fill, "decode", 0, 1], ["dash", "saved by SCR", 1, 1]];
        leg.forEach(function (g) {
          var lx = 2 + g[2] * 118, ly = 8 + g[3] * 15;
          if (g[0] === "dash") sv("rect", { x: lx, y: ly, width: 11, height: 10, fill: "rgba(61,154,80,0.10)", stroke: COL.reused, "stroke-width": 1.2, "stroke-dasharray": "3 2" }, bars);
          else sv("rect", { x: lx, y: ly, width: 11, height: 10, rx: 2, fill: g[0] }, bars);
          text(bars, lx + 15, ly + 9, g[1], "fs-leg");
        });
        var step = maxV / 1e14 > 60 ? 20 : maxV / 1e14 > 30 ? 10 : maxV / 1e14 > 12 ? 5 : maxV / 1e14 > 5 ? 2 : maxV / 1e14 > 2.5 ? 1 : 0.5;
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
        if (gh > 34) { var g1 = text(bars, c2, ytop - gh / 2 - 2, "saved", "fs-seg-v", "middle"); g1.setAttribute("fill", COL.reused); var g2 = text(bars, c2, ytop - gh / 2 + 11, "by SCR", "fs-seg-v", "middle"); g2.setAttribute("fill", COL.reused); }
        text(bars, c2, ytop - gh - 6, e14(ktot), "fs-bar-v", "middle");   // above the dashed ghost so it never collides with its label
        text(bars, c2, base + 16, "+ SCR", "fs-bar-l", "middle");
        text(bars, x0 + (BW - x0) / 2, H - 8, "SCR: " + (tot / ktot).toFixed(1) + "× fewer FLOPs", "fs-bar-note", "middle");
        bars.setAttribute("viewBox", "0 0 " + BW + " " + H);
      }
    }

    sync();
  }

  function init() { document.querySelectorAll(".flops-sim").forEach(mount); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
