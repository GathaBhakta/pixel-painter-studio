# Pixel Painter Studio

A Figma plugin for drag-to-paint pixel art without leaving your design file.

**[Install on Figma Community →](https://www.figma.com/community/plugin/1643296970831494477)**

---

## Why

Figma's event model only registers discrete clicks and not continuous drag like current painting tools. Every existing approach required clicking one cell at a time, which made fluid pixel art impossible.

Pixel Painter Studio moves the painting surface into an HTML canvas inside the plugin window. Drag freely. When you're done, hit Apply and the result writes back to your Figma frame as named rectangles — no context switching, no separate app.

---

## Features

- **Drag-to-paint** — pen, eraser, fill bucket, rectangle, oval, magic wand select
- **Symmetry** — horizontal, vertical, and 4-way with real-time axis overlays
- **Color** — HSB picker, Figma library colors, custom palette, quick presets, recent colors
- **Reference image** — drag to reposition, resize, adjust opacity, toggle visibility
- **Cell shapes** — square, rounded, pill, circle (bead-style designs)
- **Undo / redo** — 50-step history
- **Zoom / pan** — scroll to zoom, Space+drag to pan, Ctrl+0 to fit
- **Apply** — write to selected frame or create a new one

---

## How it works

```
Draw a frame in Figma → Select it → Fill Frame → Paint → Apply
```

The plugin window resizes to match your frame's aspect ratio. Painted cells write back to Figma as named `px_NN_NN` rectangles. From there, use Figma's native tools — export as SVG, flatten, apply effects.

---

## Development

**Prerequisites:** Node.js

```bash
git clone https://github.com/GathaBhakta/pixel-painter-studio
cd pixel-painter-studio
node build.js
```

Load in Figma: **Plugins → Development → Import plugin from manifest** → select `manifest.json`

After any change to `ui/` files, run `node build.js` and reload the plugin in Figma.

### Source structure

| File | Purpose |
|---|---|
| `build.js` | Inlines CSS + JS modules into `code.js` |
| `code.js` | Built output — Figma loads this directly |
| `manifest.json` | Plugin ID, permissions, API version |
| `ui/canvas.js` | Painting engine, zoom/pan, symmetry, undo |
| `ui/app.js` | UI controller, color state, message routing |
| `ui/styles.css` | All styles |
| `ui/index.html` | Plugin UI shell |

---

## Status

Live on Figma Community. Early release, think of it as an MVP, feedback is more than welcome. Open an issue or reach out directly.

---

*Built by [Gatha Bhakta](https://gathaabhakta.com)*
