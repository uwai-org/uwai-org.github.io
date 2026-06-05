# The Pandoc converter (via pandoc-ruby) tags its output with whatever the
# process locale happens to be. On systems where the locale is not UTF-8 (e.g.
# a bare CI runner), the HTML comes back tagged US-ASCII even though the bytes
# are UTF-8. That makes downstream string ops like jekyll-feed's `strip` raise
# `invalid byte sequence in US-ASCII`. Re-tagging the output as UTF-8 makes the
# build work regardless of the host locale.
module PandocUtf8
  def convert(content)
    out = super
    out.respond_to?(:force_encoding) ? out.force_encoding("UTF-8") : out
  end
end

if defined?(Jekyll::Converters::Markdown::Pandoc)
  Jekyll::Converters::Markdown::Pandoc.prepend(PandocUtf8)
end
