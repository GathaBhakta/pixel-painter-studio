# Changelog

## v1.3

**🧅 Layers**
Paint on as many layers as you like. Add, duplicate, delete and reorder them
(arrows or drag), double-click to rename, lock a layer so stray strokes can't
touch it, hide it, or fade it with per-layer opacity. Every tool paints on the
active layer only, and each layer has its own live thumbnail. Undo and redo
cover layer changes too. When you hit Apply, all visible layers are flattened
into your frame's **Pixel Painter** layer, same as always — nothing else in
your frame is touched. (Layers live in the plugin while you paint; Figma keeps
the flattened result.)

**✥ Move tool**
Press V and drag to nudge the whole layer, or just the cells you've selected
with the magic wand. Shift-click with the wand to add to a selection.

**🧰 A new painting workspace**
Tools now sit in a floating toolbar under the canvas, with hover tips that
show each shortcut. Pencil / eraser, rectangle / line / ellipse and symmetry
each tuck into a small menu. Select cells and a bar pops up to fill, delete or
deselect them. Quick confirmations appear as a small note at the top of the
canvas.

**🗂️ Panels your way**
Layers, Preview and Reference are now sections you can collapse, drag into
any order, and resize. Preview shows how many cells and colors you've used.
Press Ctrl/⌘ + \ to hide the side panels and give the canvas the whole window
— your current color stays in view in the corner.

**🎨 Looks like Figma**
The whole plugin now uses Figma's own look: blue highlights, neutral grays and
the Inter typeface. It should feel like part of Figma rather than a separate app.

**🧭 A clearer setup screen**
Before you fill, you see a small preview of your frame with the grid on it,
the margins left around the cells, and how many columns, rows and cells you'll
get. Select a frame you've already painted and change the cell size or spacing,
and it shows the old grid next to the new one, plus a warning that re-filling
clears the frame. You'll also get a heads-up when a grid goes over 10,000
cells, or when you've selected a group instead of a frame.

**⬜ White behind your pixels**
Empty cells now show white instead of cream. The white also stays in place
after Apply to Frame and Apply as New. Before, frames made with Apply as New,
and canvases from older versions, could come out see-through wherever you
hadn't painted. If your frame has its own background or layers, the plugin
still leaves them alone and adds nothing behind your pixels.

**🗄️ Library panel no longer gets stuck loading**
Opening the Library tab in a file with no local color variables used to show
"Loading colors…" forever. It now tells you plainly when there's nothing to
show, and offers a "Select from available libraries" list of secondary
buttons when your file has libraries imported. The library dropdown also
marks whichever source is currently active with a checkmark.

**🪣 Fill is now G**
Freed up to match the rest of the shortcut layout — Pencil stays P, Eraser
stays E.

**🎨 Custom colors, redone**
Adding a color now opens a small picker so you can nudge the hue and shade
before committing it, instead of only ever adding whatever was armed.
Right-click a swatch for "Use color" or "Remove swatch," and Clear now works
without a browser confirm dialog (those don't run inside Figma's plugin
window). Removing one swatch or clearing the whole palette can be undone with
Ctrl/⌘+Z right after, same as an undone paint stroke.

**🔙 A clearer way back to Setup**
The logo in the top-left of the paint screen swaps to a back arrow on hover,
so it reads as a button — click it any time to jump back and change the cell
size or spacing.

<!--
Not yet in any release note (on this branch before the redesign):
line tool (L), symmetry for shapes + mirrored fill, and view rotation
(Alt+scroll / status-bar buttons). Fold them into v1.3 if they ship together.
-->

## v1.2

**🖼️ Your frame background stays put**
Set a background fill, drop in a reference image, or stack your own layers on the
frame — paint on top and hit Apply. Everything you added stays exactly as it was.
Your pixels now land in their own **Pixel Painter** layer inside the frame, so the
plugin never overwrites anything of yours.

**🎨 Cleaner color history**
The recent-colors row only tracks colors you've actually painted with — not every
shade you scrub past while dragging the picker. Painted a color and then erased
it? It stays in the row so you can pick it back up.

<!--
If the batch below shipped to Community after v1.0 without its own release note,
fold these into v1.2 as well (see the "v1.1" section).
-->

## v1.1

**✚ Cross-stitch cells**
New cell shape — an X-stitch style that writes back to Figma as vector strokes,
for embroidery and cross-stitch charts.

**⚡ Faster library colors**
Importing colors from team libraries is much quicker, with clearer empty states
when a library has no color styles yet.

**🎯 Centered grid**
Fill Frame now centers the pixel grid in your frame instead of leaving all the
leftover space on one edge.

## v1.0.0

First public release on Figma Community.

- Drag-to-paint: pen, eraser, fill bucket, rectangle, oval, magic wand select
- Symmetry: horizontal, vertical, and 4-way with live axis overlays
- Color: HSB picker, Figma library colors, custom palette, quick presets, recents
- Reference image overlay (drag, resize, opacity, toggle)
- Cell shapes: square, rounded, pill, circle
- 50-step undo / redo
- Zoom / pan (scroll to zoom, Space+drag to pan, Ctrl+0 to fit)
- Apply to an existing frame or create a new one
