# Pixel Painter Studio — Claude Code Context

## What this is
A Figma plugin for drag-to-paint pixel art directly inside Figma. The painting surface is an HTML canvas inside the plugin window. On Apply, it writes cells back to Figma as named rectangles. No external dependencies, no server, no network calls.

**Published on Figma Community** — plugin ID `1643296970831494477`. Changes go live via "Publish new version" in the Community listing.

---

## Build system

```
node build.js
```

- Reads `ui/index.html`, inlines `ui/styles.css` and all JS modules as `<style>`/`<script>` tags
- Writes the result into `code.js` above the `// === SANDBOX START ===` marker
- Everything below that marker is the Figma plugin sandbox (backend) code — edit it directly in `code.js`, it is preserved between builds
- After any change to `ui/` files: run `node build.js` then reload the plugin in Figma

**Do not edit `code.js` above the SANDBOX START marker** — it is overwritten on every build.

---

## File structure

| File | Purpose |
|---|---|
| `manifest.json` | Figma plugin manifest — ID, permissions, API version |
| `code.js` | Built output — do not edit the top section; sandbox section is editable |
| `build.js` | Build script — inlines UI into code.js |
| `ui/index.html` | Plugin UI shell — markup only, no inline styles or scripts |
| `ui/styles.css` | All styles |
| `ui/canvas.js` | Painting engine: zoom/pan, Bresenham interpolation, symmetry, undo, shapes, reference image |
| `ui/app.js` | UI controller: tool state, color arming, palettes, message routing, boot |
| `ui/history.js` | Undo/redo stack |
| `ui/colors.js` | Color utilities, library import, palette management |
| `ui/tools.js` | Floating toolbar, tool submenus, tooltips, context menu, status bar, collapse-panels mode |
| `ui/export.js` | Builds the `apply-to-figma` message (flattens visible layers via `getCanvasState()`) |
| `icon.svg` | Plugin icon — used for Community listing upload, not referenced in manifest |
| `CASE_STUDY.md` | Project case study — no effect on plugin | Deleted from GitHub file |

---

## Architecture: two execution contexts

**Sandbox (Figma backend)** — runs in `code.js` below `// === SANDBOX START ===`
- Has access to Figma API (`figma.*`)
- No DOM access
- Communicates with UI via `figma.ui.postMessage()` and `figma.ui.onmessage`
- Node lookups must use `await figma.getNodeByIdAsync()` — `getNodeById()` is banned by `documentAccess: dynamic-page`

**UI (plugin window)** — runs in the inlined HTML/CSS/JS
- Standard browser environment, no Figma API access
- Communicates with sandbox via `parent.postMessage({ pluginMessage: msg }, '*')`
- Listens via `window.onmessage`

---

## Key design decisions — do not change these

- **Painting surface is HTML canvas, not Figma** — drag-to-paint only works because `mousemove` fires continuously in the browser. Figma's `selectionchange` fires on discrete clicks only. Do not move painting back to Figma.
- **All plugin nodes live in one `Pixel Painter` child frame** (`ensurePaintLayer`, tagged `pixelLayer=true` in shared plugin data). `fillFrame` / `applyCanvasToFigma` / `placeTrace` only ever touch this layer — they must NOT remove the target frame's other children or write to `frame.fills`. This is what keeps a user's background fill / image / layers alive across Fill Frame and Apply. **No ground fill** — `applyGround()` always sets `layer.fills = []`, so unpainted cells are genuinely empty/transparent, not a solid color. (v1.2–v1.3 briefly gave unpainted cells a solid ground — first cream, then white — before settling on no fill at all; if a user wants a background behind their pixels they paint it themselves.) `openCanvas` reads cells from the layer, falling back to loose frame children for canvases made before this change.
- **Recent colors are added on paint, not on arm** — `_doArmColor` must never call `_addToRecent`. Arming fires on every HSB-picker drag step, which would flood the history. The canvas paint paths (`_onCellPainted`, `_floodFill`, `_commitShape`) are the only callers. Colors are never removed from history, even when erased from the canvas.
- **`_lastMouseCell` separate from `_lastPaintCell`** — Bresenham interpolation uses `_lastMouseCell` (always updated to current mouse position) as start point. `_lastPaintCell` is only for the skip-duplicate guard inside `_paintAt`. Conflating them causes stroke gaps.
- **`updateThumbnail()` called once per mouse event, not per cell** — calling it inside the Bresenham loop caused full canvas redraws per pixel, breaking painting responsiveness.
- **`_addToRecent()` has an early-exit guard** — returns immediately if the hex is already first in the recent list. Prevents per-cell DOM re-render and IPC during strokes.
- **No Tools tab** — color replace, cleanup, SVG export were removed. Figma covers them natively. Do not add them back.
- **Tab bar is hidden** (`display: none` in CSS) — only the Setup panel exists. `switchTab`/`initTabs` were removed.
- **Setup screen is state-driven** — `handleSelection()` fills the `_setup` object and `renderSetup()` paints everything (status row, scaled frame preview, Result deltas, footer CTAs) through `#panel-setup[data-sel]` (`none` / `invalid` / `frame` / `canvas`) plus `.is-changed` / `.is-too-many`. Its cols/rows/margins use the same formula as `fillFrame` (`floor((W + gap) / (cell + gap))`, centred offsets) — keep the two in sync. `probeSelection` sends `mode: 'invalid'` for a selected `GROUP`. Re-fill has no `confirm()` dialog (Figma's plugin iframe can't show modals); the inline "This will clear the current frame." banner is the confirmation.
- **Armed color signifier** — `border: 2.5px solid var(--accent)` on `.quick-swatch.armed`, `.recent-sw.armed`, `.sw.armed-item .sw-sq`. Uses border (inside box model) not outline or box-shadow, so it never clips.
- **Library swatches** — `grid-template-columns: repeat(4, minmax(0, 1fr))` with `min-width: 0` on `.sw`. The `minmax(0, 1fr)` is critical — `1fr` alone inflates auto-minimum via `white-space: nowrap` on labels.

---

## Color palette (CSS variables)

As of v1.3 the plugin uses **Figma's own UI chrome** (UI3: blue accent, neutral grays, Inter) instead of the old warm brand palette (rose / terra / sage / ink / cream). A plugin that looks like part of Figma feels native and trustworthy; the old palette made it read as a separate app. The tokens come from the "Pixel Painter Canvas" Claude Design mockup. The old variables (`--rose`, `--terra`, `--sage`, `--ink`, `--cr`, `--pd`, `--il`, `--im`, `--p`) are gone — don't reintroduce them for UI chrome.

```css
--accent:        #0D99FF   /* links, selected/active, primary CTAs, focus, armed swatch border */
--accent-hover:  #007BE5
--accent-tint:   #E5F4FF   /* selected layer row, symmetry-on, selected spacing option */
--bg:            #FFFFFF   /* window + panels */
--bg-2:          #F5F5F5   /* hover, inputs, secondary surface, canvas stage */
--border:        #E6E6E6   /* dividers, control borders (also --bg-3: pressed/open) */
--text:          rgba(0,0,0,.9)
--text-2:        rgba(0,0,0,.5)   /* secondary labels */
--text-3:        rgba(0,0,0,.3)   /* disabled / placeholder */
--danger:        #DC3412   /* delete, clear, remove, re-grid */
--danger-tint:   #FFF1EE   /* danger hover */
--chrome:        #1E1E1E   /* tooltips, menus, submenus, toasts (fg #FFF, muted rgba(255,255,255,.5); menu hover = --accent) */
--r / --r-tool / --r-lg:  5px / 8px / 13px
--shadow-float / --shadow-pop / --shadow-tip / --shadow-window   /* see styles.css :root */
```

- **Primary button** = solid `--accent`, white text, 5px radius, hover `--accent-hover` (`.btn-terra` / `.btn-sage` are legacy class names; both are primary now). **Secondary** = white, 1px `--border`. **Destructive** = secondary with `--danger` text.
- **Type:** Inter 400/500/600, base 11px/16px, `0.005em` tracking; section headers 13px/18px 600. Inter is **base64-embedded** as `@font-face` at the bottom of `ui/styles.css` (source files in `ui/assets/fonts/`) — no font CDN, keeps the zero-network rule.
- Paintable preset colors in `app.js` (`QUICK_PALETTE`, default armed color `#B8607A`) are content, not chrome, and still use the original warm palette.

---

## Figma API notes

- `documentAccess: "dynamic-page"` is set in manifest — all node lookups must be async
- `permissions: ["teamlibrary"]` — allows reading color styles from shared libraries
- `figma.clientStorage` — used for recent colors and custom palette persistence (local to user's Figma account, never leaves it)
- Plugin has zero network requests and collects no data

---

## Current feature state

**Shipped (v1, live on Community):**
- Pen, eraser, fill bucket, rect, oval, magic wand select
- H / V / 4-way symmetry with visual axis overlays
- HSB color picker, Figma library colors, custom palette, quick presets
- Reference image overlay (drag/resize/opacity/toggle)
- 50-step undo/redo
- Zoom/pan (scroll to zoom, space+drag to pan, Ctrl+0 fit)
- Cell shape presets (square → rounded → pill → circle)
- Apply to Frame / Apply as New
- Plugin window resizes to match frame aspect ratio

**Intentionally not in the plugin (Figma handles natively):**
- SVG export
- Color replace
- Empty cell cleanup

---

## Next phase (post-launch, after user feedback)

Do not build these until there is real user signal:
- Palette generation from reference image
- Animation frames / sprite sheet export

---

## Monetization status

Not monetized. Launch is free; feedback is needed on plugin functionalities and any bugs.

---

## Git workflow (from v1 onwards)

- `main` — stable, published versions only
- Feature branches for any new work
- Tag every version pushed to Figma Community: `v1.0.0`, `v1.1.0` etc.
- Commit the built `code.js` — Figma loads this directly, source files alone are not enough
