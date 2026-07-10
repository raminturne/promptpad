// Standalone quick-capture popup. Collects text (and optionally a pasted
// image) and forwards it to the main window, which appends it to Fast Save.
// This window never touches the main app window, so the app stays where it is.
const input = document.getElementById('input');
const pending = document.getElementById('pending');
const pendingImg = document.getElementById('pendingImg');
const pendingRemove = document.getElementById('pendingRemove');

// Match the app's currently selected theme + font.
(async function applyTheme() {
  try {
    const s = (await window.api.loadSettings()) || {};
    const t = window.PP_applyThemeVars(s.theme || 'forest');
    document.documentElement.classList.toggle('theme-light', t.type === 'light');
    const font = (window.PP_FONTS[s.font] || window.PP_FONTS.cascadia).stack;
    document.documentElement.style.setProperty('--font', font);
  } catch (e) { console.error('qc theme failed', e); }
})();

let pendingImage = null;
const IMG_EXT_BY_MIME = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp'
};
const RTL_RE = /[֐-׿؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;

function setPending(filename) {
  pendingImage = filename || null;
  if (pendingImage) {
    pendingImg.src = 'ppimg://' + pendingImage;
    pending.classList.remove('hidden');
  } else {
    pendingImg.removeAttribute('src');
    pending.classList.add('hidden');
  }
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = () => reject(fr.error);
    fr.onload = () => {
      const s = String(fr.result || '');
      resolve(s.slice(s.indexOf(',') + 1));
    };
    fr.readAsDataURL(blob);
  });
}

function submit() {
  const text = input.value.replace(/\s+$/, '');
  if (!text.trim() && !pendingImage) { window.api.qcClose(); return; }
  window.api.qcSubmit({ text, image: pendingImage });
}

input.addEventListener('input', () => {
  const rtl = RTL_RE.test(input.value);
  input.setAttribute('dir', rtl ? 'rtl' : 'ltr');
  input.style.textAlign = rtl ? 'right' : 'left';
});

input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    submit();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    if (!document.getElementById('textContextMenu').classList.contains('hidden')) {
      document.getElementById('textContextMenu').classList.add('hidden');
      return;
    }
    window.api.qcClose();
  }
});

input.addEventListener('paste', (e) => {
  const items = e.clipboardData && e.clipboardData.items;
  if (!items) return;
  const imgItem = [...items].find((it) => it.kind === 'file' && IMG_EXT_BY_MIME[it.type]);
  if (!imgItem) return;
  e.preventDefault();
  const file = imgItem.getAsFile();
  if (!file) return;
  blobToBase64(file)
    .then((b64) => window.api.saveImage(b64, IMG_EXT_BY_MIME[file.type]))
    .then((r) => { if (r && r.filename) setPending(r.filename); })
    .catch((err) => console.error('qc image paste failed', err));
});

document.getElementById('close').addEventListener('click', () => window.api.qcClose());
pendingRemove.addEventListener('click', () => { setPending(null); input.focus(); });

// Cut/copy/paste/select-all context menu for the textarea (this popup is a
// separate Electron window, so the main window's text-menu logic doesn't
// reach it — same behavior, duplicated here for this one field).
const textMenu = document.getElementById('textContextMenu');
input.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  const hasSelection = input.selectionStart !== input.selectionEnd;
  textMenu.querySelector('[data-text-action="cut"]').classList.toggle('disabled', !hasSelection);
  textMenu.querySelector('[data-text-action="copy"]').classList.toggle('disabled', !hasSelection);
  textMenu.style.left = e.clientX + 'px';
  textMenu.style.top = e.clientY + 'px';
  textMenu.classList.remove('hidden');
});
textMenu.addEventListener('mousedown', (e) => e.preventDefault());
textMenu.addEventListener('click', async (e) => {
  const item = e.target.closest('[data-text-action]');
  if (!item || item.classList.contains('disabled')) return;
  const action = item.dataset.textAction;
  textMenu.classList.add('hidden');
  input.focus();
  if (action === 'cut') document.execCommand('cut');
  else if (action === 'copy') document.execCommand('copy');
  else if (action === 'selectall') document.execCommand('selectAll');
  else if (action === 'paste') {
    try {
      const text = await navigator.clipboard.readText();
      if (text) document.execCommand('insertText', false, text);
    } catch (err) { console.error('paste failed', err); }
  }
});
document.addEventListener('click', (e) => {
  if (!textMenu.classList.contains('hidden') && !textMenu.contains(e.target)) textMenu.classList.add('hidden');
});

input.focus();
