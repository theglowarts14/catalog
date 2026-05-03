# Catalog Creator

A self-contained, browser-based catalog creator with free-flow layout, image/PDF
import, multi-page support, landscape/portrait toggle, autofit, and **vector**
PDF export.

## Features

### Content
- **Images** — add multiple JPG/PNG/WebP files. Each gets a caption with name + number.
- **PDF import** — every page of an uploaded PDF becomes its own catalog item (rendered via pdf.js).
- **Text blocks** — editable text with font family / weight / size / color / alignment.
- **Bulk import** — pick a folder of images plus an optional CSV
  (`filename,name,number,price` — header optional). Auto-paginates into a chosen
  grid size.

### Layout
- **Free-flow** — drag and resize items anywhere; 8 resize handles per item.
- **Multi-select** — Shift-click items, or marquee-drag on empty page area.
  Group drag, delete, duplicate.
- **Snap-to-grid** — toggleable, configurable grid size.
- **Alignment guides** — pink lines appear when edges/centers align with other items.
- **Auto-Fit** — preserves an image's natural aspect ratio inside its frame.
- **Auto-Arrange** — grids the page's items based on count and aspect ratio.
- **Templates** — Cover page, 2×3 / 3×4 / 4×5 grids, magazine layout.
- **Header / Footer** — per-page or apply-to-all, with `{page}` and `{total}`
  placeholders for page numbering.

### Per-item styling
- Background color, border (width + color), corner radius, drop shadow.
- Caption position: bottom, top, overlay, or hidden.

### Pages
- A4 / Letter / A3 / A5; portrait / landscape per page.
- Reorder, duplicate, delete via the sidebar.

### State management
- **Undo / Redo** — `Ctrl+Z` / `Ctrl+Shift+Z`. ~80 step history.
- **Auto-save** — every change is debounced and saved to IndexedDB. The session
  is restored automatically on next load.
- **Save / Load JSON** — exports the whole catalog as a JSON file (images
  embedded as data URLs, fully round-tripping).
- **Clear** — wipes everything (with confirm).

### Export
- **Vector PDF** — renders text as real PDF text and images as embedded
  bitmaps via jsPDF. Smaller files, sharper text, selectable copy.
- Headers, footers, page numbering, borders, backgrounds, captions all rendered
  natively in the PDF.

## Run

It's just static files — no build step, no server required.

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

(Opening via `file://` mostly works but PDF.js prefers `http://`.)

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+Z` / `Ctrl+Shift+Z` | Undo / redo |
| `Ctrl+C` / `Ctrl+V` | Copy / paste selected items |
| `Ctrl+D` | Duplicate selection |
| `Ctrl+A` | Select all on page |
| `Delete` / `Backspace` | Delete selection |
| `Arrow keys` | Nudge selection (1px; `Shift` = 10px) |
| `Shift+click` | Toggle item in selection |
| `Drag empty area` | Marquee-select |

## Stack

Vanilla HTML / CSS / JS. Loads from CDN:

- [pdf.js](https://mozilla.github.io/pdf.js/) for PDF rendering
- [jsPDF](https://github.com/parallax/jsPDF) for vector PDF output

No data leaves the browser.
