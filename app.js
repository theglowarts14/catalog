// ============================================================================
// Catalog Creator — full app
// Vanilla JS. State + render + interactions + persistence + vector PDF export.
// ============================================================================

pdfjsLib.GlobalWorkerOptions.workerSrc =
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// CSS pixels at 96 DPI
const PAGE_SIZES = {
  A4:     { w: 794,  h: 1123 },
  Letter: { w: 816,  h: 1056 },
  A3:     { w: 1123, h: 1587 },
  A5:     { w: 559,  h: 794 },
};
const PT_PER_PX = 72 / 96; // jsPDF unit conversion

const DEFAULTS = {
  showCaption: true,
  captionPos: 'bottom',
  bg: '#ffffff',
  border: { width: 0, color: '#222222', style: 'solid' },
  radius: 0,
  shadow: { x: 0, y: 0, blur: 0, color: 'rgba(0,0,0,0.25)' },
  fontSize: 14,
  fontFamily: 'helvetica',
  fontWeight: 'normal',
  color: '#222222',
  align: 'left',
};

const state = {
  pages: [],
  activePageId: null,
  selectedItemIds: new Set(),
  nextItemId: 1,
  nextPageId: 1,
  snap: { enabled: true, size: 8 },
  guidesEnabled: true,
};

const history = { stack: [], index: -1, max: 80, suspended: false };
let clipboard = [];

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

// ============================================================================
// Page / item model
// ============================================================================
function pageDimensions(page) {
  const base = PAGE_SIZES[page.size] || PAGE_SIZES.A4;
  return page.orientation === 'landscape' ? { w: base.h, h: base.w } : { w: base.w, h: base.h };
}

function createPage(size = 'A4', orientation = 'portrait') {
  const page = {
    id: 'p' + (state.nextPageId++),
    size, orientation,
    items: [],
    header: { show: false, text: '', fontSize: 12 },
    footer: { show: false, text: '{page} / {total}', fontSize: 12 },
  };
  state.pages.push(page);
  state.activePageId = page.id;
  return page;
}

function getActivePage() { return state.pages.find(p => p.id === state.activePageId); }
function getSelectedItems() {
  const page = getActivePage();
  if (!page) return [];
  return page.items.filter(i => state.selectedItemIds.has(i.id));
}
function getPrimarySelected() {
  const items = getSelectedItems();
  return items.length === 1 ? items[0] : null;
}

function makeItem(overrides = {}) {
  return {
    id: 'i' + (state.nextItemId++),
    type: 'image',
    x: 40, y: 40, w: 240, h: 200,
    name: '', number: '',
    showCaption: DEFAULTS.showCaption,
    captionPos: DEFAULTS.captionPos,
    src: null, naturalW: 0, naturalH: 0,
    text: '',
    fontSize: DEFAULTS.fontSize,
    fontFamily: DEFAULTS.fontFamily,
    fontWeight: DEFAULTS.fontWeight,
    color: DEFAULTS.color,
    align: DEFAULTS.align,
    bg: 'transparent',
    border: { ...DEFAULTS.border },
    radius: 0,
    shadow: { ...DEFAULTS.shadow },
    ...overrides,
  };
}

function addItemToActivePage(item, opts = {}) {
  let page = getActivePage();
  if (!page) page = createPage();
  page.items.push(item);
  if (!opts.keepSelection) {
    state.selectedItemIds = new Set([item.id]);
  }
  if (!opts.skipCommit) commit();
  render();
}

// ============================================================================
// Undo / redo
// ============================================================================
function snapshot() {
  return {
    pages: JSON.parse(JSON.stringify(state.pages)),
    nextItemId: state.nextItemId,
    nextPageId: state.nextPageId,
    activePageId: state.activePageId,
  };
}
function restore(snap) {
  state.pages = JSON.parse(JSON.stringify(snap.pages));
  state.nextItemId = snap.nextItemId;
  state.nextPageId = snap.nextPageId;
  state.activePageId = state.pages.find(p => p.id === snap.activePageId)?.id || state.pages[0]?.id || null;
  state.selectedItemIds = new Set();
}
function commit() {
  if (history.suspended) return;
  history.stack.length = history.index + 1;
  history.stack.push(snapshot());
  if (history.stack.length > history.max) history.stack.shift();
  history.index = history.stack.length - 1;
  scheduleAutosave();
}
function undo() {
  if (history.index <= 0) return;
  history.index--;
  restore(history.stack[history.index]);
  render(); scheduleAutosave();
}
function redo() {
  if (history.index >= history.stack.length - 1) return;
  history.index++;
  restore(history.stack[history.index]);
  render(); scheduleAutosave();
}

// ============================================================================
// IndexedDB autosave
// ============================================================================
const DB_NAME = 'catalogDB';
const DB_STORE = 'state';
let dbPromise = null;
function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}
async function dbPut(key, value) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function dbGet(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readonly');
    const req = tx.objectStore(DB_STORE).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function dbDel(key) {
  const db = await openDb();
  return new Promise((resolve) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).delete(key);
    tx.oncomplete = () => resolve();
  });
}

let autosaveTimer = null;
function scheduleAutosave() {
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(async () => {
    try {
      await dbPut('current', snapshot());
      setStatus('Auto-saved ' + new Date().toLocaleTimeString());
    } catch (e) {
      console.warn('Autosave failed:', e);
    }
  }, 600);
}

// ============================================================================
// File loaders
// ============================================================================
function readAsDataURL(file) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload=()=>res(r.result); r.onerror=rej; r.readAsDataURL(file); });
}
function readAsArrayBuffer(file) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload=()=>res(r.result); r.onerror=rej; r.readAsArrayBuffer(file); });
}
function readAsText(file) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload=()=>res(r.result); r.onerror=rej; r.readAsText(file); });
}
function imageDims(dataUrl) {
  return new Promise((res) => { const i = new Image(); i.onload=()=>res({w:i.naturalWidth,h:i.naturalHeight}); i.src=dataUrl; });
}

async function imageItemFromFile(file, x = 40, y = 40, maxW = 360) {
  const src = await readAsDataURL(file);
  const dims = await imageDims(src);
  const ratio = dims.h / dims.w;
  const w = Math.min(maxW, dims.w);
  const h = w * ratio;
  return makeItem({
    type: 'image', src,
    x, y, w, h: h + 24,
    naturalW: dims.w, naturalH: dims.h,
    name: file.name.replace(/\.[^.]+$/, ''),
  });
}

async function loadImageFiles(files) {
  history.suspended = true;
  for (const f of files) {
    const item = await imageItemFromFile(f);
    addItemToActivePage(item, { skipCommit: true, keepSelection: true });
  }
  history.suspended = false;
  commit(); render();
}

async function loadPdfFile(file) {
  const buf = await readAsArrayBuffer(file);
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  history.suspended = true;
  for (let n = 1; n <= pdf.numPages; n++) {
    const p = await pdf.getPage(n);
    const vp = p.getViewport({ scale: 2 });
    const c = document.createElement('canvas');
    c.width = vp.width; c.height = vp.height;
    await p.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
    const src = c.toDataURL('image/png');
    const ratio = vp.height / vp.width;
    const w = 360;
    addItemToActivePage(makeItem({
      type: 'image', src,
      w, h: w * ratio + 24,
      naturalW: vp.width, naturalH: vp.height,
      name: `${file.name.replace(/\.pdf$/i,'')} - p${n}`,
      number: String(n),
    }), { skipCommit: true, keepSelection: true });
  }
  history.suspended = false;
  commit(); render();
}

// ============================================================================
// Rendering
// ============================================================================
function render() {
  const page = getActivePage();
  if (page) {
    const o = $('#orientation'), s = $('#pageSize');
    if (o) o.value = page.orientation;
    if (s) s.value = page.size;
  }
  $('#snapEnabled').checked = state.snap.enabled;
  $('#snapSize').value = state.snap.size;
  $('#guidesEnabled').checked = state.guidesEnabled;
  $('#undoBtn').disabled = history.index <= 0;
  $('#redoBtn').disabled = history.index >= history.stack.length - 1;
  renderPageList();
  renderPages();
  renderProps();
}

function renderPageList() {
  const list = $('#pageList');
  list.innerHTML = '';
  state.pages.forEach((p, idx) => {
    const div = document.createElement('div');
    div.className = 'page-item' + (p.id === state.activePageId ? ' active' : '');
    const lab = document.createElement('span');
    lab.textContent = `Page ${idx + 1} (${p.size} ${p.orientation[0].toUpperCase()})`;
    const acts = document.createElement('div');
    acts.className = 'actions';
    const up = mkBtn('▲', 'Move up', () => {
      if (idx === 0) return;
      [state.pages[idx-1], state.pages[idx]] = [state.pages[idx], state.pages[idx-1]];
      commit(); render();
    });
    const down = mkBtn('▼', 'Move down', () => {
      if (idx === state.pages.length - 1) return;
      [state.pages[idx+1], state.pages[idx]] = [state.pages[idx], state.pages[idx+1]];
      commit(); render();
    });
    const dup = mkBtn('⎘', 'Duplicate', () => {
      const copy = JSON.parse(JSON.stringify(p));
      copy.id = 'p' + (state.nextPageId++);
      copy.items.forEach(it => { it.id = 'i' + (state.nextItemId++); });
      state.pages.splice(idx + 1, 0, copy);
      state.activePageId = copy.id;
      commit(); render();
    });
    const del = mkBtn('✕', 'Delete', () => {
      if (!confirm('Delete this page?')) return;
      state.pages.splice(idx, 1);
      if (state.activePageId === p.id) state.activePageId = state.pages[idx]?.id || state.pages[0]?.id || null;
      commit(); render();
    });
    [up, down, dup, del].forEach(b => acts.appendChild(b));
    div.appendChild(lab);
    div.appendChild(acts);
    div.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      state.activePageId = p.id;
      state.selectedItemIds = new Set();
      render();
    });
    list.appendChild(div);
  });
}
function mkBtn(text, title, onClick) {
  const b = document.createElement('button');
  b.textContent = text; b.title = title;
  b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
  return b;
}

function renderPages() {
  const root = $('#pages');
  root.innerHTML = '';
  state.pages.forEach((p, idx) => {
    const dims = pageDimensions(p);
    const pageEl = document.createElement('div');
    pageEl.className = 'page' + (p.id === state.activePageId ? ' active' : '');
    pageEl.style.width = dims.w + 'px';
    pageEl.style.height = dims.h + 'px';
    pageEl.dataset.pageId = p.id;

    const label = document.createElement('div');
    label.className = 'page-label';
    label.textContent = `Page ${idx + 1}`;
    pageEl.appendChild(label);

    if (p.header.show) {
      const h = document.createElement('div');
      h.className = 'page-hf header';
      h.textContent = renderHfText(p.header.text, idx + 1, state.pages.length);
      h.style.fontSize = (p.header.fontSize || 12) + 'px';
      pageEl.appendChild(h);
    }
    if (p.footer.show) {
      const f = document.createElement('div');
      f.className = 'page-hf footer';
      f.textContent = renderHfText(p.footer.text, idx + 1, state.pages.length);
      f.style.fontSize = (p.footer.fontSize || 12) + 'px';
      pageEl.appendChild(f);
    }

    p.items.forEach(item => pageEl.appendChild(buildItemElement(item, p)));

    pageEl.addEventListener('mousedown', (e) => {
      if (e.target !== pageEl) return;
      state.activePageId = p.id;
      if (!e.shiftKey) state.selectedItemIds = new Set();
      startMarquee(e, pageEl, p);
      render();
    });

    root.appendChild(pageEl);
  });
}

function renderHfText(template, page, total) {
  return (template || '').replace(/\{page\}/g, page).replace(/\{total\}/g, total);
}

function buildItemElement(item, page) {
  const el = document.createElement('div');
  const isSelected = state.selectedItemIds.has(item.id);
  const multi = state.selectedItemIds.size > 1;
  el.className = 'item' +
    (isSelected ? ' selected' : '') +
    (isSelected && multi ? ' multi' : '') +
    (item.type === 'text' ? ' text-item' : '') +
    (' cap-' + item.captionPos);
  el.style.left = item.x + 'px';
  el.style.top = item.y + 'px';
  el.style.width = item.w + 'px';
  el.style.height = item.h + 'px';
  el.style.background = item.bg || 'transparent';
  el.style.borderRadius = (item.radius || 0) + 'px';
  if (item.border && item.border.width > 0) {
    el.style.outline = `${item.border.width}px ${item.border.style} ${item.border.color}`;
    el.style.outlineOffset = '-' + item.border.width + 'px';
  }
  if (item.shadow && item.shadow.blur > 0) {
    el.style.boxShadow = `${item.shadow.x}px ${item.shadow.y}px ${item.shadow.blur}px ${item.shadow.color}`;
  }
  el.dataset.itemId = item.id;

  const frame = document.createElement('div');
  frame.className = 'item-frame';
  frame.style.borderRadius = (item.radius || 0) + 'px';

  if (item.type === 'image' && item.src) {
    const img = document.createElement('img');
    img.src = item.src; img.draggable = false;
    frame.appendChild(img);
  } else if (item.type === 'text') {
    const t = document.createElement('div');
    t.className = 'text-content';
    t.contentEditable = 'true';
    t.style.fontSize = (item.fontSize || 14) + 'px';
    t.style.color = item.color || '#222';
    t.style.textAlign = item.align || 'left';
    t.style.fontWeight = item.fontWeight || 'normal';
    t.style.fontFamily = mapFontFamily(item.fontFamily);
    t.textContent = item.text || '';
    t.addEventListener('input', () => { item.text = t.textContent; });
    t.addEventListener('blur', () => commit());
    t.addEventListener('mousedown', (e) => e.stopPropagation());
    frame.appendChild(t);
  } else {
    const placeholder = document.createElement('div');
    placeholder.style.color = '#9ca3af';
    placeholder.style.fontSize = '12px';
    placeholder.textContent = '(empty)';
    frame.appendChild(placeholder);
  }

  el.appendChild(frame);

  if (item.type !== 'text' && item.captionPos !== 'hidden') {
    const cap = document.createElement('div');
    cap.className = 'caption';
    const name = document.createElement('span');
    name.className = 'name'; name.textContent = item.name || '';
    const num = document.createElement('span');
    num.className = 'number'; num.textContent = item.number || '';
    cap.appendChild(name); cap.appendChild(num);
    el.appendChild(cap);
  }

  ['nw','ne','sw','se','n','s','e','w'].forEach(dir => {
    const h = document.createElement('div');
    h.className = 'handle ' + dir; h.dataset.dir = dir;
    el.appendChild(h);
  });

  attachItemInteractions(el, item, page);
  return el;
}

function mapFontFamily(f) {
  if (f === 'times') return 'Times, "Times New Roman", serif';
  if (f === 'courier') return '"Courier New", Courier, monospace';
  return '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
}

// ============================================================================
// Drag, resize, marquee, snap, guides, multi-select
// ============================================================================
function snap(v) {
  if (!state.snap.enabled) return v;
  const s = state.snap.size;
  return Math.round(v / s) * s;
}

function attachItemInteractions(el, item, page) {
  el.addEventListener('mousedown', (e) => {
    if (e.target.classList.contains('handle')) {
      // resize only when single selected
      if (state.selectedItemIds.size > 1) {
        state.selectedItemIds = new Set([item.id]);
      } else {
        state.selectedItemIds.add(item.id);
      }
      render();
      const dir = e.target.dataset.dir;
      startResize(e, item, page, dir);
      return;
    }
    if (e.target.closest('.text-content')) return;

    state.activePageId = page.id;
    if (e.shiftKey) {
      if (state.selectedItemIds.has(item.id)) state.selectedItemIds.delete(item.id);
      else state.selectedItemIds.add(item.id);
    } else if (!state.selectedItemIds.has(item.id)) {
      state.selectedItemIds = new Set([item.id]);
    }
    render();
    startDrag(e, page);
  });
}

function startDrag(e, page) {
  e.preventDefault();
  const startX = e.clientX, startY = e.clientY;
  const items = getSelectedItems();
  const origs = items.map(i => ({ id: i.id, x: i.x, y: i.y, w: i.w, h: i.h }));
  const dims = pageDimensions(page);
  let moved = false;

  function move(ev) {
    const dx = ev.clientX - startX;
    const dy = ev.clientY - startY;
    if (!moved && Math.abs(dx) + Math.abs(dy) > 2) moved = true;
    items.forEach((it, idx) => {
      const o = origs[idx];
      it.x = clamp(snap(o.x + dx), 0, dims.w - it.w);
      it.y = clamp(snap(o.y + dy), 0, dims.h - it.h);
    });
    showGuidesForSelection(page);
    updateItemPositions(page);
  }
  function up() {
    document.removeEventListener('mousemove', move);
    document.removeEventListener('mouseup', up);
    clearGuides();
    if (moved) { commit(); }
    renderProps();
  }
  document.addEventListener('mousemove', move);
  document.addEventListener('mouseup', up);
}

function startResize(e, item, page, dir) {
  e.preventDefault(); e.stopPropagation();
  const startX = e.clientX, startY = e.clientY;
  const o = { x: item.x, y: item.y, w: item.w, h: item.h };
  const dims = pageDimensions(page);
  let moved = false;

  function move(ev) {
    let dx = ev.clientX - startX, dy = ev.clientY - startY;
    if (!moved && Math.abs(dx) + Math.abs(dy) > 2) moved = true;
    let nx = o.x, ny = o.y, nw = o.w, nh = o.h;
    if (dir.includes('e')) nw = Math.max(40, snap(o.w + dx));
    if (dir.includes('s')) nh = Math.max(40, snap(o.h + dy));
    if (dir.includes('w')) { const nw2 = Math.max(40, snap(o.w - dx)); nx = o.x + (o.w - nw2); nw = nw2; }
    if (dir.includes('n')) { const nh2 = Math.max(40, snap(o.h - dy)); ny = o.y + (o.h - nh2); nh = nh2; }
    nx = clamp(nx, 0, dims.w - nw);
    ny = clamp(ny, 0, dims.h - nh);
    nw = Math.min(nw, dims.w - nx);
    nh = Math.min(nh, dims.h - ny);
    item.x = nx; item.y = ny; item.w = nw; item.h = nh;
    updateItemPositions(page);
  }
  function up() {
    document.removeEventListener('mousemove', move);
    document.removeEventListener('mouseup', up);
    if (moved) commit();
    renderProps();
  }
  document.addEventListener('mousemove', move);
  document.addEventListener('mouseup', up);
}

function updateItemPositions(page) {
  page.items.forEach(it => {
    const el = document.querySelector(`.item[data-item-id="${it.id}"]`);
    if (!el) return;
    el.style.left = it.x + 'px';
    el.style.top = it.y + 'px';
    el.style.width = it.w + 'px';
    el.style.height = it.h + 'px';
  });
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// Marquee selection
function startMarquee(e, pageEl, page) {
  e.preventDefault();
  const rect = pageEl.getBoundingClientRect();
  const startX = e.clientX - rect.left, startY = e.clientY - rect.top;
  const marquee = $('#marquee');
  marquee.hidden = false;
  marquee.style.left = (rect.left + startX) + 'px';
  marquee.style.top = (rect.top + startY) + 'px';
  marquee.style.width = '0px'; marquee.style.height = '0px';
  marquee.style.position = 'fixed';

  function move(ev) {
    const x = ev.clientX, y = ev.clientY;
    const x1 = Math.min(rect.left + startX, x);
    const y1 = Math.min(rect.top + startY, y);
    const x2 = Math.max(rect.left + startX, x);
    const y2 = Math.max(rect.top + startY, y);
    marquee.style.left = x1 + 'px';
    marquee.style.top = y1 + 'px';
    marquee.style.width = (x2 - x1) + 'px';
    marquee.style.height = (y2 - y1) + 'px';
  }
  function up(ev) {
    document.removeEventListener('mousemove', move);
    document.removeEventListener('mouseup', up);
    marquee.hidden = true;
    const endX = ev.clientX - rect.left, endY = ev.clientY - rect.top;
    const x1 = Math.min(startX, endX), y1 = Math.min(startY, endY);
    const x2 = Math.max(startX, endX), y2 = Math.max(startY, endY);
    if (Math.abs(x2 - x1) < 3 || Math.abs(y2 - y1) < 3) return;
    if (!ev.shiftKey) state.selectedItemIds = new Set();
    page.items.forEach(it => {
      if (it.x < x2 && it.x + it.w > x1 && it.y < y2 && it.y + it.h > y1) {
        state.selectedItemIds.add(it.id);
      }
    });
    render();
  }
  document.addEventListener('mousemove', move);
  document.addEventListener('mouseup', up);
}

// Alignment guides
function clearGuides() {
  const g = $('#guides');
  g.innerHTML = '';
}
function showGuidesForSelection(page) {
  if (!state.guidesEnabled) return;
  clearGuides();
  const sel = getSelectedItems();
  if (sel.length === 0) return;
  const others = page.items.filter(i => !state.selectedItemIds.has(i.id));
  if (others.length === 0) return;
  const tol = 4;
  const pageEl = document.querySelector(`.page[data-page-id="${page.id}"]`);
  if (!pageEl) return;
  const pr = pageEl.getBoundingClientRect();
  const guides = $('#guides');

  for (const s of sel) {
    const sx = [s.x, s.x + s.w / 2, s.x + s.w];
    const sy = [s.y, s.y + s.h / 2, s.y + s.h];
    for (const o of others) {
      const ox = [o.x, o.x + o.w / 2, o.x + o.w];
      const oy = [o.y, o.y + o.h / 2, o.y + o.h];
      sx.forEach(a => ox.forEach(b => {
        if (Math.abs(a - b) <= tol) addGuide('v', pr.left + b, pr.top, pr.height, guides);
      }));
      sy.forEach(a => oy.forEach(b => {
        if (Math.abs(a - b) <= tol) addGuide('h', pr.left, pr.top + b, pr.width, guides);
      }));
    }
  }
}
function addGuide(orient, x, y, len, root) {
  const g = document.createElement('div');
  g.className = 'guide ' + orient;
  g.style.position = 'fixed';
  g.style.left = x + 'px';
  g.style.top = y + 'px';
  if (orient === 'v') g.style.height = len + 'px';
  else g.style.width = len + 'px';
  root.appendChild(g);
}

// ============================================================================
// Properties panel
// ============================================================================
function renderProps() {
  const root = $('#props');
  const sel = getSelectedItems();
  if (sel.length === 0) {
    root.innerHTML = '<div class="prop-empty">Select an item to edit its properties.</div>';
    return;
  }
  if (sel.length > 1) {
    root.innerHTML = '';
    const info = document.createElement('div');
    info.style.color = '#6b7280'; info.style.fontSize = '13px'; info.style.marginBottom = '10px';
    info.textContent = `${sel.length} items selected`;
    root.appendChild(info);
    const actions = makeActions(true);
    root.appendChild(actions);
    return;
  }
  const item = sel[0];
  root.innerHTML = '';
  const rows = [];

  if (item.type !== 'text') {
    rows.push(propText('Name', item.name, v => { item.name = v; commit(); render(); }));
    rows.push(propText('Number / Code', item.number, v => { item.number = v; commit(); render(); }));
    rows.push(propSelect('Caption position', item.captionPos, ['bottom','top','overlay','hidden'],
      v => { item.captionPos = v; commit(); render(); }));
  } else {
    rows.push(propTextarea('Text', item.text, v => { item.text = v; commit(); render(); }));
    const grid = document.createElement('div'); grid.className = 'prop-grid';
    grid.appendChild(propNumber('Font size', item.fontSize, v => { item.fontSize = v; commit(); render(); }));
    grid.appendChild(propSelect('Family', item.fontFamily, ['helvetica','times','courier'], v => { item.fontFamily = v; commit(); render(); }));
    grid.appendChild(propSelect('Weight', item.fontWeight, ['normal','bold'], v => { item.fontWeight = v; commit(); render(); }));
    grid.appendChild(propSelect('Align', item.align, ['left','center','right','justify'], v => { item.align = v; commit(); render(); }));
    const wrap = document.createElement('div'); wrap.className = 'prop-row';
    const lab = document.createElement('label'); lab.textContent = 'Typography';
    wrap.appendChild(lab); wrap.appendChild(grid);
    rows.push(wrap);
    rows.push(propColor('Color', item.color, v => { item.color = v; commit(); render(); }));
  }

  // Style block
  const style = document.createElement('div'); style.className = 'prop-row';
  const styleLab = document.createElement('label'); styleLab.textContent = 'Style';
  style.appendChild(styleLab);
  const styleGrid = document.createElement('div'); styleGrid.className = 'prop-grid';
  styleGrid.appendChild(propColor('Background', item.bg === 'transparent' ? '#ffffff' : item.bg,
    v => { item.bg = v; commit(); render(); }));
  styleGrid.appendChild(propNumber('Radius', item.radius || 0, v => { item.radius = v; commit(); render(); }));
  styleGrid.appendChild(propNumber('Border w', item.border?.width || 0, v => { item.border = { ...item.border, width: v }; commit(); render(); }));
  styleGrid.appendChild(propColor('Border', item.border?.color || '#222', v => { item.border = { ...item.border, color: v }; commit(); render(); }));
  styleGrid.appendChild(propNumber('Shadow blur', item.shadow?.blur || 0, v => { item.shadow = { ...item.shadow, blur: v }; commit(); render(); }));
  styleGrid.appendChild(propNumber('Shadow Y', item.shadow?.y || 0, v => { item.shadow = { ...item.shadow, y: v }; commit(); render(); }));
  style.appendChild(styleGrid);
  rows.push(style);

  // Position
  const dimRow = document.createElement('div'); dimRow.className = 'prop-row';
  const dimLab = document.createElement('label'); dimLab.textContent = 'Position & size';
  dimRow.appendChild(dimLab);
  const dimGrid = document.createElement('div'); dimGrid.className = 'prop-grid';
  ['x','y','w','h'].forEach(k => {
    const inp = document.createElement('input'); inp.type = 'number';
    inp.value = Math.round(item[k]); inp.title = k;
    inp.addEventListener('change', () => { item[k] = parseFloat(inp.value) || 0; commit(); render(); });
    dimGrid.appendChild(inp);
  });
  dimRow.appendChild(dimGrid);
  rows.push(dimRow);

  rows.push(makeActions(false));
  rows.forEach(r => root.appendChild(r));
}

function makeActions(multi) {
  const a = document.createElement('div'); a.className = 'prop-actions';
  a.innerHTML = `
    <button class="btn" data-act="autofit">Auto-Fit</button>
    <button class="btn" data-act="front">Bring Front</button>
    <button class="btn" data-act="back">Send Back</button>
    <button class="btn" data-act="dup">Duplicate</button>
    <button class="btn danger" data-act="del">Delete</button>
  `;
  a.addEventListener('click', (e) => {
    const act = e.target.dataset.act;
    if (!act) return;
    const page = getActivePage(); if (!page) return;
    const sel = getSelectedItems();
    if (act === 'autofit') sel.forEach(autoFitItem);
    if (act === 'front') {
      const ids = new Set(sel.map(i => i.id));
      page.items = page.items.filter(i => !ids.has(i.id)).concat(sel);
    }
    if (act === 'back') {
      const ids = new Set(sel.map(i => i.id));
      page.items = sel.concat(page.items.filter(i => !ids.has(i.id)));
    }
    if (act === 'dup') duplicateSelection();
    if (act === 'del') {
      const ids = new Set(sel.map(i => i.id));
      page.items = page.items.filter(i => !ids.has(i.id));
      state.selectedItemIds = new Set();
    }
    commit(); render();
  });
  return a;
}

function propText(label, value, on) { return _propInput(label, value, on, 'text'); }
function propColor(label, value, on) { return _propInput(label, value, on, 'color'); }
function propNumber(label, value, on) {
  const r = _propInput(label, value, v => on(parseFloat(v) || 0), 'number');
  return r;
}
function _propInput(label, value, on, type) {
  const r = document.createElement('div'); r.className = 'prop-row';
  const l = document.createElement('label'); l.textContent = label; r.appendChild(l);
  const i = document.createElement('input'); i.type = type; i.value = value ?? '';
  i.addEventListener('change', () => on(i.value));
  r.appendChild(i); return r;
}
function propTextarea(label, value, on) {
  const r = document.createElement('div'); r.className = 'prop-row';
  const l = document.createElement('label'); l.textContent = label; r.appendChild(l);
  const t = document.createElement('textarea'); t.value = value ?? '';
  t.addEventListener('change', () => on(t.value));
  r.appendChild(t); return r;
}
function propSelect(label, value, options, on) {
  const r = document.createElement('div'); r.className = 'prop-row';
  const l = document.createElement('label'); l.textContent = label; r.appendChild(l);
  const s = document.createElement('select');
  options.forEach(o => { const op = document.createElement('option'); op.value = o; op.textContent = o; if (o === value) op.selected = true; s.appendChild(op); });
  s.addEventListener('change', () => on(s.value));
  r.appendChild(s); return r;
}

// ============================================================================
// Auto-fit / Auto-arrange / Templates
// ============================================================================
function autoFitItem(item) {
  if (item.type !== 'image' || !item.naturalW || !item.naturalH) return;
  const captionH = (item.captionPos === 'bottom' || item.captionPos === 'top') ? 24 : 0;
  const innerW = item.w;
  const ratio = item.naturalH / item.naturalW;
  item.h = innerW * ratio + captionH;
}

function autoArrangePage(page = getActivePage(), opts = {}) {
  if (!page) return;
  const dims = pageDimensions(page);
  const items = page.items.filter(i => i.type !== 'text');
  if (items.length === 0) return;
  const margin = opts.margin || 24;
  const gap = opts.gap || 16;
  const top = (page.header.show ? 56 : margin);
  const bottom = (page.footer.show ? 56 : margin);
  const cols = opts.cols || Math.max(1, Math.round(Math.sqrt(items.length * (dims.w / (dims.h - top - bottom + margin)))));
  const rows = Math.ceil(items.length / cols);
  const cellW = (dims.w - margin * 2 - gap * (cols - 1)) / cols;
  const cellH = (dims.h - top - bottom - gap * (rows - 1)) / rows;
  items.forEach((it, idx) => {
    const r = Math.floor(idx / cols), c = idx % cols;
    it.x = margin + c * (cellW + gap);
    it.y = top + r * (cellH + gap);
    it.w = cellW; it.h = cellH;
    fitImageInBox(it, cellW, cellH);
  });
  commit(); render();
}

function fitImageInBox(item, boxW, boxH) {
  if (item.type !== 'image' || !item.naturalW || !item.naturalH) return;
  const captionH = (item.captionPos === 'bottom' || item.captionPos === 'top') ? 24 : 0;
  const ratio = item.naturalH / item.naturalW;
  let w = boxW, h = boxW * ratio + captionH;
  if (h > boxH) {
    h = boxH;
    w = (boxH - captionH) / ratio;
  }
  item.w = w; item.h = h;
  item.x += (boxW - w) / 2;
  item.y += (boxH - h) / 2;
}

function applyTemplate(name) {
  const page = createPage($('#pageSize').value, $('#orientation').value);
  const dims = pageDimensions(page);
  const margin = 36;

  if (name === 'cover') {
    page.items.push(makeItem({
      type: 'image', x: margin, y: margin,
      w: dims.w - margin * 2, h: dims.h * 0.55,
      bg: '#f3f4f6', captionPos: 'hidden',
      name: 'Cover image',
    }));
    page.items.push(makeItem({
      type: 'text', x: margin, y: dims.h * 0.55 + margin * 1.5,
      w: dims.w - margin * 2, h: 80,
      text: 'Catalog Title', fontSize: 48, fontWeight: 'bold', align: 'center',
    }));
    page.items.push(makeItem({
      type: 'text', x: margin, y: dims.h * 0.55 + margin * 4,
      w: dims.w - margin * 2, h: 40,
      text: 'Subtitle / Edition', fontSize: 18, color: '#6b7280', align: 'center',
    }));
  } else if (name === 'magazine') {
    page.items.push(makeItem({
      type: 'image', x: margin, y: margin,
      w: dims.w * 0.55, h: dims.h - margin * 2,
      captionPos: 'overlay', name: 'Hero', number: '#001',
    }));
    const rightX = dims.w * 0.55 + margin * 2;
    const rightW = dims.w - rightX - margin;
    const slotH = (dims.h - margin * 2 - 32) / 3;
    for (let i = 0; i < 3; i++) {
      page.items.push(makeItem({
        type: 'image',
        x: rightX, y: margin + i * (slotH + 16),
        w: rightW, h: slotH,
        name: `Item ${i + 1}`, number: `#${String(i + 2).padStart(3, '0')}`,
      }));
    }
  } else {
    const m = name.match(/^(\d+)x(\d+)$/);
    const cols = m ? parseInt(m[1]) : 3;
    const rows = m ? parseInt(m[2]) : 4;
    const gap = 16;
    const cellW = (dims.w - margin * 2 - gap * (cols - 1)) / cols;
    const cellH = (dims.h - margin * 2 - gap * (rows - 1)) / rows;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        page.items.push(makeItem({
          type: 'image',
          x: margin + c * (cellW + gap),
          y: margin + r * (cellH + gap),
          w: cellW, h: cellH,
          name: `Item ${r * cols + c + 1}`,
        }));
      }
    }
  }
  commit(); render();
}

// ============================================================================
// Bulk import
// ============================================================================
function parseCsv(text) {
  // Minimal CSV parser supporting quoted fields and commas in quotes.
  const rows = [];
  let i = 0, field = '', row = [], inQuotes = false;
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i += 2; continue; }
      if (c === '"') { inQuotes = false; i++; continue; }
      field += c; i++; continue;
    }
    if (c === '"') { inQuotes = true; i++; continue; }
    if (c === ',') { row.push(field); field = ''; i++; continue; }
    if (c === '\n' || c === '\r') {
      row.push(field); field = ''; rows.push(row); row = [];
      if (c === '\r' && text[i + 1] === '\n') i++;
      i++; continue;
    }
    field += c; i++;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.length > 1 || (r.length === 1 && r[0]));
}
function parseCsvToMap(text) {
  const rows = parseCsv(text);
  if (rows.length === 0) return {};
  let headers = null;
  const first = rows[0].map(s => s.trim().toLowerCase());
  if (first.some(h => ['filename','file','name','number','sku','code','price','title'].includes(h))) {
    headers = first;
    rows.shift();
  }
  const map = {};
  for (const r of rows) {
    let filename, name, number, price;
    if (headers) {
      filename = r[headers.indexOf('filename')] || r[headers.indexOf('file')] || r[0];
      name = r[headers.indexOf('name')] ?? r[headers.indexOf('title')] ?? '';
      number = r[headers.indexOf('number')] ?? r[headers.indexOf('sku')] ?? r[headers.indexOf('code')] ?? '';
      price = r[headers.indexOf('price')] ?? '';
    } else {
      [filename, name, number, price] = r;
    }
    if (!filename) continue;
    const key = filename.trim().toLowerCase();
    map[key] = { name: (name || '').trim(), number: (number || '').trim(), price: (price || '').trim() };
    const stem = key.replace(/\.[^.]+$/, '');
    map[stem] = map[key];
  }
  return map;
}

async function bulkImport({ files, csv, perPage, autoArrange }) {
  if (!files || files.length === 0) { alert('Pick a folder of images.'); return; }
  const csvMap = csv ? parseCsvToMap(await readAsText(csv)) : {};
  const imageFiles = Array.from(files).filter(f => f.type.startsWith('image/'));
  imageFiles.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

  history.suspended = true;
  setStatus(`Importing ${imageFiles.length} images…`);
  let count = 0;
  let firstNewPage = null;
  const newPages = [];

  for (let idx = 0; idx < imageFiles.length; idx++) {
    const f = imageFiles[idx];
    if (autoArrange && idx % perPage === 0) {
      const np = createPage($('#pageSize').value, $('#orientation').value);
      newPages.push(np);
      if (!firstNewPage) firstNewPage = np;
    }
    const item = await imageItemFromFile(f);
    const meta = csvMap[f.name.toLowerCase()] || csvMap[f.name.replace(/\.[^.]+$/, '').toLowerCase()];
    if (meta) {
      item.name = meta.name || item.name;
      item.number = meta.number || item.number;
      if (meta.price) item.number = (item.number ? item.number + ' • ' : '') + meta.price;
    }
    addItemToActivePage(item, { skipCommit: true, keepSelection: true });
    count++;
    if (count % 10 === 0) setStatus(`Imported ${count}/${imageFiles.length}…`);
  }

  if (autoArrange) {
    newPages.forEach(p => autoArrangePage(p));
  }
  history.suspended = false;
  commit(); render();
  setStatus(`Imported ${count} images`);
}

// ============================================================================
// Selection helpers / clipboard
// ============================================================================
function duplicateSelection() {
  const page = getActivePage(); if (!page) return;
  const sel = getSelectedItems();
  const newIds = new Set();
  for (const it of sel) {
    const copy = JSON.parse(JSON.stringify(it));
    copy.id = 'i' + (state.nextItemId++);
    copy.x = clamp(it.x + 16, 0, pageDimensions(page).w - copy.w);
    copy.y = clamp(it.y + 16, 0, pageDimensions(page).h - copy.h);
    page.items.push(copy);
    newIds.add(copy.id);
  }
  state.selectedItemIds = newIds;
}

function copySelectionToClipboard() {
  const sel = getSelectedItems();
  if (sel.length === 0) return;
  clipboard = sel.map(i => JSON.parse(JSON.stringify(i)));
  setStatus(`Copied ${sel.length} item(s)`);
}
function pasteClipboard() {
  if (clipboard.length === 0) return;
  const page = getActivePage(); if (!page) return;
  const newIds = new Set();
  for (const it of clipboard) {
    const copy = JSON.parse(JSON.stringify(it));
    copy.id = 'i' + (state.nextItemId++);
    copy.x = clamp(copy.x + 16, 0, pageDimensions(page).w - copy.w);
    copy.y = clamp(copy.y + 16, 0, pageDimensions(page).h - copy.h);
    page.items.push(copy);
    newIds.add(copy.id);
  }
  state.selectedItemIds = newIds;
  commit(); render();
}

// ============================================================================
// Save / load JSON
// ============================================================================
function saveJson() {
  const data = JSON.stringify(snapshot(), null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'catalog.json'; a.click();
}
async function loadJson(file) {
  const text = await file.text();
  const snap = JSON.parse(text);
  restore(snap);
  history.stack = []; history.index = -1; commit();
  render();
}

// ============================================================================
// Vector PDF export (jsPDF)
// ============================================================================
async function exportPdf() {
  if (state.pages.length === 0) { alert('Add a page first.'); return; }
  const overlay = $('#exportOverlay'); overlay.hidden = false;

  try {
    const { jsPDF } = window.jspdf;
    let pdf = null;
    for (let i = 0; i < state.pages.length; i++) {
      const page = state.pages[i];
      const dims = pageDimensions(page);
      const wPt = dims.w * PT_PER_PX;
      const hPt = dims.h * PT_PER_PX;
      const orientation = page.orientation === 'landscape' ? 'l' : 'p';
      if (i === 0) {
        pdf = new jsPDF({ orientation, unit: 'pt', format: [wPt, hPt] });
      } else {
        pdf.addPage([wPt, hPt], orientation);
      }
      // background
      pdf.setFillColor(255, 255, 255);
      pdf.rect(0, 0, wPt, hPt, 'F');

      // draw items in z-order
      for (const item of page.items) {
        await drawItemPdf(pdf, item);
      }

      // header / footer
      const pageNum = i + 1, total = state.pages.length;
      if (page.header.show) {
        const txt = renderHfText(page.header.text, pageNum, total);
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(page.header.fontSize || 12);
        pdf.setTextColor('#4b5563');
        pdf.text(txt, 24 * PT_PER_PX, 28 * PT_PER_PX, { baseline: 'top' });
      }
      if (page.footer.show) {
        const txt = renderHfText(page.footer.text, pageNum, total);
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(page.footer.fontSize || 12);
        pdf.setTextColor('#4b5563');
        pdf.text(txt, wPt / 2, hPt - 24 * PT_PER_PX, { align: 'center', baseline: 'bottom' });
      }
    }
    pdf.save('catalog.pdf');
  } catch (err) {
    console.error(err);
    alert('Export failed: ' + err.message);
  } finally {
    overlay.hidden = true;
  }
}

async function drawItemPdf(pdf, item) {
  const x = item.x * PT_PER_PX, y = item.y * PT_PER_PX;
  const w = item.w * PT_PER_PX, h = item.h * PT_PER_PX;
  const radius = (item.radius || 0) * PT_PER_PX;

  // background
  if (item.bg && item.bg !== 'transparent') {
    pdf.setFillColor(item.bg);
    if (radius > 0) pdf.roundedRect(x, y, w, h, radius, radius, 'F');
    else pdf.rect(x, y, w, h, 'F');
  }

  if (item.type === 'image' && item.src) {
    const captionH = (item.captionPos === 'bottom' || item.captionPos === 'top') ? 24 * PT_PER_PX : 0;
    let imgX = x, imgY = y, imgW = w, imgH = h - captionH;
    if (item.captionPos === 'top') { imgY = y + captionH; }
    // contain-fit using natural size if available
    if (item.naturalW && item.naturalH) {
      const r = item.naturalH / item.naturalW;
      let dispW = imgW, dispH = imgW * r;
      if (dispH > imgH) { dispH = imgH; dispW = imgH / r; }
      imgX = imgX + (imgW - dispW) / 2;
      imgY = imgY + (imgH - dispH) / 2;
      imgW = dispW; imgH = dispH;
    }
    try {
      const fmt = (item.src.startsWith('data:image/png')) ? 'PNG' : 'JPEG';
      pdf.addImage(item.src, fmt, imgX, imgY, imgW, imgH, undefined, 'FAST');
    } catch (e) {
      console.warn('addImage failed', e);
    }

    if (item.captionPos !== 'hidden') {
      const capY = item.captionPos === 'top' ? y : (item.captionPos === 'bottom' ? y + h - captionH : y + h - captionH);
      const overlay = item.captionPos === 'overlay';
      if (overlay) {
        pdf.setFillColor('#000000');
        pdf.setGState(new pdf.GState({ opacity: 0.55 }));
        pdf.rect(x, y + h - 24 * PT_PER_PX, w, 24 * PT_PER_PX, 'F');
        pdf.setGState(new pdf.GState({ opacity: 1 }));
        pdf.setTextColor('#ffffff');
      } else {
        pdf.setFillColor('#ffffff');
        pdf.rect(x, capY, w, captionH, 'F');
        pdf.setTextColor('#222222');
      }
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(11);
      const padX = 6 * PT_PER_PX;
      const padY = (overlay ? y + h - 8 * PT_PER_PX : capY + 16 * PT_PER_PX);
      const name = item.name || '';
      const number = item.number || '';
      // name (truncate to width)
      const maxNameW = w - padX * 2 - pdf.getTextWidth(number) - 8;
      const nameLines = pdf.splitTextToSize(name, maxNameW);
      pdf.text(nameLines[0] || '', x + padX, padY);
      if (number) {
        if (overlay) pdf.setTextColor('#d1d5db'); else pdf.setTextColor('#6b7280');
        pdf.text(number, x + w - padX, padY, { align: 'right' });
      }
    }
  } else if (item.type === 'text') {
    pdf.setFont(item.fontFamily || 'helvetica', item.fontWeight || 'normal');
    pdf.setFontSize(item.fontSize || 14);
    pdf.setTextColor(item.color || '#222222');
    const padX = 6 * PT_PER_PX, padY = 6 * PT_PER_PX;
    const maxW = w - padX * 2;
    const lines = pdf.splitTextToSize(item.text || '', maxW);
    const lineH = (item.fontSize || 14) * 1.2;
    let ty = y + padY + lineH * 0.8;
    for (const line of lines) {
      if (ty > y + h - padY) break;
      let tx = x + padX;
      let opts = {};
      if (item.align === 'center') { tx = x + w / 2; opts.align = 'center'; }
      else if (item.align === 'right') { tx = x + w - padX; opts.align = 'right'; }
      pdf.text(line, tx, ty, opts);
      ty += lineH;
    }
  }

  // border
  if (item.border && item.border.width > 0) {
    pdf.setDrawColor(item.border.color || '#222');
    pdf.setLineWidth(item.border.width * PT_PER_PX);
    if (radius > 0) pdf.roundedRect(x, y, w, h, radius, radius, 'D');
    else pdf.rect(x, y, w, h, 'D');
  }
}

// ============================================================================
// UI wiring
// ============================================================================
function setStatus(msg) {
  $('#statusBar').textContent = msg;
}

$('#addImage').addEventListener('change', async e => { await loadImageFiles(e.target.files); e.target.value = ''; });
$('#addPdf').addEventListener('change', async e => {
  for (const f of e.target.files) await loadPdfFile(f);
  e.target.value = '';
});
$('#addText').addEventListener('click', () => {
  addItemToActivePage(makeItem({ type: 'text', text: 'Heading', w: 320, h: 60, fontSize: 28, fontWeight: 'bold' }));
});
$('#addCard').addEventListener('click', () => {
  addItemToActivePage(makeItem({ type: 'image', src: null, w: 240, h: 200, name: 'Item Name', number: '#001' }));
});
$('#orientation').addEventListener('change', e => { const p = getActivePage(); if (p) { p.orientation = e.target.value; commit(); render(); } });
$('#pageSize').addEventListener('change', e => { const p = getActivePage(); if (p) { p.size = e.target.value; commit(); render(); } });
$('#addPage').addEventListener('click', () => { createPage($('#pageSize').value, $('#orientation').value); commit(); render(); });

$('#templatesBtn').addEventListener('click', e => {
  e.stopPropagation();
  document.querySelector('.dropdown').classList.toggle('open');
});
document.addEventListener('click', () => document.querySelector('.dropdown').classList.remove('open'));
$('#templatesMenu').addEventListener('click', e => {
  const tpl = e.target.dataset.tpl;
  if (tpl) { applyTemplate(tpl); document.querySelector('.dropdown').classList.remove('open'); }
});

$('#snapEnabled').addEventListener('change', e => { state.snap.enabled = e.target.checked; });
$('#snapSize').addEventListener('change', e => { state.snap.size = Math.max(1, parseInt(e.target.value) || 8); });
$('#guidesEnabled').addEventListener('change', e => { state.guidesEnabled = e.target.checked; });

$('#autoFit').addEventListener('click', () => {
  const sel = getSelectedItems();
  if (sel.length === 0) { alert('Select item(s) first.'); return; }
  sel.forEach(autoFitItem); commit(); render();
});
$('#autoArrange').addEventListener('click', () => autoArrangePage());

$('#undoBtn').addEventListener('click', undo);
$('#redoBtn').addEventListener('click', redo);

$('#saveJson').addEventListener('click', saveJson);
$('#loadJson').addEventListener('change', async e => { if (e.target.files[0]) await loadJson(e.target.files[0]); e.target.value = ''; });
$('#clearAll').addEventListener('click', async () => {
  if (!confirm('Clear everything? This cannot be undone past the undo limit.')) return;
  state.pages = []; state.selectedItemIds = new Set(); state.nextItemId = 1; state.nextPageId = 1;
  createPage('A4', 'portrait'); commit(); render();
  await dbDel('current');
});

$('#exportPdf').addEventListener('click', exportPdf);

$('#openBulk').addEventListener('click', () => { $('#bulkModal').hidden = false; });
$('#bulkCancel').addEventListener('click', () => { $('#bulkModal').hidden = true; });
$('#bulkRun').addEventListener('click', async () => {
  $('#bulkModal').hidden = true;
  await bulkImport({
    files: $('#bulkImages').files,
    csv: $('#bulkCsv').files[0],
    perPage: Math.max(1, parseInt($('#bulkPerPage').value) || 6),
    autoArrange: $('#bulkAutoArrange').checked,
  });
});

$('#headerFooterBtn').addEventListener('click', () => {
  const p = getActivePage(); if (!p) return;
  $('#hfHeaderShow').checked = p.header.show;
  $('#hfHeaderText').value = p.header.text || '';
  $('#hfFooterShow').checked = p.footer.show;
  $('#hfFooterText').value = p.footer.text || '';
  $('#hfApplyAll').checked = false;
  $('#hfModal').hidden = false;
});
$('#hfCancel').addEventListener('click', () => { $('#hfModal').hidden = true; });
$('#hfSave').addEventListener('click', () => {
  const headerShow = $('#hfHeaderShow').checked;
  const headerText = $('#hfHeaderText').value;
  const footerShow = $('#hfFooterShow').checked;
  const footerText = $('#hfFooterText').value;
  const all = $('#hfApplyAll').checked;
  const targets = all ? state.pages : [getActivePage()].filter(Boolean);
  targets.forEach(p => {
    p.header.show = headerShow; p.header.text = headerText;
    p.footer.show = footerShow; p.footer.text = footerText;
  });
  $('#hfModal').hidden = true;
  commit(); render();
});

document.addEventListener('keydown', (e) => {
  const tag = (e.target.tagName || '').toLowerCase();
  const editing = tag === 'input' || tag === 'textarea' || e.target.isContentEditable;
  if (editing) return;

  const meta = e.ctrlKey || e.metaKey;
  if (meta && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return; }
  if (meta && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) { e.preventDefault(); redo(); return; }
  if (meta && e.key.toLowerCase() === 'c') { copySelectionToClipboard(); return; }
  if (meta && e.key.toLowerCase() === 'v') { pasteClipboard(); return; }
  if (meta && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicateSelection(); commit(); render(); return; }
  if (meta && e.key.toLowerCase() === 'a') {
    e.preventDefault();
    const p = getActivePage(); if (!p) return;
    state.selectedItemIds = new Set(p.items.map(i => i.id));
    render(); return;
  }

  if (e.key === 'Delete' || e.key === 'Backspace') {
    const sel = getSelectedItems();
    if (sel.length) {
      const page = getActivePage();
      const ids = new Set(sel.map(i => i.id));
      page.items = page.items.filter(i => !ids.has(i.id));
      state.selectedItemIds = new Set();
      commit(); render();
    }
    return;
  }
  if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)) {
    const step = e.shiftKey ? 10 : 1;
    const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
    const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
    const sel = getSelectedItems();
    if (sel.length) {
      e.preventDefault();
      const page = getActivePage();
      const dims = pageDimensions(page);
      sel.forEach(it => {
        it.x = clamp(it.x + dx, 0, dims.w - it.w);
        it.y = clamp(it.y + dy, 0, dims.h - it.h);
      });
      commit(); render();
    }
  }
});

// ============================================================================
// Bootstrap with autosave restore
// ============================================================================
(async function init() {
  try {
    const saved = await dbGet('current');
    if (saved && saved.pages && saved.pages.length > 0) {
      restore(saved);
      commit();
      render();
      setStatus('Restored from auto-save');
      return;
    }
  } catch (e) { console.warn('Restore failed:', e); }
  createPage('A4', 'portrait');
  commit();
  render();
  setStatus('Ready');
})();
