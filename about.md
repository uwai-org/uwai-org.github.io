---
layout: page
title: About
subtitle: Open agentic research.
description: About WAI, a student-led organization from the University of Washington CS / NLP group.
permalink: /about/
---

WAI is a student-led organization formed by PhD students in the University of
Washington CS / NLP group. We work on agentic research across the full stack:
data, training, and evaluation.

AI has advanced faster than the understanding of it. Knowledge of how agents
are built — what data they learn from, how they are trained, how they are
judged — sits inside a few labs. We think it should be public.

So we do three things. We do research on agents. We open-source what we build —
data, code, and systems. And we host tutorials and seminars on what is
happening at the frontier. Science is better when it is shared, and we publish
code, write-ups, and findings as we go.

## Our story

WAI started on a walk. A few of us were talking about how the field was
at a fork in the road: frontier labs publish less and less, and academia drifts
further from where the systems are actually built. Meanwhile more people than
ever want to understand and use them. The gap between what is known and what is
shared keeps growing. We bridge that gap by building and sharing frontier AI
agents.

## Organizers

<ul class="people" data-shuffle>
  <li><a href="https://oseyincs.io/about/">Junjie Oscar Yin</a></li>
  <li><a href="https://rulinshao.github.io/">Rulin Shao</a></li>
  <li>Steven Gao</li>
</ul>

## Advisors

<ul class="people" data-shuffle>
  <li><a href="https://homes.cs.washington.edu/~lsz/">Luke Zettlemoyer</a></li>
  <li><a href="https://hannaneh.ai/">Hanna Hajishirzi</a></li>
  <li><a href="https://koh.pw/">Pang Wei Koh</a></li>
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

WAI incubates open-source projects led by its members.

- **TMax** — an open recipe for state-of-the-art terminal agents.
- **Humanity Last System** — a one-line description of what it does.
- **Project Three** — a one-line description of what it does.

## Get in touch

Interested in collaborating or contributing? Reach out at
[wai.org.research@gmail.com](mailto:wai.org.research@gmail.com) or follow us on
[Twitter](https://x.com/waiorg).
