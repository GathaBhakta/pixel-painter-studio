// export.js — builds the messages that carry pixels to the Figma sandbox
//
// Layers never cross the wire. getCanvasState() (canvas.js) flattens every
// visible layer — respecting opacity — into one [row][col] grid of
// '#RRGGBB' | null, exactly the `cells` shape applyCanvasToFigma has always
// consumed, so the sandbox and its one-"Pixel Painter"-frame rule are unchanged.

// createNew: true → new frame; frameId: omit for "Apply as New"
function buildApplyMessage(createNew, frameId) {
  var state = (typeof getCanvasState === 'function') ? getCanvasState() : null;
  if (!state) return null;
  var msg = {
    type: 'apply-to-figma',
    cells: state.cells,
    cols: state.cols, rows: state.rows, cellSize: state.cellSize, gap: state.gap,
    cornerRadiusPct: _cellRadiusPct, shape: _cellShapeMode,
    createNew: !!createNew,
  };
  if (frameId) msg.frameId = frameId;
  return msg;
}

function flatHasContent(cells) {
  return !!cells && cells.some(function (row) {
    return row.some(function (c) { return c !== null; });
  });
}
