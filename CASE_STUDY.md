# Pixel Painter Studio
### A 0-to-1 Figma Plugin Case Study
**Gatha Bhakta · UX Designer · 3 years**

---

## The One-Line Version

I was tired of clicking. So I built a tool that lets me drag. Four plugins, one standalone app experiment, and dozens of QA cycles later — I got there.

---

## Background

I'm a UX designer who draws. Not in a sketchbook — in Figma, because that's where my portfolio visuals live and I refuse to context-switch. I wanted to create pixel art for my portfolio covers, character moments, and textural touches. The kind of work where the medium is the message — deliberate, cell-by-cell, retro in spirit.

Figma is where I live. But Figma has never been built for painting.

---

## Before This Plugin: The Ones That Didn't Work

This is not the story of a first attempt. It's the story of a fifth one.

Before Pixel Painter Studio, there were four distinct plugin iterations — each with its own manifest ID, its own set of bugs, and its own set of things I learned I needed to cut.

**Pixel Painter v1 and v2** (`pixel-painter-gatha-v2`) were the raw experiments. They proved the basic thesis — you could get Figma to fill colored rectangles — but painting was one click per cell, and the plugin state was fragile. Closing the plugin lost everything. The creative act was buried under interaction cost.

**Pixel Painter Pro** (`pixel-painter-gatha-pro`, then `pixel-painter-gatha-pro-v2`, then finally `pixel-painter-pro-final-001`) was the first serious build. A handoff spec I wrote for it included: an HSB color picker, a library integration system, recent colors via clientStorage, a trace layer for reference images, a color replace tool, SVG and sticker exports. All of this was built in Claude.ai chat — iterating on a single `code.js` file, patching each session.

The problem with building this way: every session added to the same file. The plugin accumulated layers of patches on top of patches. There were five known bugs I couldn't fully close — the plugin loading as an old cached version, recent colors not persisting reliably, the library dropdown returning empty even when libraries existed, the color replace UI failing on timing, the HSB picker thumb positioning wrong at first load. I fixed some and worked around others. But the underlying issue was architectural: the painting surface was Figma's canvas itself.

My spec noted it directly: *"persistent versioning/ID issues because each iteration was patched in Claude.ai rather than rebuilt cleanly."*

**Pixel Painter Studio v1** (`pixel-painter-studio-v1-2026`) was the first modular rebuild. Separate source files, a Node build script, a proper folder structure. But I still hadn't solved the core problem.

**A standalone app — KnitPix** was a longer detour than I'd like to admit. At the point where reference image handling inside the plugin felt structurally awkward, I pivoted to building a full Electron desktop application instead. The idea: if the plugin environment was the constraint, remove the plugin environment.

KnitPix grew fast. Within a few sessions it had: a proper layer system (paint layers, reference layers, both movable and reorderable), a canvas size dialog with pixel/inch/cm units, symmetry with visual SVG icons and an adjustable axis, a circle tool discoverable by long-pressing the rectangle tool, canvas editing to resize the pixel grid, a "remove unused cells" function that trimmed to the bounding box, per-layer opacity, SVG export, and an option to upload color tokens directly from a Figma/W3C JSON file.

I renamed it KnitPix. It felt like a real product.

Then I sat with it and realized what I'd done: I had rebuilt, from scratch, most of what Figma already gives me for free. Canvas sizing? That's just drawing a frame in Figma. Color token import? That's the library integration I'd already built into the plugin. Layer management? Figma has layers. Export? Figma exports. Every feature I added to KnitPix to compensate for not being inside Figma was a feature I had to maintain, debug, and QA myself — for capabilities that existed a tab-switch away.

More pointedly: the whole reason I started this project was to avoid context-switching. Building a separate desktop app to avoid switching from Figma required switching from Figma. The logic collapsed on itself.

I abandoned KnitPix and returned to the plugin. The plugin had to live inside Figma. Frictionless frame creation — draw a rectangle, select it, hit Fill Frame — is only frictionless because Figma already knows the dimensions, the grid, the design file context. Outside Figma you have to reconstruct all of that. Inside Figma, it's already there.

---

## The Manifest Problem

Every iteration of this plugin hit the same wall: Figma caches plugins by their manifest ID. When you develop iteratively — patching the same code file across sessions — the new version loads as the old one. Clearing the plugin, reimporting from manifest, restarting Figma. Sometimes the old version persisted anyway.

My workaround was naming each version with a completely fresh ID:

```
pixel-painter-gatha-v2
pixel-painter-gatha-pro
pixel-painter-gatha-pro-v2
pixel-painter-pro-final-001
pixel-painter-studio-v1-2026
pixel-painter-studio-001  ← current
```

This became a ritual before every new build: *"when you finally save the plugin, save it under a new name so the manifest does not override in Figma."*

Even naming alone wasn't always enough. When I asked to rename the folder on disk mid-session, it turned out the development environment was locked to that path. The workaround: change the manifest `name` field instead of the folder, so at least Figma's plugin menu showed a distinct label. When I asked *"can you just rename the files? the same folder leads to no change as manifest remains the same"* — that question reveals exactly how I was thinking: the manifest is the identity, not the folder.

---

## The Insight That Changed Everything

The fundamental fix required an architectural shift most Figma plugins don't make: **move the painting surface out of Figma entirely**.

Figma's event model doesn't support continuous drag-paint because `selectionchange` only fires on discrete clicks. You tap a cell — Figma registers the selection — the plugin fills it. This is still one-click-per-cell. You cannot drag. You cannot flow.

But an HTML `<canvas>` element inside the plugin UI responds to `mousemove` on every frame. If the canvas lives inside the plugin instead of on the Figma artboard, drag-to-paint becomes trivial.

The tradeoff: painted work has to be written *back* to Figma as rectangles when the session ends. This turned out to be fine — pixel art is made of rectangles anyway. Each cell becomes a named `px_NN_NN` rectangle in the Figma frame. The painting experience gains everything; the output loses nothing.

This was the founding architectural decision that everything else was built on top of. I documented it in the spec I wrote before the rebuild:

> *"The old plugin painted directly on Figma's canvas using selectionchange events, which forces click-per-cell. The new plugin paints inside the plugin window on an HTML canvas, then writes the result back to Figma in one batch when the user clicks 'Apply to Figma.' This unlocks drag-to-paint, symmetry, eraser, undo, and continuous mouse-down painting — none of which Figma's event model allows natively."*

---

## How I Built It

I worked with Claude (Anthropic's AI) as a technical collaborator throughout — first in the Claude.ai chat interface for early versions, then in Claude Code (the CLI) for the final rebuild. I directed the product: what to build, why, in what order, what to cut. Claude executed the implementation in JavaScript, CSS, and the Figma Plugin API. This partnership let me think at the design level without being blocked by syntax.

The rebuild was structured as eleven phases, with explicit QA between each: *"After each phase, give me explicit test steps and I'll reload the plugin in Figma and report what works or breaks."*

That's how every feature got built in this project — not in one pass, but in a cycle of build → test → report → revise. I was the QA on every single phase.

---

## Phase by Phase: What I Built, What Broke, What I Changed

### Phase 1 — Scaffold and Build System

First step: does the build system work? A `build.js` script that inlines CSS and JS modules into a single Figma-compatible `code.js` file. The test was minimal: load the plugin in Figma, see "Hello."

**What I reported:** *"it works, proceed to phase 2"*

Short. But that confirmation mattered. A broken build system would have poisoned every phase that followed.

### Phase 2 — Canvas Rendering

A fresh grid in the plugin window. Stroke-only cells, no fill. Plugin window resizes when you fill a Figma frame, proportioned to the frame's aspect ratio.

**What I reported:** *"it works, proceed to phase 3"*

Then, immediately: *"btw there is no way to zoom in on the canvas, select colors, can we have a thumbnail preview on the right panel and put the color selection below it. Preview is collapsible. or better, but the preview on a new left panel. Work on it as you seem fit."*

This was the first major layout decision — and I deferred the final call to the implementation. "Work on it as you see fit" is a trust signal. I had articulated the direction (thumbnail preview, color accessible without scrolling), and trusted that the structural solution could be figured out in code. The left panel emerged from that: 220px, thumbnail at top, color below.

### Phase 3 — Color (Two Trials to Get It Right)

Color took two distinct attempts before it landed correctly.

**Trial 1 — the hardcoded brand palette.** The first plugin shipped with a fixed palette pulled directly from my branding work — neutrals, rose, sage, terra, lilac, olive, pumpkin, slate. Colors I had already designed and used across my portfolio. The logic seemed sound: if this tool is for portfolio illustration, it should use portfolio colors.

The problem surfaced within minutes of actual use. The palette was coherent but inflexible. If I was painting an asset that sat alongside specific components in a Figma file, I needed to match *those* colors — not my general brand system. And if a color I needed wasn't in the preset twenty-four, I had nowhere to go. The palette that was supposed to make things easier became a ceiling.

**Trial 2 — custom color input.** The obvious fix seemed to be: let me type in any hex value. So that's what I asked for next. And that worked, technically. But typing hex codes by hand is friction of a different kind — it's precise but slow, and it disconnects me from the visual relationships between colors.

The real requirement crystallized from that gap: *I already have a design system. It already lives in this Figma file. Why am I re-entering values I've already defined?*

**What I reported:** *"it still does not have flexibility to choose colors based on hex values or RGB, nor does it import the full visual style existing or imported in the Figma file. We need to provide a color picker too where I can drag the color on a gradient and pick the shade or hue. Quick just gives default colors, not very flexible."*

That sentence has the complete requirements embedded in it: hex/RGB inputs, library import, HSB gradient picker. The pivot wasn't "give me more colors" — it was "give me the colors I've already designed." Brand cohesion on pixel art assets is effortless when the painting tool reads directly from the same design system the rest of the file uses. What I actually needed was three things that eventually became three tabs: Picker, Library, Custom.

**The library categorization bug:** When library colors finally loaded, groups appeared out of order — "Brand" might show up twice if both local paint styles and color variables contributed to it. The fix was a sort pass before sending colors to the UI. I reported this directly: *"colors imported from library are not categorized correctly. Solve for that and move to Phase 5. Debug wherever required and write code as per best practices. Lets defer resizing plugin window to the last phase."*

That last sentence — "defer resizing to the last phase" — is a product decision. Resizing was real friction but not blocking. Something is only a priority if it prevents me from using the tool. Window size didn't.

### Phase 4 — Zoom and Pan

After Phase 3, the canvas still couldn't be zoomed.

**What I reported:** *"The canvas cannot be zoomed in. We need to use similar mechanisms to Photoshop when interacting with the Canvas."*

Photoshop is the reference because that's what I know. Space-held drag to pan, scroll-wheel to zoom, Ctrl+0 to fit. These aren't invented conventions — they're muscle memory. If the tool breaks that muscle memory, every session starts with relearning instead of painting.

The technical solution: CSS `transform: translate(panX, panY) scale(zoom)` on the canvas element, with coordinate math that correctly maps screen pixels back to grid cells at any zoom level. A fallback re-entry button was also added for when a user accidentally exits paint mode mid-session — *"we need to provide a fallback in case I leave the interface of painting inside the canvas by mistake or want to come back to a canvas later."*

### Phase 5 — Symmetry

Sprite work is often symmetric — characters, icons, UI elements. Symmetry mode mirrors every stroke across a chosen axis in real-time. Four modes: Off, Horizontal, Vertical, 4-way.

The visual axis overlays (semi-transparent red lines) repositioned at every zoom level and pan position. This was a subtle detail that mattered for trust. If the visual axis doesn't match where the mirror actually fires, the tool feels broken even when it works.

**Trade-off:** Flood fill deliberately does not apply symmetry. Flood fill across a mirror axis produces results that are hard to predict — filling one half and auto-filling the mirror can create unintended shapes when the color boundary doesn't align with the axis. I kept it off for bucket fill specifically.

### Phases 6–8 — Undo, Flood Fill, Shape Tools

Fifty-step undo history. Per-stroke snapshots taken at mousedown and committed at mouseup — so a long drag is one undoable action, not a hundred.

For tools, I specified: *"Yes, a flood fill and a rectangle cum oval tool that by pressing shift transforms to square cum circle."*

Then, after seeing the first implementation: *"since we have flood fill tool, oval and rectangle tools can be outline only."*

**The reasoning:** Pixel art convention is to draw outlines first, then fill them with the bucket tool. A filled rectangle or oval doesn't match how pixel artists actually work. Shapes that render outline-only feel intentional; shapes that render filled feel like a shortcut that produces the wrong output. Making rect/oval outline-only reduced the feature surface without reducing the usefulness.

### Phase 9 — Reference Image

I trace a lot. Not copying, but using a sketch or reference photo as a structural guide. The first implementation placed the reference as locked Figma rectangle cells behind the paint layer — actual Figma objects.

**What I reported:** *"reference layer needs to be added below the canvas within the app -- needs to be toggled on or off and resized manually by user instead of snapping."*

The key word: *within the app*. The reference had no business being in Figma's layer hierarchy. It's a painting aid, not an output. Moving it into the plugin canvas as an HTML image overlay — with a drag handle and a resize handle, opacity slider, toggle — made it properly ephemeral. It exists during the session and nowhere else.

**Trade-off on resizing:** Free transform, no grid snapping. The reference is a visual guide, not an asset. Snapping it to pixel cells adds constraint where freedom is the point. You want to slide the reference around until the proportions feel right, not align it to a coordinate system.

### Phase 10–11 — Layout, Color Panel Overlap, Window Sizing

The most disruptive phase — not because features were added, but because the existing layout broke under its own weight.

**What I reported:** *"trace can be removed from setup and added into the main canvas side. Plugin window needs to be resized. Recent and preset has color overlapping. Can the plugin window be as big as the Figma canvas minus the side panels?"*

That single message drove an entire restructure:

- Trace tab removed from setup entirely; reference controls moved into the always-visible left panel
- Color and reference were competing for the same vertical space in the left panel — both scrolling, overlapping, fighting for attention
- The solution: a three-column layout. Left panel (190px) for spatial context — preview thumbnail and reference controls, set once, left alone. Center for the canvas. Right panel (260px) for color — the thing you reach for constantly gets the most accessible real estate
- Apply buttons moved to the toolbar. Ending a session is a top-level action, not something buried in a panel

**Window sizing:** The plugin window auto-scales to the Figma canvas area minus side panels (~480px for panels). Tall frame = tall window. Wide frame = wide window. The window adapts to what you're painting.

### The Color System — Arm Architecture, Erase in Library, Empty States

These were smaller issues but compounded into meaningful friction during actual use.

**The arm architecture:** Clicking a color used to require a confirm step — pick the color, click "Arm," now it's active. This is standard for some tools. In a high-frequency painting context, it's wrong.

**What I reported:** *"let us remove the arm architecture completely. If you select a color then it is stored."*

One click should set the color. The arm architecture added a confirmation where none was needed. In flow-state tools, confirmations are friction.

**Erase in library:** The eraser tool was appearing in the library tab as a special swatch labeled "Erase."

**What I reported:** *"The eraser tool is in the library under local styles and variables. Remove it from there because it serves no purpose sitting by itself as 'special'."*

A tool is not a color. The color panel is for colors; the toolbar is for tools. Conflating them creates a confused mental model. Small fix, clear principle.

**Library empty states:** When no local styles were available, the library tab showed nothing. I specified: if there are imported libraries available, say so and offer a path to them. If there are no libraries at all, say that and offer the custom palette. Dead ends in the interface are a design failure.

### The Checkerboard Background

The canvas originally showed a checkerboard pattern to indicate transparency — standard in image editing tools.

**What I reported:** *"can we remove the checkered background on the working area aka canvas? The overall gray and dark color there would make it hard for users like me to see the actual way color is showing up."*

The checkerboard misrepresents colors. A semi-transparent color over a checkerboard looks different from how it will appear over a white Figma frame. The canvas background shouldn't lie about what the output will look like. Replaced with a neutral warm gray that reads as neutral without suggesting a specific final context.

### The Eyedropper — Scope Expansion

The eyedropper originally sampled only from within the plugin canvas.

**What I reported:** *"the color picker, should be able to exist within the entire figma file and not the canvas itself. Should reflect that it is being used, signifier should include a picker icon."*

I regularly want to match colors from elsewhere in my Figma file — a component I'm designing around, a style from a brand document, a color on a reference artboard. Restricting the eyedropper to the plugin canvas was an artificial boundary.

The extended behavior: click eyedropper, a terra-colored banner appears above the toolbar ("Click any element in Figma to sample its color"), the eyedropper button shifts to terra-fill to signal the tool is in an extended state, click any Figma layer, the color is sampled, the mode exits automatically.

**The signifier was important to get right.** This isn't just a tool change — it's a context change. The painter's focus temporarily extends beyond the plugin window. The banner communicates this clearly and provides an escape hatch if the user clicked eyedropper by accident.

### The QA Cycle That Never Ended

After the major layout restructure:

**What I reported:** *"Left panel left padding is off. Kindly balance everything out."*

After the fix: *"hey the padding is still off, when I select a color, the signifier for color selection, ie, the stroke gets cropped on the left side."*

The stroke was being clipped by `overflow-y: auto` on the swatch container — a CSS specification behavior where setting `overflow-y` to a non-visible value implicitly sets `overflow-x` to non-visible as well. Fixing it required adding `padding: 4px` to the active tab panel so the selection outline had room to render.

Then: *"I noticed the colors on the far right are smaller in size and cropped, could you wrap the colors layout in a way where they don't crop and one can see maximum 4 colors in a row so the 5th moves to the next line?"*

This was a 5-column grid that was leaving insufficient space when the scrollbar consumed width. The fix was changing to a 4-column grid. Maximum four colors per row — the fifth wraps. No cropping.

**What this QA cycle demonstrates:** The issues I caught weren't things you can predict in a wireframe. The swatch stroke clipping, the grid column overflow, the padding inconsistency — these only surface when you're actually using the tool. The feedback loop between painting a session and reporting what was wrong was the mechanism through which the tool got better. Not planning. Not prototyping. Using it.

### Practicing Code Hygiene

The last session before this case study was written became its own design lesson — not in UX, but in code craft.

A bug had slipped through: the cell shape feature added rounded corners and circle shapes to cells, and it worked correctly on a full canvas redraw. But cells painted in real time during a drag came out square regardless of the setting selected. Selecting "Circle" and dragging the pen produced square cells. Clicking "Apply to Figma" after the fact corrected the output, but that was a workaround, not a fix.

The root cause was a split rendering path. `renderCanvas()` — the full redraw function — had been updated to use `_drawRoundedCell()`. `_renderCell()` — the per-cell function called on every cursor movement during drag-painting — still used the old `fillRect()` directly. Two paths, one updated, one missed.

**What I reported:** *"When I select cell shape, then when I draw something new, it does not universally apply to my cell shape. So, if a cell shape is selected then it needs to be reflected universally in the drawing without me having to click it after drawing something new every time."*

The fix was one line. But finding it required reading both functions, not patching by assumption.

That reading pass surfaced three more issues:

`initCanvas()` — called every time a canvas opens or re-grids — didn't reset the undo and redo stacks. After re-gridding with new cell settings, old undo states would reference a different grid dimension. Restoring them would either crash or produce corrupted cell data. A silent structural bug that only surfaced when you changed settings mid-session.

`redoCanvas()` cleared the selected cells correctly, but didn't call `onWandSelection(0)`. The wand selection banner — the dark strip showing "N cells selected" — would stay visible after a redo even though the selection no longer existed. `undoCanvas()` had this call; `redoCanvas()` didn't. A copy-paste asymmetry.

The `filled` message from the sandbox didn't carry `gap` explicitly, relying on the UI's ambient `_gap` variable to stay in sync. Removing that implicit dependency and making `gap` explicit in the message made the data flow readable without tracing two files simultaneously.

None of this added a visible feature. But it's the difference between a tool that holds up under repeated use and one that fails in the exact session when your muscle memory has learned to trust it.

The re-grid feature — going back to Setup and changing cell spacing on an already-painted canvas — also surfaced its own trade-off: changing cell size clears the painting. The grid is physically encoded as Figma rectangles. Different cell size means a different rectangle count. Resampling is imprecise. The right answer is to apply the current art to Figma first, preserving it there, then re-initialize the canvas with new settings. That fix shipped in the same session: the sandbox now processes both messages in sequence — apply to a new frame, then re-grid the original — so the art survives the settings change.

### Workflow Refinements: When Using It Reveals What's Wrong

The next round of issues only showed up during actual painting sessions. Not in code review, not in planning — in use.

**Tool stickiness.** Every time I clicked a color swatch while using the bucket fill tool, the plugin switched me back to the pen. I had to re-select bucket after every color change. The root cause was in `armColor()` — the function that runs on every swatch click. It called `setActiveTool('pen')` unconditionally, regardless of what tool was active.

**What I reported:** *"Once a tool action is over, it reverts to Pen tool. I might want to continue using the Fill Bucket tool."*

The fix required reasoning about intent. Picking a new color while on the bucket means: I want to fill with a different color. Not: switch me to pen. The only case where picking a color genuinely implies "now paint with pen" is the eyedropper — you sample a color specifically to then apply it stroke by stroke. For every other tool, the color pick is a parameter change, not a mode change. One conditional:

```js
if (_activeTool === 'eyedropper') setActiveTool('pen');
```

Everything else stays where it is.

**Symmetry hold-to-pick.** The symmetry button cycled through modes on each click: Off → Horizontal → Vertical → 4-way → Off. That works when you've memorized the sequence. It doesn't work when you want to jump straight from Off to 4-way without two intermediate clicks, or when you've forgotten what comes next in the rotation.

**What I reported:** *"For symmetry, could we have a hold down option where I can select the symmetry style instead of clicking it multiple times?"*

The solution layered two affordances on the same control. A quick click still cycles — for the muscle memory path. A held press (380ms) opens a small popup listing all four modes with a dot indicator on the active one. Click any option to jump directly. Two levels of the same action on one button: fast for those who know it, discoverable for those who don't. Escape or a click outside closes it. The tooltip was updated to surface the hold behaviour: *"click to cycle · hold for picker."*

**Pre-armed brush.** The first time you open a canvas, the pen tool does nothing until you click a color. The mental model says the brush is ready; the actual state says it isn't. Rose (`#B8607A`) is now armed by default at plugin boot — the first preset color, visible as highlighted in the swatch grid. The tool is ready to make a mark the moment the canvas opens.

---

## Impact: The Interaction Cost Over Time

The clearest way to measure what this project accomplished is to count the clicks.

**Before any plugin — raw Figma:**
To paint a single cell: select the cell rectangle → open the fill panel → pick a color → click the next cell → repeat. Every stroke was four to five discrete actions. Color changes required a separate trip to the fill panel each time. A thirty-cell character sprite meant potentially 150+ interactions before you had anything on screen. Undo for a misclick undid your last fill and broke your momentum.

The creative act was buried under the interaction cost.

**First plugin generation (selectionchange-based):**
The armed color mechanism reduced the per-cell cost. You selected a color once, armed it, and then clicking a cell applied the fill automatically via Figma's `selectionchange` event. 3–4 clicks to set up — frame selection, layer targeting, color arming — and then 1 click per cell to paint.

Still one click per cell. You could not drag. But it was meaningfully faster than the manual approach, and it proved the thesis was worth pursuing.

**The shift+select range fill:**
The intermediate plugin added a hold-and-shift mechanism — select one cell, shift-click another cell in the same row or column, and the plugin fills every cell between them. The same pattern Windows uses for list selection, applied to pixel grid painting.

This was a significant reduction for structured work: painting a horizontal stripe across a 32-wide sprite went from 32 clicks to 2. It still operated within Figma's event model — still discrete, still 1 click per cell for freehand work — but it opened up a way to work in blocks rather than single cells.

**Current plugin — HTML canvas drag-to-paint:**
Mousedown. Drag. Mouseup. One stroke covers every cell the cursor crosses. Interaction cost per cell during a drag approaches zero.

The full arc: 4–5 clicks per cell → 1 click per cell → 2 clicks for a full row → effectively 0 clicks per cell.

The difference isn't just efficiency. It's the difference between a tool that interrupts creative thinking and one that disappears into the work. When interaction cost is high, you spend cognitive energy managing the tool. When it's low enough, you spend it on the art.

---

## Design Principles That Emerged

**Honest color representation.** The canvas background is a neutral warm gray. The checkerboard was removed specifically because it changes how colors read. The background should not lie about what the color will look like in its final context.

**Gesture reduction.** The gap between thought and mark should approach zero. Auto-history. Immediate color selection. Keyboard shortcuts for every tool. The fewer clicks between intent and output, the longer the creative session lasts before fatigue sets in.

**Scoped empty states.** When the library tab has no local styles, it doesn't just show "No colors found." It checks whether imported libraries are available and offers a path. Empty states guide. They don't dead-end.

**Tool coherence.** The eraser was appearing in the library tab as a color. A tool is not a color. Small fix, clear principle: the color panel is for colors; the toolbar is for tools.

**Parameter changes don't change mode.** Picking a new color while the bucket is active means: fill with a different color. Not: switch to pen. Color is a parameter of the active tool, not a signal to change tools. The only exception is the eyedropper — sampling a color is explicitly preparation to paint, so switching to pen there is intentional. Every other tool holds its ground.

**Two affordance levels on one control.** Some actions have a fast path for users who've learned the tool and a slower, more discoverable path for everyone else. The symmetry button cycles on click for speed and opens a labeled picker on hold for clarity. The control doesn't hide one path to give the other — it layers them on the same surface with different gestures.

**Proportional sizing.** The plugin window resizes to match your frame's aspect ratio when you open or fill a canvas. You also get a drag handle to resize manually. The window's size should reflect the scale of what you're making.

**Feedback at every state.** Symmetry axis overlays. Pick-mode banner. Selection stroke on the active swatch. Zoom level display. Canvas thumbnail in the left panel. The tool communicates its state constantly so you're never guessing whether a setting is active.

---

## By the Numbers

A structured view of the project for those evaluating AI-assisted design and build work.

### Project Scope

| Metric | Value |
|---|---|
| Total plugin versions shipped | 6 (v1 → v2 → Pro → Pro-v2 → Studio-v1 → Studio-001) |
| Full architectural pivots | 2 |
| Standalone app experiments abandoned | 1 (KnitPix) |
| Major feature pivots | 5 (color system, painting surface, layout, arm architecture, Tools tab) |
| Build phases in final rebuild | 11 |
| Source modules (final architecture) | 6 (canvas.js, tools.js, history.js, colors.js, export.js, app.js) |
| QA cycles across entire project | 30+ |
| Explicit code hygiene passes | 2 |

### Code Metrics (Final Rebuild)

| Metric | Value |
|---|---|
| Built output at MVP ship | ~146 KB |
| Built output post-cleanup | ~127 KB |
| Size reduction through hygiene | ~13% (~19 KB eliminated) |
| Dead code removed — first pass | ~120 lines (CSS + JS: trace panel, dead selectors, duplicate rules) |
| Dead code removed — second pass | Tools tab (entire panel, 5 JS functions, 7 backend message handlers, ~40 CSS rules) |
| Dead JS functions removed (total) | 12+ (`_placeTrace`, `_closestPaletteColor`, `initToolsPanel`, `renderToolsColors`, `_updateCRSwatches`, `_exportPNG`, `_handleSVGReady`, `exportSticker`, `exportSVG`, `replaceColor`, `getCanvasColors`, `cleanup`) |
| Backend message handlers removed | 7 (`export-sticker`, `export-svg`, `color-replace`, `cleanup`, `get-colors`, `probe`, `canvas-colors`) |
| Net lines of code direction: added | New features only — no defensive code, no backwards-compat shims |

### Bugs Fixed in Final Polish Session (Post-MVP)

| Bug | Root Cause | Fix Type |
|---|---|---|
| Swatch selection stroke invisible | `inset box-shadow` clipped by `overflow`; too subtle on dark colors | CSS |
| Library swatches uneven width | `repeat(4, 1fr)` + `white-space: nowrap` inflating auto-minimum on grid tracks | CSS |
| Far-right library swatch cropped | `overflow-y: auto` on grid implicitly clipped `overflow-x`, adding a phantom scrollbar | CSS |
| HEX label overlaid by input field | `.field-label` at 16px width; truncated "HEX" to invisible | CSS |
| Library color had no armed stroke | `.sw` elements missing `data-hex` attribute; querySelector returned nothing | JS |
| Symmetry buttons completely silent | `initSymmetryButton` queried `.sym-btn`; buttons carried `data-mode` not that class | JS |
| Escape key threw `ReferenceError` | Called `_closeSymPopup()` after popup mechanic was deleted in a prior session | JS |
| Canvas stroke gaps (fast painting) | `updateThumbnail()` called per-cell inside Bresenham loop; full canvas redraw on every pixel | Perf |
| Persistent stroke gaps after above fix | `_lastPaintCell` used for Bresenham start; stale when mouse hovered a painted cell | Logic |

**9 bugs fixed post-MVP. 2 were silent regressions introduced by prior sessions.**

### AI Collaboration Metrics

| Metric | Value / Observation |
|---|---|
| Estimated tokens — entire project (all tools) | ~500K–700K (chat sessions + Claude Code; estimated) |
| Estimated tokens — Claude Code rebuild alone | ~350K–450K across 2+ context windows |
| Context windows consumed during rebuild | 2 (one hit context limit mid-session; work resumed without loss) |
| Avg feedback-to-implementation cycle | Under 5 minutes per feature or bug fix |
| Avg user-reported issues per session | 3–5 |
| Prompts that drove architectural decisions | ~8 (painting surface, layout restructure, arm removal, tool stickiness, symmetry, reference layer, color system, Tools tab removal) |
| Scope reductions initiated by user | 4 (sticker export, color replace, cleanup tool, entire Tools tab) |
| Features added then cut before shipping | 2 (hold-to-pick symmetry popup replaced by flat 3-button layout; sticker SVG export replaced by PNG) |

### Time Investment

| Phase | Estimated Duration |
|---|---|
| v1–v4: chat-based, patch-on-patch iteration | Several weeks, non-consecutive sessions |
| KnitPix detour (Electron app, abandoned) | ~2 sessions · ~3 hours total |
| Final rebuild (Claude Code, phases 1–11) | ~6–8 focused sessions |
| Post-MVP polish: swatch fixes, painting gaps | ~2 sessions |
| Post-polish: export swap, Tools tab removal, hygiene | ~1 session |
| **Total calendar time from v1 to shipped** | **~2–3 months (non-consecutive, alongside other work)** |
| **Total active build time (focused sessions)** | **~20–30 hours estimated** |

### What Hiring Managers Should Read From This

**For an AI Designer role:** Every scope decision in this project was made by a designer, not delegated to the AI. The AI executed; I directed. The cases where the tool got worse — the color system that was too rigid, the arm architecture that added friction, the Tools tab that survived one cleanup pass before being cut entirely — happened because I hadn't yet used the tool enough to know. Using it surfaced the problems. That's the design process, not a failure mode.

**For an AI Builder role:** The codebase went from monolith patches to a modular build system with explicit source ownership per file. Two hygiene passes cut 13% of the output with no behavior regression. Every bug in the final session had an identifiable root cause — not a guess, not a rollback. The Bresenham painting fix required understanding both the algorithm and the side-effect budget per event loop iteration. That's the difference between "it works" and "it holds."

---

## What I'd Explore Next

**Palette generation from reference.** Load a reference image and extract its dominant colors into the custom palette automatically. Start painting with colors that already match the reference.

**Animation frames.** Multiple canvas states on a timeline. Export as sprite sheet or animated GIF. This is the natural extension for game-adjacent design work.

**Accessibility audit.** Keyboard navigation through the swatch grid, ARIA labels on all interactive elements, focus management across panel switches.

**Collaborative annotation.** Leave notes on specific cells of the pixel canvas, tied to design decisions rather than pixel coordinates.

---

## Reflection

I came into this project frustrated by a tool and left it having built a better one. That's the cleanest summary of what product design should accomplish.

But the cleaner summary misses the actual path. The actual path was four plugins, a manifest collision ritual at the start of every new version, a standalone app experiment I abandoned after a day, a library categorization bug I had to call out explicitly, a color system I rebuilt from scratch because ten hardcoded colors were worse than no color system at all, and a layout restructure that happened because the first layout broke under its own weight once the feature set grew.

Working with AI as a technical collaborator changed the pace of the project significantly. I could describe a UX decision — *"remove the arm architecture, clicking a color should set it immediately"* — and have that implemented within minutes. The feedback loop was short enough that iteration felt like thinking out loud rather than filing tickets.

What surprised me was how often the implementation revealed new design problems I hadn't anticipated. Seeing the swatch stroke get clipped by `overflow-y` wasn't something I'd have noticed in a wireframe. Seeing the checkerboard make colors read differently than they would in Figma — that's a building-live insight. The seams only show when you're using it.

The other thing that surprised me: how much product thinking I'd compressed into casual feedback during the build. *"The eraser tool serves no purpose in the library"* or *"the reference layer should be free-resize, not grid-snapping"* — these sentences carry design rationale I'd worked out quickly and intuitively. Documenting them now makes that thinking explicit and transferable.

That's the meta-skill I'm most proud of demonstrating here: not the painting tool, but the ability to identify friction, articulate root cause, make a design decision with clear reasoning, and move on. At speed. Across a complex, evolving system.

Five builds, two hygiene passes, a dozen root-cause fixes, and one tool that finally lets me drag — and nothing else it doesn't need to.

---

## The Artifact

Pixel Painter Studio is a working Figma plugin. It lives in a single compiled file (`code.js`) assembled from six modular source files by a Node build script. It runs in Figma's sandboxed plugin environment with no external dependencies.

The source is organized as:
- `canvas.js` — painting engine, zoom/pan, symmetry, Bresenham interpolation, undo, shape tools, reference layer
- `colors.js` — color utilities, library import, palette management
- `app.js` — UI controller, message routing, tool state, color arming
- `history.js` — undo/redo stack management
- `tools.js` — reserved for future tool extensions (currently empty)
- `export.js` — reserved for future export formats (currently empty)
- `build.js` — inlines CSS and JS into the Figma plugin HTML format

Color replace, cleanup, SVG export, and sticker export were removed after shipping. Figma handles them natively; keeping them in the plugin was duplicate surface area. The plugin does exactly one thing now — painting — and does it well.

**Status:** Feature-complete for core painting workflow. In daily use for portfolio illustration work.

---

*Gatha Bhakta · UX Designer · gathaabhakta.com*
*Built with Claude (Anthropic) · 2026*
