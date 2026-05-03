// Catalog Creator - free-flow page-based catalog with image/PDF/text items.
// Self-contained vanilla JS. Persists in-memory; Save/Load uses JSON files.

pdfjsLib.GlobalWorkerOptions.workerSrc =
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// Page sizes in CSS pixels at 96 DPI (1in = 96px).
const PAGE_SIZES = {
  A4:     { w: 794,  h: 1123 },
  Letter: { w: 816,  h: 1056 },
  A3:     { w: 1123, h: 1587 },
  A5:     { w: 559,  h: 794 },
};

const state = {
  pages: [],          // [{ id, size, orientation, items: [...] }]
  activePageId: null,
  selectedItemId: null,
  nextItemId: 1,
  nextPageId: 1,
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

// ---------------------------- Page management ----------------------------
function pageDimensions(page) {
  const base = PAGE_SIZES[page.size] || PAGE_SIZES.A4;
  return page.orientation === 'landscape'
    ? { w: base.h, h: base.w }
    : { w: base.w, h: base.h };
}

function createPage(size = 'A4', orientation = 'portrait') {
  const page = {
    id: 'p' + (state.nextPageId++),
    size, orientation, items: [],
  };
  state.pages.push(page);
  state.activePageId = page.id;
  return page;
}

function getActivePage() {
  return state.pages.find(p => p.id === state.activePageId);
}

function getSelectedItem() {
  const page = getActivePage();
  if (!page) return null;
  return page.items.find(i => i.id === state.selectedItemId) || null;
}

// ---------------------------- Item creation ----------------------------
function defaultItem(overrides = {}) {
  return {
    id: 'i' + (state.nextItemId++),
    type: 'image',
    x: 40, y: 40, w: 240, h: 200,
    name: '', number: '',
    showCaption: true,
    src: null,        // dataURL for image, or rendered PDF page
    text: '',
    fontSize: 16,
    color: '#222222',
    align: 'left',
    bg: 'transparent',
    ...overrides,
  };
}

function addItemToActivePage(item) {
  let page = getActivePage();
  if (!page) page = createPage();
  page.items.push(item);
  state.selectedItemId = item.id;
  render();
}

// ---------------------------- File loaders ----------------------------
function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

function readFileAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsArrayBuffer(file);
  });
}

async function loadImageFile(file) {
  const dataUrl = await readFileAsDataURL(file);
  const dims = await new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.src = dataUrl;
  });
  // fit to max 400 wide while preserving ratio
  const maxW = 400;
  const ratio = dims.h / dims.w;
  const w = Math.min(maxW, dims.w);
  const h = w * ratio;
  const baseName = file.name.replace(/\.[^.]+$/, '');
  addItemToActivePage(defaultItem({
    type: 'image', src: dataUrl,
    w, h: h + 24, // +24 for caption strip
    name: baseName,
    naturalW: dims.w, naturalH: dims.h,
  }));
}

async function loadPdfFile(file) {
  const buf = await readFileAsArrayBuffer(file);
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const pdfPage = await pdf.getPage(pageNum);
    const viewport = pdfPage.getViewport({ scale: 2 });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d');
    await pdfPage.render({ canvasContext: ctx, viewport }).promise;
    const dataUrl = canvas.toDataURL('image/png');
    const ratio = viewport.height / viewport.width;
    const w = 400;
    const h = w * ratio;
    addItemToActivePage(defaultItem({
      type: 'image', src: dataUrl,
      w, h: h + 24,
      name: `${file.name.replace(/\.pdf$/i,'')} - p${pageNum}`,
      number: String(pageNum),
      naturalW: viewport.width, naturalH: viewport.height,
    }));
  }
}

// ---------------------------- Rendering ----------------------------
function render() {
  const page = getActivePage();
  if (page) {
    const o = document.getElementById('orientation');
    const s = document.getElementById('pageSize');
    if (o) o.value = page.orientation;
    if (s) s.value = page.size;
  }
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
    div.innerHTML = `<span>Page ${idx + 1} (${p.size}, ${p.orientation})</span>`;
    const del = document.createElement('button');
    del.textContent = '✕';
    del.title = 'Delete page';
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!confirm('Delete this page?')) return;
      state.pages = state.pages.filter(x => x.id !== p.id);
      if (state.activePageId === p.id) {
        state.activePageId = state.pages[0]?.id || null;
      }
      render();
    });
    div.appendChild(del);
    div.addEventListener('click', () => {
      state.activePageId = p.id;
      state.selectedItemId = null;
      render();
    });
    list.appendChild(div);
  });
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

    pageEl.addEventListener('mousedown', (e) => {
      if (e.target === pageEl) {
        state.activePageId = p.id;
        state.selectedItemId = null;
        render();
      }
    });

    p.items.forEach((item) => {
      pageEl.appendChild(buildItemElement(item, p));
    });

    root.appendChild(pageEl);
  });
}

function buildItemElement(item, page) {
  const el = document.createElement('div');
  el.className = 'item' + (item.id === state.selectedItemId ? ' selected' : '') +
                 (item.type === 'text' ? ' text-item' : '') +
                 (!item.showCaption ? ' no-caption' : '');
  el.style.left = item.x + 'px';
  el.style.top = item.y + 'px';
  el.style.width = item.w + 'px';
  el.style.height = item.h + 'px';
  el.dataset.itemId = item.id;

  const content = document.createElement('div');
  content.className = 'content';

  if (item.type === 'image' && item.src) {
    const img = document.createElement('img');
    img.src = item.src;
    img.draggable = false;
    content.appendChild(img);
  } else if (item.type === 'text') {
    const text = document.createElement('div');
    text.className = 'text-content';
    text.contentEditable = 'true';
    text.style.fontSize = (item.fontSize || 16) + 'px';
    text.style.color = item.color || '#222';
    text.style.textAlign = item.align || 'left';
    text.style.background = item.bg || 'transparent';
    text.textContent = item.text || 'Type here...';
    text.addEventListener('input', () => {
      item.text = text.textContent;
    });
    text.addEventListener('mousedown', (e) => e.stopPropagation());
    content.appendChild(text);
  } else {
    content.textContent = '(empty)';
  }

  el.appendChild(content);

  if (item.type !== 'text' && item.showCaption) {
    const cap = document.createElement('div');
    cap.className = 'caption';
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = item.name || '';
    const num = document.createElement('span');
    num.className = 'number';
    num.textContent = item.number || '';
    cap.appendChild(name);
    cap.appendChild(num);
    el.appendChild(cap);
  }

  ['nw','ne','sw','se','n','s','e','w'].forEach(dir => {
    const h = document.createElement('div');
    h.className = 'handle ' + dir;
    h.dataset.dir = dir;
    el.appendChild(h);
  });

  attachItemInteractions(el, item, page);

  return el;
}

// ---------------------------- Drag/Resize ----------------------------
function attachItemInteractions(el, item, page) {
  el.addEventListener('mousedown', (e) => {
    if (e.target.classList.contains('handle')) {
      startResize(e, el, item, page, e.target.dataset.dir);
      return;
    }
    if (e.target.closest('.text-content')) return;
    state.activePageId = page.id;
    state.selectedItemId = item.id;
    startDrag(e, el, item, page);
    render();
  });
}

function startDrag(e, el, item, page) {
  e.preventDefault();
  const startX = e.clientX, startY = e.clientY;
  const origX = item.x, origY = item.y;
  const dims = pageDimensions(page);

  function move(ev) {
    const dx = ev.clientX - startX;
    const dy = ev.clientY - startY;
    item.x = Math.max(0, Math.min(dims.w - item.w, origX + dx));
    item.y = Math.max(0, Math.min(dims.h - item.h, origY + dy));
    el.style.left = item.x + 'px';
    el.style.top = item.y + 'px';
  }
  function up() {
    document.removeEventListener('mousemove', move);
    document.removeEventListener('mouseup', up);
    renderProps();
  }
  document.addEventListener('mousemove', move);
  document.addEventListener('mouseup', up);
}

function startResize(e, el, item, page, dir) {
  e.preventDefault();
  e.stopPropagation();
  const startX = e.clientX, startY = e.clientY;
  const origX = item.x, origY = item.y, origW = item.w, origH = item.h;
  const dims = pageDimensions(page);
  state.selectedItemId = item.id;

  function move(ev) {
    let dx = ev.clientX - startX;
    let dy = ev.clientY - startY;
    let nx = origX, ny = origY, nw = origW, nh = origH;
    if (dir.includes('e')) nw = Math.max(40, origW + dx);
    if (dir.includes('s')) nh = Math.max(40, origH + dy);
    if (dir.includes('w')) { nw = Math.max(40, origW - dx); nx = origX + (origW - nw); }
    if (dir.includes('n')) { nh = Math.max(40, origH - dy); ny = origY + (origH - nh); }
    nx = Math.max(0, Math.min(dims.w - nw, nx));
    ny = Math.max(0, Math.min(dims.h - nh, ny));
    nw = Math.min(nw, dims.w - nx);
    nh = Math.min(nh, dims.h - ny);
    item.x = nx; item.y = ny; item.w = nw; item.h = nh;
    el.style.left = nx + 'px'; el.style.top = ny + 'px';
    el.style.width = nw + 'px'; el.style.height = nh + 'px';
  }
  function up() {
    document.removeEventListener('mousemove', move);
    document.removeEventListener('mouseup', up);
    renderProps();
  }
  document.addEventListener('mousemove', move);
  document.addEventListener('mouseup', up);
}

// ---------------------------- Properties panel ----------------------------
function renderProps() {
  const root = $('#props');
  const item = getSelectedItem();
  if (!item) {
    root.innerHTML = '<div class="prop-empty">Select an item to edit its properties.</div>';
    return;
  }
  root.innerHTML = '';

  const rows = [];

  if (item.type !== 'text') {
    rows.push(propText('Name', item.name, (v) => { item.name = v; render(); }));
    rows.push(propText('Number / Code', item.number, (v) => { item.number = v; render(); }));
    rows.push(propCheckbox('Show caption', item.showCaption, (v) => { item.showCaption = v; render(); }));
  } else {
    rows.push(propTextarea('Text', item.text, (v) => { item.text = v; render(); }));
    rows.push(propNumber('Font size', item.fontSize, (v) => { item.fontSize = v; render(); }));
    rows.push(propText('Color', item.color, (v) => { item.color = v; render(); }, 'color'));
    rows.push(propSelect('Align', item.align, ['left','center','right','justify'], (v) => { item.align = v; render(); }));
  }

  const dimRow = document.createElement('div');
  dimRow.className = 'prop-row';
  dimRow.innerHTML = `<label>Position & Size</label>`;
  const grid = document.createElement('div');
  grid.style.display = 'grid';
  grid.style.gridTemplateColumns = '1fr 1fr';
  grid.style.gap = '6px';
  ['x','y','w','h'].forEach(k => {
    const inp = document.createElement('input');
    inp.type = 'number';
    inp.value = Math.round(item[k]);
    inp.placeholder = k.toUpperCase();
    inp.addEventListener('change', () => { item[k] = parseFloat(inp.value) || 0; render(); });
    grid.appendChild(inp);
  });
  dimRow.appendChild(grid);
  rows.push(dimRow);

  const actions = document.createElement('div');
  actions.className = 'prop-actions';
  actions.innerHTML = `
    <button class="btn" data-act="autofit">Auto-Fit</button>
    <button class="btn" data-act="front">Bring Front</button>
    <button class="btn" data-act="back">Send Back</button>
    <button class="btn" data-act="dup">Duplicate</button>
    <button class="btn danger" data-act="del">Delete</button>
  `;
  actions.addEventListener('click', (e) => {
    const a = e.target.dataset.act;
    if (!a) return;
    const page = getActivePage();
    if (a === 'autofit') autoFitItem(item);
    if (a === 'front') {
      page.items = page.items.filter(i => i.id !== item.id).concat(item);
    }
    if (a === 'back') {
      page.items = [item].concat(page.items.filter(i => i.id !== item.id));
    }
    if (a === 'dup') {
      const copy = JSON.parse(JSON.stringify(item));
      copy.id = 'i' + (state.nextItemId++);
      copy.x += 16; copy.y += 16;
      page.items.push(copy);
      state.selectedItemId = copy.id;
    }
    if (a === 'del') {
      page.items = page.items.filter(i => i.id !== item.id);
      state.selectedItemId = null;
    }
    render();
  });
  rows.push(actions);

  rows.forEach(r => root.appendChild(r));
}

function propText(label, value, onChange, type = 'text') {
  const row = document.createElement('div');
  row.className = 'prop-row';
  const lab = document.createElement('label'); lab.textContent = label;
  const inp = document.createElement('input'); inp.type = type; inp.value = value || '';
  inp.addEventListener('change', () => onChange(inp.value));
  row.appendChild(lab); row.appendChild(inp);
  return row;
}
function propTextarea(label, value, onChange) {
  const row = document.createElement('div');
  row.className = 'prop-row';
  const lab = document.createElement('label'); lab.textContent = label;
  const inp = document.createElement('textarea'); inp.value = value || '';
  inp.addEventListener('change', () => onChange(inp.value));
  row.appendChild(lab); row.appendChild(inp);
  return row;
}
function propNumber(label, value, onChange) {
  const row = document.createElement('div');
  row.className = 'prop-row';
  const lab = document.createElement('label'); lab.textContent = label;
  const inp = document.createElement('input'); inp.type = 'number'; inp.value = value;
  inp.addEventListener('change', () => onChange(parseFloat(inp.value) || 0));
  row.appendChild(lab); row.appendChild(inp);
  return row;
}
function propCheckbox(label, value, onChange) {
  const row = document.createElement('div');
  row.className = 'prop-row';
  const wrap = document.createElement('label');
  wrap.style.display = 'flex'; wrap.style.flexDirection = 'row';
  wrap.style.alignItems = 'center'; wrap.style.gap = '6px'; wrap.style.textTransform = 'none';
  wrap.style.fontSize = '13px'; wrap.style.color = '#222';
  const inp = document.createElement('input'); inp.type = 'checkbox'; inp.checked = !!value;
  inp.addEventListener('change', () => onChange(inp.checked));
  wrap.appendChild(inp);
  wrap.appendChild(document.createTextNode(label));
  row.appendChild(wrap);
  return row;
}
function propSelect(label, value, options, onChange) {
  const row = document.createElement('div');
  row.className = 'prop-row';
  const lab = document.createElement('label'); lab.textContent = label;
  const sel = document.createElement('select');
  options.forEach(o => {
    const op = document.createElement('option');
    op.value = o; op.textContent = o;
    if (o === value) op.selected = true;
    sel.appendChild(op);
  });
  sel.addEventListener('change', () => onChange(sel.value));
  row.appendChild(lab); row.appendChild(sel);
  return row;
}

// ---------------------------- Auto-fit / Auto-arrange ----------------------------
function autoFitItem(item) {
  // For images: keep image natural aspect ratio inside current box (caption strip stays).
  if (item.type === 'image' && item.naturalW && item.naturalH) {
    const captionH = item.showCaption ? 24 : 0;
    const innerW = item.w;
    const innerH = item.h - captionH;
    const ratio = item.naturalH / item.naturalW;
    // Adjust h so the picture region matches w*ratio, preserving width.
    item.h = innerW * ratio + captionH;
  }
}

function autoArrangePage() {
  const page = getActivePage();
  if (!page) return;
  const dims = pageDimensions(page);
  const items = page.items.filter(i => i.type !== 'text');
  if (items.length === 0) return;
  const margin = 24;
  const gap = 16;
  // Choose grid columns based on count and orientation.
  const cols = Math.min(items.length, Math.max(2, Math.round(Math.sqrt(items.length * (dims.w / dims.h)))));
  const rows = Math.ceil(items.length / cols);
  const cellW = (dims.w - margin * 2 - gap * (cols - 1)) / cols;
  const cellH = (dims.h - margin * 2 - gap * (rows - 1)) / rows;
  items.forEach((item, idx) => {
    const r = Math.floor(idx / cols);
    const c = idx % cols;
    item.x = margin + c * (cellW + gap);
    item.y = margin + r * (cellH + gap);
    item.w = cellW;
    item.h = cellH;
    autoFitItem(item);
    // Recenter within cell vertically if image is shorter than cell.
    if (item.h < cellH) {
      item.y += (cellH - item.h) / 2;
    } else if (item.h > cellH) {
      // shrink to fit
      const captionH = item.showCaption ? 24 : 0;
      const ratio = (item.naturalH || 1) / (item.naturalW || 1);
      const fitW = (cellH - captionH) / ratio;
      if (fitW > 0 && fitW <= cellW) {
        item.w = fitW;
        item.h = cellH;
        item.x = margin + c * (cellW + gap) + (cellW - fitW) / 2;
      } else {
        item.h = cellH;
      }
    }
  });
  render();
}

// ---------------------------- Save / Load / Export ----------------------------
function saveJson() {
  const data = JSON.stringify(state, null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'catalog.json';
  a.click();
}

async function loadJson(file) {
  const text = await file.text();
  const data = JSON.parse(text);
  state.pages = data.pages || [];
  state.activePageId = data.activePageId || (state.pages[0]?.id || null);
  state.selectedItemId = null;
  state.nextItemId = data.nextItemId || 1;
  state.nextPageId = data.nextPageId || 1;
  render();
}

async function exportPdf() {
  if (state.pages.length === 0) { alert('Add a page first.'); return; }
  const overlay = document.createElement('div');
  overlay.id = 'exportOverlay';
  overlay.className = 'visible';
  overlay.textContent = 'Generating PDF...';
  document.body.appendChild(overlay);
  try {
    const prevSelected = state.selectedItemId;
    state.selectedItemId = null;
    render();
    await new Promise(r => setTimeout(r, 50));

    const { jsPDF } = window.jspdf;
    let pdf = null;
    const pageEls = $$('.page');

    for (let i = 0; i < pageEls.length; i++) {
      const pageEl = pageEls[i];
      const page = state.pages[i];
      const dims = pageDimensions(page);
      const canvas = await html2canvas(pageEl, {
        backgroundColor: '#ffffff',
        scale: 2,
        useCORS: true,
        logging: false,
      });
      const img = canvas.toDataURL('image/jpeg', 0.92);

      // jsPDF uses points by default; we'll use px units to match our CSS sizing.
      const orientation = page.orientation === 'landscape' ? 'l' : 'p';
      if (i === 0) {
        pdf = new jsPDF({ orientation, unit: 'px', format: [dims.w, dims.h], hotfixes: ['px_scaling'] });
      } else {
        pdf.addPage([dims.w, dims.h], orientation);
      }
      pdf.addImage(img, 'JPEG', 0, 0, dims.w, dims.h);
    }

    pdf.save('catalog.pdf');
    state.selectedItemId = prevSelected;
    render();
  } catch (err) {
    console.error(err);
    alert('Export failed: ' + err.message);
  } finally {
    overlay.remove();
  }
}

// ---------------------------- Toolbar wiring ----------------------------
$('#addImage').addEventListener('change', async (e) => {
  for (const f of e.target.files) {
    await loadImageFile(f);
  }
  e.target.value = '';
});

$('#addPdf').addEventListener('change', async (e) => {
  for (const f of e.target.files) {
    await loadPdfFile(f);
  }
  e.target.value = '';
});

$('#addText').addEventListener('click', () => {
  addItemToActivePage(defaultItem({ type: 'text', text: 'Heading', w: 300, h: 60, fontSize: 24 }));
});

$('#addCard').addEventListener('click', () => {
  addItemToActivePage(defaultItem({
    type: 'image', src: null, w: 240, h: 200,
    name: 'Item Name', number: '#001',
  }));
});

$('#orientation').addEventListener('change', (e) => {
  const page = getActivePage();
  if (page) { page.orientation = e.target.value; render(); }
});

$('#pageSize').addEventListener('change', (e) => {
  const page = getActivePage();
  if (page) { page.size = e.target.value; render(); }
});

$('#addPage').addEventListener('click', () => {
  const size = $('#pageSize').value;
  const orientation = $('#orientation').value;
  createPage(size, orientation);
  render();
});

$('#autoFit').addEventListener('click', () => {
  const item = getSelectedItem();
  if (item) { autoFitItem(item); render(); }
  else alert('Select an item first.');
});

$('#autoArrange').addEventListener('click', autoArrangePage);

$('#saveJson').addEventListener('click', saveJson);

$('#loadJson').addEventListener('change', async (e) => {
  if (e.target.files[0]) await loadJson(e.target.files[0]);
  e.target.value = '';
});

$('#exportPdf').addEventListener('click', exportPdf);

document.addEventListener('keydown', (e) => {
  if (e.key === 'Delete' || e.key === 'Backspace') {
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || e.target.isContentEditable) return;
    const item = getSelectedItem();
    if (item) {
      const page = getActivePage();
      page.items = page.items.filter(i => i.id !== item.id);
      state.selectedItemId = null;
      render();
    }
  }
});

// Bootstrap
createPage('A4', 'portrait');
render();
