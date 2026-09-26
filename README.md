# Pixel Painter Studio

A Figma plugin for drag-to-paint pixel art without leaving your design file.

**[Install on Figma Community →](https://www.figma.com/community/plugin/1643296970831494477)**

---

## 💁🏻‍♀️ Why

Figma's event model only registers discrete clicks and not continuous drag like current painting tools. Every existing approach required clicking one cell at a time, which made fluid pixel art impossible.

Pixel Painter Studio moves the painting surface into an HTML canvas inside the plugin window. Drag freely. When you're done, hit Apply and the result writes back to your Figma frame as named rectangles — no context switching, no separate app.

---

## 🌈 Features

- **Layers** — add, duplicate, delete, reorder, lock, hide, and fade layers with per-layer opacity; every tool paints on the active layer, with live thumbnails and layer-aware undo/redo
- **Drag-to-paint** — pen, eraser, fill bucket, rectangle, oval, line, magic wand select, move tool
- **Symmetry** — horizontal, vertical, and 4-way, mirroring every tool (including fill and shapes) with real-time axis overlays
- **Color** — HSB picker, Figma library colors, custom palette (with its own undo), quick presets, recent colors
- **Reference image** — drag to reposition, resize, adjust opacity, toggle visibility
- **Cell shapes** — square, rounded, pill, circle (bead-style designs), cross-stitch
- **View rotation** — Alt+scroll or status-bar buttons, 15° steps, purely visual
- **Undo / redo** — 50-step history
- **Zoom / pan** — scroll to zoom, Space+drag to pan, Ctrl+0 to fit
- **Setup screen** — live preview of your frame and grid before you commit, with a heads-up when re-filling a painted frame changes its cell size or spacing
- **Apply** — write to selected frame or create a new one

Looks and feels like it belongs in Figma — blue accents, neutral grays, Inter typeface, no separate visual language to learn.

See [CHANGELOG.md](CHANGELOG.md) for what's new in each release.

---

## ✨ How it works

```
Draw a frame in Figma → Select it → Fill Frame → Paint → Apply
```

The setup screen shows a live preview of your frame with the grid overlaid before you commit to a cell size. The plugin window then resizes to match your frame's aspect ratio. Paint on as many layers as you like — they're flattened on Apply into a single `Pixel Painter` layer inside your frame, as named `px_NN_NN` nodes (rectangles, or vectors for the cross-stitch shape) — so any background fill, image, or other layers you set on the frame stay put. From there, use Figma's native tools — export as SVG, flatten, apply effects.

---

## 🧩 Development

**Prerequisites:** Node.js

```bash
git clone https://github.com/GathaBhakta/pixel-painter-studio
cd pixel-painter-studio
node build.js
```

Load in Figma: **Plugins → Development → Import plugin from manifest** → select `manifest.json`

After any change to `ui/` files, run `node build.js` and reload the plugin in Figma.

### 📝 Source structure

| File | Purpose |
|---|---|
| `build.js` | Inlines CSS + JS modules into `code.js` |
| `code.js` | Built output — Figma loads this directly |
| `manifest.json` | Plugin ID, permissions, API version |
| `ui/canvas.js` | Painting engine: zoom/pan/rotation, symmetry, shapes, layers/compositing, reference image |
| `ui/tools.js` | Floating toolbar, tool submenus, tooltips, context menu, status bar, collapse-panels mode |
| `ui/history.js` | Undo/redo stack |
| `ui/colors.js` | Color utilities, library import, palette management |
| `ui/export.js` | Builds the apply-to-Figma message (flattens visible layers) |
| `ui/app.js` | UI controller: tool state, color arming, palettes, message routing, boot |
| `ui/styles.css` | All styles |
| `ui/index.html` | Plugin UI shell |
| `ui/assets/` | Source favicon + Inter font files (embedded as base64 in `styles.css` — no runtime network requests) |

---

## Status - 🟢 LIVE

Live on Figma Community. Early release, think of it as an MVP, feedback is more than welcome. Open an issue or reach out directly.

---

*Built by [Gatha Bhakta](https://gathaabhakta.com)*
