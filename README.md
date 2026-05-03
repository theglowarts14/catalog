# Catalog Creator

A self-contained, browser-based catalog creator with free-flow layout, image/PDF
import, multi-page support, landscape/portrait toggle, autofit, and PDF export.

## Features

- **Free-flow layout** — drag and resize items anywhere on the page.
- **Images** — add multiple JPG/PNG/WebP files. Each gets a caption with name + number.
- **PDF import** — every page of an uploaded PDF becomes its own catalog item (rendered via pdf.js).
- **Text blocks** — editable text with font size / color / alignment.
- **Pages** — A4 / Letter / A3 / A5, portrait or landscape, multiple pages.
- **Auto-fit** — preserves an image's natural aspect ratio inside its frame.
- **Auto-arrange** — grid the page's items based on count and aspect ratio.
- **Save / Load** — exports the whole catalog as a JSON file (images embedded as data URLs).
- **Export PDF** — flatten every page to a single PDF using html2canvas + jsPDF.

## Run

It's just static files — no build step, no server required.

Open `index.html` in a modern browser. To avoid `file://` quirks with PDF.js,
run a tiny local server:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

## Usage

1. Click **+ Image(s)** or **+ PDF** to import files. Each image / PDF page is
   added as a draggable item on the active page.
2. Click an item to select it; drag to move, drag a corner/edge to resize.
3. Edit name and number in the right-hand properties panel.
4. **Auto-Fit Selected** restores the image's aspect ratio.
5. **Auto-Arrange Page** lays all items out in a grid.
6. **+ Page** adds another page in the chosen orientation/size.
7. **Export PDF** generates `catalog.pdf` with every page.

## Keyboard

- `Delete` / `Backspace` removes the selected item (when not editing text).

## Stack

Vanilla HTML / CSS / JS. Loads three libraries from CDN:

- [pdf.js](https://mozilla.github.io/pdf.js/) for PDF rendering
- [jsPDF](https://github.com/parallax/jsPDF) for PDF output
- [html2canvas](https://html2canvas.hertzen.com/) to rasterize each page

No data leaves the browser.
