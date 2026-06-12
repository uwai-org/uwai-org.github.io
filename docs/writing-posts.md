# Writing blog posts

Internal guide to writing and formatting posts. This folder is excluded from
the Jekyll build, so nothing here is published.

## Creating a post

Add a Markdown file to `_posts/` named `YYYY-MM-DD-title.md` with front matter:

```markdown
---
title: "Your post title"
subtitle: "Optional subtitle"
author: Your Name
date: 2026-05-11
math: true   # only if the post uses math
description: One-line description used for SEO / link previews.
---

Your content...
```

Push to `main`. GitHub Actions builds the site with Pandoc and deploys it.
That's it.

## Formatting features

Posts are rendered with Pandoc using a Tufte-style theme. The features below
are available in any post.

### Sidenotes

The signature feature of the theme. Any Markdown footnote becomes a numbered
note in the margin on wide screens, and collapses inline on narrow screens.
Sidenotes are great for citations, asides, and definitions that would otherwise
interrupt the flow of the main text.

```markdown
Regular footnote syntax works.[^note]

[^note]: This becomes a margin note.

Inline footnotes work too.^[This also becomes a margin note.]
```

Citations work the same way:

```markdown
You can cite work inline.^[Vaswani, A. et al. "Attention Is All You Need."
*NeurIPS*, 2017.]
```

### Math

Set `math: true` in the front matter to load KaTeX on that page. Then:

- Inline math with single dollar signs: `$\mathcal{L}(\theta)$`
- Display math with double dollar signs:

```markdown
$$
\mathcal{L}(\theta) = -\frac{1}{N} \sum_{i=1}^{N} \log p_\theta(y_i \mid x_i)
$$
```

### Code

Fenced code blocks with a language tag are styled for readability, and inline
`code` uses backticks as usual:

````markdown
```python
def softmax(x):
    x = x - x.max(axis=-1, keepdims=True)
    e = np.exp(x)
    return e / e.sum(axis=-1, keepdims=True)
```
````

### Headings and table of contents

`##` and `###` headings are collected into the floating table of contents
automatically.

### Lists and quotes

Standard Markdown lists and `>` blockquotes are styled by the theme — nothing
special needed.
