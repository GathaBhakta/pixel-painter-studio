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
| `ui/tools.js` | Reserved — currently empty |
| `ui/export.js` | Reserved — currently empty |
| `icon.svg` | Plugin icon — used for Community listing upload, not referenced in manifest |
| `CASE_STUDY.md` | Project case study — no effect on plugin |

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
- **`_lastMouseCell` separate from `_lastPaintCell`** — Bresenham interpolation uses `_lastMouseCell` (always updated to current mouse position) as start point. `_lastPaintCell` is only for the skip-duplicate guard inside `_paintAt`. Conflating them causes stroke gaps.
- **`updateThumbnail()` called once per mouse event, not per cell** — calling it inside the Bresenham loop caused full canvas redraws per pixel, breaking painting responsiveness.
- **`_addToRecent()` has an early-exit guard** — returns immediately if the hex is already first in the recent list. Prevents per-cell DOM re-render and IPC during strokes.
- **No Tools tab** — color replace, cleanup, SVG export were removed. Figma covers them natively. Do not add them back.
- **Tab bar is hidden** (`display: none` in CSS) — only the Setup panel exists. `switchTab`/`initTabs` were removed.
- **Armed color signifier** — `border: 2.5px solid var(--rose)` on `.quick-swatch.armed`, `.recent-sw.armed`, `.sw.armed-item .sw-sq`. Uses border (inside box model) not outline or box-shadow, so it never clips.
- **Library swatches** — `grid-template-columns: repeat(4, minmax(0, 1fr))` with `min-width: 0` on `.sw`. The `minmax(0, 1fr)` is critical — `1fr` alone inflates auto-minimum via `white-space: nowrap` on labels.

---

## Color palette (CSS variables)

```css
--rose:  #B8607A   /* primary accent, armed state */
--terra: #A85A3C   /* CTAs, active tab */
--sage:  #556B50   /* secondary actions */
--ink:   #2C2018   /* text, dark elements */
--cr:    #FAF6EF   /* canvas/panel background */
--pd:    #E8E0D4   /* dividers, inactive */
--il:    #8C7260   /* secondary labels */
```

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
- Freemium split (canvas size gate at 32×32 free, unlimited paid)

---

## Monetization status

Not monetized. Launch is free to establish user base and gather feedback. Revisit after 500+ installs and repeated feature requests that don't yet exist.

---

## Git workflow (from v1 onwards)

- `main` — stable, published versions only
- Feature branches for any new work
- Tag every version pushed to Figma Community: `v1.0.0`, `v1.1.0` etc.
- Commit the built `code.js` — Figma loads this directly, source files alone are not enough
