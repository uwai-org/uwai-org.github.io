---
title: "Welcome to the WAI blog"
subtitle: "What we're building, and how this blog works"
author: WAI
date: 2026-05-11
math: true
description: An introduction to WAI and a tour of the blog's formatting features.
---

This is the first post on the WAI blog. We started WAI to incubate open-source
projects and research coming out of the University of Washington CS NLP
group,^[WAI is run entirely by PhD students. If you'd like to get involved,
reach out — we're always looking for collaborators.] and this blog is where
we'll share what we learn along the way.

This post doubles as a quick tour of how posts are written and rendered, so you
can see the features available to you before writing your own.

## Sidenotes

The signature feature of this theme is Tufte-style sidenotes. Any Markdown
footnote becomes a numbered note in the margin on wide screens, and collapses
inline on narrow screens.^[Like this one. Sidenotes are great for citations,
asides, and definitions that would otherwise interrupt the flow of the main
text.] They keep references close to where they're mentioned without breaking
your reading.

You can also cite work inline the same way.^[Vaswani, A. et al. "Attention Is
All You Need." *NeurIPS*, 2017.] Write a footnote and it becomes a margin note
automatically.

## Math

Inline math works with single dollar signs: the loss is $\mathcal{L}(\theta)$.
Display math is rendered with KaTeX:

$$
\mathcal{L}(\theta) = -\frac{1}{N} \sum_{i=1}^{N} \log p_\theta(y_i \mid x_i)
$$

Set `math: true` in a post's front matter to load KaTeX on that page.

## Code

Code blocks are styled for readability, with inline `code` too:

```python
def softmax(x):
    x = x - x.max(axis=-1, keepdims=True)
    e = np.exp(x)
    return e / e.sum(axis=-1, keepdims=True)
```

## Lists and quotes

- Open-source projects and tools
- Research write-ups and notes
- Project updates from the lab

> We believe science is better when it is shared.

## Writing your own post

Add a Markdown file to `_posts/` named `YYYY-MM-DD-title.md`, include the front
matter above, and push to `main`. GitHub Actions builds the site with Pandoc and
deploys it. That's it.
