/* Teaser figure for the Suffix Cache Reuse post.
 *
 * Markup:  ::: {.scr-teaser}  caption  :::
 *
 * The context before an edit (A B C, all cached) and after the edit replaces B with a shorter
 * B′: A is reused as a prefix, only B′ is prefilled, and the cache of C moves to its new
 * positions. Drawn in CSS pixels at the figure's width, so text keeps its size on phones.
 */
(function () {
  "use strict";

  var BLUE = { fill: "#bcd8ee", ink: "#1179b5", text: "#1d4f7a" };
  var PINK = { fill: "#f4c8d6", ink: "#c23962", text: "#8a2347" };
  var LEN = { A: 300, B: 260, Bp: 110, C: 330 };
  var NS = "http://www.w3.org/2000/svg";

  function sv(tag, attrs, parent) {
    var n = document.createElementNS(NS, tag);
    Object.keys(attrs).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    if (parent) parent.appendChild(n);
    return n;
  }
  function text(parent, x, y, s, cls, anchor) {
    var t = sv("text", { x: x, y: y, class: cls, "text-anchor": anchor || "middle" }, parent);
    t.textContent = s;
    return t;
  }

  // Band from the span `up` = [x0, x1] at y = yb on the upper row to `down` at y = yt below.
  function band(parent, up, down, yb, yt, color, opacity) {
    var ym = (yb + yt) / 2;
    var d = "M" + up[0] + "," + yb +
      " C" + up[0] + "," + ym + " " + down[0] + "," + ym + " " + down[0] + "," + yt +
      " L" + down[1] + "," + yt +
      " C" + down[1] + "," + ym + " " + up[1] + "," + ym + " " + up[1] + "," + yb + " Z";
    sv("path", { d: d, fill: color, opacity: opacity }, parent);
  }

  function block(parent, x0, x1, y, h, c, letter) {
    sv("rect", { x: x0 + 1.5, y: y, width: x1 - x0 - 3, height: h, rx: 4, fill: c.fill,
      stroke: c.ink, "stroke-opacity": 0.55, "stroke-width": 1.2 }, parent);
    text(parent, (x0 + x1) / 2, y + h / 2 + 6, letter, "st-letter").setAttribute("fill", c.text);
  }

  // Bracket under [x0, x1] with a centered label, split over two lines if it does not fit.
  function bracket(parent, x0, x1, y, s, c) {
    var a = x0 + 2, b = x1 - 2;
    sv("path", { d: "M" + a + "," + (y - 5) + " V" + y + " H" + b + " V" + (y - 5),
      fill: "none", stroke: c.ink, "stroke-width": 1.5 }, parent);
    var t = text(parent, (a + b) / 2, y + 16, s, "st-lab");
    t.setAttribute("fill", c.ink);
    if (t.getComputedTextLength() <= b - a + 12) return 1;
    var words = s.split(" "), cut = Math.ceil(words.length / 2);
    t.textContent = "";
    [words.slice(0, cut).join(" "), words.slice(cut).join(" ")].forEach(function (line, i) {
      sv("tspan", { x: (a + b) / 2, dy: i ? "1.25em" : 0 }, t).textContent = line;
    });
    return 2;
  }

  function draw(svg) {
    var W = Math.floor(svg.getBoundingClientRect().width);
    if (!W) return;
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    var narrow = W < 520;
    svg.classList.toggle("narrow", narrow);

    var labW = narrow ? 44 : 108, x0 = labW + 12;
    var k = (W - x0 - 1) / (LEN.A + LEN.B + LEN.C);
    var bh = narrow ? 34 : 40, gap = narrow ? 58 : 70;
    var y1 = 2, y2 = y1 + bh + gap, yb = y1 + bh;
    var xB = x0 + LEN.A * k, xC = xB + LEN.B * k, xE = xC + LEN.C * k;
    var xC2 = xB + LEN.Bp * k, xE2 = xC2 + LEN.C * k;

    band(svg, [x0 + 1.5, xB - 1.5], [x0 + 1.5, xB - 1.5], yb, y2, BLUE.fill, 0.45);
    band(svg, [xB + 1.5, xC - 1.5], [xB + 1.5, xC2 - 1.5], yb, y2, PINK.fill, 0.6);
    band(svg, [xC + 1.5, xE - 1.5], [xC2 + 1.5, xE2 - 1.5], yb, y2, BLUE.fill, 0.45);
    var ym = (yb + y2) / 2 + 4;
    text(svg, (2 * xB + xC + xC2) / 4, ym, "rewritten", "st-band").setAttribute("fill", PINK.ink);
    text(svg, (xC + xE + xC2 + xE2) / 4, ym, narrow ? "cache moved" : "cache moved to new positions", "st-band").setAttribute("fill", BLUE.ink);

    block(svg, x0, xB, y1, bh, BLUE, "A");
    block(svg, xB, xC, y1, bh, BLUE, "B");
    block(svg, xC, xE, y1, bh, BLUE, "C");
    block(svg, x0, xB, y2, bh, BLUE, "A");
    block(svg, xB, xC2, y2, bh, PINK, "B′");
    block(svg, xC2, xE2, y2, bh, BLUE, "C");

    text(svg, labW, y1 + bh / 2 + 5, narrow ? "before" : "before the edit", "st-row", "end");
    text(svg, labW, y2 + bh / 2 + 5, narrow ? "after" : "after the edit", "st-row", "end");

    var yl = y2 + bh + 11;
    var lines = Math.max(
      bracket(svg, x0, xB, yl, "prefix cache reused", BLUE),
      bracket(svg, xB, xC2, yl, "prefill", PINK),
      bracket(svg, xC2, xE2, yl, "suffix cache reused", BLUE));
    var H = Math.ceil(yl + 20 + (lines - 1) * 16);
    svg.setAttribute("viewBox", "0 0 " + W + " " + H);
    svg.setAttribute("height", H);
  }

  function mount(node) {
    Array.prototype.forEach.call(node.children, function (c) { if (c.tagName === "P") c.classList.add("st-caption"); });
    var box = document.createElement("div");
    box.className = "st-box";
    node.insertBefore(box, node.firstChild);
    var svg = sv("svg", { class: "st-svg", role: "img", "aria-label":
      "Before the edit, the context A B C is cached. After the edit replaces B with a shorter B′, " +
      "the cache of A is reused as a prefix, only B′ is prefilled, and the cache of C moves to its new positions." }, box);
    draw(svg);
    var last = box.clientWidth, timer;
    window.addEventListener("resize", function () {
      clearTimeout(timer);
      timer = setTimeout(function () {
        if (box.clientWidth !== last) { last = box.clientWidth; draw(svg); }
      }, 100);
    });
  }

  function init() { document.querySelectorAll(".scr-teaser").forEach(mount); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
