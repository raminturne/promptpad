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

  // Inline: images, `code`, **bold**, *italic*, [text](url) — links render as
  // styled text (not clickable) to avoid navigation inside the app.
  // Image sources are restricted to the app's own ppimg:// scheme; the
  // filename charset can't break out of the src attribute.
  function inline(s) {
    return s
      .replace(/!\[img\]\(ppimg:\/\/([a-zA-Z0-9._-]+)\)/g, '<img class="md-img" src="ppimg://$1" alt="">')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<span class="md-link" data-href="$2" title="$2">$1</span>');
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
        const startLine = i;
        const buf = [];
        i++;
        while (i < lines.length && !/^```/.test(lines[i])) { buf.push(esc(lines[i])); i++; }
        const endLine = i; // index of the closing fence line
        i++; // skip closing fence
        out.push(
          '<div class="md-codeblock" data-line="' + startLine + '" data-end-line="' + endLine + '">' +
          '<button class="md-code-copy" type="button" title="Copy code" aria-label="Copy code">' +
          '<svg class="md-code-copy-icon" viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">' +
          '<rect x="9" y="9" width="11" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/>' +
          '<path d="M5 15V5a2 2 0 0 1 2-2h8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>' +
          '</svg>' +
          '<svg class="md-code-copy-check" viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">' +
          '<path d="M5 12.5l4.5 4.5L19 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>' +
          '</svg>' +
          '</button>' +
          '<button class="md-code-improve" type="button" title="Improve this prompt" aria-label="Improve this prompt">' +
          '<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">' +
          '<path d="M4 20L14 10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>' +
          '<path d="M17 3l.9 2.1L20 6l-2.1.9L17 9l-.9-2.1L14 6l2.1-.9L17 3z" fill="currentColor"/>' +
          '<path d="M12.5 7.5l.5 1.2 1.2.5-1.2.5-.5 1.2-.5-1.2-1.2-.5 1.2-.5.5-1.2z" fill="currentColor"/>' +
          '</svg>' +
          '</button>' +
          '<button class="md-code-genimg" type="button" title="Generate image from this block" aria-label="Generate image from this block">' +
          '<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">' +
          '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z" fill="currentColor"/>' +
          '<path d="M19 14l.9 2.1L22 17l-2.1.9L19 20l-.9-2.1L16 17l2.1-.9L19 14z" fill="currentColor"/>' +
          '</svg>' +
          '</button>' +
          '<pre><code>' + buf.join('\n') + '</code></pre>' +
          '</div>'
        );
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

      // todo item (- [ ] / - [x]) — must run before the generic ul rule.
      // data-line points back at the source line so the preview checkbox
      // can toggle the underlying note text.
      const todo = raw.match(/^\s*- \[( |x)\] (.*)$/);
      if (todo) {
        if (listType !== 'ul') { closeList(); out.push('<ul>'); listType = 'ul'; }
        const done = todo[1] === 'x';
        out.push('<li class="md-todo' + (done ? ' done' : '') + '" data-line="' + i + '">' +
          '<span class="md-todo-box">' + (done ? '☑' : '☐') + '</span> ' +
          inline(esc(todo[2])) + '</li>');
        i++;
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
