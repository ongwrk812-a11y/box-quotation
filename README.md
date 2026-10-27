# Web Fomular

MYBOX quotation page with live pricing and Pizza Box 2D parametric dieline preview.

## Current scope

- Home page box selection (RSC, 5 Panel, Pizza, Gift)
- Quotation page with real-time pricing
- Pizza Box Template-B 2D dieline redraw from L/W/H inputs

## Project structure

```text
C:\Users\Zhi\Desktop\Web Fomular
|-- index.html
|-- serve.js
|-- start-server.bat
|-- README.md
|-- assets
|   |-- images
|   |   |-- logo.png
|   |   |-- rsc.png
|   |   |-- 5panel.png
|   |   |-- pizza.png
|   |   `-- gift.png
|   `-- pizza-box
|       `-- 2d
|           `-- templates
|               |-- Pizza Box ... (Clean).svg
|               |-- Pizza Box ... (Detail).svg
|               `-- Pizza Box ... .ai
`-- scripts
    |-- app.js
    `-- models
        `-- pizza-template-b-model.js
```

## Run locally

1. Install Node.js (if not installed).
2. In this folder, run:
   - `node serve.js`
3. Open:
   - `http://127.0.0.1:5173/index.html`

Or double-click `start-server.bat`.

## Pricing rules (current)

- MOQ: `30`
- 3 Layer minimum unit price before discount: `RM 1.00`
- 5 Layer minimum unit price before discount: `RM 1.50`
- Quantity discount:
  - `>= 100`: 10%
  - `>= 500`: 15%
  - `>= 1000`: 20%

## Pizza Box 2D model

- Source model file: `scripts/models/pizza-template-b-model.js`
- Runtime logic: `scripts/app.js`
- Validation:
  - `L: 50..1000`
  - `W: 40..L`
  - `H: 25..(W + X)` where `X = 2`

## Extension guideline (next: RSC / 5 Panel 2D)

- Keep each box type data and references under `assets/<box-type>/2d/`.
- Keep rendering formulas and UI logic in `scripts/app.js` (or split into `scripts/<box-type>.js` when logic grows).
- Keep all gallery/thumbnail assets in `assets/images/` only.
