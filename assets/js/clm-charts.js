/* Interactive charts and tab panels for the Context Language Models post.
 *
 * Markup (Pandoc fenced divs in the post):
 *   ::: {.clm-chart chart="pareto"}      -> <div class="clm-chart" data-chart="pareto">
 *   caption paragraph(s)
 *   :::
 *   :::: {.clm-tabs} / ::: {.tab tab="Label"}  -> tabbed panels
 *
 * Chart data lives in /assets/data/clm/<chart>.json, built by _scripts/clm_chart_data.py.
 * Requires Plotly (loaded by the layout when the post sets `plotly: true`).
 */
(function () {
  "use strict";

  var DATA = document.currentScript.src.replace(/js\/clm-charts\.js.*$/, "data/clm/");
  var SANS = 'system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",sans-serif';
  var INK = "#282828", MUTED = "#6f6d68", GRID = "#e9e5dc", AXIS = "#cfc9bc";
  var BLUE = "#0668E1", SKY = "#56B4E9", PINK = "#E39BB0", GOLD = "#D4A017";
  var CONFIG = { displayModeBar: false, responsive: true };
  var CHARTS = {};

  // ------------------------------------------------------------------ helpers
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function axis(o) {
    o = o || {};
    var a = {
      gridcolor: GRID, linecolor: AXIS, showline: true, zeroline: false,
      ticks: "outside", tickcolor: AXIS, ticklen: 4,
      tickfont: { color: MUTED, size: 12 }, automargin: true
    };
    Object.keys(o).forEach(function (k) { a[k] = o[k]; });
    if (typeof a.title === "string") a.title = { text: a.title };
    if (a.title) a.title.font = { size: 13, color: INK };
    return a;
  }

  function layout(o) {
    var base = {
      font: { family: SANS, size: 13, color: INK },
      paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)",
      margin: { l: 64, r: 24, t: 12, b: 56 },
      hovermode: "closest",
      hoverlabel: { font: { family: SANS, size: 12 }, bgcolor: "#fff", bordercolor: AXIS },
      legend: { orientation: "h", x: 0, xanchor: "left", y: 1.02, yanchor: "bottom", font: { size: 12 } },
      showlegend: true
    };
    Object.keys(o || {}).forEach(function (k) { base[k] = o[k]; });
    return base;
  }

  function rgba(hex, a) {
    var n = parseInt(hex.slice(1), 16);
    return "rgba(" + (n >> 16) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + a + ")";
  }

  function seg(parent, label, opts, value, onChange, cls) {
    var wrap = el("div", "seg" + (cls ? " " + cls : ""));
    if (label) wrap.appendChild(el("span", "seg-label", label));
    var btns = {};
    opts.forEach(function (o) {
      var b = el("button", null, o.label);
      b.type = "button";
      b.addEventListener("click", function () { set(o.key); onChange(o.key); });
      btns[o.key] = b;
      wrap.appendChild(b);
    });
    function set(k) {
      Object.keys(btns).forEach(function (x) {
        btns[x].classList.toggle("on", x === String(k));
        btns[x].setAttribute("aria-pressed", x === String(k) ? "true" : "false");
      });
    }
    set(value);
    parent.appendChild(wrap);
    return { set: set, el: wrap };
  }

  function opts(list) { return list.map(function (x) { return { key: x, label: x }; }); }

  function frontier(pts, xk, yk) {
    return pts.filter(function (p) {
      return !pts.some(function (q) {
        return q !== p && q[xk] <= p[xk] && q[yk] >= p[yk] && (q[xk] < p[xk] || q[yk] > p[yk]);
      });
    }).sort(function (a, b) { return a[xk] - b[xk]; });
  }

  function extent(vals, padFrac, minPad) {
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    var pad = Math.max((hi - lo) * padFrac, minPad || 0);
    return [lo - pad, hi + pad];
  }

  // Push end-of-line labels apart vertically (same rule as the paper's long-horizon figure).
  function spread(ends, gap) {
    var s = ends.slice().sort(function (a, b) { return a.y - b.y; });
    s.forEach(function (e, i) { e.ly = i ? Math.max(e.y, s[i - 1].ly + gap) : e.y; });
    return s;
  }

  function onResize(fn) {
    var t;
    window.addEventListener("resize", function () { clearTimeout(t); t = setTimeout(fn, 150); });
  }

  // ------------------------------------------------------------------ ContextBench
  CHARTS.contextbench = function (d, plot) {
    var COL = { "Base": "#A39E93", "RLM": "#E5B85C", "Summary": PINK, "Context folding": "#8CBF9A",
                "Self-Compact": "#9C8FD4", "ACM": "#6FA8B8", "CLM": BLUE };
    var SYM = { "Base": "square", "RLM": "triangle-down", "Summary": "triangle-up", "Context folding": "diamond",
                "Self-Compact": "cross", "ACM": "star", "CLM": "circle" };
    plot.style.height = "620px";
    var traces = [], ann = [];
    var lay = layout({
      grid: { rows: 2, columns: 2, pattern: "independent", xgap: 0.1, ygap: 0.3 },
      margin: { l: 64, r: 16, t: 84, b: 64 },
      legend: { orientation: "h", x: 0.5, xanchor: "center", y: 1.08, yanchor: "bottom", font: { size: 12 } }
    });
    d.tasks.forEach(function (t, i) {
      var k = i ? String(i + 1) : "";
      d.arms.forEach(function (arm) {
        var s = t.series[arm];
        if (!s || !s.x.length) return;
        var clm = arm === "CLM";
        traces.push({
          type: "scatter", mode: "lines+markers", name: clm ? "CLM (ours)" : arm,
          legendgroup: arm, showlegend: i === 0, x: s.x, y: s.y, xaxis: "x" + k, yaxis: "y" + k,
          error_y: { type: "data", array: s.se, thickness: 1, width: 2, color: rgba(COL[arm], 0.6) },
          line: { color: COL[arm], width: clm ? 3 : 1.8 },
          marker: { color: COL[arm], symbol: SYM[arm], size: clm ? 8 : 7 },
          customdata: s.se,
          hovertemplate: "<b>" + arm + "</b> · " + t.title + "<br>pressure %{x:.2g}×<br>accuracy %{y:.0%} ± %{customdata:.0%}<extra></extra>"
        });
      });
      lay["xaxis" + k] = axis({ type: "log", tickvals: t.ticks, ticktext: t.ticks.map(function (v) { return v + "×"; }) });
      lay["yaxis" + k] = axis({ range: [-0.05, 1.08], tickvals: [0, 0.5, 1], tickformat: ".0%", title: i % 2 === 0 ? "Accuracy" : "" });
      ann.push({ text: "<b>" + t.title + "</b>", xref: "x" + k + " domain", yref: "y" + k + " domain",
                 x: 0.5, y: 1.03, xanchor: "center", yanchor: "bottom", showarrow: false, font: { size: 13 } });
    });
    ann.push({ text: "Context pressure (total input ÷ 32K context limit)", xref: "paper", yref: "paper", x: 0.5, y: -0.1,
               xanchor: "center", yanchor: "top", showarrow: false, font: { size: 13 } });
    traces.sort(function (a, b) { return (a.legendgroup === "CLM") - (b.legendgroup === "CLM"); });
    lay.annotations = ann;
    Plotly.react(plot, traces, lay, CONFIG);
  };

  // ------------------------------------------------------------------ Coding + deep research Pareto
  CHARTS.pareto = function (d, plot, controls) {
    var BENCH = [{ key: "BCP", label: "BrowseComp-Plus" }, { key: "TB2.1", label: "TerminalBench 2.1" }, { key: "TBLite", label: "TBLite" }];
    var MODELS = ["Qwen3.5-9B", "Qwen3.6-27B", "Qwen3.8-27B", "Claude 4.5 Haiku", "Claude 4.6 Sonnet", "Claude 4.6 Opus"].filter(function (m) { return d[m]; });
    var st = { bench: "BCP", model: "Qwen3.6-27B" };
    seg(controls, "Benchmark", BENCH, st.bench, function (k) { st.bench = k; draw(); });
    seg(controls, "Model", opts(MODELS), st.model, function (k) { st.model = k; draw(); });
    plot.style.height = "440px";
    var M = { l: 64, r: 24, t: 16, b: 60 };

    function draw() {
      var pts = (d[st.model][st.bench] || []).map(function (p) { return Object.assign({}, p); });
      var api = st.model.indexOf("Claude") === 0;
      var fr = frontier(pts, "cost", "acc");
      var tx = api ? function (v) { return Math.log10(v); } : function (v) { return v; };
      var xr = extent(pts.map(function (p) { return tx(p.cost); }), 0.14, api ? 0.15 : 0.3);
      if (!api) xr[0] = Math.max(0, xr[0]);
      var yr = extent(pts.map(function (p) { return p.acc; }), 0.16, 5);
      yr = [Math.max(0, yr[0]), Math.min(100, yr[1] + 4)];

      // Place labels in pixel space: try below/above/right/left, keep the first that clears
      // every marker and every label placed so far.
      var W = Math.max(200, plot.clientWidth - M.l - M.r), H = 440 - M.t - M.b;
      function px(p) { return [(tx(p.cost) - xr[0]) / (xr[1] - xr[0]) * W, (1 - (p.acc - yr[0]) / (yr[1] - yr[0])) * H]; }
      var boxes = pts.map(function (p) { var c = px(p); return [c[0] - 7, c[1] - 7, c[0] + 7, c[1] + 7]; });
      var ann = [];
      pts.sort(function (a, b) { return (b.arm === "CLM") - (a.arm === "CLM"); }).forEach(function (p) {
        var clm = p.arm === "CLM", label = p.arm + (p.flag === "dagger" ? "†" : "");
        var w = label.length * (clm ? 8.6 : 7.2) + 4, h = clm ? 18 : 16, c = px(p);
        var cand = clm
          ? [[0, -12, "center", "bottom"], [12, 0, "left", "middle"], [-12, 0, "right", "middle"], [0, 12, "center", "top"]]
          : [[0, 11, "center", "top"], [0, -11, "center", "bottom"], [11, 0, "left", "middle"], [-11, 0, "right", "middle"]];
        var pick = cand[0], best = null;
        for (var i = 0; i < cand.length; i++) {
          var o = cand[i], x0 = c[0] + o[0] - (o[2] === "center" ? w / 2 : o[2] === "right" ? w : 0);
          var y0 = c[1] + o[1] - (o[3] === "middle" ? h / 2 : o[3] === "bottom" ? h : 0);
          var b = [x0, y0, x0 + w, y0 + h];
          var clash = b[0] < -30 || b[2] > W + 30 || boxes.some(function (q) { return b[0] < q[2] && b[2] > q[0] && b[1] < q[3] && b[3] > q[1]; });
          if (!clash) { pick = o; best = b; break; }
        }
        if (best) boxes.push(best);
        ann.push({ x: tx(p.cost), y: p.acc, text: clm ? "<b>CLM</b>" : label, showarrow: false,
                   xanchor: pick[2], yanchor: pick[3], xshift: pick[0], yshift: -pick[1],
                   font: { size: clm ? 14 : 12, color: clm ? BLUE : INK } });
      });

      var unit = api ? "USD / question" : "PFLOPs / question";
      var hover = function (p) {
        return "<b>" + p.arm + "</b><br>accuracy " + p.acc.toFixed(1) + "%<br>cost " +
          (api ? "$" + p.cost.toFixed(2) : p.cost.toFixed(2) + " PFLOPs") + " / question" +
          (p.flag === "dagger" ? "<br>(list-price upper bound)" : "") + "<extra></extra>";
      };
      var base = pts.filter(function (p) { return p.arm !== "CLM"; }), clm = pts.filter(function (p) { return p.arm === "CLM"; });
      var traces = [
        { type: "scatter", mode: "lines", x: fr.map(function (p) { return p.cost; }), y: fr.map(function (p) { return p.acc; }),
          line: { color: rgba(BLUE, 0.55), width: 1.5, dash: "dash" }, hoverinfo: "skip", name: "Pareto frontier" },
        { type: "scatter", mode: "markers", x: base.map(function (p) { return p.cost; }), y: base.map(function (p) { return p.acc; }),
          marker: { size: 11, color: "#fff", line: { color: "#333", width: 1.4 } }, name: "Baselines",
          hovertemplate: base.map(hover) },
        { type: "scatter", mode: "markers", x: clm.map(function (p) { return p.cost; }), y: clm.map(function (p) { return p.acc; }),
          marker: { size: 15, color: BLUE }, name: "CLM", hovertemplate: clm.map(hover) }
      ];
      Plotly.react(plot, traces, layout({
        margin: M, showlegend: false, annotations: ann,
        xaxis: axis({ type: api ? "log" : "linear", range: xr, title: api ? "Billed cost (USD / question, log scale)" : "Prefix-reuse PFLOPs / question" }),
        yaxis: axis({ range: yr, title: "Accuracy (%)" })
      }), CONFIG);
    }
    draw();
    onResize(draw);
  };

  // ------------------------------------------------------------------ Math optimization
  CHARTS.open_problems = function (d, plot, controls) {
    var COL = { "OpenEvolve": "#9AA0A6", "OpenEvolve-Agent": "#5F6368", "CLMs (subagents)": SKY, "CLM": BLUE };
    var st = { task: "heilbronn_triangle", zoom: "top" };
    seg(controls, "Problem", d.tasks.map(function (t) { return { key: t.key, label: t.title }; }), st.task, function (k) { st.task = k; draw(); });
    seg(controls, "View", [{ key: "top", label: "Zoom to the top" }, { key: "full", label: "Full range" }], st.zoom, function (k) { st.zoom = k; draw(); });
    plot.style.height = "420px";

    function draw() {
      var t = d.tasks.filter(function (x) { return x.key === st.task; })[0], hb = t.higher_better;
      var traces = [], finals = [];
      d.arms.forEach(function (arm) {
        var s = t.series[arm];
        if (!s) return;
        var x = s.att.map(function (_, i) { return i + 1; }), n = x.length, col = COL[arm];
        finals.push(s.best[n - 1]);
        traces.push({ type: "scatter", mode: "markers", x: x, y: s.att, legendgroup: arm, showlegend: false,
                      marker: { size: 5, color: rgba(col, 0.35) },
                      hovertemplate: "<b>" + arm + "</b><br>attempt %{x}: %{y:.6g}<extra></extra>" });
        traces.push({ type: "scatter", mode: "lines", x: x, y: s.best, legendgroup: arm, name: arm,
                      line: { color: col, width: arm === "CLM" ? 3 : 2.2, shape: "hv" },
                      hovertemplate: "<b>" + arm + "</b><br>best after %{x} attempts: %{y:.6g}<extra></extra>" });
        traces.push({ type: "scatter", mode: "markers", x: [n], y: [s.best[n - 1]], legendgroup: arm, showlegend: false,
                      marker: { size: 11, color: s.wall_stop ? "#fff" : col, line: { color: col, width: 2.5 } },
                      hovertemplate: "<b>" + arm + "</b><br>best of run: %{y:.6g}<br>" +
                        (s.wall_stop ? "stopped at the 5-hour limit" : "used its attempt budget") + "<extra></extra>" });
      });
      var yr = null;
      if (st.zoom === "top") {
        var lo = Math.min.apply(null, finals), hi = Math.max.apply(null, finals), bk = t.best_known;
        var top = hb ? Math.max(hi, bk || hi) : Math.min(lo, bk || lo);
        var span = Math.abs(top - (hb ? lo : hi)) || Math.abs(top) * 0.01;
        yr = hb ? [lo - 0.25 * span, top + 0.15 * span] : [top - 0.15 * span, hi + 0.25 * span];
      }
      Plotly.react(plot, traces, layout({
        xaxis: axis({ range: [0, 104], title: "Scored attempts" }),
        yaxis: axis({ range: yr, autorange: yr ? false : true, title: t.unit + (hb ? " (higher is better)" : " (lower is better)"), tickformat: ".4~g" })
      }), CONFIG);
    }
    draw();
  };

  // ------------------------------------------------------------------ EdgeBench (12 hours)
  CHARTS.edgebench = function (d, plot, controls) {
    var ARMS = ["Base", "Summary", "CLM", "CLMs (subagents)"];
    var COL = { "Base": "#666666", "Summary": PINK, "CLM": BLUE, "CLMs (subagents)": SKY };
    var st = { model: "qwen", x: "h" };
    seg(controls, "Model", [{ key: "qwen", label: "Qwen3.6-27B" }, { key: "sonnet", label: "Claude 4.6 Sonnet" }], st.model,
        function (k) { st.model = k; if (k === "sonnet") { st.x = "h"; xs.set("h"); } draw(); });
    var xs = seg(controls, "x-axis", [{ key: "h", label: "Wall-clock hours" }, { key: "pf", label: "Compute (PFLOPs)" }], st.x,
                 function (k) { st.x = k; draw(); });
    plot.style.height = "420px";

    function draw() {
      xs.el.style.display = st.model === "qwen" ? "" : "none";
      if (st.model !== "qwen") st.x = "h";
      var D = d[st.model], traces = [], ends = [], ys = [];
      ARMS.forEach(function (arm) {
        var s = D[arm], col = COL[arm], x = st.x === "pf" ? s.pf : s.h, n = x.length;
        ys = ys.concat(s.y);
        var ex = arm === "Base" ? x[n - 1] : (st.x === "pf" ? x[n - 1] : 12);
        var label = s.final.toFixed(1) + (s.pf_total != null ? " | " + s.pf_total + " PF" : "");
        traces.push({ type: "scatter", mode: "lines", x: x, y: s.y, name: arm, legendgroup: arm, line: { color: col, width: 3 },
                      hovertemplate: "<b>" + arm + "</b><br>" + (st.x === "pf" ? "%{x:.0f} PFLOPs" : "%{x:.1f} h") + ": %{y:.1f}<extra></extra>" });
        traces.push({ type: "scatter", mode: "markers", x: [ex], y: [s.final], legendgroup: arm, showlegend: false,
                      marker: { size: 10, color: col, line: { color: "#fff", width: 1.5 } },
                      hovertemplate: "<b>" + arm + "</b><br>final score " + s.final.toFixed(1) +
                        (s.pf_total != null ? "<br>" + s.pf_total + " PFLOPs per run" : "") + "<extra></extra>" });
        ends.push({ x: ex, y: s.final, text: label, col: col, arm: arm });
        ys.push(s.final);
      });
      var yr = extent(ys, 0.06, 1);
      var gap = (yr[1] - yr[0]) * 0.075;
      var main = spread(ends.filter(function (e) { return e.arm !== "Base"; }), gap);
      yr[1] = Math.max(yr[1], main[main.length - 1].ly + gap / 2);
      var ann = main.map(function (e) {
        return { x: e.x, y: e.ly, text: e.text, showarrow: false, xanchor: "left", xshift: 10, font: { size: 13, color: e.col } };
      });
      var b = ends.filter(function (e) { return e.arm === "Base"; })[0];
      ann.push({ x: b.x, y: b.y, text: "Base: " + b.text + " (context overflows)", showarrow: false, xanchor: "left", yanchor: "bottom",
                 xshift: 6, yshift: 6, font: { size: 12, color: b.col } });
      var xmax = st.x === "pf" ? Math.max.apply(null, ends.map(function (e) { return e.x; })) * 1.04 : 12.3;
      Plotly.react(plot, traces, layout({
        margin: { l: 64, r: 130, t: 12, b: 56 }, annotations: ann,
        xaxis: axis({ range: [0, xmax], title: st.x === "pf" ? "Cumulative compute (prefix-reuse PFLOPs per run)" : "Wall-clock hours" }),
        yaxis: axis({ range: yr, title: "Best score so far (0–100)" })
      }), CONFIG);
    }
    draw();
  };

  // ------------------------------------------------------------------ Software World (24+ hours)
  CHARTS.software_world = function (d, plot, controls) {
    var ARMS = [["Summary (agent swarm)", "#CF7B9B"], ["CLMs (agent swarm)", "#4C6FCB"]];
    var st = { x: "h" };
    seg(controls, "x-axis", [{ key: "h", label: "Active hours" }, { key: "usd", label: "Cumulative spend (USD)" }], st.x,
        function (k) { st.x = k; draw(); });
    plot.style.height = "380px";

    function draw() {
      var traces = [], ann = [], xmax = 0;
      ARMS.forEach(function (a) {
        var s = d[a[0]], x = s[st.x], n = x.length;
        xmax = Math.max(xmax, x[n - 1]);
        traces.push({ type: "scatter", mode: "lines", x: x, y: s.y, name: a[0], line: { color: a[1], width: 3 },
                      hovertemplate: "<b>" + a[0] + "</b><br>" + (st.x === "h" ? "%{x:.1f} active hours" : "$%{x:.0f}") + "<br>speedup %{y:.3f}×<extra></extra>" });
        traces.push({ type: "scatter", mode: "markers", x: [x[n - 1]], y: [s.y[n - 1]], showlegend: false, hoverinfo: "skip",
                      marker: { size: 10, color: a[1], line: { color: "#fff", width: 1.5 } } });
        ann.push({ x: x[n - 1], y: s.y[n - 1], text: s.y[n - 1].toFixed(3) + "×", showarrow: false, xanchor: "left", xshift: 9,
                   font: { size: 13, color: a[1] } });
      });
      Plotly.react(plot, traces, layout({
        margin: { l: 64, r: 70, t: 12, b: 56 }, annotations: ann,
        xaxis: axis({ range: [0, xmax * 1.03], title: st.x === "h" ? "Active hours" : "Cumulative API spend (USD)" }),
        yaxis: axis({ range: [0.995, 1.05], tickformat: ".2f", ticksuffix: "×", title: "Speedup on held-out packages" })
      }), CONFIG);
    }
    draw();
  };

  // ------------------------------------------------------------------ Steering
  CHARTS.steering = function (d, plot, controls) {
    var GREY = "#8a8a8a", LIGHT = "#8fc1e3";
    var st = { p: "threshold" };
    seg(controls, null, [
      { key: "threshold", label: "“Compact to 4k tokens once you reach Y tokens.”" },
      { key: "boundaries", label: "“Compact at sub-question boundaries.”" },
      { key: "backup", label: "“Back up on disk before you compact.”" }
    ], st.p, function (k) { st.p = k; draw(); }, "quotes");
    plot.style.height = "380px";
    var kfmt = function (v) { return Math.round(v / 1000) + "k"; };

    function draw() {
      var traces, lay;
      if (st.p === "threshold") {
        var P = d.threshold.points, none = d.threshold.no_instruction_median;
        traces = [
          { type: "scatter", mode: "lines", x: [12000, 36000], y: [12000, 36000], line: { color: "rgba(0,0,0,0.12)", width: 10 },
            hoverinfo: "skip", name: "first compaction = Y" },
          { type: "scatter", mode: "lines", x: [12000, 36000], y: [none, none], line: { color: GREY, width: 2, dash: "dash" },
            name: "no instruction (median " + kfmt(none) + ")", hovertemplate: "no instruction: first compaction at " + (none / 1000).toFixed(1) + "k<extra></extra>" },
          { type: "scatter", mode: "lines+markers", name: "instructed (median, 95% CI)",
            x: P.map(function (p) { return p.y; }), y: P.map(function (p) { return p.median; }),
            error_y: { type: "data", symmetric: false, array: P.map(function (p) { return p.hi - p.median; }),
                       arrayminus: P.map(function (p) { return p.median - p.lo; }), color: BLUE, thickness: 1.5, width: 5 },
            line: { color: BLUE, width: 2.5 }, marker: { size: 10, color: BLUE },
            hovertemplate: "instructed at Y = %{x:.3s}<br>first compaction at %{y:.3s} tokens<extra></extra>" }
        ];
        lay = layout({
          xaxis: axis({ range: [12000, 36000], tickvals: [16000, 24000, 32000], ticktext: ["16k", "24k", "32k"], title: "Instructed threshold Y (tokens)" }),
          yaxis: axis({ range: [12000, 42000], tickvals: [16000, 24000, 32000, 40000], ticktext: ["16k", "24k", "32k", "40k"], title: "Context size at first compaction" })
        });
      } else if (st.p === "boundaries") {
        var B = d.boundaries, ann = [];
        traces = [["no instruction", GREY], ["instructed", BLUE]].map(function (a) {
          ann.push({ xref: "paper", yref: "paper", x: 1, y: a[0] === "instructed" ? 0.97 : 0.89, xanchor: "right", showarrow: false,
                     text: a[0] + ": " + B[a[0]].within2.toFixed(2) + " of boundaries compacted within 2 turns", font: { size: 12, color: a[1] } });
          return { type: "scatter", mode: "lines+markers", x: B.k, y: B[a[0]].rate, name: a[0], line: { color: a[1], width: 2.5 },
                   marker: { size: 7, color: a[1] }, hovertemplate: a[0] + "<br>%{x} turns after a boundary: %{y:.2f}<extra></extra>" };
        });
        lay = layout({
          annotations: ann,
          shapes: [{ type: "rect", xref: "x", yref: "paper", x0: -0.5, x1: 2.5, y0: 0, y1: 1, fillcolor: "rgba(0,0,0,0.05)", line: { width: 0 } },
                   { type: "line", xref: "x", yref: "paper", x0: 0, x1: 0, y0: 0, y1: 1, line: { color: "#bbb", width: 1, dash: "dot" } }],
          xaxis: axis({ range: [-4.5, 15.5], dtick: 2, title: "Turns after a sub-question is answered" }),
          yaxis: axis({ range: [0, 0.9], title: "Share of boundaries with a compaction" })
        });
      } else {
        var K = d.backup, cats = ["no instruction", "instructed"];
        traces = [
          { type: "bar", name: "full backup", x: cats, y: cats.map(function (c) { return K[c].full; }), marker: { color: [GREY, BLUE] },
            width: 0.5, hovertemplate: "%{x}: %{y:.0%} of edits had a full backup<extra></extra>",
            text: cats.map(function (c) { return K[c].full ? (100 * K[c].full).toFixed(0) + "%" : "0 of 479 edits"; }),
            textposition: cats.map(function (c) { return K[c].full ? "inside" : "outside"; }), insidetextfont: { color: "#fff", size: 14 } },
          { type: "bar", name: "partial backup", x: cats, y: cats.map(function (c) { return K[c].partial; }), marker: { color: LIGHT },
            width: 0.5, hovertemplate: "%{x}: +%{y:.0%} partial backup<extra></extra>",
            text: cats.map(function (c) { return K[c].partial ? "+" + (100 * K[c].partial).toFixed(0) + "%" : ""; }), textposition: "inside" }
        ];
        lay = layout({
          barmode: "stack",
          xaxis: axis({ showgrid: false }),
          yaxis: axis({ range: [0, 1], tickformat: ".0%", title: "Edits preceded by a backup" })
        });
      }
      Plotly.react(plot, traces, lay, CONFIG);
    }
    draw();
  };

  // ------------------------------------------------------------------ Skill evolution
  CHARTS.selfevo = function (d, plot, controls, node) {
    var SET = {
      assisted: { label: "Assisted: Qwen3.6-27B agent, Claude Fable 5.1 proposer", col: "#1F77B4", x: "Prefix-reuse PFLOPs / task", yr: [-4, 106] },
      self: { label: "Self: Opus 5 proposes for itself", col: "#7B3FA0", x: "USD / task", yr: [89, 101.2] }
    };
    var st = { set: "assisted", fam: "kv", k: null };
    seg(controls, null, [{ key: "assisted", label: SET.assisted.label }, { key: "self", label: SET.self.label }], st.set,
        function (k) { st.set = k; st.k = null; draw(); });
    seg(controls, "Task", ["ndl", "sud", "kv", "log"].map(function (f) { return { key: f, label: d.assisted[f].title }; }), st.fam,
        function (k) { st.fam = k; st.k = null; draw(); });
    var sl = el("label", "chart-slider");
    var txt = el("span"), range = el("input");
    range.type = "range"; range.min = 1; range.step = 1;
    range.addEventListener("input", function () { st.k = +range.value; draw(); });
    sl.appendChild(txt); sl.appendChild(range);
    controls.appendChild(sl);
    plot.style.height = "420px";

    function draw() {
      var S = SET[st.set], F = d[st.set][st.fam], all = F.entered, n = all.length;
      var k = st.k == null ? n : Math.min(st.k, n);
      sl.style.display = n > 1 ? "" : "none";
      range.max = Math.max(1, n); range.value = k;
      txt.textContent = "Frontier skills shown: " + k + " of " + n + " (in the order they were proposed)";
      var shown = all.slice(0, k), start = F.start;
      var pool = shown.concat(start.x != null ? [start] : []);
      var fin = frontier(pool, "x", "y").filter(function (p) { return p !== start; });
      var isFin = function (p) { return fin.indexOf(p) >= 0; };
      var traces = [];
      if (fin.length > 1) traces.push({ type: "scatter", mode: "lines", x: fin.map(function (p) { return p.x; }), y: fin.map(function (p) { return p.y; }),
                                        line: { color: GOLD, width: 1.5, dash: "dash" }, hoverinfo: "skip", name: "final Pareto frontier" });
      traces.push({ type: "scatter", mode: "markers", name: "evolved skill (darker = later)",
                    x: shown.map(function (p) { return p.x; }), y: shown.map(function (p) { return p.y; }),
                    marker: { size: 12, color: shown.map(function (_, i) { return rgba(S.col, 0.3 + 0.7 * (n > 1 ? i / (n - 1) : 1)); }),
                              line: { color: shown.map(function (p) { return isFin(p) ? GOLD : "rgba(0,0,0,0)"; }), width: 2.2 } },
                    customdata: shown.map(function (p) { return p.attempt; }),
                    hovertemplate: "proposal #%{customdata}<br>accuracy %{y:.1f}%<br>cost %{x:.3g}<extra></extra>" });
      if (start.x != null) traces.push({ type: "scatter", mode: "markers+text", x: [start.x], y: [start.y], name: "start (no instruction)",
                                         marker: { size: 14, color: "#fff", line: { color: INK, width: 2 } },
                                         text: ["start"], textposition: "bottom center", textfont: { size: 12, color: INK },
                                         hovertemplate: "start: no instruction<br>accuracy %{y:.1f}%<br>cost %{x:.3g}<extra></extra>" });
      var xs = pool.map(function (p) { return p.x; });
      Plotly.react(plot, traces, layout({
        xaxis: axis({ range: extent(xs, 0.12, 0.02 * Math.max.apply(null, xs)), title: S.x }),
        yaxis: axis({ range: S.yr, title: "Dev-split accuracy (%)" })
      }), CONFIG);
    }
    draw();
  };

  // ------------------------------------------------------------------ RL training curves
  CHARTS.rl = function (d, plot, controls) {
    var STY = {
      "CLM, with efficiency advantage": { col: BLUE, dash: "solid", sym: "circle" },
      "CLM, task reward only": { col: BLUE, dash: "dash", sym: "square" },
      "Summary, with efficiency advantage": { col: "#D9577A", dash: "solid", sym: "circle" },
      "Summary, task reward only": { col: "#D9577A", dash: "dash", sym: "square" }
    };
    var st = { v: "steps" };
    seg(controls, "View", [{ key: "steps", label: "Over training steps" }, { key: "pareto", label: "Accuracy vs. compute" }], st.v,
        function (k) { st.v = k; draw(); });
    plot.style.height = "420px";

    function draw() {
      var traces = [], lay;
      Object.keys(STY).forEach(function (name) {
        var s = d[name], y = STY[name];
        if (!s) return;
        var common = { mode: "lines+markers", legendgroup: name, line: { color: y.col, width: 2.4, dash: y.dash }, marker: { color: y.col, size: 8, symbol: y.sym } };
        if (st.v === "steps") {
          traces.push(Object.assign({ type: "scatter", name: name, x: s.step, y: s.acc, xaxis: "x", yaxis: "y",
                                      hovertemplate: "<b>" + name + "</b><br>step %{x}: %{y:.1f}%<extra></extra>" }, common));
          traces.push(Object.assign({ type: "scatter", name: name, showlegend: false, x: s.step, y: s.pflops, xaxis: "x2", yaxis: "y2",
                                      hovertemplate: "<b>" + name + "</b><br>step %{x}: %{y:.2f} PFLOPs<extra></extra>" }, common));
        } else {
          traces.push(Object.assign({ type: "scatter", name: name, x: s.pflops, y: s.acc, customdata: s.step,
                                      hovertemplate: "<b>" + name + "</b><br>step %{customdata}: %{y:.1f}% at %{x:.2f} PFLOPs<extra></extra>" }, common));
        }
      });
      if (st.v === "steps") {
        lay = layout({
          grid: { rows: 1, columns: 2, pattern: "independent", xgap: 0.14 },
          margin: { l: 64, r: 16, t: 70, b: 56 },
          legend: { orientation: "h", x: 0, y: 1.14, yanchor: "bottom", font: { size: 12 } },
          xaxis: axis({ title: "Training step", dtick: 20 }), yaxis: axis({ title: "BrowseComp-Plus accuracy (%)", range: [0, 52] }),
          xaxis2: axis({ title: "Training step", dtick: 20 }), yaxis2: axis({ title: "PFLOPs / question", range: [0, 4.4] })
        });
      } else {
        lay = layout({
          margin: { l: 64, r: 16, t: 70, b: 56 },
          legend: { orientation: "h", x: 0, y: 1.14, yanchor: "bottom", font: { size: 12 } },
          annotations: [{ xref: "paper", yref: "paper", x: 0.02, y: 0.98, xanchor: "left", showarrow: false, text: "↖ better", font: { size: 12, color: MUTED } }],
          xaxis: axis({ title: "PFLOPs / question", range: [0, 4.4] }), yaxis: axis({ title: "BrowseComp-Plus accuracy (%)", range: [0, 52] })
        });
      }
      Plotly.react(plot, traces, lay, CONFIG);
    }
    draw();
  };

  // ------------------------------------------------------------------ Suffix Cache Reuse
  CHARTS.scr = function (d, plot, controls) {
    var A = ["Standard SGLang", "Suffix Cache Reuse"];
    var st = { pop: "all" };
    seg(controls, "Prompt tokens on", [{ key: "all", label: "all turns" }, { key: "edited", label: "turns right after a context edit" }], st.pop,
        function (k) { st.pop = k; draw(); });
    plot.style.height = "340px";

    function draw() {
      var short = { "Standard SGLang": "Standard", "Suffix Cache Reuse": "SCR" };
      var cats = A.map(function (a) { return short[a] + "<br><span style='color:" + MUTED + "'>" + d[a].acc.toFixed(1) + "% acc.</span>"; });
      var totals = A.map(function (a) { return d[a].total_pflops; });
      var shares = [["hit", "prefix-cache hit", "#d6d2c8"], ["reused", "reused by Suffix Cache Reuse", "#3d9a50"], ["prefilled", "prefilled", PINK]];
      var rows = A.slice().reverse();
      var traces = [
        { type: "bar", x: cats, y: A.map(function (a) { return d[a].prefill_pflops; }), name: "prefill", xaxis: "x", yaxis: "y",
          marker: { color: ["#9a9a9a", BLUE] }, width: 0.55, showlegend: false, hovertemplate: "prefill: %{y:.2f} PFLOPs / question<extra></extra>" },
        { type: "bar", x: cats, y: A.map(function (a) { return d[a].decode_pflops; }), name: "decode", xaxis: "x", yaxis: "y",
          marker: { color: ["#d3d3d3", "#9cc3f5"] }, width: 0.55, showlegend: false, hovertemplate: "decode: %{y:.2f} PFLOPs / question<extra></extra>" }
      ].concat(shares.map(function (s) {
        return { type: "bar", orientation: "h", name: s[1], xaxis: "x2", yaxis: "y2", y: rows,
                 x: rows.map(function (a) { return d[a][st.pop][s[0]]; }), marker: { color: s[2] },
                 text: rows.map(function (a) { var v = d[a][st.pop][s[0]]; return v ? v.toFixed(1) + "%" : ""; }),
                 textposition: "inside", insidetextanchor: "middle", textangle: 0, textfont: { size: 12 },
                 hovertemplate: "%{y}<br>" + s[1] + ": %{x:.1f}%<extra></extra>" };
      }));
      Plotly.react(plot, traces, layout({
        barmode: "stack",
        margin: { l: 64, r: 16, t: 44, b: 56 },
        legend: { orientation: "h", x: 0.36, y: 1.04, yanchor: "bottom", traceorder: "normal", font: { size: 12 } },
        annotations: totals.map(function (v, i) {
          return { x: cats[i], y: v, xref: "x", yref: "y", text: "<b>" + v.toFixed(2) + "</b>", showarrow: false, yanchor: "bottom", yshift: 2 };
        }),
        xaxis: axis({ domain: [0, 0.26], showgrid: false, tickangle: 0, tickfont: { size: 12, color: INK } }),
        yaxis: axis({ title: "PFLOPs / question", range: [0, 12.5] }),
        xaxis2: axis({ domain: [0.44, 1], range: [0, 100], ticksuffix: "%", title: "Share of prompt tokens" }),
        yaxis2: axis({ anchor: "x2", showgrid: false, tickfont: { size: 12, color: INK } })
      }), CONFIG);
    }
    draw();
  };

  // ------------------------------------------------------------------ tabs + mounting
  function mountTabs(node) {
    var panes = Array.prototype.filter.call(node.children, function (c) { return c.classList.contains("tab"); });
    if (!panes.length) return;
    var bar = el("div", "chart-controls");
    node.insertBefore(bar, node.firstChild);
    node.classList.add("ready");
    function show(i) { panes.forEach(function (p, j) { p.classList.toggle("on", j === +i); }); }
    seg(bar, null, panes.map(function (p, i) { return { key: String(i), label: p.getAttribute("data-tab") || "Tab " + (i + 1) }; }), "0", show);
    show(0);
  }

  function mountChart(node) {
    var name = node.getAttribute("data-chart");
    if (!CHARTS[name]) return;
    var controls = el("div", "chart-controls"), plot = el("div", "chart-plot");
    Array.prototype.forEach.call(node.children, function (c) { if (c.tagName === "P") c.classList.add("chart-caption"); });
    node.insertBefore(plot, node.firstChild);
    node.insertBefore(controls, plot);
    if (!window.Plotly) { plot.textContent = "Interactive chart unavailable (Plotly failed to load)."; return; }
    fetch(DATA + name + ".json")
      .then(function (r) { return r.json(); })
      .then(function (data) { CHARTS[name](data, plot, controls, node); })
      .catch(function (e) { plot.textContent = "Could not load chart data for “" + name + "”."; console.error(e); });
  }

  function init() {
    document.querySelectorAll(".clm-tabs").forEach(mountTabs);
    document.querySelectorAll(".clm-chart[data-chart]").forEach(mountChart);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
