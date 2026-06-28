---
layout: page
title: About
subtitle: Open agentic research.
description: About WAI, a research organization formed by NLP / ML / System PhDs from the University of Washington.
permalink: /about/
---

WAI is a research organization formed by NLP / ML / System PhD students from the University of Washington. We work on agentic research across the full stack:
data, training, and evaluation.

AI has advanced faster than the understanding of it. Knowledge of how agents
are built — what data they learn from, how they are trained, how they are
judged — is largely closed source. We think the science behind them should be open.

So we do three things. We do research on agents. We open-source what we build: data, code, and systems. And we host tutorials and seminars on what is
happening at the frontier. Science is better when it is shared, and we publish
write-ups and findings as we go.

## Our story

WAI started on a walk. A few of us were talking about how the field was
at a fork in the road: frontier labs publish less and less, and academia drifts
further from where the systems are actually built. Meanwhile more people than
ever want to understand and use them. The gap between what is known and what is
shared keeps growing. At WAI, we bridge that gap by building AI
agents and openly sharing how we do it.

## Organizers

<ul class="people" data-shuffle>
  <li><a href="https://ivison.id.au/">Hamish Ivison</a></li>
  <li><a href="https://oseyincs.io/about/">Junjie Oscar Yin</a></li>
  <li><a href="https://rulinshao.github.io/">Rulin Shao</a></li>
  <li>Steven Gao</li>
</ul>

## Advisors

<ul class="people" data-shuffle>
  <li><a href="https://homes.cs.washington.edu/~lsz/">Luke Zettlemoyer</a></li>
  <li><a href="https://hannaneh.ai/">Hanna Hajishirzi</a></li>
  <li><a href="https://koh.pw/">Pang Wei Koh</a></li>
  <li><a href="https://natolambert.com/">Nathan Lambert</a></li>
</ul>

<script>
  (function () {
    function shuffle(list) {
      var items = Array.prototype.slice.call(list.children);
      for (var i = items.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var tmp = items[i];
        items[i] = items[j];
        items[j] = tmp;
      }
      items.forEach(function (item) { list.appendChild(item); });
    }
    document.querySelectorAll('ul.people[data-shuffle]').forEach(shuffle);
  })();
</script>

## Projects

### [TMax](/blog/tmax/) — an open recipe for state-of-the-art terminal agents.

**Team:** Hamish Ivison\*, Junjie Oscar Yin\*, Rulin Shao, Teng Xiao, Nathan Lambert, Hannaneh Hajishirzi

<!-- - **Humanity Last System** — a one-line description of what it does. -->
<!-- - **Project Three** — a one-line description of what it does. -->

## Get in touch

Interested in collaborating or contributing? Reach out at
[wai.org.research@gmail.com](mailto:wai.org.research@gmail.com) or follow us on
Twitter [@waiorg](https://x.com/waiorg).
