// canvas.js — painting engine · zoom/pan · symmetry · undo · shapes · fill

var _cells       = null;  // [row][col] = hexString | null
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

// Zoom / pan
var _zoom      = 1;
var _panX      = 0;
var _panY      = 0;
var _isPanning = false;
var _panLastX  = 0;
var _panLastY  = 0;
var _spaceHeld = false;

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

// Undo / redo
var _undoStack      = [];
var _redoStack      = [];
var MAX_UNDO        = 50;
var _strokeSnapshot = null;

// Magic wand selection
var _selectedCells = new Set();

// Cell corner radius (0–100, where 100 = circle)
var _cellRadius = 0;

// ── Init ──────────────────────────────────────────────────────────────────────

function initCanvas(cols, rows, canvasW, canvasH, gap, figmaCellSize) {
  _cols        = cols;
  _rows        = rows;
  _gap         = gap !== undefined ? gap : 1;
  _figmaCellSz = figmaCellSize || 16;

  var pxW = canvasW / cols;
  var pxH = canvasH / rows;
  _cellPx = Math.max(4, Math.floor(Math.min(pxW, pxH)));

  _cells = [];
  for (var r = 0; r < rows; r++) _cells.push(new Array(cols).fill(null));

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
  _painting       = false;
  _lastPaintCell  = null;
  _strokeSnapshot = null;
  _selectedCells  = new Set();
  _undoStack      = [];
  _redoStack      = [];
  _zoom = 1; _panX = 0; _panY = 0;
  renderCanvas();
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
  _canvasEl.style.transform = t;
  if (_previewEl) _previewEl.style.transform = t;
  var lvl = document.getElementById('zoom-level');
  if (lvl) lvl.textContent = Math.round(_zoom * 100) + '%';
  _updateAxisOverlays();
  _positionRef();
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
  var natW = _cols * _cellPx, natH = _rows * _cellPx;
  var pad = 20;
  _zoom = Math.max(0.1, Math.min(64, Math.min((wW - pad*2)/natW, (wH - pad*2)/natH)));
  _panX = (wW - natW * _zoom) / 2;
  _panY = (wH - natH * _zoom) / 2;
  _applyTransform();
}

function setSpaceHeld(v) {
  _spaceHeld = v;
  if (!_scrollEl) return;
  if (!v && !_isPanning) _scrollEl.style.cursor = '';
  else if (v && !_isPanning) _scrollEl.style.cursor = 'grab';
}

// ── Undo / Redo ───────────────────────────────────────────────────────────────

function _deepCopyCells() {
  return _cells.map(function (row) { return row.slice(); });
}

function _pushUndo(snapshot) {
  _undoStack.push(snapshot);
  if (_undoStack.length > MAX_UNDO) _undoStack.shift();
  _redoStack = [];
}

function undoCanvas() {
  if (!_undoStack.length) return;
  _selectedCells = new Set();
  _redoStack.push(_deepCopyCells());
  _cells = _undoStack.pop();
  renderCanvas();
  if (typeof onWandSelection === 'function') onWandSelection(0);
}

function redoCanvas() {
  if (!_redoStack.length) return;
  _selectedCells = new Set();
  _undoStack.push(_deepCopyCells());
  _cells = _redoStack.pop();
  renderCanvas();
  if (typeof onWandSelection === 'function') onWandSelection(0);
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
  var show = _refVisible && _refEl.src && _refEl.src !== window.location.href;
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

function renderCanvas() {
  if (!_ctx || !_cols) return;
  var W = _cols * _cellPx, H = _rows * _cellPx;
  _ctx.clearRect(0, 0, W, H);
  var rad = Math.round((_cellRadius / 100) * (_cellPx * 0.5));
  for (var r = 0; r < _rows; r++) {
    for (var c = 0; c < _cols; c++) {
      var hex = _cells[r][c];
      if (!hex) continue;
      _ctx.fillStyle = hex;
      _drawRoundedCell(c * _cellPx, r * _cellPx, _cellPx, rad);
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
    if (activeTool === 'wand') {
      // Full per-cell overlay when wand is active
      _ctx.fillStyle = 'rgba(100,149,237,0.28)';
      _selectedCells.forEach(function (key) {
        var p = key.split(','), r = +p[0], c = +p[1];
        _ctx.fillRect(c * _cellPx, r * _cellPx, _cellPx, _cellPx);
      });
      _ctx.strokeStyle = 'rgba(70,110,210,0.9)';
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
      _ctx.strokeStyle = 'rgba(70,110,210,0.85)';
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

function updateThumbnail() {
  var thumb = document.getElementById('canvas-thumb');
  var wrap  = document.getElementById('thumb-wrap');
  if (!thumb || !_canvasEl || !_cols) return;
  var maxW = (wrap ? wrap.clientWidth : 196) - 8;
  var maxH = 160;
  var aspect = _cols / _rows;
  var tw = maxW, th = Math.round(tw / aspect);
  if (th > maxH) { th = maxH; tw = Math.round(th * aspect); }
  tw = Math.max(tw, 1); th = Math.max(th, 1);
  thumb.width = tw; thumb.height = th;
  var tctx = thumb.getContext('2d');
  tctx.imageSmoothingEnabled = false;
  tctx.clearRect(0, 0, tw, th);
  tctx.drawImage(_canvasEl, 0, 0, tw, th);
}

// ── Cell helpers ──────────────────────────────────────────────────────────────

function _cellFromEvent(e) {
  var rect = _canvasEl.getBoundingClientRect();
  return {
    col: Math.floor((e.clientX - rect.left) / (rect.width  / _cols)),
    row: Math.floor((e.clientY - rect.top)  / (rect.height / _rows)),
  };
}

function _inBounds(row, col) {
  return row >= 0 && row < _rows && col >= 0 && col < _cols;
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
  var coords = shiftKey ? _constrainSquare(r0, c0, r1, c1) : { r0: r0, c0: c0, r1: r1, c1: c1 };
  var cells = tool === 'oval'
    ? _ovalCells(coords.r0, coords.c0, coords.r1, coords.c1)
    : _rectCells(coords.r0, coords.c0, coords.r1, coords.c1);

  _previewCtx.save();
  if (color) {
    _previewCtx.globalAlpha = 0.65;
    _previewCtx.fillStyle = color;
  } else {
    // eraser preview: red-tinted checkerboard impression
    _previewCtx.globalAlpha = 0.45;
    _previewCtx.fillStyle = '#CC4444';
  }
  cells.forEach(function (cell) {
    if (!_inBounds(cell[0], cell[1])) return;
    _previewCtx.fillRect(cell[1] * _cellPx, cell[0] * _cellPx, _cellPx, _cellPx);
  });
  _previewCtx.restore();
}

// ── Flood fill ────────────────────────────────────────────────────────────────

function _floodFill(startRow, startCol, fillColor) {
  if (!_inBounds(startRow, startCol)) return;
  var targetColor = _cells[startRow][startCol];
  if (targetColor === fillColor) return;

  var queue = [[startRow, startCol]];
  var visited = {};

  while (queue.length) {
    var item = queue.shift();
    var r = item[0], c = item[1];
    var key = r + ',' + c;
    if (visited[key] || !_inBounds(r, c)) continue;
    if (_cells[r][c] !== targetColor) continue;
    visited[key] = true;
    _cells[r][c] = fillColor;
    _renderCell(r, c);
    queue.push([r-1, c], [r+1, c], [r, c-1], [r, c+1]);
  }
  updateThumbnail();
  if (fillColor && typeof _addToRecent === 'function') _addToRecent(fillColor);
}

// ── Shape commit ──────────────────────────────────────────────────────────────

function _commitShape(r0, c0, r1, c1, shiftKey) {
  var tool  = (typeof _activeTool !== 'undefined') ? _activeTool : 'rect';
  var color = (typeof _armedColor  !== 'undefined') ? _armedColor : null;
  var coords = shiftKey ? _constrainSquare(r0, c0, r1, c1) : { r0: r0, c0: c0, r1: r1, c1: c1 };
  var cells = tool === 'oval'
    ? _ovalCells(coords.r0, coords.c0, coords.r1, coords.c1)
    : _rectCells(coords.r0, coords.c0, coords.r1, coords.c1);

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
    if (prev !== color) _onCellPainted(row, col, color);
  } else if (tool === 'eraser') {
    if (_cells[row][col] === null) return;
    _cells[row][col] = null;
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
    var picked = _cells[row][col];
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

function _renderCell(row, col) {
  var x = col * _cellPx, y = row * _cellPx;
  _ctx.clearRect(x, y, _cellPx, _cellPx);
  var hex = _cells[row][col];
  if (hex) {
    _ctx.fillStyle = hex;
    var rad = Math.round((_cellRadius / 100) * (_cellPx * 0.5));
    _drawRoundedCell(x, y, _cellPx, rad);
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

// ── Mouse events ──────────────────────────────────────────────────────────────

function _onCanvasMouseDown(e) {
  if (_spaceHeld || e.button !== 0) return;
  var pos  = _cellFromEvent(e);
  var tool = (typeof _activeTool !== 'undefined') ? _activeTool : 'pen';

  if (tool === 'wand') {
    var count = _inBounds(pos.row, pos.col) ? selectByColor(pos.row, pos.col) : 0;
    if (typeof onWandSelection === 'function') onWandSelection(count);
    e.preventDefault();
    return;
  }

  if (tool === 'bucket') {
    var color = (typeof _armedColor !== 'undefined') ? _armedColor : null;
    if (color && _inBounds(pos.row, pos.col)) {
      var snap = _deepCopyCells();
      _floodFill(pos.row, pos.col, color);
      _pushUndo(snap);
    }
    e.preventDefault();
    return;
  }

  if (tool === 'rect' || tool === 'oval') {
    _shapeActive   = true;
    _shapeStart    = pos;
    _shapeEnd      = pos;
    _shapeShiftKey = e.shiftKey;
    _strokeSnapshot = _deepCopyCells();
    _drawShapePreview(pos.row, pos.col, pos.row, pos.col, e.shiftKey);
    e.preventDefault();
    return;
  }

  _painting      = true;
  _lastPaintCell = null;
  _lastMouseCell = null;
  _strokeSnapshot = _deepCopyCells();
  _paintAt(pos.row, pos.col);
  _lastMouseCell = { row: pos.row, col: pos.col };
  updateThumbnail();
  e.preventDefault();
}

function _onScrollMouseDown(e) {
  if (!_spaceHeld || e.button !== 0) return;
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
    if (_strokeSnapshot) { _pushUndo(_strokeSnapshot); _strokeSnapshot = null; }
  }
}

function _onWheel(e) {
  e.preventDefault();
  var factor = e.ctrlKey
    ? (e.deltaY < 0 ? 1.5  : 1/1.5)
    : (e.deltaY < 0 ? 1.15 : 1/1.15);
  _zoomAt(e.clientX, e.clientY, factor);
}

// ── State export ──────────────────────────────────────────────────────────────

function getCanvasState() {
  if (!_cells) return null;
  return { cells: _cells, cols: _cols, rows: _rows, cellSize: _figmaCellSz, gap: _gap };
}

function loadCells(cells) {
  if (!_cells || !cells) return;
  for (var r = 0; r < _rows; r++)
    for (var c = 0; c < _cols; c++)
      _cells[r][c] = (cells[r] && cells[r][c]) ? cells[r][c] : null;
  renderCanvas();
}

// ── Magic Wand selection ──────────────────────────────────────────────────────

function selectByColor(startRow, startCol) {
  if (!_inBounds(startRow, startCol)) return 0;
  var target  = _cells[startRow][startCol];
  var visited = new Set();
  var queue   = [[startRow, startCol]];
  _selectedCells = new Set();
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

function fillSelection(color) {
  if (!_selectedCells.size || !color) return;
  _pushUndo(_deepCopyCells());
  _selectedCells.forEach(function (key) {
    var p = key.split(',');
    _cells[+p[0]][+p[1]] = color;
  });
  _selectedCells = new Set();
  renderCanvas();
  updateThumbnail();
}

function eraseSelection() {
  if (!_selectedCells.size) return;
  _pushUndo(_deepCopyCells());
  _selectedCells.forEach(function (key) {
    var p = key.split(',');
    _cells[+p[0]][+p[1]] = null;
  });
  _selectedCells = new Set();
  renderCanvas();
  updateThumbnail();
}

// ─────────────────────────────────────────────────────────────────────────────

function clearCanvas() {
  if (!_cells) return;
  _selectedCells = new Set();
  _pushUndo(_deepCopyCells());
  for (var r = 0; r < _rows; r++)
    for (var c = 0; c < _cols; c++)
      _cells[r][c] = null;
  renderCanvas();
}
