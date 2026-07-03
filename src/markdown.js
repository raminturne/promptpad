// Minimal, dependency-free Markdown renderer for the preview pane.
// All input is HTML-escaped first, so no raw HTML ever reaches the DOM.
(function () {
  function esc(s) {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // Inline: `code`, **bold**, *italic*, [text](url) — links render as
  // styled text (not clickable) to avoid navigation inside the app.
  function inline(s) {
    return s
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<span class="md-link" title="$2">$1</span>');
  }

  function render(text) {
    const lines = (text || '').split('\n');
    const out = [];
    let i = 0;
    let listType = null; // 'ul' | 'ol'

    const closeList = () => {
      if (listType) { out.push('</' + listType + '>'); listType = null; }
    };

    while (i < lines.length) {
      const raw = lines[i];
      const line = esc(raw);

      // fenced code block
      if (/^```/.test(raw)) {
        closeList();
        const buf = [];
        i++;
        while (i < lines.length && !/^```/.test(lines[i])) { buf.push(esc(lines[i])); i++; }
        i++; // skip closing fence
        out.push('<pre><code>' + buf.join('\n') + '</code></pre>');
        continue;
      }

      // horizontal rule
      if (/^\s*(-{3,}|\*{3,})\s*$/.test(raw)) {
        closeList();
        out.push('<hr>');
        i++;
        continue;
      }

      // headings
      const h = raw.match(/^(#{1,4})\s+(.*)$/);
      if (h) {
        closeList();
        const lv = h[1].length;
        out.push('<h' + lv + '>' + inline(esc(h[2])) + '</h' + lv + '>');
        i++;
        continue;
      }

      // blockquote
      if (/^>\s?/.test(raw)) {
        closeList();
        const buf = [];
        while (i < lines.length && /^>\s?/.test(lines[i])) {
          buf.push(inline(esc(lines[i].replace(/^>\s?/, ''))));
          i++;
        }
        out.push('<blockquote>' + buf.join('<br>') + '</blockquote>');
        continue;
      }

      // unordered list
      if (/^\s*[-*]\s+/.test(raw)) {
        if (listType !== 'ul') { closeList(); out.push('<ul>'); listType = 'ul'; }
        out.push('<li>' + inline(esc(raw.replace(/^\s*[-*]\s+/, ''))) + '</li>');
        i++;
        continue;
      }

      // ordered list
      if (/^\s*\d+[.)]\s+/.test(raw)) {
        if (listType !== 'ol') { closeList(); out.push('<ol>'); listType = 'ol'; }
        out.push('<li>' + inline(esc(raw.replace(/^\s*\d+[.)]\s+/, ''))) + '</li>');
        i++;
        continue;
      }

      // blank line
      if (!raw.trim()) {
        closeList();
        i++;
        continue;
      }

      // paragraph
      closeList();
      out.push('<p>' + inline(line) + '</p>');
      i++;
    }
    closeList();
    return out.join('');
  }

  window.renderMarkdown = render;
})();
