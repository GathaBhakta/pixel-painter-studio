// tools.js — floating toolbar · tool submenus · tooltips · context menu ·
//            status bar · collapse-panels mode · shared drag helpers

var TOOL_NAMES = {
  move: 'Move', wand: 'Magic wand', pen: 'Pencil', eraser: 'Eraser', bucket: 'Fill',
  eyedropper: 'Eyedropper', line: 'Line', rect: 'Rectangle', oval: 'Ellipse',
};
var TOOL_KEYS = {
  move: 'V', wand: 'W', pen: 'P', eraser: 'E', bucket: 'G',
  eyedropper: 'I', line: 'L', rect: 'R', oval: 'O',
};
var TOOL_HINTS = {
  move:       'Drag to move the layer — or the selection, if there is one',
  wand:       'Click to select same-color cells · Shift adds',
  pen:        'Click or drag to paint',
  eraser:     'Click or drag to erase',
  bucket:     'Click to fill connected cells',
  eyedropper: 'Click a cell, or any element in Figma, to pick its color',
  line:       'Drag to draw a line · Shift snaps to 45°',
  rect:       'Drag to draw a rectangle · Shift = square',
  oval:       'Drag to draw an ellipse · Shift = circle',
};
var SYM_LABELS = { none: 'Off', H: 'Horizontal', V: 'Vertical', '4': '4-way' };

var PAINT_GROUP = { pen: 1, eraser: 1 };
var SHAPE_GROUP = { rect: 1, line: 1, oval: 1 };

var _lastPaint   = 'pen';
var _lastShape   = 'rect';
var _lastSymMode = 'H';   // what the symmetry quick-toggle turns on
var _openMenu    = null;  // 'paint' | 'shape' | 'sym' | null

// ── Shared drag helpers ───────────────────────────────────────────────────────

// Drag along one axis from a mousedown: calls set(clamped value) on every move.
function drag1D(e, axis, start, min, max, set, rate) {
  e.preventDefault(); e.stopPropagation();
  var p0 = axis === 'x' ? e.clientX : e.clientY;
  var prevCursor = document.body.style.cursor;
  document.body.style.cursor = getComputedStyle(e.currentTarget).cursor;
  document.body.classList.add('is-dragging');
  function move(ev) {
    var p = axis === 'x' ? ev.clientX : ev.clientY;
    set(Math.max(min, Math.min(max, Math.round(start + (p - p0) * (rate || 1)))));
  }
  function up() {
    document.body.style.cursor = prevCursor;
    document.body.classList.remove('is-dragging');
    document.removeEventListener('mousemove', move);
    document.removeEventListener('mouseup', up);
  }
  document.addEventListener('mousemove', move);
  document.addEventListener('mouseup', up);
}

// Numeric % field with a scrub handle (drag left/right), arrow keys (±1, Shift ±10)
// and Enter/blur to commit — the design spec's numField pattern.
function bindNumField(input, scrub, opts) {
  if (!input) return;
  function commit() {
    var v = parseInt(String(input.value).replace(/[^0-9]/g, ''), 10);
    if (!isNaN(v)) opts.set(Math.max(opts.min, Math.min(opts.max, v)));
    input.value = opts.get();
  }
  input.addEventListener('input', function () {
    input.value = String(input.value).replace(/[^0-9]/g, '').slice(0, 3);
  });
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { input.blur(); return; }
    if (e.key === 'Escape') { input.value = opts.get(); input.blur(); return; }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      var step = (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 10 : 1);
      opts.set(Math.max(opts.min, Math.min(opts.max, (+opts.get() || 0) + step)));
      input.value = opts.get();
    }
  });
  if (scrub) scrub.addEventListener('mousedown', function (e) {
    if (e.button !== 0) return;
    drag1D(e, 'x', +opts.get() || 0, opts.min, opts.max, function (v) {
      opts.set(v); input.value = opts.get();
    }, 0.5);
  });
}

// ── Popover menus (toolbar submenus + context menu) ───────────────────────────
// Menus are fixed-position elements outside the toolbar, so the toolbar can
// scroll horizontally in a narrow window without clipping them.

function closeMenus() {
  if (_openMenu) {
    var m = document.getElementById('menu-' + _openMenu);
    if (m) m.classList.remove('open');
    _openMenu = null;
  }
  document.querySelectorAll('.tb-chev.open').forEach(function (c) { c.classList.remove('open'); });
  closeCtxMenu();
}

function _toggleMenu(name, chev) {
  var wasOpen = _openMenu === name;
  closeMenus();
  if (wasOpen) return;
  var menu = document.getElementById('menu-' + name);
  var bar  = document.getElementById('toolbar');
  if (!menu || !bar) return;
  _hideTip();
  _openMenu = name;
  chev.classList.add('open');
  refreshToolbar();
  menu.classList.add('open');
  var group = chev.parentElement.getBoundingClientRect();
  var barR  = bar.getBoundingClientRect();
  menu.style.bottom = Math.round(window.innerHeight - barR.top + 10) + 'px';
  var mw = menu.offsetWidth;
  var left = menu.classList.contains('pop-menu-right') ? group.right - mw : group.left;
  menu.style.left = Math.round(Math.max(8, Math.min(window.innerWidth - mw - 8, left))) + 'px';
}

// items: [{ label, key, run, disabled, danger } | 'sep']
function openCtxMenu(clientX, clientY, items) {
  closeMenus();
  var menu = document.getElementById('ctx-menu');
  if (!menu) return;
  menu.innerHTML = '';
  items.forEach(function (it) {
    if (it === 'sep') {
      var s = document.createElement('div'); s.className = 'pop-sep'; menu.appendChild(s); return;
    }
    var b = document.createElement('button');
    b.className = 'pop-item pop-item-ctx' + (it.danger ? ' danger' : '');
    b.disabled = !!it.disabled;
    var l = document.createElement('span'); l.textContent = it.label;
    var k = document.createElement('span'); k.className = 'pop-key'; k.textContent = it.key || '';
    b.appendChild(l); b.appendChild(k);
    b.addEventListener('click', function () { if (it.disabled) return; closeCtxMenu(); it.run(); });
    menu.appendChild(b);
  });
  menu.classList.add('open');
  var w = menu.offsetWidth, h = menu.offsetHeight;
  menu.style.left = Math.round(Math.max(8, Math.min(window.innerWidth  - w - 8, clientX))) + 'px';
  menu.style.top  = Math.round(Math.max(8, Math.min(window.innerHeight - h - 8, clientY))) + 'px';
  _hideTip();
}

function closeCtxMenu() {
  var menu = document.getElementById('ctx-menu');
  if (menu) menu.classList.remove('open');
}

// ── Tooltips ──────────────────────────────────────────────────────────────────

function _showTip(btn) {
  if (_openMenu) return;
  var tip = document.getElementById('tb-tip');
  if (!tip || !btn.dataset.tip) return;
  tip.querySelector('.tb-tip-label').textContent = btn.dataset.tip;
  tip.querySelector('.tb-tip-key').textContent   = btn.dataset.key || '';
  var r = btn.getBoundingClientRect();
  tip.style.left = Math.round(r.left + r.width / 2) + 'px';
  tip.style.top  = Math.round(r.top - 8) + 'px';
  tip.classList.add('show');
}

function _hideTip() {
  var tip = document.getElementById('tb-tip');
  if (tip) tip.classList.remove('show');
}

// ── Toolbar state ─────────────────────────────────────────────────────────────

// Called by setActiveTool / symmetry changes: syncs active states, group icons,
// submenu check marks, tooltips and the status-bar hint.
function refreshToolbar() {
  var tool = (typeof _activeTool !== 'undefined') ? _activeTool : 'pen';
  if (PAINT_GROUP[tool]) _lastPaint = tool;
  if (SHAPE_GROUP[tool]) _lastShape = tool;

  document.querySelectorAll('.tb-btn[data-tool]').forEach(function (b) {
    b.classList.toggle('active', b.dataset.tool === tool);
  });

  var paint = document.getElementById('grp-paint');
  if (paint) {
    paint.dataset.show = _lastPaint;
    paint.dataset.tip  = TOOL_NAMES[_lastPaint];
    paint.dataset.key  = TOOL_KEYS[_lastPaint];
    paint.classList.toggle('active', !!PAINT_GROUP[tool]);
  }
  var shape = document.getElementById('grp-shape');
  if (shape) {
    shape.dataset.show = _lastShape;
    shape.dataset.tip  = TOOL_NAMES[_lastShape];
    shape.dataset.key  = TOOL_KEYS[_lastShape];
    shape.classList.toggle('active', !!SHAPE_GROUP[tool]);
  }
  var sym = document.getElementById('grp-sym');
  var symMode = (typeof _symMode !== 'undefined') ? _symMode : 'none';
  if (sym) {
    sym.dataset.show = symMode;
    sym.dataset.key  = SYM_LABELS[symMode];
    sym.classList.toggle('on', symMode !== 'none');
    sym.title = '';
  }

  document.querySelectorAll('[data-pick-tool]').forEach(function (b) {
    var t = b.dataset.pickTool;
    b.classList.toggle('checked', PAINT_GROUP[t] ? t === _lastPaint : t === _lastShape);
  });
  document.querySelectorAll('[data-pick-sym]').forEach(function (b) {
    b.classList.toggle('checked', b.dataset.pickSym === symMode);
  });

  var hint = document.getElementById('sb-hint');
  if (hint) hint.textContent = (TOOL_NAMES[tool] || tool) + ' · ' + (TOOL_HINTS[tool] || '');
}

function initToolbar() {
  var bar = document.getElementById('toolbar');
  if (!bar) return;

  bar.querySelectorAll('.tb-btn[data-tool]').forEach(function (b) {
    b.addEventListener('click', function () { setActiveTool(b.dataset.tool); });
  });

  var paint = document.getElementById('grp-paint');
  if (paint) paint.addEventListener('click', function () { setActiveTool(_lastPaint); });
  var shape = document.getElementById('grp-shape');
  if (shape) shape.addEventListener('click', function () { setActiveTool(_lastShape); });
  var sym = document.getElementById('grp-sym');
  if (sym) sym.addEventListener('click', function () {
    var cur = (typeof _symMode !== 'undefined') ? _symMode : 'none';
    _setSymMode(cur === 'none' ? _lastSymMode : 'none');
  });

  bar.querySelectorAll('.tb-chev').forEach(function (c) {
    c.addEventListener('click', function (e) { e.stopPropagation(); _toggleMenu(c.dataset.menuFor, c); });
  });

  document.querySelectorAll('[data-pick-tool]').forEach(function (b) {
    b.addEventListener('click', function () { closeMenus(); setActiveTool(b.dataset.pickTool); });
  });
  document.querySelectorAll('[data-pick-sym]').forEach(function (b) {
    b.addEventListener('click', function () { closeMenus(); _setSymMode(b.dataset.pickSym); });
  });

  // Tooltips (dark bubble: label + shortcut)
  bar.querySelectorAll('[data-tip]').forEach(function (b) {
    b.addEventListener('mouseenter', function () { _showTip(b); });
    b.addEventListener('mouseleave', _hideTip);
    b.addEventListener('mousedown', _hideTip);
  });
  bar.addEventListener('scroll', _hideTip);

  // Outside click closes menus (menus and their chevrons are marked data-menu / data-ctx)
  document.addEventListener('mousedown', function (e) {
    var t = e.target;
    if (_openMenu && !(t.closest && t.closest('[data-menu]'))) closeMenus();
    if (!(t.closest && t.closest('[data-ctx]'))) closeCtxMenu();
  });
  window.addEventListener('resize', function () { closeMenus(); _hideTip(); });
  window.addEventListener('blur', _hideTip);

  refreshToolbar();
}

// Remembers the last non-off symmetry mode so the quick-toggle restores it
function _noteSymMode(mode) {
  if (mode && mode !== 'none') _lastSymMode = mode;
  refreshToolbar();
}

// ── Status bar ────────────────────────────────────────────────────────────────

function onHistoryChanged(canUndo, canRedo) {
  var u = document.getElementById('tool-undo');
  var r = document.getElementById('tool-redo');
  if (u) u.disabled = !canUndo;
  if (r) r.disabled = !canRedo;
}

function onCanvasHover(pos) {
  var el = document.getElementById('sb-coords');
  if (el) el.textContent = pos ? 'X ' + (pos.col + 1) + '  Y ' + (pos.row + 1) : 'X —  Y —';
}

// ── Selection action bar ──────────────────────────────────────────────────────

function onWandSelection(count) {
  var countEl = document.getElementById('sel-count');
  if (countEl) countEl.textContent = count + ' selected';
  document.body.classList.toggle('sel-mode', count > 0);
}

// ── Collapse-panels mode ──────────────────────────────────────────────────────

function togglePanels(force) {
  var hide = typeof force === 'boolean' ? force : !document.body.classList.contains('panels-hidden');
  document.body.classList.toggle('panels-hidden', hide);
  closeMenus();
  _hideTip();
  var t = hide ? 'Show panels (Ctrl+\\)' : 'Hide panels (Ctrl+\\)';
  var hb = document.getElementById('btn-hide-panels');
  if (hb) hb.title = t;
}

function initPanelsToggle() {
  ['btn-hide-panels', 'btn-show-panels', 'float-hex'].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.addEventListener('click', function () { togglePanels(); });
  });
}
