# WAI website

Source for [uwai-org.github.io](https://uwai-org.github.io) — the site for WAI,
a research organization formed by NLP / ML / System PhDs from the University of Washington.

It's a minimal [Jekyll](https://jekyllrb.com/) site with:

- A minimal landing page and an About page.
- A blog whose posts are rendered with **Pandoc**, giving Tufte-style margin
  sidenotes, KaTeX math, a floating table of contents, and automatic light/dark
  mode (theme based on the
  [Pandoc Markdown CSS Theme](https://jez.io/pandoc-markdown-css-theme/)).

## How deployment works

GitHub Pages can't run Pandoc natively, so the site is built and deployed by a
GitHub Actions workflow ([`.github/workflows/pages.yml`](.github/workflows/pages.yml)).
On every push to `main` it installs Pandoc and the `pandoc-sidenote` filter,
runs `jekyll build`, and publishes the result.

### One-time setup

In the repo on GitHub, go to **Settings → Pages → Build and deployment → Source**
and select **GitHub Actions**. (This only needs to be done once.)

## Writing a blog post

See [`docs/writing-posts.md`](docs/writing-posts.md) for the full guide: front
matter, sidenotes, math, code blocks, and the table of contents. In short, add
a Markdown file to `_posts/` named `YYYY-MM-DD-title.md` and push to `main`.

## Running locally

You need [Pandoc](https://pandoc.org/), plus **Ruby 2.7+** (the macOS system Ruby
2.6 is too old for Jekyll 4) and [Bundler](https://bundler.io/). On macOS:

```bash
brew install pandoc ruby

# Homebrew's Ruby is keg-only, so put it first on your PATH:
export PATH="/opt/homebrew/opt/ruby/bin:/opt/homebrew/lib/ruby/gems/4.0.0/bin:$PATH"

# One-time: install gems and fetch the sidenote filter into the repo root.
gem install bundler
bundle install
curl -sSL -o pandoc-sidenote.lua \
  https://github.com/jez/pandoc-sidenote/raw/refs/heads/master/pandoc-sidenote.lua

# Serve with live reload at http://127.0.0.1:4000
bundle exec jekyll serve --livereload
```

`pandoc-sidenote.lua` is git-ignored; the build downloads it automatically in CI,
and the command above fetches it for local development.

> The gem version in the PATH line (`gems/4.0.0`) tracks your installed Ruby
> minor version — adjust if `brew install ruby` gives you a different one.

## Project layout

```
_config.yml                 Site config + Pandoc/converter settings
_layouts/                   default, home, page, blog, post
_includes/                  nav, footer
_posts/                     blog posts (Markdown)
blog/index.html             blog index
about.md                    About page
index.md                    landing page
assets/css/theme.css        Pandoc Markdown CSS theme (prose, sidenotes, dark mode)
assets/css/site.css         minimal chrome (nav, footer, home, lists)
.github/workflows/pages.yml build + deploy
```

## Editing content

- **Organizers / advisors / projects:** edit [`about.md`](about.md). The names
  there are placeholders.
- **Landing copy:** edit [`index.md`](index.md) and the tagline in
  [`_config.yml`](_config.yml).
