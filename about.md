---
layout: page
title: About
subtitle: A student-led organization incubating open-source AI projects and research.
description: About WAI, a student-led organization from the University of Washington CS NLP group.
permalink: /about/
---

WAI is a student-led organization formed by PhD students in the University of
Washington CS NLP group. Our mission is to make AI research and tools accessible
to everyone by incubating open-source projects, datasets, and systems, and by
sharing our work openly.

We conduct research, build open-source software, and support early-stage
projects that grow out of the lab. We believe science is better when it is
shared, and we publish code, write-ups, and findings as we go.

## Our story

WAI grew out of informal collaborations between PhD students in the UW CS NLP
group. *(Placeholder: a short paragraph on how the group started, its goals, and
what it is becoming. Replace this with the real story.)*

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

WAI incubates open-source projects led by its members. *(Placeholder list —
replace with real projects and links.)*

- **Project One** — a one-line description of what it does.
- **Project Two** — a one-line description of what it does.
- **Project Three** — a one-line description of what it does.

## Get in touch

Interested in collaborating or contributing? *(Placeholder: add an email,
GitHub org link, or contact form here.)*
