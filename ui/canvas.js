// canvas.js — painting engine · layers · compositing · zoom/pan · symmetry · shapes · fill

// ── Layers ────────────────────────────────────────────────────────────────────
// Layers are a UI-only concept. Each layer is its own full [row][col] grid of
// hex | null. The sandbox never sees them: everything that leaves the plugin
// window (Apply to Frame / Apply as New / re-grid) goes through getFlatCells(),
// which composites the visible layers top-to-bottom into ONE flat grid in the
// exact shape the sandbox has always received. The one-Pixel-Painter-frame
// invariant on the Figma side is untouched.
//
// _layers[0] is the TOP of the stack (same order as the Layers panel).
// _cells always aliases the ACTIVE layer's grid, so every tool below
// (pen, eraser, fill, shapes, wand, move, selection fill/erase) operates on the
// active layer only, with no per-tool layer plumbing.

var _layers        = [];
var _activeLayerId = null;
var _layerSeq      = 0;
var _comp          = null;   // composite cache [row][col] = hex | null (what's drawn + applied)
var _rgbCache      = {};

var _cells       = null;  // active layer grid — [row][col] = hexString | null
var _cols        = 0;
var _rows        = 0;
var _cellPx      = 16;
var _figmaCellSz = 16;
var _gap         = 1;
var _ctx         = null;
var _canvasEl    = null;
var _scrollEl    = null;

// Preview overlay (shapes)
var _previewEl  = null;
var _previewCtx = null;

// Paint state
var _painting       = false;
var _lastPaintCell  = null;  // last cell actually painted (skip-duplicate guard)
var _lastMouseCell  = null;  // last cell the mouse was over (Bresenham start point)
var _eventsAttached = false;
var _strokeChanged  = false; // did the current pen/eraser stroke change any cell?

// Zoom / pan
var _zoom      = 1;
var _panX      = 0;
var _panY      = 0;
var _isPanning = false;
var _panLastX  = 0;
var _panLastY  = 0;
var _spaceHeld = false;

// View rotation (degrees) — visual only, spins the canvas for drawing
// ergonomics like Krita/Procreate. Never touches _cells; painting math
// inverse-transforms the mouse position back through it, see _screenToCanvas.
var _viewRotation = 0;

// Symmetry — 'none' | 'H' | 'V' | '4'
var _symmetry = 'none';

// Reference image overlay
var _refEl          = null;
var _refVisible     = false;
var _refLeft        = 0;     // natural-canvas-pixel offset from canvas origin
var _refTop         = 0;
var _refWidth       = 100;
var _refHeight      = 100;
var _refOpacity     = 0.4;
var _refDragging    = false;
var _refResizing    = false;
var _refDragStart   = null;  // {cx,cy,left,top}
var _refResizeStart = null;  // {cx,cy,w,h}
var _refHandlesWired = false;

// Shape tool state
var _shapeActive   = false;
var _shapeStart    = null;   // {row, col}
var _shapeEnd      = null;   // {row, col}
var _shapeShiftKey = false;

// Snapshot taken at mousedown, pushed to history on mouseup (see history.js)
var _strokeSnapshot = null;

// Move tool state
var _moveActive    = false;
var _moveStart     = null;   // {row, col}
var _moveLast      = null;   // {dr, dc}
var _moveSnapCells = null;
var _moveSnapSel   = null;

// Magic wand selection
var _selectedCells = new Set();

// Cell corner radius (0–100, where 100 = circle)
var _cellRadius = 0;

// Cell shape mode — 'radius' uses _cellRadius above, 'cross' draws a
// cross-stitch X instead of a filled square/rounded shape.
var _cellShapeMode = 'radius';

// Tools that write pixels — blocked on a locked or hidden active layer
var _EDIT_TOOLS = { pen: 1, eraser: 1, bucket: 1, rect: 1, oval: 1, line: 1, move: 1 };

// ── Grid + layer helpers ──────────────────────────────────────────────────────

function _emptyGrid() {
  var g = [];
  for (var r = 0; r < _rows; r++) g.push(new Array(_cols).fill(null));
  return g;
}

function _cloneGrid(g) {
  return g.map(function (row) { return row.slice(); });
}

function _makeLayer(name, cells) {
  _layerSeq++;
  return {
    id:      'L' + _layerSeq,
    name:    name || ('Layer ' + _layerSeq),
    visible: true,
    locked:  false,
    opacity: 100,
    cells:   cells || _emptyGrid(),
  };
}

function _layerIndex(id) {
  for (var i = 0; i < _layers.length; i++) if (_layers[i].id === id) return i;
  return -1;
}

function _findLayer(id) {
  var i = _layerIndex(id);
  return i >= 0 ? _layers[i] : null;
}

function _getActiveLayer() {
  return _findLayer(_activeLayerId);
}

// Re-point _cells at the active layer's grid. Call after anything that swaps
// the active layer or replaces its grid array.
function _syncActive() {
  var A = _getActiveLayer();
  if (!A && _layers.length) { A = _layers[0]; _activeLayerId = A.id; }
  _cells = A ? A.cells : null;
}

function _rgbOf(hex) {
  var v = _rgbCache[hex];
  if (v) return v;
  var n = parseInt(hex.slice(1, 7), 16);
  v = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  _rgbCache[hex] = v;
  return v;
}

function _toHex(r, g, b) {
  function h(x) { x = Math.max(0, Math.min(255, Math.round(x))); return (x < 16 ? '0' : '') + x.toString(16); }
  return ('#' + h(r) + h(g) + h(b)).toUpperCase();
}

// Composite one cell across all visible layers, top → bottom.
// Fast path: the topmost painted cell on a 100%-opacity layer wins outright and
// its exact hex passes through untouched (the overwhelmingly common case).
// Partial-opacity layers are alpha-blended; because Figma cells are written as
// solid fills, any transparency left at the bottom of the stack is flattened
// onto white — so what you see on the canvas is exactly what gets applied.
function _compositeAt(r, c) {
  var stack = null;
  for (var i = 0; i < _layers.length; i++) {
    var L = _layers[i];
    if (!L.visible || L.opacity <= 0) continue;
    var hex = L.cells[r][c];
    if (!hex) continue;
    if (L.opacity >= 100) {
      if (!stack) return hex;
      stack.push(hex, 1);
      break;
    }
    (stack || (stack = [])).push(hex, L.opacity / 100);
  }
  if (!stack) return null;
  var rr = 255, gg = 255, bb = 255;
  for (var j = stack.length - 2; j >= 0; j -= 2) {
    var v = _rgbOf(stack[j]), a = stack[j + 1];
    rr += (v[0] - rr) * a;
    gg += (v[1] - gg) * a;
    bb += (v[2] - bb) * a;
  }
  return _toHex(rr, gg, bb);
}

function _recomputeComposite() {
  if (!_comp || _comp.length !== _rows) _comp = _emptyGrid();
  for (var r = 0; r < _rows; r++)
    for (var c = 0; c < _cols; c++)
      _comp[r][c] = _compositeAt(r, c);
}

// Raw color of the topmost visible layer at a cell — used by the canvas
// eyedropper so a picked color keeps its exact hex even on a faded layer.
function _topColorAt(r, c) {
  for (var i = 0; i < _layers.length; i++) {
    var L = _layers[i];
    if (L.visible && L.cells[r][c]) return L.cells[r][c];
  }
  return null;
}

function _canEditActiveLayer(withToast) {
  var L = _getActiveLayer();
  if (!L) return false;
  var msg = !L.visible ? L.name + ' is hidden · show it to paint'
          : L.locked   ? L.name + ' is locked · unlock it to paint'
          : null;
  if (msg && withToast && typeof showToast === 'function') showToast(msg, 'lock');
  return !msg;
}

function isActiveLayerEditable() { return _canEditActiveLayer(false); }

// ── Init ──────────────────────────────────────────────────────────────────────

function initCanvas(cols, rows, canvasW, canvasH, gap, figmaCellSize) {
  _cols        = cols;
  _rows        = rows;
  _gap         = gap !== undefined ? gap : 1;
  _figmaCellSz = figmaCellSize || 16;

  var pxW = canvasW / cols;
  var pxH = canvasH / rows;
  _cellPx = Math.max(4, Math.floor(Math.min(pxW, pxH)));

  // Fresh layer stack: a single empty "Layer 1"
  _layerSeq = 0;
  var base = _makeLayer('Layer 1');
  _layers        = [base];
  _activeLayerId = base.id;
  _comp          = _emptyGrid();
  _syncActive();

  _canvasEl        = document.getElementById('paint-canvas');
  _previewEl       = document.getElementById('preview-canvas');
  _scrollEl        = document.getElementById('canvas-scroll');
  _ctx             = _canvasEl.getContext('2d');
  _canvasEl.width  = cols * _cellPx;
  _canvasEl.height = rows * _cellPx;

  if (_previewEl) {
    _previewCtx      = _previewEl.getContext('2d');
    _previewEl.width  = _canvasEl.width;
    _previewEl.height = _canvasEl.height;
  }

  if (!_eventsAttached) {
    _eventsAttached = true;
    _canvasEl.addEventListener('mousedown', _onCanvasMouseDown);
    if (_scrollEl) _scrollEl.addEventListener('mousedown', _onScrollMouseDown);
    document.addEventListener('mousemove', _onMouseMove);
    document.addEventListener('mouseup',   _onMouseUp);
    if (_scrollEl) _scrollEl.addEventListener('wheel', _onWheel, { passive: false });
    if (_scrollEl) _scrollEl.addEventListener('mouseleave', function () { _reportHover(null); });
  }

  if (!_refHandlesWired) {
    _refHandlesWired = true;
    var mh = document.getElementById('ref-handle-move');
    var br = document.getElementById('ref-handle-br');
    if (mh) mh.addEventListener('mousedown', function (e) {
      if (e.button !== 0) return;
      _refDragging  = true;
      _refDragStart = { cx: e.clientX, cy: e.clientY, left: _refLeft, top: _refTop };
      e.preventDefault(); e.stopPropagation();
    });
    if (br) br.addEventListener('mousedown', function (e) {
      if (e.button !== 0) return;
      _refResizing    = true;
      _refResizeStart = { cx: e.clientX, cy: e.clientY, w: _refWidth, h: _refHeight };
      e.preventDefault(); e.stopPropagation();
    });
  }
  _refEl = document.getElementById('ref-image');

  _symmetry       = 'none';
  _shapeActive    = false;
  _moveActive     = false;
  _painting       = false;
  _lastPaintCell  = null;
  _strokeSnapshot = null;
  _selectedCells  = new Set();
  if (typeof _resetHistory === 'function') _resetHistory();
  _zoom = 1; _panX = 0; _panY = 0; _viewRotation = 0;
  renderCanvas();
  if (typeof onLayersChanged === 'function') onLayersChanged();
  setTimeout(fitToWindow, 60);

  // Re-fit whenever the canvas-scroll area resizes (e.g. user drags window edge)
  if (window._canvasResizeObserver) window._canvasResizeObserver.disconnect();
  if (window.ResizeObserver && _scrollEl) {
    window._canvasResizeObserver = new ResizeObserver(function () { fitToWindow(); });
    window._canvasResizeObserver.observe(_scrollEl);
  }
}

// ── Transform ─────────────────────────────────────────────────────────────────

function _applyTransform() {
  if (!_canvasEl) return;
  var t = 'translate(' + Math.round(_panX) + 'px,' + Math.round(_panY) + 'px) scale(' + _zoom + ')';
  if (_viewRotation) {
    var cx = (_cols * _cellPx) / 2, cy = (_rows * _cellPx) / 2;
    t += ' translate(' + cx + 'px,' + cy + 'px) rotate(' + _viewRotation + 'deg) translate(' + (-cx) + 'px,' + (-cy) + 'px)';
  }
  _canvasEl.style.transform = t;
  if (_previewEl) _previewEl.style.transform = t;
  var lvl = document.getElementById('zoom-level');
  if (lvl) lvl.textContent = Math.round(_zoom * 100) + '%';
  var rlvl = document.getElementById('rotate-level');
  if (rlvl) rlvl.textContent = Math.round(_viewRotation) + '°';
  _updateAxisOverlays();
  _positionRef();
}

// Undo pan/zoom/rotation to map a screen point (client coords) to a
// point in the canvas's own unrotated pixel space, for mouse-to-cell math.
function _screenToCanvas(clientX, clientY) {
  var rect = _scrollEl.getBoundingClientRect();
  var ux = (clientX - rect.left - _panX) / _zoom;
  var uy = (clientY - rect.top  - _panY) / _zoom;
  if (!_viewRotation) return { x: ux, y: uy };
  var cx = (_cols * _cellPx) / 2, cy = (_rows * _cellPx) / 2;
  var rad = _viewRotation * Math.PI / 180;
  var cos = Math.cos(rad), sin = Math.sin(rad);
  var dx = ux - cx, dy = uy - cy;
  return {
    x: cx + dx * cos + dy * sin,
    y: cy - dx * sin + dy * cos,
  };
}

function rotateView(deltaDeg) {
  _viewRotation = (_viewRotation + deltaDeg) % 360;
  _applyTransform();
}

function resetViewRotation() {
  _viewRotation = 0;
  _applyTransform();
}

function _zoomAt(clientX, clientY, factor) {
  if (!_scrollEl) return;
  var newZoom = Math.max(0.1, Math.min(64, _zoom * factor));
  var rect    = _scrollEl.getBoundingClientRect();
  var mx = clientX - rect.left, my = clientY - rect.top;
  _panX = mx - (mx - _panX) * (newZoom / _zoom);
  _panY = my - (my - _panY) * (newZoom / _zoom);
  _zoom = newZoom;
  _applyTransform();
}

function fitToWindow() {
  if (!_scrollEl || !_cols || !_cellPx) return;
  var wW = _scrollEl.clientWidth, wH = _scrollEl.clientHeight;
  if (!wW || !wH) return;
  var natW = _cols * _cellPx, natH = _rows * _cellPx;
  var padX = 20;
  var padBottom = 84; // keep the art clear of the floating toolbar
  _zoom = Math.max(0.1, Math.min(64, Math.min((wW - padX*2)/natW, (wH - padX - padBottom)/natH)));
  _panX = (wW - natW * _zoom) / 2;
  _panY = Math.max(padX, (wH - padBottom + padX - natH * _zoom) / 2);
  _applyTransform();
}

function setSpaceHeld(v) {
  _spaceHeld = v;
  if (!_scrollEl) return;
  if (!v && !_isPanning) _scrollEl.style.cursor = '';
  else if (v && !_isPanning) _scrollEl.style.cursor = 'grab';
}

// ── Reference image overlay ───────────────────────────────────────────────────

function setRefImage(src, opacity) {
  _refEl = _refEl || document.getElementById('ref-image');
  if (!_refEl) return;
  _refOpacity = opacity !== undefined ? opacity : 0.4;
  _refVisible = true;
  _refLeft    = 0;
  _refTop     = 0;

  var canvasW = _cols * _cellPx || 200;
  var canvasH = _rows * _cellPx || 200;

  function _applyNaturalSize() {
    var nw = _refEl.naturalWidth, nh = _refEl.naturalHeight;
    if (nw > 0 && nh > 0) {
      var aspect = nw / nh;
      _refWidth  = canvasW;
      _refHeight = Math.round(canvasW / aspect);
      if (_refHeight > canvasH) { _refHeight = canvasH; _refWidth = Math.round(canvasH * aspect); }
    } else {
      _refWidth  = canvasW;
      _refHeight = canvasH;
    }
    _positionRef();
  }

  // Set src, then apply size once image dimensions are known
  _refEl.onload = _applyNaturalSize;
  _refEl.src    = src;
  if (_refEl.complete && _refEl.naturalWidth > 0) { _refEl.onload = null; _applyNaturalSize(); }
}

function setRefOpacity(opacity) {
  _refOpacity = opacity;
  if (_refEl) _refEl.style.opacity = opacity;
}

function setRefVisible(v) {
  _refVisible = v;
  _positionRef();
}

function clearRef() {
  _refVisible = false;
  _refEl = _refEl || document.getElementById('ref-image');
  if (_refEl) { _refEl.src = ''; _refEl.style.display = 'none'; }
  _showRefHandles(false);
}

function _positionRef() {
  _refEl = _refEl || document.getElementById('ref-image');
  if (!_refEl) return;
  // Positioned via left/top outside the rotated canvas element, so it'd sit
  // misaligned once the view is rotated — hide it rather than show a
  // trace guide that no longer lines up with the art underneath it.
  var show = _refVisible && _refEl.src && _refEl.src !== window.location.href && !_viewRotation;
  _refEl.style.display = show ? 'block' : 'none';
  _showRefHandles(show);
  if (!show) return;

  var x = Math.round(_panX + _refLeft * _zoom);
  var y = Math.round(_panY + _refTop  * _zoom);
  var w = Math.round(_refWidth  * _zoom);
  var h = Math.round(_refHeight * _zoom);
  _refEl.style.left    = x + 'px';
  _refEl.style.top     = y + 'px';
  _refEl.style.width   = w + 'px';
  _refEl.style.height  = h + 'px';
  _refEl.style.opacity = _refOpacity;

  var mh = document.getElementById('ref-handle-move');
  if (mh) { mh.style.left = x + 'px'; mh.style.top = y + 'px'; mh.style.width = w + 'px'; }

  var br = document.getElementById('ref-handle-br');
  if (br) { br.style.left = (x + w - 7) + 'px'; br.style.top = (y + h - 7) + 'px'; }
}

function _showRefHandles(show) {
  ['ref-handle-move', 'ref-handle-br'].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.style.display = show ? 'block' : 'none';
  });
}

// ── Symmetry ──────────────────────────────────────────────────────────────────

function setSymmetry(mode) {
  _symmetry = mode;
  _updateAxisOverlays();
}

function _updateAxisOverlays() {
  var hAxis = document.getElementById('sym-axis-h');
  var vAxis = document.getElementById('sym-axis-v');
  if (!hAxis || !vAxis || !_cols) return;
  // The axis guides are straight lines positioned outside the rotated canvas
  // element, so they'd be visibly misaligned once the view is rotated — hide
  // them rather than show a guide that lies.
  if (_viewRotation) { hAxis.style.display = 'none'; vAxis.style.display = 'none'; return; }
  var canvasW = _cols * _cellPx * _zoom;
  var canvasH = _rows * _cellPx * _zoom;
  var showH = _symmetry === 'H' || _symmetry === '4';
  var showV = _symmetry === 'V' || _symmetry === '4';
  if (showH) {
    hAxis.style.display = 'block';
    hAxis.style.left    = Math.round(_panX + canvasW / 2) + 'px';
    hAxis.style.top     = Math.round(_panY) + 'px';
    hAxis.style.height  = Math.round(canvasH) + 'px';
  } else { hAxis.style.display = 'none'; }
  if (showV) {
    vAxis.style.display = 'block';
    vAxis.style.top     = Math.round(_panY + canvasH / 2) + 'px';
    vAxis.style.left    = Math.round(_panX) + 'px';
    vAxis.style.width   = Math.round(canvasW) + 'px';
  } else { vAxis.style.display = 'none'; }
}

// ── Rendering ─────────────────────────────────────────────────────────────────

function setCellRadius(pct) {
  _cellRadius = Math.max(0, Math.min(100, pct || 0));
  renderCanvas();
}

function setCellShapeMode(mode) {
  _cellShapeMode = (mode === 'cross') ? 'cross' : 'radius';
  renderCanvas();
}

function _drawRoundedCell(x, y, size, r) {
  if (r <= 0) { _ctx.fillRect(x, y, size, size); return; }
  r = Math.min(r, size * 0.5);
  _ctx.beginPath();
  _ctx.moveTo(x + r, y);
  _ctx.lineTo(x + size - r, y);
  _ctx.arcTo(x + size, y,        x + size, y + r,        r);
  _ctx.lineTo(x + size, y + size - r);
  _ctx.arcTo(x + size, y + size, x + size - r, y + size, r);
  _ctx.lineTo(x + r,   y + size);
  _ctx.arcTo(x,        y + size, x,            y + size - r, r);
  _ctx.lineTo(x,       y + r);
  _ctx.arcTo(x,        y,        x + r,        y,            r);
  _ctx.closePath();
  _ctx.fill();
}

function _drawCrossCell(x, y, size) {
  // Matches the design spec: 14x14 viewBox, path "M1 1L13 13M13 1L1 13", stroke-width 2.8.
  var inset = size * (1 / 14);
  _ctx.save();
  _ctx.lineWidth = Math.max(1, size * (2.8 / 14));
  _ctx.lineCap   = 'round';
  _ctx.beginPath();
  _ctx.moveTo(x + inset,        y + inset);
  _ctx.lineTo(x + size - inset, y + size - inset);
  _ctx.moveTo(x + size - inset, y + inset);
  _ctx.lineTo(x + inset,        y + size - inset);
  _ctx.stroke();
  _ctx.restore();
}

// Full redraw from the layer composite. Called after structural changes
// (layer add/delete/reorder/visibility/opacity, undo/redo, load, clear).
function renderCanvas() {
  if (!_ctx || !_cols || !_layers.length) return;
  _recomputeComposite();
  var W = _cols * _cellPx, H = _rows * _cellPx;
  _ctx.clearRect(0, 0, W, H);
  var rad = Math.round((_cellRadius / 100) * (_cellPx * 0.5));
  for (var r = 0; r < _rows; r++) {
    for (var c = 0; c < _cols; c++) {
      var hex = _comp[r][c];
      if (!hex) continue;
      if (_cellShapeMode === 'cross') {
        _ctx.strokeStyle = hex;
        _drawCrossCell(c * _cellPx, r * _cellPx, _cellPx);
      } else {
        _ctx.fillStyle = hex;
        _drawRoundedCell(c * _cellPx, r * _cellPx, _cellPx, rad);
      }
    }
  }
  if (_cellPx >= 3) {
    _ctx.save();
    _ctx.strokeStyle = 'rgba(0,0,0,0.15)';
    _ctx.lineWidth   = 1;
    for (var cv = 0; cv <= _cols; cv++) {
      var x = cv * _cellPx + 0.5;
      _ctx.beginPath(); _ctx.moveTo(x, 0); _ctx.lineTo(x, H); _ctx.stroke();
    }
    for (var rh = 0; rh <= _rows; rh++) {
      var y = rh * _cellPx + 0.5;
      _ctx.beginPath(); _ctx.moveTo(0, y); _ctx.lineTo(W, y); _ctx.stroke();
    }
    _ctx.restore();
  }

  // Selection overlay
  if (_selectedCells.size > 0) {
    var activeTool = (typeof _activeTool !== 'undefined') ? _activeTool : 'wand';
    _ctx.save();
    if (activeTool === 'wand' || activeTool === 'move') {
      // Full per-cell overlay when wand (or move, which drags the selection) is active
      _ctx.fillStyle = 'rgba(13,153,255,0.16)';   // Figma accent tint
      _selectedCells.forEach(function (key) {
        var p = key.split(','), r = +p[0], c = +p[1];
        _ctx.fillRect(c * _cellPx, r * _cellPx, _cellPx, _cellPx);
      });
      _ctx.strokeStyle = '#0D99FF';
      _ctx.lineWidth = 1.5;
      _selectedCells.forEach(function (key) {
        var p = key.split(','), r = +p[0], c = +p[1];
        var cx = c * _cellPx, cy = r * _cellPx;
        _ctx.beginPath();
        if (!_selectedCells.has((r-1)+','+c)) { _ctx.moveTo(cx, cy+0.5);         _ctx.lineTo(cx+_cellPx, cy+0.5); }
        if (!_selectedCells.has((r+1)+','+c)) { _ctx.moveTo(cx, cy+_cellPx-0.5); _ctx.lineTo(cx+_cellPx, cy+_cellPx-0.5); }
        if (!_selectedCells.has(r+','+(c-1))) { _ctx.moveTo(cx+0.5, cy);         _ctx.lineTo(cx+0.5, cy+_cellPx); }
        if (!_selectedCells.has(r+','+(c+1))) { _ctx.moveTo(cx+_cellPx-0.5, cy); _ctx.lineTo(cx+_cellPx-0.5, cy+_cellPx); }
        _ctx.stroke();
      });
    } else {
      // Bounding box only when another tool is active
      var minR = Infinity, maxR = -Infinity, minC = Infinity, maxC = -Infinity;
      _selectedCells.forEach(function (key) {
        var p = key.split(','), r = +p[0], c = +p[1];
        if (r < minR) minR = r; if (r > maxR) maxR = r;
        if (c < minC) minC = c; if (c > maxC) maxC = c;
      });
      _ctx.strokeStyle = '#0D99FF';
      _ctx.lineWidth = 1.5;
      _ctx.setLineDash([4, 3]);
      _ctx.strokeRect(
        minC * _cellPx + 0.75,           minR * _cellPx + 0.75,
        (maxC - minC + 1) * _cellPx - 1.5, (maxR - minR + 1) * _cellPx - 1.5
      );
      _ctx.setLineDash([]);
    }
    _ctx.restore();
  }

  updateThumbnail();
  _applyTransform();
}

// ── Preview + layer thumbnails ────────────────────────────────────────────────
// updateThumbnail() is still called once per mouse event (never per painted
// cell); it additionally coalesces into one requestAnimationFrame, so a burst
// of events costs a single redraw of the Preview panel + active layer thumb.

var _thumbRAF = 0;

function updateThumbnail() {
  if (_thumbRAF) return;
  var raf = window.requestAnimationFrame || function (f) { return setTimeout(f, 16); };
  _thumbRAF = raf(function () { _thumbRAF = 0; _flushThumbnail(); });
}

function _paintGridToCanvas(el, grid) {
  if (!el || !grid || !_cols) return;
  if (el.width !== _cols)  el.width  = _cols;
  if (el.height !== _rows) el.height = _rows;
  var ctx = el.getContext('2d');
  var img = ctx.createImageData(_cols, _rows);
  var d = img.data;
  for (var r = 0; r < _rows; r++) {
    var row = grid[r];
    for (var c = 0; c < _cols; c++) {
      var hex = row[c];
      if (!hex) continue;
      var v = _rgbOf(hex), i = (r * _cols + c) * 4;
      d[i] = v[0]; d[i + 1] = v[1]; d[i + 2] = v[2]; d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

function drawLayerThumb(L) {
  if (!L) return;
  var el = document.querySelector('.layer-thumb[data-id="' + L.id + '"]');
  if (el) _paintGridToCanvas(el, L.cells);
}

function _flushThumbnail() {
  if (!_cols || !_comp) return;

  // Stats for the Preview header
  var painted = 0, seen = {}, colors = 0;
  for (var r = 0; r < _rows; r++) {
    for (var c = 0; c < _cols; c++) {
      var hex = _comp[r][c];
      if (!hex) continue;
      painted++;
      if (!seen[hex]) { seen[hex] = 1; colors++; }
    }
  }
  if (typeof onPreviewStats === 'function') onPreviewStats(painted, colors);

  var thumb = document.getElementById('canvas-thumb');
  var wrap  = document.getElementById('thumb-wrap');
  if (thumb && wrap && wrap.clientWidth > 0) {
    _paintGridToCanvas(thumb, _comp);
    var maxW = wrap.clientWidth - 16, maxH = wrap.clientHeight - 16;
    var aspect = _cols / _rows;
    var tw = maxW, th = tw / aspect;
    if (th > maxH) { th = maxH; tw = th * aspect; }
    thumb.style.width  = Math.max(1, Math.floor(tw)) + 'px';
    thumb.style.height = Math.max(1, Math.floor(th)) + 'px';
  }

  drawLayerThumb(_getActiveLayer());
}

// ── Cell helpers ──────────────────────────────────────────────────────────────

function _cellFromEvent(e) {
  var p = _screenToCanvas(e.clientX, e.clientY);
  return { col: Math.floor(p.x / _cellPx), row: Math.floor(p.y / _cellPx) };
}

function _inBounds(row, col) {
  return row >= 0 && row < _rows && col >= 0 && col < _cols;
}

var _lastHoverKey = '';
function _reportHover(e) {
  if (typeof onCanvasHover !== 'function') return;
  var pos = null;
  if (e && _scrollEl && _cols && (e.target === _canvasEl || _scrollEl.contains(e.target))) {
    var p = _cellFromEvent(e);
    if (_inBounds(p.row, p.col)) pos = p;
  }
  var key = pos ? pos.row + ',' + pos.col : '';
  if (key === _lastHoverKey) return;
  _lastHoverKey = key;
  onCanvasHover(pos);
}

// ── Shape geometry ────────────────────────────────────────────────────────────

function _constrainSquare(r0, c0, r1, c1) {
  var dr = r1 - r0, dc = c1 - c0;
  var dim = Math.min(Math.abs(dr), Math.abs(dc));
  return { r0: r0, c0: c0, r1: r0 + (dr < 0 ? -dim : dim), c1: c0 + (dc < 0 ? -dim : dim) };
}

function _rectCells(r0, c0, r1, c1) {
  var minR = Math.min(r0, r1), maxR = Math.max(r0, r1);
  var minC = Math.min(c0, c1), maxC = Math.max(c0, c1);
  var out = [];
  for (var r = minR; r <= maxR; r++)
    for (var c = minC; c <= maxC; c++)
      if (r === minR || r === maxR || c === minC || c === maxC)
        out.push([r, c]);
  return out;
}

function _lineCells(r0, c0, r1, c1) {
  var out = [];
  var dr = Math.abs(r1 - r0), dc = Math.abs(c1 - c0);
  var sr = r0 < r1 ? 1 : -1, sc = c0 < c1 ? 1 : -1;
  var err = dr - dc;
  while (true) {
    out.push([r0, c0]);
    if (r0 === r1 && c0 === c1) break;
    var e2 = 2 * err;
    if (e2 > -dc) { err -= dc; r0 += sr; }
    if (e2 <  dr) { err += dr; c0 += sc; }
  }
  return out;
}

// Shift-snap a line to the nearest 45° increment, keeping the start point fixed
function _constrainLineAngle(r0, c0, r1, c1) {
  var dr = r1 - r0, dc = c1 - c0;
  if (dr === 0 && dc === 0) return { r0: r0, c0: c0, r1: r1, c1: c1 };
  var angle = Math.atan2(dr, dc);
  var snapped = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
  var dist = Math.round(Math.sqrt(dr * dr + dc * dc));
  return {
    r0: r0, c0: c0,
    r1: r0 + Math.round(Math.sin(snapped) * dist),
    c1: c0 + Math.round(Math.cos(snapped) * dist),
  };
}

function _ovalCells(r0, c0, r1, c1) {
  var minR = Math.min(r0, r1), maxR = Math.max(r0, r1);
  var minC = Math.min(c0, c1), maxC = Math.max(c0, c1);
  var cr = (minR + maxR) / 2, cc = (minC + maxC) / 2;
  var ra = (maxR - minR) / 2 + 0.5;
  var rb = (maxC - minC) / 2 + 0.5;

  function _inside(r, c) { var dr = (r-cr)/ra, dc = (c-cc)/rb; return dr*dr + dc*dc <= 1; }

  var out = [];
  for (var r = minR; r <= maxR; r++) {
    for (var c = minC; c <= maxC; c++) {
      if (!_inside(r, c)) continue;
      // Include only cells whose 4-neighbourhood touches the outside
      if (!_inside(r-1,c) || !_inside(r+1,c) || !_inside(r,c-1) || !_inside(r,c+1))
        out.push([r, c]);
    }
  }
  return out;
}

// Mirrors a cell list across the active symmetry axes (see _paintAt for the
// equivalent per-cell mirroring used by pen/eraser strokes)
function _mirrorCells(cells) {
  if (_symmetry === 'none') return cells;
  var seen = {};
  var out = [];
  function add(r, c) {
    var key = r + ',' + c;
    if (seen[key]) return;
    seen[key] = true;
    out.push([r, c]);
  }
  cells.forEach(function (cell) {
    var r = cell[0], c = cell[1];
    var mirC = _cols - 1 - c, mirR = _rows - 1 - r;
    add(r, c);
    if (_symmetry === 'H' || _symmetry === '4') add(r,    mirC);
    if (_symmetry === 'V' || _symmetry === '4') add(mirR, c);
    if (_symmetry === '4')                       add(mirR, mirC);
  });
  return out;
}

function _shapeCells(tool, r0, c0, r1, c1, shiftKey) {
  var cells;
  if (tool === 'line') {
    var lc = shiftKey ? _constrainLineAngle(r0, c0, r1, c1) : { r0: r0, c0: c0, r1: r1, c1: c1 };
    cells = _lineCells(lc.r0, lc.c0, lc.r1, lc.c1);
  } else {
    var coords = shiftKey ? _constrainSquare(r0, c0, r1, c1) : { r0: r0, c0: c0, r1: r1, c1: c1 };
    cells = tool === 'oval'
      ? _ovalCells(coords.r0, coords.c0, coords.r1, coords.c1)
      : _rectCells(coords.r0, coords.c0, coords.r1, coords.c1);
  }
  return _mirrorCells(cells);
}

// ── Preview canvas ────────────────────────────────────────────────────────────

function _clearPreview() {
  if (_previewCtx && _previewEl)
    _previewCtx.clearRect(0, 0, _previewEl.width, _previewEl.height);
}

function _drawShapePreview(r0, c0, r1, c1, shiftKey) {
  if (!_previewCtx) return;
  _clearPreview();
  var tool  = (typeof _activeTool !== 'undefined') ? _activeTool : 'rect';
  var color = (typeof _armedColor  !== 'undefined') ? _armedColor : null;
  var cells = _shapeCells(tool, r0, c0, r1, c1, shiftKey);

  _previewCtx.save();
  if (color) {
    _previewCtx.globalAlpha = 0.65;
    _previewCtx.fillStyle = color;
  } else {
    // eraser preview: red-tinted checkerboard impression
    _previewCtx.globalAlpha = 0.45;
    _previewCtx.fillStyle = '#DC3412';   // Figma danger
  }
  cells.forEach(function (cell) {
    if (!_inBounds(cell[0], cell[1])) return;
    _previewCtx.fillRect(cell[1] * _cellPx, cell[0] * _cellPx, _cellPx, _cellPx);
  });
  _previewCtx.restore();
}

// ── Flood fill ────────────────────────────────────────────────────────────────
// Operates on the active layer's own pixels (not the composite).

function _floodFill(startRow, startCol, fillColor) {
  if (!_inBounds(startRow, startCol)) return false;
  var targetColor = _cells[startRow][startCol];
  if (targetColor === fillColor) return false;

  var queue = [[startRow, startCol]];
  var visited = {};
  var filled = [];

  while (queue.length) {
    var item = queue.shift();
    var r = item[0], c = item[1];
    var key = r + ',' + c;
    if (visited[key] || !_inBounds(r, c)) continue;
    if (_cells[r][c] !== targetColor) continue;
    visited[key] = true;
    _cells[r][c] = fillColor;
    _renderCell(r, c);
    filled.push([r, c]);
    queue.push([r-1, c], [r+1, c], [r, c-1], [r, c+1]);
  }

  // Mirror the filled region itself (like pen/eraser/shapes) rather than
  // re-running flood fill at the mirrored start point, so a fill still
  // reads as "this region, mirrored" even on an asymmetric canvas.
  if (_symmetry !== 'none') {
    _mirrorCells(filled).forEach(function (cell) {
      var r = cell[0], c = cell[1];
      if (!_inBounds(r, c) || _cells[r][c] === fillColor) return;
      _cells[r][c] = fillColor;
      _renderCell(r, c);
    });
  }

  updateThumbnail();
  if (fillColor && typeof _addToRecent === 'function') _addToRecent(fillColor);
  return true;
}

// ── Shape commit ──────────────────────────────────────────────────────────────

function _commitShape(r0, c0, r1, c1, shiftKey) {
  var tool  = (typeof _activeTool !== 'undefined') ? _activeTool : 'rect';
  var color = (typeof _armedColor  !== 'undefined') ? _armedColor : null;
  var cells = _shapeCells(tool, r0, c0, r1, c1, shiftKey);

  cells.forEach(function (cell) {
    var r = cell[0], c = cell[1];
    if (!_inBounds(r, c)) return;
    _cells[r][c] = color || null;
    _renderCell(r, c);
  });
  updateThumbnail();
  if (color && typeof _addToRecent === 'function') _addToRecent(color);
}

// ── Per-cell paint / erase ────────────────────────────────────────────────────

function _applyToolAt(row, col, tool, color) {
  if (!_inBounds(row, col)) return;
  if (tool === 'pen') {
    if (!color) return;
    var prev = _cells[row][col];
    _cells[row][col] = color;
    _renderCell(row, col);
    if (prev !== color) { _strokeChanged = true; _onCellPainted(row, col, color); }
  } else if (tool === 'eraser') {
    if (_cells[row][col] === null) return;
    _cells[row][col] = null;
    _strokeChanged = true;
    _renderCell(row, col);
  }
}

function _paintAt(row, col) {
  if (!_inBounds(row, col)) return;
  if (_lastPaintCell && _lastPaintCell.row === row && _lastPaintCell.col === col) return;
  _lastPaintCell = { row: row, col: col };

  var tool  = (typeof _activeTool !== 'undefined') ? _activeTool : 'pen';
  var color = (typeof _armedColor  !== 'undefined') ? _armedColor : null;

  if (tool === 'eyedropper') {
    var picked = _topColorAt(row, col);
    // Picking arms the color and switches to pen; end the gesture here so the
    // rest of this drag doesn't start painting (which would also skip the
    // locked-layer check made at mousedown).
    _painting = false;
    _strokeSnapshot = null;
    if (picked && typeof _armColorFromCanvas === 'function') _armColorFromCanvas(picked);
    return;
  }

  var mirC = _cols - 1 - col;
  var mirR = _rows - 1 - row;
  _applyToolAt(row, col,  tool, color);
  if (_symmetry === 'H' || _symmetry === '4') _applyToolAt(row,  mirC, tool, color);
  if (_symmetry === 'V' || _symmetry === '4') _applyToolAt(mirR, col,  tool, color);
  if (_symmetry === '4')                       _applyToolAt(mirR, mirC, tool, color);
}

// Redraw one cell from the composite (the active layer just changed at row,col)
function _renderCell(row, col) {
  var x = col * _cellPx, y = row * _cellPx;
  _ctx.clearRect(x, y, _cellPx, _cellPx);
  var hex = _comp[row][col] = _compositeAt(row, col);
  if (hex) {
    if (_cellShapeMode === 'cross') {
      _ctx.strokeStyle = hex;
      _drawCrossCell(x, y, _cellPx);
    } else {
      _ctx.fillStyle = hex;
      var rad = Math.round((_cellRadius / 100) * (_cellPx * 0.5));
      _drawRoundedCell(x, y, _cellPx, rad);
    }
  }
  if (_cellPx < 3) return;
  _ctx.save();
  _ctx.strokeStyle = 'rgba(0,0,0,0.15)';
  _ctx.lineWidth   = 1;
  var x0 = x + 0.5, y0 = y + 0.5, x1 = x + _cellPx + 0.5, y1 = y + _cellPx + 0.5;
  _ctx.beginPath(); _ctx.moveTo(x0, y);  _ctx.lineTo(x0, y + _cellPx); _ctx.stroke();
  _ctx.beginPath(); _ctx.moveTo(x1, y);  _ctx.lineTo(x1, y + _cellPx); _ctx.stroke();
  _ctx.beginPath(); _ctx.moveTo(x, y0);  _ctx.lineTo(x + _cellPx, y0); _ctx.stroke();
  _ctx.beginPath(); _ctx.moveTo(x, y1);  _ctx.lineTo(x + _cellPx, y1); _ctx.stroke();
  _ctx.restore();
}

function _onCellPainted(row, col, hex) {
  if (hex && typeof _addToRecent === 'function') _addToRecent(hex);
}

// ── Move tool ─────────────────────────────────────────────────────────────────
// Drags the whole active layer, or just the selected cells if there is a wand
// selection. Pixels pushed past the grid edge are clipped on release.

function _beginMove(pos) {
  _moveActive    = true;
  _moveStart     = pos;
  _moveLast      = { dr: 0, dc: 0 };
  _strokeSnapshot = _snapshotState();
  _moveSnapCells = _cloneGrid(_cells);
  _moveSnapSel   = _selectedCells.size ? new Set(_selectedCells) : null;
}

function _updateMove(pos) {
  var dr = pos.row - _moveStart.row, dc = pos.col - _moveStart.col;
  if (dr === _moveLast.dr && dc === _moveLast.dc) return;
  _moveLast = { dr: dr, dc: dc };

  var src = _moveSnapCells, sel = _moveSnapSel;
  var next = _emptyGrid();
  var nsel = sel ? new Set() : null;
  var r, c;

  if (sel) {
    for (r = 0; r < _rows; r++)
      for (c = 0; c < _cols; c++)
        if (!sel.has(r + ',' + c)) next[r][c] = src[r][c];
  }
  for (r = 0; r < _rows; r++) {
    for (c = 0; c < _cols; c++) {
      if (sel && !sel.has(r + ',' + c)) continue;
      var nr = r + dr, nc = c + dc;
      if (!_inBounds(nr, nc)) continue;
      if (src[r][c]) next[nr][nc] = src[r][c];
      if (nsel) nsel.add(nr + ',' + nc);
    }
  }

  var A = _getActiveLayer();
  A.cells = next;
  _syncActive();
  if (nsel) _selectedCells = nsel;
  renderCanvas();
}

function _endMove() {
  if (_moveLast && (_moveLast.dr || _moveLast.dc) && _strokeSnapshot) _pushUndo(_strokeSnapshot);
  _strokeSnapshot = null;
  _moveActive = false;
  _moveStart = null; _moveLast = null; _moveSnapCells = null; _moveSnapSel = null;
  if (typeof onWandSelection === 'function') onWandSelection(_selectedCells.size);
}

// ── Mouse events ──────────────────────────────────────────────────────────────

function _onCanvasMouseDown(e) {
  if (_spaceHeld || e.button !== 0) return;
  window.focus(); // reclaim keyboard focus from the Figma app so Ctrl+Z/Ctrl+Y hit the plugin, not the main canvas
  var pos  = _cellFromEvent(e);
  var tool = (typeof _activeTool !== 'undefined') ? _activeTool : 'pen';

  if (tool === 'wand') {
    var count;
    if (_inBounds(pos.row, pos.col)) count = selectByColor(pos.row, pos.col, e.shiftKey);
    else { if (!e.shiftKey) clearSelection(); count = _selectedCells.size; }
    if (typeof onWandSelection === 'function') onWandSelection(count);
    e.preventDefault();
    return;
  }

  // Locked / hidden active layer: block every pixel-writing tool
  if (_EDIT_TOOLS[tool] && !_canEditActiveLayer(true)) { e.preventDefault(); return; }

  if (tool === 'move') {
    _beginMove(pos);
    e.preventDefault();
    return;
  }

  if (tool === 'bucket') {
    var color = (typeof _armedColor !== 'undefined') ? _armedColor : null;
    if (color && _inBounds(pos.row, pos.col)) {
      var snap = _snapshotState();
      if (_floodFill(pos.row, pos.col, color)) _pushUndo(snap);
    }
    e.preventDefault();
    return;
  }

  if (tool === 'rect' || tool === 'oval' || tool === 'line') {
    _shapeActive   = true;
    _shapeStart    = pos;
    _shapeEnd      = pos;
    _shapeShiftKey = e.shiftKey;
    _strokeSnapshot = _snapshotState();
    _drawShapePreview(pos.row, pos.col, pos.row, pos.col, e.shiftKey);
    e.preventDefault();
    return;
  }

  _painting      = true;
  _lastPaintCell = null;
  _lastMouseCell = null;
  _strokeChanged = false;
  _strokeSnapshot = _snapshotState();
  _paintAt(pos.row, pos.col);
  _lastMouseCell = { row: pos.row, col: pos.col };
  updateThumbnail();
  e.preventDefault();
}

function _onScrollMouseDown(e) {
  if (!_spaceHeld || e.button !== 0) return;
  window.focus();
  _isPanning = true;
  _panLastX  = e.clientX;
  _panLastY  = e.clientY;
  if (_scrollEl) _scrollEl.style.cursor = 'grabbing';
  e.preventDefault();
}

function _onMouseMove(e) {
  if (_refDragging && _refDragStart) {
    _refLeft = _refDragStart.left + (e.clientX - _refDragStart.cx) / _zoom;
    _refTop  = _refDragStart.top  + (e.clientY - _refDragStart.cy) / _zoom;
    _positionRef();
    return;
  }
  if (_refResizing && _refResizeStart) {
    _refWidth  = Math.max(20, _refResizeStart.w + (e.clientX - _refResizeStart.cx) / _zoom);
    _refHeight = Math.max(20, _refResizeStart.h + (e.clientY - _refResizeStart.cy) / _zoom);
    _positionRef();
    return;
  }

  if (_isPanning) {
    _panX += e.clientX - _panLastX; _panY += e.clientY - _panLastY;
    _panLastX = e.clientX; _panLastY = e.clientY;
    _applyTransform();
    return;
  }

  if (_cols) _reportHover(e);

  if (_moveActive) {
    _updateMove(_cellFromEvent(e));
    return;
  }

  if (_shapeActive) {
    var pos = _cellFromEvent(e);
    _shapeEnd      = pos;
    _shapeShiftKey = e.shiftKey;
    _drawShapePreview(_shapeStart.row, _shapeStart.col, pos.row, pos.col, e.shiftKey);
    return;
  }

  if (!_painting) return;
  var pos2 = _cellFromEvent(e);
  if (_lastMouseCell) {
    // Bresenham line: fill every cell between last mouse pos and current pos
    var r0 = _lastMouseCell.row, c0 = _lastMouseCell.col;
    var r1 = pos2.row,           c1 = pos2.col;
    var dr = Math.abs(r1 - r0), dc = Math.abs(c1 - c0);
    var sr = r0 < r1 ? 1 : -1,  sc = c0 < c1 ? 1 : -1;
    var err = dr - dc;
    while (true) {
      _paintAt(r0, c0);
      if (r0 === r1 && c0 === c1) break;
      var e2 = 2 * err;
      if (e2 > -dc) { err -= dc; r0 += sr; }
      if (e2 <  dr) { err += dr; c0 += sc; }
    }
  } else {
    _paintAt(pos2.row, pos2.col);
  }
  _lastMouseCell = pos2;
  updateThumbnail();
}

function _onMouseUp(e) {
  if (_refDragging || _refResizing) {
    _refDragging = false; _refResizing = false;
    _refDragStart = null; _refResizeStart = null;
    return;
  }
  if (_isPanning) {
    _isPanning = false;
    if (_scrollEl) _scrollEl.style.cursor = _spaceHeld ? 'grab' : '';
  }

  if (_moveActive) { _endMove(); return; }

  if (_shapeActive) {
    var end = _shapeEnd || _shapeStart;
    _commitShape(_shapeStart.row, _shapeStart.col, end.row, end.col, _shapeShiftKey);
    if (_strokeSnapshot) { _pushUndo(_strokeSnapshot); _strokeSnapshot = null; }
    _clearPreview();
    _shapeActive = false;
    _shapeStart  = null;
    _shapeEnd    = null;
    return;
  }

  if (_painting) {
    _painting      = false;
    _lastPaintCell = null;
    _lastMouseCell = null;
    // Only strokes that actually changed a cell become an undo step
    // (an eyedropper click or a pen pass over same-color cells does not).
    if (_strokeSnapshot && _strokeChanged) _pushUndo(_strokeSnapshot);
    _strokeSnapshot = null;
    _strokeChanged  = false;
  }
}

function _onWheel(e) {
  e.preventDefault();
  if (e.altKey) {
    rotateView(e.deltaY < 0 ? -5 : 5);
    return;
  }
  var factor = e.ctrlKey
    ? (e.deltaY < 0 ? 1.5  : 1/1.5)
    : (e.deltaY < 0 ? 1.15 : 1/1.15);
  _zoomAt(e.clientX, e.clientY, factor);
}

// ── State export (flatten) ────────────────────────────────────────────────────

// The single choke point for anything headed to the sandbox: composites every
// visible layer (respecting opacity) into one fresh [row][col] grid of
// '#RRGGBB' | null — identical in shape to the pre-layers `cells` payload.
function getFlatCells() {
  var out = [];
  for (var r = 0; r < _rows; r++) {
    var row = new Array(_cols);
    for (var c = 0; c < _cols; c++) row[c] = _compositeAt(r, c);
    out.push(row);
  }
  return out;
}

function getCanvasState() {
  if (!_cells) return null;
  return { cells: getFlatCells(), cols: _cols, rows: _rows, cellSize: _figmaCellSz, gap: _gap };
}

// Load flat cells read back from Figma into the active layer (right after
// initCanvas, that's the single "Layer 1" — Figma only stores the flat result).
function loadCells(cells) {
  if (!_cells || !cells) return;
  for (var r = 0; r < _rows; r++)
    for (var c = 0; c < _cols; c++)
      _cells[r][c] = (cells[r] && cells[r][c]) ? cells[r][c] : null;
  renderCanvas();
  if (typeof onLayersChanged === 'function') onLayersChanged();
}

// ── Layer API (used by the Layers panel in app.js) ────────────────────────────

function getLayers()        { return _layers; }
function getActiveLayerId() { return _activeLayerId; }
function getActiveLayer()   { return _getActiveLayer(); }

function _notifyLayers() {
  if (typeof onLayersChanged === 'function') onLayersChanged();
  if (typeof refreshCanvasCursor === 'function') refreshCanvasCursor();
}

function setActiveLayer(id) {
  if (!_findLayer(id) || id === _activeLayerId) return;
  _activeLayerId = id;
  _syncActive();
  _notifyLayers();
}

// New empty layer directly above the active one
function addLayer() {
  if (!_layers.length) return null;
  _pushUndo(_captureState());
  var L = _makeLayer();
  _layers.splice(Math.max(0, _layerIndex(_activeLayerId)), 0, L);
  _activeLayerId = L.id;
  _syncActive();
  renderCanvas();
  _notifyLayers();
  return L;
}

function duplicateLayer(id) {
  var i = _layerIndex(id || _activeLayerId);
  if (i < 0) return null;
  var src = _layers[i];
  _pushUndo(_captureState());
  var copy = _makeLayer(src.name + ' copy', _cloneGrid(src.cells));
  copy.visible = src.visible;
  copy.opacity = src.opacity;
  _layers.splice(i, 0, copy);
  _activeLayerId = copy.id;
  _syncActive();
  renderCanvas();
  _notifyLayers();
  return copy;
}

function deleteLayer(id) {
  var i = _layerIndex(id || _activeLayerId);
  if (i < 0 || _layers.length < 2) return false;
  _pushUndo(_captureState());
  var wasActive = _layers[i].id === _activeLayerId;
  _layers.splice(i, 1);
  if (wasActive) _activeLayerId = _layers[Math.min(i, _layers.length - 1)].id;
  _syncActive();
  renderCanvas();
  _notifyLayers();
  return true;
}

// dir: -1 = up (toward top of stack), +1 = down
function moveLayer(id, dir) {
  var i = _layerIndex(id || _activeLayerId), j = i + dir;
  if (i < 0 || j < 0 || j >= _layers.length) return false;
  _pushUndo(_captureState());
  var t = _layers[i]; _layers[i] = _layers[j]; _layers[j] = t;
  renderCanvas();
  _notifyLayers();
  return true;
}

// Move a layer to a final index in the stack (used by drag-to-reorder)
function moveLayerTo(id, toIndex) {
  var i = _layerIndex(id);
  if (i < 0) return false;
  toIndex = Math.max(0, Math.min(_layers.length - 1, toIndex));
  if (toIndex === i) return false;
  _pushUndo(_captureState());
  var L = _layers.splice(i, 1)[0];
  _layers.splice(toIndex, 0, L);
  renderCanvas();
  _notifyLayers();
  return true;
}

// Name / visibility / lock / opacity are instant settings (like the mock),
// not undo steps — see history.js _restoreState.
function renameLayer(id, name) {
  var L = _findLayer(id);
  name = (name || '').trim();
  if (!L || !name || name === L.name) return;
  L.name = name;
  _notifyLayers();
}

function setLayerVisible(id, v) {
  var L = _findLayer(id);
  if (!L) return;
  L.visible = !!v;
  renderCanvas();
  _notifyLayers();
}

function setLayerLocked(id, v) {
  var L = _findLayer(id);
  if (!L) return;
  L.locked = !!v;
  _notifyLayers();
}

function setLayerOpacity(id, pct) {
  var L = _findLayer(id);
  if (!L) return;
  pct = Math.max(0, Math.min(100, Math.round(pct)));
  if (pct === L.opacity) return;
  L.opacity = pct;
  renderCanvas();
}

// ── Magic Wand selection ──────────────────────────────────────────────────────
// Selects same-color connected cells on the ACTIVE layer. Shift adds.

function selectByColor(startRow, startCol, additive) {
  if (!_inBounds(startRow, startCol)) return 0;
  var target  = _cells[startRow][startCol];
  var visited = new Set();
  var queue   = [[startRow, startCol]];
  if (!additive) _selectedCells = new Set();
  while (queue.length) {
    var curr = queue.shift();
    var r = curr[0], c = curr[1];
    var key = r + ',' + c;
    if (visited.has(key)) continue;
    visited.add(key);
    if (!_inBounds(r, c) || _cells[r][c] !== target) continue;
    _selectedCells.add(key);
    queue.push([r-1,c],[r+1,c],[r,c-1],[r,c+1]);
  }
  renderCanvas();
  return _selectedCells.size;
}

function clearSelection() {
  if (!_selectedCells.size) return;
  _selectedCells = new Set();
  renderCanvas();
}

function getSelectionCount() { return _selectedCells.size; }

// Returns true if the selection was filled (false if blocked by a locked layer)
function fillSelection(color) {
  if (!_selectedCells.size || !color) return false;
  if (!_canEditActiveLayer(true)) return false;
  _pushUndo(_snapshotState());
  _selectedCells.forEach(function (key) {
    var p = key.split(',');
    _cells[+p[0]][+p[1]] = color;
  });
  _selectedCells = new Set();
  renderCanvas();
  return true;
}

function eraseSelection() {
  if (!_selectedCells.size) return false;
  if (!_canEditActiveLayer(true)) return false;
  _pushUndo(_snapshotState());
  _selectedCells.forEach(function (key) {
    var p = key.split(',');
    _cells[+p[0]][+p[1]] = null;
  });
  _selectedCells = new Set();
  renderCanvas();
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────

// Clears the ACTIVE layer (undoable). Returns true if cleared.
function clearCanvas() {
  if (!_cells) return false;
  if (!_canEditActiveLayer(true)) return false;
  _selectedCells = new Set();
  _pushUndo(_captureState());
  var A = _getActiveLayer();
  A.cells = _emptyGrid();   // replace, don't mutate — the old grid lives on in history
  _syncActive();
  renderCanvas();
  if (typeof onWandSelection === 'function') onWandSelection(0);
  return true;
}
