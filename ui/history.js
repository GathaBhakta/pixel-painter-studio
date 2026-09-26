// history.js — 50-step undo/redo stack (layer-aware)
//
// Same stack semantics the plugin has always had (MAX_UNDO steps, a new edit
// clears redo), moved here from canvas.js. What changed is what a step holds:
// instead of one copied cell grid, a snapshot is the whole layer stack —
// { active, layers: [{ id, name, visible, locked, opacity, cells }] } —
// modelled on the design spec's hist/fut snapshots of { layers, sel }.
// (The wand selection is not stored: undo/redo clears it, as before.)
//
// Memory: snapshots share grids copy-on-write. A snapshot keeps references to
// every layer's grid; _snapshotState() then gives the LIVE active layer a fresh
// copy, because every in-place pixel write is preceded by a snapshot in the
// same gesture (mousedown / bucket / selection fill / erase). Untouched layers
// cost nothing per step. Operations that don't write pixels in place (layer
// add / delete / reorder / clear-layer, which swaps in a new grid) use the
// cheaper _captureState() with no copy at all.

var _undoStack = [];
var _redoStack = [];
var MAX_UNDO   = 50;

function _resetHistory() {
  _undoStack = [];
  _redoStack = [];
  _notifyHistory();
}

function _notifyHistory() {
  if (typeof onHistoryChanged === 'function') onHistoryChanged(_undoStack.length > 0, _redoStack.length > 0);
}

// Reference snapshot of the current stack — no grid copies
function _captureState() {
  return {
    active: _activeLayerId,
    layers: _layers.map(function (L) {
      return { id: L.id, name: L.name, visible: L.visible, locked: L.locked, opacity: L.opacity, cells: L.cells };
    }),
  };
}

// Snapshot before an in-place pixel edit: capture, then copy-on-write the
// active layer so the edit lands on a fresh grid and the snapshot stays intact.
function _snapshotState() {
  var snap = _captureState();
  var A = _getActiveLayer();
  if (A) { A.cells = _cloneGrid(A.cells); _syncActive(); }
  return snap;
}

// Restore pixels + layer structure (membership, order, active layer) from a
// snapshot. Name / visibility / lock / opacity of layers that still exist are
// kept as they are now — those are instant settings, not history steps — so
// undoing a stroke never silently re-hides or unlocks a layer.
function _restoreState(snap) {
  var current = {};
  _layers.forEach(function (L) { current[L.id] = L; });
  _layers = snap.layers.map(function (s) {
    var c = current[s.id] || s;
    return { id: s.id, name: c.name, visible: c.visible, locked: c.locked, opacity: c.opacity, cells: s.cells };
  });
  _activeLayerId = snap.active;
  _syncActive();
}

function _pushUndo(snapshot) {
  _undoStack.push(snapshot);
  if (_undoStack.length > MAX_UNDO) _undoStack.shift();
  _redoStack = [];
  // A real canvas edit displaces the one-slot custom-swatch undo, same as the
  // Claude Design mockup's swUndo — otherwise Ctrl/Cmd+Z after painting could
  // silently restore an old removed swatch instead of undoing the stroke.
  if (typeof _customPaletteUndo !== 'undefined') _customPaletteUndo = null;
  _notifyHistory();
}

function _afterHistoryJump() {
  _selectedCells = new Set();
  renderCanvas();
  if (typeof onWandSelection === 'function') onWandSelection(0);
  if (typeof onLayersChanged === 'function') onLayersChanged();
  if (typeof refreshCanvasCursor === 'function') refreshCanvasCursor();
  _notifyHistory();
}

function undoCanvas() {
  if (!_undoStack.length || !_layers.length) return;
  _redoStack.push(_captureState());
  _restoreState(_undoStack.pop());
  _afterHistoryJump();
}

function redoCanvas() {
  if (!_redoStack.length || !_layers.length) return;
  _undoStack.push(_captureState());
  _restoreState(_redoStack.pop());
  _afterHistoryJump();
}
