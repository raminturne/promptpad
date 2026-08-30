// Minimal, dependency-free Markdown renderer for the preview pane.
// All input is HTML-escaped first, so no raw HTML ever reaches the DOM.
//
// Supports CommonMark basics plus GitHub-flavoured and "extended" syntax:
// tables, ~~strike~~, ==highlight==, ~sub~ / ^sup^, footnotes, definition
// lists, nested lists, setext headings, autolinks and backslash escapes.
(function () {
  function esc(s) {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ---- Inline pass -------------------------------------------------------
  //
  // Anything that must not be touched by a later rule (an escaped character,
  // a code span, a finished link) is lifted out into a placeholder first and
  // spliced back at the very end. The sentinels are private-use code points,
  // so neither esc() nor any syntax rule below can match them, and any that
  // survive in user text are stripped up front.
  const PH_OPEN = '\uE000';
  const PH_CLOSE = '\uE001';
  const PH_RE = /\uE000(\d+)\uE001/g;

  // Digits-only by construction, and clamped, so a width can't break out of
  // the style attribute. Filenames are whitelisted to the same charset the
  // ppimg:// protocol handler in main.js accepts.
  function imgHtml(file, w) {
    const px = w ? Math.min(4000, parseInt(w, 10)) : 0;
    return '<img class="md-img' + (px ? ' md-img-sized' : '') + '" src="ppimg://' + file +
      '" alt=""' + (px ? ' style="width:' + px + 'px"' : '') + '>';
  }

  // Links render as styled text (not clickable) to avoid navigation inside
  // the app; the renderer's click handler opens them externally.
  function linkHtml(label, url) {
    return '<span class="md-link" data-href="' + esc(url) + '" title="' + esc(url) + '">' +
      esc(label) + '</span>';
  }

  // A URL is only auto-linked when it looks like one; the trailing-punctuation
  // trim keeps "see https://x.com." from swallowing the sentence's full stop.
  function trimUrlTail(url) {
    let tail = '';
    let m;
    while ((m = /[.,;:!?)\]]$/.exec(url))) {
      if (m[0] === ')' && (url.split('(').length > url.split(')').length)) break;
      tail = m[0] + tail;
      url = url.slice(0, -1);
    }
    return [url, tail];
  }

  // opts.footnotes — the shared { order: [] } collector for [^ref] markers, so
  // the reference number matches the definition list rendered at the end.
  function inline(raw, opts) {
    const store = [];
    const ph = (html) => {
      store.push(html);
      return PH_OPEN + (store.length - 1) + PH_CLOSE;
    };
    let s = String(raw == null ? '' : raw).replace(/[\uE000\uE001]/g, '');

    // 1. backslash escapes — first, so "\*" never reads as emphasis
    s = s.replace(/\\([\\`*_{}[\]()#+\-.!~^=|<>"&])/g, (_m, c) => ph(esc(c)));

    // 2. code spans — their contents are literal, immune to every rule below
    s = s.replace(/(`+)([^\n]*?[^`])\1(?!`)/g, (_m, _t, code) => ph('<code>' + esc(code) + '</code>'));

    // 3. images (the app's own ppimg:// scheme only)
    s = s.replace(/!\[img\]\(ppimg:\/\/([a-zA-Z0-9._-]+)(?:\|(\d+))?\)/g,
      (_m, file, w) => ph(imgHtml(file, w)));

    // 4. [label](url) — before autolinking, so the href isn't linkified twice
    s = s.replace(/\[([^\]\n]*)\]\(([^)\s]+)\)/g, (_m, label, url) => ph(linkHtml(label, url)));

    // 5. footnote references
    if (opts && opts.footnotes) {
      s = s.replace(/\[\^([^\]\s]+)\]/g, (_m, id) => {
        const order = opts.footnotes.order;
        let n = order.indexOf(id);
        if (n === -1) { order.push(id); n = order.length - 1; }
        return ph('<sup class="md-fnref" id="md-fnref-' + (n + 1) + '">' +
          '<a href="#md-fn-' + (n + 1) + '">' + (n + 1) + '</a></sup>');
      });
    }

    // 6. autolinks: <https://…> and bare URLs / www. hosts
    s = s.replace(/<((?:https?|mailto):[^>\s]+)>/g, (_m, url) => ph(linkHtml(url, url)));
    s = s.replace(/(^|[\s(])((?:https?:\/\/|www\.)[^\s<>"']+)/g, (_m, pre, url) => {
      const [clean, tail] = trimUrlTail(url);
      if (!clean) return _m;
      return pre + ph(linkHtml(clean, /^www\./.test(clean) ? 'https://' + clean : clean)) + tail;
    });

    // 7. everything still literal gets escaped now
    s = esc(s);

    // 8. emphasis & friends, longest marker first
    s = s
      .replace(/\*\*\*([^*\n]+)\*\*\*/g, '<strong><em>$1</em></strong>')
      .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^\w])__([^_\n]+)__(?!\w)/g, '$1<strong>$2</strong>')
      .replace(/(^|[^*\w])\*([^*\n]+)\*/g, '$1<em>$2</em>')
      // "_" only outside words, so snake_case_names stay intact
      .replace(/(^|[^\w])_([^_\n]+)_(?!\w)/g, '$1<em>$2</em>')
      .replace(/~~([^\n]+?)~~/g, '<del>$1</del>')
      .replace(/==([^\n]+?)==/g, '<mark>$1</mark>')
      .replace(/(^|[^~])~([^~\s][^~\n]*?)~(?!~)/g, '$1<sub>$2</sub>')
      .replace(/\^([^\s^][^^\n]*?)\^/g, '<sup>$1</sup>');

    // 9. splice the untouchables back in
    return s.replace(PH_RE, (_m, i) => store[Number(i)]);
  }

  // ---- Block pass --------------------------------------------------------

  // Ordered-list markers may use ASCII, Persian or Arabic-Indic digits — a
  // Persian note numbered "۱." is still an ordered list.
  const DIGITS = '0-9۰-۹٠-٩';
  const OL_RE = new RegExp('^(\\s*)([' + DIGITS + ']+)[.)]\\s+(.*)$');
  const UL_RE = /^(\s*)[-*+]\s+(.*)$/;
  const TODO_RE = /^(\s*)- \[( |x)\] (.*)$/;

  function toAsciiDigits(s) {
    return s.replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06f0))
      .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660));
  }

  // A GFM alignment row: |---|:--:|---:| — the line under a table header.
  function parseAlignRow(line) {
    if (!/\|/.test(line) || !/^[\s|:-]+$/.test(line)) return null;
    const cells = splitRow(line);
    if (!cells.length) return null;
    const align = [];
    for (const c of cells) {
      const t = c.trim();
      if (!/^:?-{1,}:?$/.test(t)) return null;
      const l = t.startsWith(':');
      const r = t.endsWith(':');
      align.push(l && r ? 'center' : r ? 'right' : l ? 'left' : '');
    }
    return align;
  }

  // Split a table row on unescaped pipes, dropping the optional outer ones.
  function splitRow(line) {
    const cells = [];
    let cur = '';
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '\\' && line[i + 1] === '|') { cur += '\\|'; i++; continue; }
      if (c === '|') { cells.push(cur); cur = ''; continue; }
      cur += c;
    }
    cells.push(cur);
    if (cells.length && !cells[0].trim()) cells.shift();
    if (cells.length && !cells[cells.length - 1].trim()) cells.pop();
    return cells;
  }

  // opts.ai — when false, the "Improve this prompt" button is left out of code
  // blocks entirely (the master AI switch in Settings).
  function render(text, opts) {
    const ai = !opts || opts.ai !== false;
    const lines = (text || '').split('\n');
    const out = [];
    const footnotes = { order: [], defs: {} };
    const io = { footnotes };
    let i = 0;
    // Open list levels, outermost first: { type: 'ul'|'ol', indent: number }.
    // <li> elements are left unclosed on purpose — the HTML parser closes them
    // implicitly, which is exactly what nesting a list inside an item needs.
    const stack = [];

    // Every block carries the source lines it came from, so double-clicking it
    // in the preview can splice an edit back into the note text.
    const at = (start, end) =>
      ' data-line="' + start + '" data-end-line="' + (end === undefined ? start : end) + '"';

    const closeLists = (toIndent) => {
      while (stack.length && (toIndent === undefined || stack[stack.length - 1].indent > toIndent)) {
        // A nested list lives *inside* its parent <li>, so closing it also
        // closes that item (see the </li> lifted off in openListLevel).
        out.push('</' + stack.pop().type + '>' + (stack.length ? '</li>' : ''));
      }
    };
    const closeList = () => closeLists();

    // Open/close list levels until the innermost one matches (type, indent).
    const openListLevel = (type, indent) => {
      closeLists(indent);
      const top = stack[stack.length - 1];
      if (top && top.indent === indent && top.type !== type) {
        out.push('</' + stack.pop().type + '>' + (stack.length ? '</li>' : ''));
      }
      if (!stack.length || stack[stack.length - 1].indent < indent) {
        // Nesting: reopen the item we just closed so the sublist sits inside
        // it, which is what produces real indentation (and valid HTML).
        if (stack.length) {
          const prev = out[out.length - 1];
          if (prev && prev.endsWith('</li>')) out[out.length - 1] = prev.slice(0, -5);
        }
        out.push('<' + type + '>');
        stack.push({ type, indent });
      }
    };

    while (i < lines.length) {
      const raw = lines[i];

      // fenced code block
      if (/^\s*```/.test(raw)) {
        closeList();
        const startLine = i;
        const lang = raw.replace(/^\s*```/, '').trim();
        const buf = [];
        i++;
        while (i < lines.length && !/^\s*```/.test(lines[i])) { buf.push(esc(lines[i])); i++; }
        const endLine = Math.min(i, lines.length - 1); // index of the closing fence line
        i++; // skip closing fence
        out.push(
          '<div class="md-codeblock" data-line="' + startLine + '" data-end-line="' + endLine + '">' +
          (lang ? '<span class="md-code-lang">' + esc(lang) + '</span>' : '') +
          '<button class="md-code-copy" type="button" title="Copy code" aria-label="Copy code">' +
          '<svg class="md-code-copy-icon" viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">' +
          '<rect x="9" y="9" width="11" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/>' +
          '<path d="M5 15V5a2 2 0 0 1 2-2h8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>' +
          '</svg>' +
          '<svg class="md-code-copy-check" viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">' +
          '<path d="M5 12.5l4.5 4.5L19 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>' +
          '</svg>' +
          '</button>' +
          (ai
            ? '<button class="md-code-improve" type="button" title="Improve this prompt" aria-label="Improve this prompt">' +
              '<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">' +
              '<path d="M4 20L14 10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>' +
              '<path d="M17 3l.9 2.1L20 6l-2.1.9L17 9l-.9-2.1L14 6l2.1-.9L17 3z" fill="currentColor"/>' +
              '<path d="M12.5 7.5l.5 1.2 1.2.5-1.2.5-.5 1.2-.5-1.2-1.2-.5 1.2-.5.5-1.2z" fill="currentColor"/>' +
              '</svg>' +
              '</button>'
            : '') +
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

      // footnote definition: [^id]: text (continuation lines are indented)
      const fnDef = raw.match(/^\[\^([^\]\s]+)\]:\s*(.*)$/);
      if (fnDef) {
        closeList();
        const buf = [fnDef[2]];
        i++;
        while (i < lines.length && /^\s{2,}\S/.test(lines[i])) { buf.push(lines[i].trim()); i++; }
        footnotes.defs[fnDef[1]] = buf.join(' ');
        continue;
      }

      // horizontal rule (--- *** ___)
      if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(raw)) {
        closeList();
        out.push('<hr' + at(i) + '>');
        i++;
        continue;
      }

      // ATX headings, now through h6
      const h = raw.match(/^(#{1,6})\s+(.*?)\s*#*$/);
      if (h) {
        closeList();
        const lv = h[1].length;
        out.push('<h' + lv + at(i) + '>' + inline(h[2], io) + '</h' + lv + '>');
        i++;
        continue;
      }

      // blockquote (nesting is flattened; the bar itself is what reads)
      if (/^\s*>\s?/.test(raw)) {
        closeList();
        const start = i;
        const buf = [];
        while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
          buf.push(inline(lines[i].replace(/^\s*>\s?/, ''), io));
          i++;
        }
        out.push('<blockquote' + at(start, i - 1) + '>' + buf.join('<br>') + '</blockquote>');
        continue;
      }

      // table: a row of pipes whose next line is an alignment row
      if (raw.includes('|') && i + 1 < lines.length) {
        const align = parseAlignRow(lines[i + 1]);
        if (align && splitRow(raw).length === align.length) {
          closeList();
          const start = i;
          const head = splitRow(raw);
          const body = [];
          i += 2;
          while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
            body.push(splitRow(lines[i]));
            i++;
          }
          const cls = (n) => (align[n] ? ' class="md-a' + align[n][0] + '"' : '');
          // Every real cell (not a +/- control cell) carries a contenteditable
          // INNER span for its text, deliberately not the cell element itself
          // — a header cell also holds the delete-column button as a sibling,
          // and making the whole <th> editable put that button inside the
          // editable surface too: selecting the header text and typing over
          // it could delete the button outright, and reading the cell's own
          // textContent back to save picked up the button's "×" along with
          // it. Keeping the button OUTSIDE the editable span avoids both.
          // data-col identifies which cell for both that and for the column
          // +/- rail below. Every table also gets a live +/- rail: a delete
          // button riding inside each header cell, one extra header cell
          // that adds a column, one extra cell per body row that deletes it,
          // and a final full-width row that adds one. All of this is app
          // chrome, not document content — exportRenderPayload() strips it
          // (.md-table-ctlcell / -delcol / -addrow-row) before a note is
          // ever saved as HTML/PDF/PNG.
          let html = '<table' + at(start, i - 1) + '><thead><tr>';
          head.forEach((c, n) => {
            html += '<th' + cls(n) + ' data-col="' + n + '">' +
              '<span class="md-table-celltext" contenteditable="true">' + inline(c.trim(), io) + '</span>' +
              '<button type="button" class="md-table-delcol" data-col="' + n +
              '" title="Remove column" tabindex="-1">×</button></th>';
          });
          html += '<th class="md-table-ctlcell">' +
            '<button type="button" class="md-table-addcol" title="Add column" tabindex="-1">+</button></th>';
          html += '</tr></thead><tbody>';
          body.forEach((row, r) => {
            html += '<tr data-row="' + r + '">';
            for (let n = 0; n < head.length; n++) {
              html += '<td' + cls(n) + ' data-col="' + n + '">' +
                '<span class="md-table-celltext" contenteditable="true">' +
                inline((row[n] || '').trim(), io) + '</span></td>';
            }
            html += '<td class="md-table-ctlcell">' +
              '<button type="button" class="md-table-delrow" data-row="' + r +
              '" title="Remove row" tabindex="-1">×</button></td></tr>';
          });
          html += '<tr class="md-table-addrow-row"><td class="md-table-ctlcell" colspan="' +
            (head.length + 1) + '">' +
            '<button type="button" class="md-table-addrow" title="Add row" tabindex="-1">+ Row</button></td></tr>';
          out.push(html + '</tbody></table>');
          continue;
        }
      }

      // todo item (- [ ] / - [x]) — must run before the generic ul rule.
      // data-line points back at the source line so the preview checkbox
      // can toggle the underlying note text.
      const todo = raw.match(TODO_RE);
      if (todo) {
        openListLevel('ul', todo[1].length);
        const done = todo[2] === 'x';
        out.push('<li class="md-todo' + (done ? ' done' : '') + '"' + at(i) + '>' +
          '<span class="md-todo-box">' + (done ? '☑' : '☐') + '</span> ' +
          inline(todo[3], io) + '</li>');
        i++;
        continue;
      }

      // unordered list
      const ul = raw.match(UL_RE);
      if (ul) {
        openListLevel('ul', ul[1].length);
        out.push('<li' + at(i) + '>' + inline(ul[2], io) + '</li>');
        i++;
        continue;
      }

      // ordered list — `value` keeps the author's own numbering (and renders
      // Persian-digit lists with the right numbers rather than restarting).
      const ol = raw.match(OL_RE);
      if (ol) {
        const wasOpen = stack.length && stack[stack.length - 1].indent === ol[1].length &&
          stack[stack.length - 1].type === 'ol';
        openListLevel('ol', ol[1].length);
        const num = parseInt(toAsciiDigits(ol[2]), 10);
        const val = !wasOpen && num >= 0 ? ' value="' + num + '"' : '';
        out.push('<li' + val + at(i) + '>' + inline(ol[3], io) + '</li>');
        i++;
        continue;
      }

      // definition list: a term followed by one or more ": definition" lines
      if (raw.trim() && i + 1 < lines.length && /^\s*:\s+\S/.test(lines[i + 1])) {
        closeList();
        const start = i;
        let html = '<dl';
        const parts = ['<dt>' + inline(raw.trim(), io) + '</dt>'];
        i++;
        while (i < lines.length) {
          if (/^\s*:\s+/.test(lines[i])) {
            parts.push('<dd>' + inline(lines[i].replace(/^\s*:\s+/, ''), io) + '</dd>');
            i++;
          } else if (lines[i].trim() && i + 1 < lines.length && /^\s*:\s+\S/.test(lines[i + 1])) {
            parts.push('<dt>' + inline(lines[i].trim(), io) + '</dt>');
            i++;
          } else break;
        }
        out.push(html + at(start, i - 1) + '>' + parts.join('') + '</dl>');
        continue;
      }

      // blank line
      if (!raw.trim()) {
        closeList();
        i++;
        continue;
      }

      // setext heading: text underlined with === (h1) or --- (h2). The --- case
      // only reaches here when the line above is a paragraph; a --- on its own
      // was already consumed as an <hr> above.
      if (i + 1 < lines.length && /^\s*(=+|-+)\s*$/.test(lines[i + 1])) {
        closeList();
        const lv = lines[i + 1].trim()[0] === '=' ? 1 : 2;
        out.push('<h' + lv + at(i, i + 1) + '>' + inline(raw.trim(), io) + '</h' + lv + '>');
        i += 2;
        continue;
      }

      // paragraph — consecutive non-blank lines join with <br>, so a wrapped
      // sentence stays one block and edits round-trip as one unit
      closeList();
      const pStart = i;
      const buf = [];
      while (i < lines.length && lines[i].trim() &&
             !isBlockStart(lines, i, i > pStart)) {
        buf.push(inline(lines[i].replace(/(\s\s+|\\)$/, ''), io));
        i++;
      }
      out.push('<p' + at(pStart, i - 1) + '>' + buf.join('<br>') + '</p>');
    }
    closeList();

    // footnote definitions, numbered in reference order
    if (footnotes.order.length) {
      let html = '<hr class="md-fn-sep"><ol class="md-footnotes">';
      footnotes.order.forEach((id, n) => {
        html += '<li id="md-fn-' + (n + 1) + '">' + inline(footnotes.defs[id] || '', io) +
          ' <a class="md-fnback" href="#md-fnref-' + (n + 1) + '">↩</a></li>';
      });
      out.push(html + '</ol>');
    }
    return out.join('');
  }

  // Would `lines[i]` open a new block? Used to stop a paragraph run before it
  // swallows a list, heading, table or quote that follows on the next line.
  function isBlockStart(lines, i, notFirst) {
    const raw = lines[i];
    if (!notFirst) return false;
    if (/^\s*```/.test(raw)) return true;
    if (/^(#{1,6})\s+/.test(raw)) return true;
    if (/^\s*>\s?/.test(raw)) return true;
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(raw)) return true;
    if (UL_RE.test(raw) || OL_RE.test(raw) || TODO_RE.test(raw)) return true;
    if (/^\[\^([^\]\s]+)\]:/.test(raw)) return true;
    if (/^\s*(=+|-+)\s*$/.test(raw)) return true;
    if (/^\s*:\s+\S/.test(raw)) return true;
    // a setext heading starts here if the NEXT line is its underline
    if (i + 1 < lines.length && /^\s*(=+|-+)\s*$/.test(lines[i + 1])) return true;
    if (raw.includes('|') && i + 1 < lines.length && parseAlignRow(lines[i + 1])) return true;
    return false;
  }

  window.renderMarkdown = render;
})();
