/* Interactive charts and tab panels for the TMax v1.1 post.
 *
 * Markup (Pandoc fenced divs in the post):
 *   ::: {.tmax-chart chart="datasets"}   -> <div class="tmax-chart" data-chart="datasets">
 *   caption paragraph(s)
 *   :::
 *   :::: {.tmax-tabs} / ::: {.tab tab="Label"}  -> tabbed panels
 *
 * All numbers live in /assets/data/tmax-v11/results.json.
 * Requires Plotly (loaded by the layout when the post sets `plotly: true`).
 */
(function () {
  "use strict";

  var DATA_URL = document.currentScript.src.replace(/js\/tmax-v11-charts\.js.*$/, "data/tmax-v11/results.json");
  var SANS = 'system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",sans-serif';
  var INK = "#282828", MUTED = "#6f6d68", GRID = "#e9e5dc", AXIS = "#cfc9bc";
  var TMAX = "#B85C38", PEACH = "#EDB79E", BASE = "#BDB8AD", PRIOR = "#D9D4CA", PURPLE = "#7B4FC9", GREEN = "#6A9F58";
  var CONFIG = { displayModeBar: false, responsive: true };
  var CHARTS = {};
  var data = null;

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

  function seg(parent, label, opts, value, onChange) {
    var wrap = el("div", "seg");
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

  function median(xs) {
    var s = xs.slice().sort(function (a, b) { return a - b; }), m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  function onResize(fn) {
    var t;
    window.addEventListener("resize", function () { clearTimeout(t); t = setTimeout(fn, 150); });
  }

  // Grouped vertical bars on a numeric axis, so each value label can sit just above its error bar.
  // series: [{ name, y: [per group], se?: [per group], color, strong? }]
  function groupedBars(plot, groups, series, o) {
    o = o || {};
    var n = series.length, w = 0.8 / n, ymax = 0, ann = (o.annotations || []).slice();
    var traces = series.map(function (s, si) {
      var x = groups.map(function (_, g) { return g + (si - (n - 1) / 2) * w; });
      s.y.forEach(function (v, g) {
        var top = v + (s.se ? s.se[g] : 0);
        ymax = Math.max(ymax, top);
        ann.push({ x: x[g], y: top, yanchor: "bottom", yshift: 2, showarrow: false, text: v.toFixed(1),
                   font: { size: 12, color: s.strong ? s.color : MUTED } });
      });
      return {
        type: "bar", name: s.name, x: x, y: s.y, width: w * 0.92, marker: { color: s.color },
        error_y: s.se ? { type: "data", array: s.se, thickness: 1, width: 3, color: "rgba(0,0,0,0.35)" } : undefined,
        customdata: groups.map(function (gr, g) { return [o.hoverGroups ? o.hoverGroups[g] : gr, s.se ? s.se[g] : null]; }),
        hovertemplate: "<b>" + s.name + "</b><br>%{customdata[0]}: %{y:.1f}" + (s.se ? " ± %{customdata[1]:.1f}" : "") + "<extra></extra>"
      };
    });
    Plotly.react(plot, traces, layout({
      annotations: ann,
      margin: o.margin || { l: 64, r: 16, t: 12, b: 40 },
      legend: o.legend || layout().legend,
      xaxis: axis({ showgrid: false, tickvals: groups.map(function (_, g) { return g; }), ticktext: groups,
                    range: [-0.5, groups.length - 0.5], ticks: "", tickfont: { size: 13, color: INK } }),
      yaxis: axis({ range: [0, ymax * (o.headroom || 1.15)], title: o.yTitle || "Accuracy (%)" })
    }), CONFIG);
  }

  // ------------------------------------------------------------------ Model sizes: base vs. v1.0 vs. v1.1
  CHARTS.sizes = function (d, plot, controls) {
    var S = d.sizes, st = { b: "TB 2.0" };
    seg(controls, "Benchmark", opts(Object.keys(S.benchmarks)), st.b, function (k) { st.b = k; draw(); });
    plot.style.height = "400px";

    function draw() {
      var B = S.benchmarks[st.b];
      var groups = S.labels.map(function (l, i) { return "<b>" + l + "</b><br><span style='color:" + MUTED + ";font-size:11px'>" + S.base_names[i] + "</span>"; });
      var series = [{ name: "Base model (no RL)", y: B.base, se: B.base_se, color: BASE }];
      if (B.v10) series.push({ name: "TMax v1.0 (June)", y: B.v10, color: PEACH });
      series.push({ name: "TMax v1.1", y: B.v11, se: B.v11_se, color: TMAX, strong: true });
      groupedBars(plot, groups, series, {
        yTitle: st.b + " accuracy (%)", headroom: 1.3, hoverGroups: S.base_names.map(function (b) { return b + " · " + st.b; }),
        margin: { l: 64, r: 16, t: 40, b: 56 },
        legend: { orientation: "h", x: 0, xanchor: "left", y: 1.12, yanchor: "bottom", font: { size: 12 } },
        annotations: [{ xref: "paper", yref: "paper", x: 0, y: 1, xanchor: "left", yanchor: "top", showarrow: false, align: "left",
                        text: B.note + (B.v10 ? "" : "<br>v1.0 used a different sandbox backend for this benchmark, so it is not shown"),
                        font: { size: 11.5, color: MUTED } }]
      });
    }
    draw();
  };

  // ------------------------------------------------------------------ Generalization: other tasks and other harnesses (9B)
  CHARTS.generalization = function (d, plot) {
    var rows = d.generalization.rows, GAP = 0.6;
    var pos = [], p = 0;
    rows.forEach(function (r, i) {
      if (i && r.group !== rows[i - 1].group) p += GAP;
      pos.push(p++);
    });
    plot.style.height = "280px";

    function dots(key, name, color) {
      return {
        type: "scatter", mode: "markers", name: name, y: pos, x: rows.map(function (r) { return r[key][0]; }),
        marker: { color: color, size: 12, line: { color: "#fff", width: 1.5 } },
        customdata: rows.map(function (r) { return [r.label, r[key][1]]; }),
        hovertemplate: "<b>" + name + "</b><br>%{customdata[0]}: %{x:.1f} ± %{customdata[1]:.1f}<extra></extra>"
      };
    }
    var link = { type: "scatter", mode: "lines", showlegend: false, hoverinfo: "skip", line: { color: AXIS, width: 3 }, x: [], y: [] };
    rows.forEach(function (r, i) { link.x.push(r.base[0], r.tmax[0], null); link.y.push(pos[i], pos[i], null); });
    var ann = rows.map(function (r, i) {
      return { x: r.tmax[0], y: pos[i], xanchor: "left", xshift: 10, showarrow: false,
               text: "+" + (r.tmax[0] - r.base[0]).toFixed(1), font: { size: 12, color: TMAX } };
    });
    Plotly.react(plot, [link, dots("base", "Qwen3.5-9B", BASE), dots("tmax", "TMax-v1.1-9B", TMAX)], layout({
      annotations: ann,
      margin: { l: 16, r: 36, t: 30, b: 48 },
      legend: { orientation: "h", x: 0, xanchor: "left", y: 1.02, yanchor: "bottom", font: { size: 12 } },
      xaxis: axis({ range: [20, 100], dtick: 20, title: "Accuracy (%)" }),
      yaxis: axis({ showgrid: false, showline: false, ticks: "", tickvals: pos, ticktext: rows.map(function (r) { return r.label; }),
                    range: [p - 1 + 0.6, -0.6], tickfont: { size: 12.5, color: INK } })
    }), CONFIG);
  };

  // ------------------------------------------------------------------ RL dataset comparison (Qwen3.5-9B)
  CHARTS.datasets = function (d, plot, controls) {
    var D = d.datasets;
    var COL = { prior: PRIOR, ours: TMAX, prerepair: PEACH, selfgen: PURPLE };
    var st = { b: "TB Lite", view: "score", show: "all" };
    seg(controls, "Benchmark", opts(["TB Lite", "TB 2.1"]), st.b, function (k) { st.b = k; draw(); });
    seg(controls, "Show", [{ key: "all", label: "All" }, { key: "main", label: "Prior datasets vs. ours" }], st.show,
        function (k) { st.show = k; draw(); });
    seg(controls, "Plot", [{ key: "score", label: "Score" }, { key: "gain", label: "Gain over base" }], st.view,
        function (k) { st.view = k; draw(); });

    function draw() {
      var rows = D.rows.filter(function (r) { return st.show === "all" || r.kind === "prior" || r.kind === "ours"; });
      rows = rows.slice().sort(function (a, b) { return a[st.b][0] - b[st.b][0] || (a.kind === "prior") - (b.kind === "prior"); });
      var base = D.base[st.b][0], gain = st.view === "gain";
      var x = rows.map(function (r) { return gain ? r[st.b][0] - base : r[st.b][0]; });
      var names = rows.map(function (r) { return r.kind === "prior" ? r.name : "<b>" + r.name + "</b>"; });
      var height = Math.max(360, 30 * rows.length + 90);
      plot.style.height = height + "px";
      var se = rows.map(function (r) { return r[st.b][1]; });
      var traces = [{
        type: "bar", orientation: "h", y: names, x: x, showlegend: false,
        marker: { color: rows.map(function (r) { return COL[r.kind]; }) },
        error_x: { type: "data", array: se, thickness: 1, width: 3, color: "rgba(0,0,0,0.3)" },
        customdata: rows.map(function (r) { return [r.name, r[st.b][0], r[st.b][1], r[st.b][0] - base]; }),
        hovertemplate: "<b>%{customdata[0]}</b><br>" + st.b + ": %{customdata[1]:.1f} ± %{customdata[2]:.1f}" +
          "<br>vs. base: %{customdata[3]:+.1f}<extra></extra>"
      }];
      var hi = Math.max.apply(null, x.map(function (v, i) { return v + se[i]; }).concat([gain ? 0 : base]));
      var lo = Math.min.apply(null, x.map(function (v, i) { return v - se[i]; }).concat([0]));
      var shapes = [], ann = rows.map(function (r, i) {
        var neg = x[i] < 0;
        return { x: x[i] + (neg ? -se[i] : se[i]), y: names[i], xanchor: neg ? "right" : "left", xshift: neg ? -4 : 4, showarrow: false,
                 text: (gain && x[i] > 0 ? "+" : "") + x[i].toFixed(1),
                 font: { size: 12, color: r.kind === "prior" ? MUTED : COL[r.kind] } };
      });
      if (!gain) {
        shapes.push({ type: "line", xref: "x", yref: "paper", x0: base, x1: base, y0: 0, y1: 1, line: { color: INK, width: 1.2, dash: "dash" } });
        ann.push({ xref: "x", yref: "paper", x: base, y: 1, xanchor: "center", yanchor: "bottom", showarrow: false,
                   text: D.base.name + ": " + base.toFixed(1), font: { size: 11.5, color: INK } });
      } else {
        shapes.push({ type: "line", xref: "x", yref: "paper", x0: 0, x1: 0, y0: 0, y1: 1, line: { color: INK, width: 1 } });
      }
      Plotly.react(plot, traces, layout({
        height: height, margin: { l: 16, r: 40, t: 26, b: 48 }, bargap: 0.3, shapes: shapes, annotations: ann,
        xaxis: axis({ range: [lo < 0 ? lo - 0.12 * (hi - lo) : 0, hi + 0.1 * (hi - lo)],
                      title: gain ? "Gain over Qwen3.5-9B (points, " + st.b + ")" : st.b + " accuracy (%) after RL on each dataset" }),
        yaxis: axis({ showgrid: false, tickfont: { size: 12.5, color: INK } })
      }), CONFIG);
    }
    draw();
    onResize(draw);
  };

  // ------------------------------------------------------------------ Audit labels and what happened to each task
  CHARTS.audit = function (d, plot) {
    var A = d.audit, rows = A.labels.slice().sort(function (a, b) { return a.count - b.count; });
    var y = rows.map(function (r) { return r.label; });
    var parts = [["repaired", "Repaired", TMAX], ["kept", "Kept as is", GREEN], ["dropped", "Dropped", BASE]];
    plot.style.height = "340px";
    var traces = parts.map(function (p) {
      return {
        type: "bar", orientation: "h", name: p[1], y: y, x: rows.map(function (r) { return r[p[0]]; }),
        marker: { color: p[2] },
        hovertemplate: "%{y}<br>" + p[1].toLowerCase() + ": %{x:,}<extra></extra>"
      };
    });
    var ann = rows.map(function (r) {
      return { x: r.count, y: r.label, xanchor: "left", xshift: 6, showarrow: false,
               text: r.count.toLocaleString("en-US") + " <span style='color:" + MUTED + "'>(" + (100 * r.count / A.total).toFixed(1) + "%)</span>",
               font: { size: 12, color: INK } };
    });
    Plotly.react(plot, traces, layout({
      barmode: "stack", bargap: 0.3, annotations: ann,
      margin: { l: 16, r: 110, t: 36, b: 48 },
      legend: { orientation: "h", x: 0, xanchor: "left", y: 1.04, yanchor: "bottom", traceorder: "normal", font: { size: 12 } },
      xaxis: axis({ range: [0, 12000], tickformat: ",", title: "Tasks (of " + A.total.toLocaleString("en-US") + " in TMax-15k)" }),
      yaxis: axis({ showgrid: false, tickfont: { size: 12.5, color: INK } })
    }), CONFIG);
  };

  // ------------------------------------------------------------------ Repair ablation
  CHARTS.repair = function (d, plot) {
    var D = d.datasets, by = {};
    D.rows.forEach(function (r) { by[r.kind] = r; });
    var cats = ["TB Lite", "TB 2.1"];
    plot.style.height = "340px";
    groupedBars(plot, cats, [
      { name: "Qwen3.5-9B (no RL)", y: cats.map(function (b) { return D.base[b][0]; }), se: cats.map(function (b) { return D.base[b][1]; }), color: BASE },
      { name: "+ RL on TMax-15k, before repair", y: cats.map(function (b) { return by.prerepair[b][0]; }), se: cats.map(function (b) { return by.prerepair[b][1]; }), color: PEACH },
      { name: "+ RL on TMax-v1.1-13k, after repair", y: cats.map(function (b) { return by.ours[b][0]; }), se: cats.map(function (b) { return by.ours[b][1]; }), color: TMAX, strong: true }
    ]);
  };

  // ------------------------------------------------------------------ Self-generated data
  CHARTS.selfgen = function (d, plot) {
    var D = d.datasets, by = {};
    D.rows.forEach(function (r) { by[r.kind] = r; });
    var prior = D.rows.filter(function (r) { return r.kind === "prior"; });
    var cats = ["TB Lite", "TB 2.1"];
    plot.style.height = "340px";
    groupedBars(plot, cats, [
      { name: "Qwen3.5-9B (no RL)", y: cats.map(function (b) { return D.base[b][0]; }), color: BASE },
      { name: "Median of " + prior.length + " prior datasets", y: cats.map(function (b) { return median(prior.map(function (r) { return r[b][0]; })); }), color: PRIOR },
      { name: "Self-generated by Qwen3.5-9B (3.1k)", y: cats.map(function (b) { return by.selfgen[b][0]; }), se: cats.map(function (b) { return by.selfgen[b][1]; }), color: PURPLE, strong: true },
      { name: "TMax-v1.1-13k (Gemini-3-Pro + GPT-5.6 Sol)", y: cats.map(function (b) { return by.ours[b][0]; }), se: cats.map(function (b) { return by.ours[b][1]; }), color: TMAX, strong: true }
    ]);
  };

  // ------------------------------------------------------------------ Toy: two rollouts in one group run the same commands; one loses its sandbox
  CHARTS.twinrollouts = function (d, plot, controls) {
    var T = d.twinrollouts, out = T.outcomes, st = { mode: "zero" };
    var END = { pass: ["Hidden tests pass", 1], infra: ["Sandbox lost while the tests ran", 0] };
    var count = function (k) { return out.filter(function (o) { return o === k; }).length; };
    var fmt = function (a) { var r = Math.round(a * 100) / 100; return (r > 0 ? "+" : r < 0 ? "−" : "") + Math.abs(r).toFixed(2); };
    seg(controls, "Sandbox failures are", [{ key: "zero", label: "Scored as 0 (v1.0)" }, { key: "mask", label: "Masked (v1.1)" }], st.mode,
        function (k) { st.mode = k; draw(); });
    plot.classList.add("tr-plot");

    function draw() {
      var mask = st.mode === "mask";
      var valid = out.filter(function (o) { return !(mask && o === "infra"); });
      var mean = valid.filter(function (o) { return o === "pass"; }).length / valid.length;
      var adv = T.pair.map(function (i) { return mask && out[i] === "infra" ? null : (out[i] === "pass" ? 1 : 0) - mean; });
      var live = adv.filter(function (a) { return a !== null; });
      var net = live.reduce(function (s, a) { return s + a; }, 0);

      plot.textContent = "";
      plot.appendChild(el("p", "tr-note", "Two rollouts from a group of " + out.length + " (" + count("pass") + " passed, " + count("fail") + " failed, " +
        count("infra") + " lost their sandbox). Group mean over " + (mask ? "the " + valid.length + " valid" : "all " + out.length) + " rollouts = " + mean.toFixed(2) + "."));

      var cols = el("div", "tr-cols");
      T.pair.forEach(function (i, k) {
        var a = adv[k], col = el("div", "tr-col " + (a === null ? "masked" : a >= 0 ? "up" : "down"));
        col.appendChild(el("div", "tr-head", "Rollout " + (i + 1)));
        var cmds = el("ol", "tr-cmds");
        T.commands.forEach(function (c) { cmds.appendChild(el("li", null, c)); });
        col.appendChild(cmds);
        var end = el("div", "tr-end " + out[i]);
        end.appendChild(el("span", null, END[out[i]][0]));
        end.appendChild(el("b", null, "reward " + END[out[i]][1]));
        col.appendChild(end);
        col.appendChild(el("div", "tr-adv", a === null ? "Masked: no gradient" : "Advantage " + fmt(a) + " on every command"));
        cols.appendChild(col);
      });
      plot.appendChild(cols);

      var sum = live.map(function (a, j) { return j ? (a < 0 ? " − " : " + ") + Math.abs(a).toFixed(2) : fmt(a); }).join("") + (live.length > 1 ? " = " + fmt(net) : "");
      var p = el("p", "tr-net");
      p.appendChild(el("span", null, "Net push on these " + T.commands.length + " commands: "));
      p.appendChild(el("b", null, sum));
      p.appendChild(el("span", null, mask ? ". Rollout " + (T.pair[1] + 1) + " drops out, so the commands that solved the task are reinforced."
                                          : ". The commands that solved the task get no reinforcement."));
      plot.appendChild(p);
    }
    draw();
  };

  // ------------------------------------------------------------------ 1,000-step run on the sandbox fleet
  CHARTS.stability = function (d, plot, controls) {
    var S = d.stability, st = { m: "reward" };
    var M = {
      reward: { label: "Training solve rate", y: "Fraction of rollouts solved", range: [0.3, 1], fmt: ".3f" },
      entropy: { label: "Entropy", y: "Mean token entropy", range: [0, 0.6], fmt: ".3f" },
      mismatch: { label: "Logprob mismatch", y: "Mean |vLLM − learner| logprob", range: [0, 0.025], fmt: ".4f" },
      gradnorm: { label: "Gradient norm", y: "Gradient norm", range: [0, 0.1], fmt: ".4f" }
    };
    seg(controls, "Metric", Object.keys(M).map(function (k) { return { key: k, label: M[k].label }; }), st.m, function (k) { st.m = k; draw(); });
    plot.style.height = "340px";

    function smooth(ys, half) {
      return ys.map(function (_, i) {
        var lo = Math.max(0, i - half), hi = Math.min(ys.length, i + half + 1), s = 0;
        for (var j = lo; j < hi; j++) s += ys[j];
        return s / (hi - lo);
      });
    }

    function draw() {
      var ys = S[st.m], m = M[st.m];
      var x = ys.map(function (_, i) { return S.start + i; });
      Plotly.react(plot, [
        { type: "scatter", mode: "lines", x: x, y: ys, name: "Per step", line: { color: "rgba(237,183,158,0.5)", width: 0.8 }, hoverinfo: "skip" },
        { type: "scatter", mode: "lines", x: x, y: smooth(ys, 25), name: "50-step average", line: { color: TMAX, width: 2.5 },
          hovertemplate: "Step %{x}<br>" + m.label + ": %{y:" + m.fmt + "}<extra></extra>" }
      ], layout({
        hovermode: "x",
        margin: { l: 64, r: 16, t: 36, b: 48 },
        legend: { orientation: "h", x: 1, xanchor: "right", y: 1.02, yanchor: "bottom", font: { size: 12 } },
        xaxis: axis({ range: [0, x[x.length - 1] + 1], title: "Training step" }),
        yaxis: axis({ range: m.range, title: m.y })
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

  function mountChart(node, load) {
    var name = node.getAttribute("data-chart");
    if (!CHARTS[name]) return;
    var controls = el("div", "chart-controls"), plot = el("div", "chart-plot");
    Array.prototype.forEach.call(node.children, function (c) { if (c.tagName === "P") c.classList.add("chart-caption"); });
    node.insertBefore(plot, node.firstChild);
    node.insertBefore(controls, plot);
    if (!window.Plotly) { plot.textContent = "Interactive chart unavailable (Plotly failed to load)."; return; }
    load.then(function (d) { CHARTS[name](d, plot, controls, node); })
      .catch(function (e) { plot.textContent = "Could not load chart data for “" + name + "”."; console.error(e); });
  }

  function init() {
    document.querySelectorAll(".tmax-tabs").forEach(mountTabs);
    var charts = document.querySelectorAll(".tmax-chart[data-chart]");
    if (!charts.length) return;
    var load = data ? Promise.resolve(data) : fetch(DATA_URL).then(function (r) { return r.json(); }).then(function (d) { data = d; return d; });
    charts.forEach(function (n) { mountChart(n, load); });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
