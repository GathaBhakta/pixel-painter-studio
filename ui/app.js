// app.js — UI controller

// ── Shared globals (read by canvas.js) ───────────────────────────────────────
var _activeTool    = 'pen';
var _armedColor    = null;
var _recentColors  = [];
var MAX_RECENT     = 24;
var _cellRadiusPct = 0;

// ── Setup tab state ───────────────────────────────────────────────────────────
var _selectedFrameId      = null;
var _selectedFrameW       = 0;
var _selectedFrameH       = 0;
var _currentCanvasFrameId = null;
var _cellSize             = 16;
var _gap                  = 1;

// ── Quick presets ─────────────────────────────────────────────────────────────
var QUICK_PALETTE = [
  { hex: '#B8607A', name: 'Rose'      }, { hex: '#556B50', name: 'Sage'      },
  { hex: '#A85A3C', name: 'Terra'     }, { hex: '#C8A84B', name: 'Yellow'    },
  { hex: '#9A8AB0', name: 'Lilac'     }, { hex: '#6878A0', name: 'Slate'     },
  { hex: '#6B6830', name: 'Olive'     }, { hex: '#B06828', name: 'Pumpkin'   },
  { hex: '#2C2018', name: 'Ink'       }, { hex: '#8C7260', name: 'Ink Light' },
];

// ── HSB picker state ──────────────────────────────────────────────────────────
var _hue = 200;   // 0–360
var _sat = 60;    // 0–100
var _bri = 80;    // 0–100
var _hsbCanvasEl = null;
var _hueCanvasEl = null;
var _hsbDragging = false;
var _hueDragging = false;
var _pickerUpdating = false;  // prevents armColor ↔ picker infinite loop

// ── Utilities ─────────────────────────────────────────────────────────────────

function postMsg(msg) {
  parent.postMessage({ pluginMessage: msg }, '*');
}

function showToast(msg) {
  var t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(function () { t.classList.remove('show'); }, 2200);
}

// ── Color math ────────────────────────────────────────────────────────────────

function _hsbToRgb(h, s, b) {
  s /= 100; b /= 100;
  if (s === 0) { var v = Math.round(b * 255); return { r: v, g: v, b: v }; }
  var h6 = (h % 360) / 60;
  var i  = Math.floor(h6), f = h6 - i;
  var p  = b * (1 - s), q = b * (1 - f * s), t = b * (1 - (1 - f) * s);
  var r, g, bv;
  switch (i) {
    case 0: r=b; g=t; bv=p; break; case 1: r=q; g=b; bv=p; break;
    case 2: r=p; g=b; bv=t; break; case 3: r=p; g=q; bv=b; break;
    case 4: r=t; g=p; bv=b; break; default: r=b; g=p; bv=q; break;
  }
  return { r: Math.round(r*255), g: Math.round(g*255), b: Math.round(bv*255) };
}

function _rgbToHsb(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  var max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  var h = 0, s = max === 0 ? 0 : d / max, v = max;
  if (d !== 0) {
    if      (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else                h = (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
  }
  return { h: h, s: s * 100, b: v * 100 };
}

function _hsbToHex(h, s, b) {
  var c = _hsbToRgb(h, s, b);
  return '#' + (c.r<16?'0':'') + c.r.toString(16)
             + (c.g<16?'0':'') + c.g.toString(16)
             + (c.b<16?'0':'') + c.b.toString(16);
}

function _hexToRgb(hex) {
  var h = hex.replace('#', '');
  if (h.length !== 6) return null;
  return {
    r: parseInt(h.slice(0,2), 16),
    g: parseInt(h.slice(2,4), 16),
    b: parseInt(h.slice(4,6), 16),
  };
}

// Set HSB from hex string. Returns true on success.
function _setHSBFromHex(hex) {
  var rgb = _hexToRgb(hex);
  if (!rgb) return false;
  var hsb = _rgbToHsb(rgb.r, rgb.g, rgb.b);
  _hue = hsb.h; _sat = hsb.s; _bri = hsb.b;
  return true;
}

// ── Active color ──────────────────────────────────────────────────────────────

function _doArmColor(hex, name) {
  if (!hex || hex === '__ERASE__') return;
  hex = hex.toUpperCase();
  _armedColor = hex;

  // Highlight the matching swatch in every panel
  document.querySelectorAll('.quick-swatch').forEach(function (s) {
    s.classList.toggle('armed', s.dataset.hex === hex);
  });
  document.querySelectorAll('.sw[data-hex]').forEach(function (s) {
    s.classList.toggle('armed-item', s.dataset.hex === hex);
  });

  // Keep picker-preview in sync
  var prev = document.getElementById('picker-preview');
  if (prev) prev.style.background = hex;

  _addToRecent(hex);
}

// Public armColor: also syncs the HSB picker (avoids loop via _pickerUpdating)
function armColor(hex, name) {
  if (!hex || hex === '__ERASE__') return;
  hex = hex.toUpperCase();
  _doArmColor(hex, name);
  // Only auto-switch to pen from eyedropper — all other tools stay sticky
  // so picking a new color while on bucket/rect/oval doesn't kick you back to pen
  if (_activeTool === 'eyedropper') setActiveTool('pen');
  if (!_pickerUpdating) {
    _pickerUpdating = true;
    _setHSBFromHex(hex);
    _syncPickerUI();
    _pickerUpdating = false;
  }
}

// Called by canvas.js eyedropper
function _armColorFromCanvas(hex) {
  armColor(hex, hex);
  showToast('Picked ' + hex);
}

// ── Recent palette ────────────────────────────────────────────────────────────

function _addToRecent(hex) {
  if (!hex) return;
  hex = hex.toUpperCase();
  if (_recentColors.length && _recentColors[0].hex === hex) return;
  _recentColors = _recentColors.filter(function (c) { return c.hex !== hex; });
  _recentColors.unshift({ hex: hex });
  if (_recentColors.length > MAX_RECENT) _recentColors = _recentColors.slice(0, MAX_RECENT);
  renderRecentTray();
  postMsg({ type: 'save-recent-colors', colors: _recentColors });
}

function renderRecentTray() {
  var wrap = document.getElementById('recent-swatches');
  if (!wrap) return;
  wrap.innerHTML = '';
  if (!_recentColors.length) {
    var e = document.createElement('span');
    e.className = 'recent-empty'; e.textContent = 'No colors used yet';
    wrap.appendChild(e); return;
  }
  _recentColors.forEach(function (c) {
    var sw = document.createElement('div');
    sw.className        = 'recent-sw' + (_armedColor === c.hex ? ' armed' : '');
    sw.style.background = c.hex;
    sw.title            = c.hex;
    sw.addEventListener('click', function () { armColor(c.hex, c.hex); });
    wrap.appendChild(sw);
  });
}

// ── Quick presets ─────────────────────────────────────────────────────────────

function buildQuickGrid() {
  var grid = document.getElementById('quick-grid');
  if (!grid) return;
  grid.innerHTML = '';
  QUICK_PALETTE.forEach(function (c) {
    var sw = document.createElement('div');
    sw.className        = 'quick-swatch';
    sw.dataset.hex      = c.hex.toUpperCase();
    sw.style.background = c.hex;
    sw.title            = c.name + ' ' + c.hex;
    sw.addEventListener('click', function () { armColor(c.hex, c.name); });
    grid.appendChild(sw);
  });
}

// ── HSB picker rendering ──────────────────────────────────────────────────────

function _renderHSBGradient() {
  if (!_hsbCanvasEl) return;
  var w = _hsbCanvasEl.width, h = _hsbCanvasEl.height;
  var ctx = _hsbCanvasEl.getContext('2d');
  var rgb = _hsbToRgb(_hue, 100, 100);
  var hueColor = 'rgb(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ')';

  var gH = ctx.createLinearGradient(0, 0, w, 0);
  gH.addColorStop(0, '#ffffff');
  gH.addColorStop(1, hueColor);
  ctx.fillStyle = gH;
  ctx.fillRect(0, 0, w, h);

  var gV = ctx.createLinearGradient(0, 0, 0, h);
  gV.addColorStop(0, 'rgba(0,0,0,0)');
  gV.addColorStop(1, 'rgba(0,0,0,1)');
  ctx.fillStyle = gV;
  ctx.fillRect(0, 0, w, h);
}

function _renderHueStrip() {
  if (!_hueCanvasEl) return;
  var w = _hueCanvasEl.width, h = _hueCanvasEl.height;
  var ctx = _hueCanvasEl.getContext('2d');
  var g = ctx.createLinearGradient(0, 0, w, 0);
  for (var i = 0; i <= 12; i++) {
    var rgb = _hsbToRgb(i * 30, 100, 100);
    g.addColorStop(i / 12, 'rgb(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ')');
  }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

// Sync picker canvas + thumbs + inputs from current _hue/_sat/_bri
function _syncPickerUI() {
  _renderHSBGradient();

  // HSB thumb (% positioning — works even when hidden)
  var hsbThumb = document.getElementById('hsb-thumb');
  if (hsbThumb) {
    hsbThumb.style.left = _sat + '%';
    hsbThumb.style.top  = (100 - _bri) + '%';
  }
  // Hue thumb
  var hueThumb = document.getElementById('hue-thumb');
  if (hueThumb) hueThumb.style.left = (_hue / 360 * 100) + '%';

  // Derived values
  var hex = _hsbToHex(_hue, _sat, _bri).toUpperCase();
  var rgb = _hsbToRgb(_hue, _sat, _bri);

  var pHex = document.getElementById('picker-hex');
  if (pHex) pHex.value = hex;
  var pR = document.getElementById('picker-r');
  var pG = document.getElementById('picker-g');
  var pB = document.getElementById('picker-b');
  if (pR) pR.value = rgb.r;
  if (pG) pG.value = rgb.g;
  if (pB) pB.value = rgb.b;

  var prev = document.getElementById('picker-preview');
  if (prev) prev.style.background = hex;
}

// Called when picker interaction changes color
function _armFromPicker() {
  var hex = _hsbToHex(_hue, _sat, _bri).toUpperCase();
  _pickerUpdating = true;
  _doArmColor(hex, hex);
  setActiveTool('pen');
  _pickerUpdating = false;
  _syncPickerUI();
}

// ── HSB picker drag wiring ────────────────────────────────────────────────────

function initHSBPicker() {
  _hsbCanvasEl = document.getElementById('hsb-canvas');
  _hueCanvasEl = document.getElementById('hue-canvas');
  if (!_hsbCanvasEl || !_hueCanvasEl) return;

  _renderHueStrip();
  _renderHSBGradient();
  _syncPickerUI();

  // 2D gradient drag
  var hsbWrap = document.querySelector('.hsb-canvas-wrap');
  if (hsbWrap) {
    hsbWrap.addEventListener('mousedown', function (e) {
      _hsbDragging = true;
      _pickHSBAt(e, hsbWrap);
      e.preventDefault();
    });
  }

  // Hue strip drag
  var hueWrap = document.querySelector('.hue-wrap');
  if (hueWrap) {
    hueWrap.addEventListener('mousedown', function (e) {
      _hueDragging = true;
      _pickHueAt(e, hueWrap);
      e.preventDefault();
    });
  }

  document.addEventListener('mousemove', function (e) {
    if (_hsbDragging && hsbWrap) _pickHSBAt(e, hsbWrap);
    if (_hueDragging && hueWrap) _pickHueAt(e, hueWrap);
  });
  document.addEventListener('mouseup', function () {
    _hsbDragging = false;
    _hueDragging = false;
  });

  // Hex input
  var hexInp = document.getElementById('picker-hex');
  if (hexInp) {
    hexInp.addEventListener('input', function () {
      var v = hexInp.value.trim();
      if (!/^#/.test(v)) v = '#' + v;
      if (/^#[0-9a-fA-F]{6}$/.test(v) && _setHSBFromHex(v)) {
        _armFromPicker();
      }
    });
    hexInp.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        var v = hexInp.value.trim();
        if (!/^#/.test(v)) v = '#' + v;
        if (/^#[0-9a-fA-F]{6}$/.test(v) && _setHSBFromHex(v)) _armFromPicker();
      }
    });
  }

  // RGB inputs
  ['r', 'g', 'b'].forEach(function (ch) {
    var inp = document.getElementById('picker-' + ch);
    if (!inp) return;
    inp.addEventListener('input', function () {
      var cur = _hsbToRgb(_hue, _sat, _bri);
      cur[ch] = Math.max(0, Math.min(255, parseInt(inp.value) || 0));
      var hsb = _rgbToHsb(cur.r, cur.g, cur.b);
      _hue = hsb.h; _sat = hsb.s; _bri = hsb.b;
      _armFromPicker();
    });
  });
}

function _pickHSBAt(e, wrap) {
  var rect = wrap.getBoundingClientRect();
  _sat = Math.max(0, Math.min(100, (e.clientX - rect.left) / rect.width  * 100));
  _bri = Math.max(0, Math.min(100, (1 - (e.clientY - rect.top) / rect.height) * 100));
  _armFromPicker();
}

function _pickHueAt(e, wrap) {
  var rect = wrap.getBoundingClientRect();
  _hue = Math.max(0, Math.min(359.99, (e.clientX - rect.left) / rect.width * 360));
  _renderHSBGradient();
  var hueThumb = document.getElementById('hue-thumb');
  if (hueThumb) hueThumb.style.left = (_hue / 360 * 100) + '%';
  _armFromPicker();
}

// ── Color sub-tabs ────────────────────────────────────────────────────────────

var _libAutoLoaded = false;

function initColorTabs() {
  document.querySelectorAll('.ctab').forEach(function (t) {
    t.addEventListener('click', function () {
      document.querySelectorAll('.ctab').forEach(function (x) { x.classList.remove('active'); });
      document.querySelectorAll('.ctab-panel').forEach(function (p) { p.classList.remove('active'); });
      t.classList.add('active');
      document.getElementById('cpanel-' + t.dataset.ctab).classList.add('active');

      if (t.dataset.ctab === 'picker') {
        // Re-render in case canvas was resized
        _renderHueStrip();
        _renderHSBGradient();
        _syncPickerUI();
      }

      if (t.dataset.ctab === 'library' && !_libAutoLoaded) {
        _libAutoLoaded = true;
        postMsg({ type: 'get-libraries' });
        postMsg({ type: 'load-lib-colors', key: '__local__' });
      }
    });
  });
}

// ── Library panel ─────────────────────────────────────────────────────────────

var _availableLibs = [];   // imported libraries received from sandbox

function initLibraryPanel() {
  var btn  = document.getElementById('lib-btn');
  var menu = document.getElementById('lib-menu');
  if (!btn || !menu) return;

  btn.addEventListener('click', function (e) {
    e.stopPropagation();
    menu.classList.toggle('open');
    if (!_libAutoLoaded) {
      _libAutoLoaded = true;
      postMsg({ type: 'get-libraries' });
      postMsg({ type: 'load-lib-colors', key: '__local__' });
    }
  });

  document.addEventListener('click', function () { menu.classList.remove('open'); });
}

function handleLibraries(libs) {
  _availableLibs = libs || [];
  var menu = document.getElementById('lib-menu');
  if (!menu) return;
  menu.innerHTML = '';

  function _makeItem(label, key, name) {
    var item = document.createElement('div');
    item.className   = 'lib-menu-item';
    item.textContent = label;
    item.addEventListener('click', function () {
      document.getElementById('lib-name').textContent = label;
      menu.classList.remove('open');
      var empty = document.getElementById('lib-empty');
      var grid  = document.getElementById('lib-swatch-grid');
      if (empty) { empty.style.display = ''; empty.textContent = 'Loading…'; }
      if (grid)  grid.innerHTML = '';
      postMsg({ type: 'load-lib-colors', key: key, name: name });
    });
    menu.appendChild(item);
  }

  _makeItem('Local styles & variables', '__local__', '__local__');
  libs.forEach(function (lib) { _makeItem(lib.name, lib.key, lib.name); });
}

function handleLibColors(colors) {
  var grid  = document.getElementById('lib-swatch-grid');
  var empty = document.getElementById('lib-empty');
  if (!grid) return;
  if (empty) empty.style.display = 'none';
  grid.innerHTML = '';

  // Strip any Erase sentinel that may arrive from older sandbox versions
  colors = colors.filter(function (c) { return c.hex !== '__ERASE__'; });

  if (!colors.length) {
    // Use the #lib-empty div (outside the grid) so layout is a plain flow block,
    // not a grid item that would stretch to fill a column.
    if (empty) {
      empty.innerHTML = '';
      empty.style.display = 'block';
      empty.className = 'lib-empty-state';
      if (_availableLibs.length > 0) {
        var msg1 = document.createElement('p');
        msg1.className = 'hint'; msg1.textContent = 'No local styles available.';
        var msg2 = document.createElement('p');
        msg2.className = 'hint'; msg2.textContent = 'Switch to an imported library:';
        empty.appendChild(msg1); empty.appendChild(msg2);
        _availableLibs.forEach(function (lib) {
          var btn = document.createElement('button');
          btn.className = 'btn-small btn-ghost lib-switch-btn';
          btn.textContent = lib.name;
          btn.addEventListener('click', function () {
            document.getElementById('lib-name').textContent = lib.name;
            postMsg({ type: 'load-lib-colors', key: lib.key, name: lib.name });
          });
          empty.appendChild(btn);
        });
      } else {
        var msg3 = document.createElement('p');
        msg3.className = 'hint'; msg3.textContent = 'No styles have been imported yet.';
        empty.appendChild(msg3);
        var btn2 = document.createElement('button');
        btn2.className = 'btn-small btn-sage lib-switch-btn';
        btn2.textContent = 'Go to Custom Colors';
        btn2.addEventListener('click', function () {
          document.querySelectorAll('.ctab').forEach(function (t) { t.classList.remove('active'); });
          document.querySelectorAll('.ctab-panel').forEach(function (p) { p.classList.remove('active'); });
          var ct = document.querySelector('.ctab[data-ctab="custom"]');
          if (ct) ct.classList.add('active');
          var cp = document.getElementById('cpanel-custom');
          if (cp) cp.classList.add('active');
        });
        empty.appendChild(btn2);
      }
    }
    return;
  }

  var currentGroup = null;
  colors.forEach(function (c) {
    if (c.group !== currentGroup) {
      currentGroup = c.group;
      var lbl = document.createElement('div');
      lbl.className = 'grp-label'; lbl.textContent = c.group;
      grid.appendChild(lbl);
    }
    var sw = document.createElement('div');
    sw.className = 'sw' + (_armedColor === c.hex ? ' armed-item' : '');
    sw.dataset.hex = c.hex.toUpperCase();
    sw.title = c.name + '\n' + c.hex;

    var sq = document.createElement('div');
    sq.className = 'sw-sq'; sq.style.background = c.hex;

    var nm = document.createElement('div');
    nm.className = 'sw-name';
    nm.textContent = c.name.length > 10 ? c.name.slice(0, 10) + '…' : c.name;

    sw.appendChild(sq); sw.appendChild(nm);
    sw.addEventListener('click', function () { armColor(c.hex, c.name); });
    grid.appendChild(sw);
  });
}

// ── Custom palette ────────────────────────────────────────────────────────────

var _customPalette = [];

function renderCustomGrid() {
  var grid = document.getElementById('custom-grid');
  if (!grid) return;
  grid.innerHTML = '';
  if (!_customPalette.length) {
    var empty = document.createElement('span');
    empty.className        = 'recent-empty';
    empty.style.gridColumn = '1 / -1';
    empty.textContent      = 'No custom colors yet';
    grid.appendChild(empty); return;
  }
  _customPalette.forEach(function (c, idx) {
    var sw = document.createElement('div');
    sw.className = 'sw' + (_armedColor === c.hex ? ' armed-item' : '');
    sw.dataset.hex = c.hex.toUpperCase();
    sw.title     = (c.name || c.hex) + '\n' + c.hex + '\nRight-click to remove';

    var sq = document.createElement('div');
    sq.className = 'sw-sq'; sq.style.background = c.hex;

    var nm = document.createElement('div');
    var _cname = c.name || c.hex.slice(1);
    nm.className = 'sw-name';
    nm.textContent = _cname.length > 10 ? _cname.slice(0, 10) + '…' : _cname;

    sw.appendChild(sq); sw.appendChild(nm);
    sw.addEventListener('click', function () { armColor(c.hex, c.name || c.hex); });
    sw.addEventListener('contextmenu', function (e) {
      e.preventDefault();
      _customPalette.splice(idx, 1);
      renderCustomGrid();
      postMsg({ type: 'save-custom-palette', colors: _customPalette });
    });
    grid.appendChild(sw);
  });
}

function initCustomPalette() {
  document.getElementById('btn-add-custom').addEventListener('click', function () {
    if (!_armedColor) { showToast('Pick a color first'); return; }
    if (_customPalette.some(function (c) { return c.hex === _armedColor; })) {
      showToast('Already in palette'); return;
    }
    _customPalette.push({ hex: _armedColor, name: _armedColor });
    renderCustomGrid();
    postMsg({ type: 'save-custom-palette', colors: _customPalette });
    showToast('Added to custom palette');
  });
  document.getElementById('btn-clear-custom').addEventListener('click', function () {
    if (!_customPalette.length) return;
    if (!confirm('Clear custom palette?')) return;
    _customPalette = [];
    renderCustomGrid();
    postMsg({ type: 'save-custom-palette', colors: _customPalette });
  });
}

// ── Tool buttons ──────────────────────────────────────────────────────────────

function setActiveTool(name) {
  var wasEye = _activeTool === 'eyedropper';
  _activeTool = name;

  document.querySelectorAll('.tool-btn[data-tool]').forEach(function (b) {
    b.classList.toggle('active', b.dataset.tool === name);
  });

  var canvasEl = document.getElementById('paint-canvas');
  if (canvasEl) {
    var cursorMap = { eraser: 'cell', eyedropper: 'crosshair', bucket: 'copy',
                      rect: 'crosshair', oval: 'crosshair', wand: 'default' };
    canvasEl.style.cursor = cursorMap[name] || 'crosshair';
  }

  if (name === 'eyedropper') {
    document.body.classList.add('pick-mode');
    postMsg({ type: 'start-figma-pick' });
  } else {
    document.body.classList.remove('pick-mode');
    if (wasEye) postMsg({ type: 'cancel-figma-pick' });
  }

  // Switching tools re-renders canvas so bounding box vs full overlay updates
  if (name !== 'wand' && typeof renderCanvas === 'function') renderCanvas();
}

function _exitPickMode() {
  if (_activeTool === 'eyedropper') setActiveTool('pen');
}

// ── Magic wand selection banner ───────────────────────────────────────────────

function onWandSelection(count) {
  var countEl = document.getElementById('sel-count');
  if (countEl) countEl.textContent = count + (count === 1 ? ' cell selected' : ' cells selected');
  if (count > 0) {
    document.body.classList.add('sel-mode');
  } else {
    document.body.classList.remove('sel-mode');
  }
}

function _exitSelMode() {
  if (typeof clearSelection === 'function') clearSelection();
  document.body.classList.remove('sel-mode');
}

function initSelectionBanner() {
  var fillBtn     = document.getElementById('sel-fill-btn');
  var removeBtn   = document.getElementById('sel-remove-btn');
  var deselectBtn = document.getElementById('sel-deselect-btn');

  if (fillBtn) fillBtn.addEventListener('click', function () {
    var color = (typeof _armedColor !== 'undefined') ? _armedColor : null;
    if (!color) { showToast('Pick a color first'); return; }
    if (typeof fillSelection === 'function') fillSelection(color);
    document.body.classList.remove('sel-mode');
  });

  if (removeBtn) removeBtn.addEventListener('click', function () {
    if (typeof eraseSelection === 'function') eraseSelection();
    document.body.classList.remove('sel-mode');
  });

  if (deselectBtn) deselectBtn.addEventListener('click', _exitSelMode);
}

// ─────────────────────────────────────────────────────────────────────────────

function initToolButtons() {
  document.querySelectorAll('.tool-btn[data-tool]').forEach(function (b) {
    b.addEventListener('click', function () { setActiveTool(b.dataset.tool); });
  });
  var cancelBtn = document.getElementById('pick-cancel');
  if (cancelBtn) cancelBtn.addEventListener('click', _exitPickMode);
  document.getElementById('tool-undo').addEventListener('click', function () { undoCanvas(); });
  document.getElementById('tool-redo').addEventListener('click', function () { redoCanvas(); });
  document.getElementById('tool-clear').addEventListener('click', function () {
    if (!confirm('Clear the entire canvas? This cannot be undone yet.')) return;
    clearCanvas(); showToast('Canvas cleared');
  });
  document.getElementById('btn-back').addEventListener('click', exitPaintMode);
  initSymmetryButton();
}

// ── Symmetry ──────────────────────────────────────────────────────────────────

var _symMode = 'none';

function _setSymMode(mode) {
  _symMode = mode;
  if (typeof setSymmetry === 'function') setSymmetry(mode);
  document.querySelectorAll('[data-mode]').forEach(function (btn) {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });
}

function initSymmetryButton() {
  document.querySelectorAll('[data-mode]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      _setSymMode(_symMode === btn.dataset.mode ? 'none' : btn.dataset.mode);
    });
  });
}

// ── Zoom controls ─────────────────────────────────────────────────────────────

function initZoomControls() {
  function _center() {
    var el = document.getElementById('canvas-scroll');
    if (!el) return { x: 400, y: 300 };
    var r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }
  document.getElementById('zoom-in') .addEventListener('click', function () { var c=_center(); _zoomAt(c.x,c.y,1.5); });
  document.getElementById('zoom-out').addEventListener('click', function () { var c=_center(); _zoomAt(c.x,c.y,1/1.5); });
  document.getElementById('zoom-fit').addEventListener('click', fitToWindow);
}

// ── Thumbnail collapse ────────────────────────────────────────────────────────

function initThumbCollapse() {
  var btn  = document.getElementById('thumb-toggle');
  var body = document.getElementById('thumb-body');
  if (!btn || !body) return;
  btn.addEventListener('click', function () {
    var collapsed = body.classList.toggle('collapsed');
    btn.classList.toggle('collapsed', collapsed);
    btn.title = collapsed ? 'Expand preview' : 'Collapse preview';
  });
}

// ── Mode switching ────────────────────────────────────────────────────────────

function enterPaintMode() {
  document.body.classList.add('mode-paint');
}

function exitPaintMode() {
  document.body.classList.remove('mode-paint');
  postMsg({ type: 'resize-default' });
}

// ── Setup tab ─────────────────────────────────────────────────────────────────

function initSetupTab() {
  document.querySelectorAll('#snap-setup .snap').forEach(function (b) {
    b.addEventListener('click', function () {
      _cellSize = parseInt(b.dataset.s);
      document.querySelectorAll('#snap-setup .snap').forEach(function (x) { x.classList.remove('on'); });
      b.classList.add('on');
      updateGridCalc();
    });
  });

  document.getElementById('sp1').addEventListener('click', function () {
    _gap = 1;
    document.getElementById('sp1').classList.add('on');
    document.getElementById('sp0').classList.remove('on');
    updateGridCalc();
  });
  document.getElementById('sp0').addEventListener('click', function () {
    _gap = 0;
    document.getElementById('sp0').classList.add('on');
    document.getElementById('sp1').classList.remove('on');
    updateGridCalc();
  });

  document.getElementById('btn-fill').addEventListener('click', function () {
    var targetId = _selectedFrameId || _currentCanvasFrameId;
    if (!targetId) return;

    if (!_selectedFrameId && _currentCanvasFrameId) {
      // Re-grid path — check for painted content to preserve
      var state = getCanvasState();
      var hasContent = state && state.cells.some(function (row) {
        return row.some(function (c) { return c !== null; });
      });

      var confirmed = confirm(hasContent
        ? 'Your painting will be saved to a new Figma frame first, then this frame will be re-gridded with the new settings. Continue?'
        : 'Re-gridding will rebuild this frame with the new settings. Continue?');
      if (!confirmed) return;

      if (hasContent) {
        // Apply current art to a new frame before wiping the grid
        postMsg({ type: 'apply-to-figma', cells: state.cells,
          cols: state.cols, rows: state.rows, cellSize: state.cellSize, gap: state.gap,
          cornerRadiusPct: _cellRadiusPct, createNew: true });
        showToast('Saving art then re-gridding…');
      } else {
        showToast('Re-gridding frame…');
      }
    } else {
      showToast('Filling frame…');
    }

    postMsg({ type: 'fill-frame', frameId: targetId, cellSize: _cellSize, gap: _gap });
  });

  document.getElementById('btn-open-canvas').addEventListener('click', function () {
    if (!_currentCanvasFrameId) return;
    showToast('Loading canvas…');
    postMsg({ type: 'open-canvas', frameId: _currentCanvasFrameId });
  });
}

function updateGridCalc() {
  if (!_selectedFrameId && !_currentCanvasFrameId) return;
  if (!_selectedFrameW || !_selectedFrameH) return;
  var stride = _cellSize + _gap;
  var cols   = Math.max(1, Math.floor((_selectedFrameW + _gap) / stride));
  var rows   = Math.max(1, Math.floor((_selectedFrameH + _gap) / stride));
  document.getElementById('gc-cols').textContent  = cols;
  document.getElementById('gc-rows').textContent  = rows;
  document.getElementById('gc-total').textContent = (cols * rows).toLocaleString();
}

// ── Cell shape section ────────────────────────────────────────────────────────

function initShapeSection() {
  var slider  = document.getElementById('cell-radius-slider');
  var valEl   = document.getElementById('shape-val');
  var presets = document.querySelectorAll('.shape-preset');

  function _radiusLabel(pct) {
    if (pct === 0)   return 'Square';
    if (pct === 100) return 'Circle';
    if (pct <= 20)   return 'Slight round';
    if (pct <= 50)   return 'Rounded';
    return 'Pill';
  }

  function _applyRadius(pct) {
    _cellRadiusPct = pct;
    if (slider) slider.value = pct;
    if (valEl)  valEl.textContent = _radiusLabel(pct);
    presets.forEach(function (b) {
      b.classList.toggle('active', +b.dataset.radius === pct);
    });
    if (typeof setCellRadius === 'function') setCellRadius(pct);
  }

  if (slider) {
    slider.addEventListener('input', function () { _applyRadius(+slider.value); });
  }

  presets.forEach(function (b) {
    b.addEventListener('click', function () { _applyRadius(+b.dataset.radius); });
  });

  _applyRadius(0); // default: square
}

// ── Apply buttons ─────────────────────────────────────────────────────────────

function initApplyButtons() {
  document.getElementById('btn-apply-selected').addEventListener('click', function () {
    var state    = getCanvasState();
    var targetId = _currentCanvasFrameId || _selectedFrameId;
    if (!state)    { showToast('Paint something first'); return; }
    if (!targetId) { showToast('Select a pixel canvas in Figma first'); return; }
    postMsg({ type: 'apply-to-figma', frameId: targetId, cells: state.cells,
      cols: state.cols, rows: state.rows, cellSize: state.cellSize, gap: state.gap,
      cornerRadiusPct: _cellRadiusPct, createNew: false });
    showToast('Applying to Figma…');
  });

  document.getElementById('btn-apply-new').addEventListener('click', function () {
    var state = getCanvasState();
    if (!state) { showToast('Paint something first'); return; }
    postMsg({ type: 'apply-to-figma', cells: state.cells,
      cols: state.cols, rows: state.rows, cellSize: state.cellSize, gap: state.gap,
      cornerRadiusPct: _cellRadiusPct, createNew: true });
    showToast('Creating new frame…');
  });
}

// ── Selection bar ─────────────────────────────────────────────────────────────

function handleSelection(m) {
  var bar     = document.getElementById('sel-bar');
  var btnFill = document.getElementById('btn-fill');

  if (m.mode === 'frame') {
    _selectedFrameId = m.frameId;
    _selectedFrameW  = m.width;
    _selectedFrameH  = m.height;
    bar.className    = 'sel-bar has-frame';
    bar.querySelector('.sel-title').textContent = m.name || 'Unnamed frame';
    bar.querySelector('.sel-sub').textContent   = m.width + ' × ' + m.height + 'px — pick a cell size and fill';
    btnFill.textContent = 'Fill Frame & Open Canvas';
    btnFill.disabled = false;
    updateGridCalc();

  } else if (m.mode === 'canvas') {
    _selectedFrameId      = null;
    _currentCanvasFrameId = m.id || null;
    _selectedFrameW       = m.width  || 0;
    _selectedFrameH       = m.height || 0;
    bar.className         = 'sel-bar has-canvas';
    bar.querySelector('.sel-title').textContent = m.name;
    var gapLabel = (m.gap === 0) ? 'no gap' : '1px gap';
    bar.querySelector('.sel-sub').textContent   = m.cols + '×' + m.rows + ' · ' + m.cellSize + 'px · ' + gapLabel;
    btnFill.textContent = 'Re-grid Frame (clears canvas)';
    btnFill.disabled = false;
    // Sync cell size + gap controls to the canvas's current settings
    var cs = m.cellSize || 16;
    _cellSize = cs;
    document.querySelectorAll('#snap-setup .snap').forEach(function (x) {
      x.classList.toggle('on', parseInt(x.dataset.s) === cs);
    });
    var cg = m.gap !== undefined ? m.gap : 1;
    _gap = cg;
    document.getElementById('sp1').classList.toggle('on', cg === 1);
    document.getElementById('sp0').classList.toggle('on', cg === 0);
    updateGridCalc();

  } else {
    _selectedFrameId = null;
    bar.className    = 'sel-bar empty';
    bar.querySelector('.sel-title').textContent = 'No frame selected';
    bar.querySelector('.sel-sub').textContent   = 'Select a plain frame in Figma to fill it with a pixel grid';
    btnFill.textContent = 'Fill Frame & Open Canvas';
    btnFill.disabled = true;
    document.getElementById('gc-cols').textContent  = '—';
    document.getElementById('gc-rows').textContent  = '—';
    document.getElementById('gc-total').textContent = '—';
  }
}

// ── Filled / Reopened → paint mode ───────────────────────────────────────────

function handleFilled(m) {
  showToast('Filled: ' + m.cols + '×' + m.rows + ' (' + m.cellSize + 'px)');
  _gap = m.gap !== undefined ? m.gap : _gap;
  enterPaintMode();
  setTimeout(function () {
    initCanvas(m.cols, m.rows, m.canvasW, m.canvasH, m.gap !== undefined ? m.gap : _gap, m.cellSize);
    initHSBPicker();
    _applyRefToCanvas();
  }, 0);
}

function handleReopened(m) {
  showToast('Loaded ' + m.cols + '×' + m.rows + ' canvas');
  _gap = m.gap !== undefined ? m.gap : 1;
  enterPaintMode();
  setTimeout(function () {
    initCanvas(m.cols, m.rows, m.canvasW, m.canvasH, m.gap, m.cellSize);
    if (m.cells) loadCells(m.cells);
    initHSBPicker();
    _applyRefToCanvas();
  }, 0);
}

// ── Trace / Reference panel ───────────────────────────────────────────────────

var _refSrc        = null;   // object URL of loaded reference image
var _refOpacityPct = 40;     // 10–80
var _refOn         = true;   // visibility toggle

function _applyRefToCanvas() {
  if (!_refSrc) return;
  if (typeof setRefImage  === 'function') setRefImage(_refSrc, _refOpacityPct / 100);
  if (typeof setRefVisible === 'function') setRefVisible(_refOn);
}

function initRefPanel() {
  var dropEl      = document.getElementById('ref-drop-mini');
  var fileInput   = document.getElementById('ref-file-input');
  var loadedEl    = document.getElementById('ref-loaded');
  var thumbEl     = document.getElementById('ref-thumb');
  var removeBtn   = document.getElementById('ref-remove-btn');
  var opSlider    = document.getElementById('ref-opacity');
  var opVal       = document.getElementById('ref-opacity-val');
  var toggle      = document.getElementById('ref-vis-toggle');
  var collapseBtn = document.getElementById('ref-collapse-btn');
  var bodyEl      = document.getElementById('ref-body');

  function _showLoaded(show) {
    dropEl.style.display   = show ? 'none' : 'flex';
    loadedEl.style.display = show ? 'flex' : 'none';
    if (show) { loadedEl.style.flexDirection = 'column'; loadedEl.style.gap = '6px'; }
  }

  // Collapse toggle
  collapseBtn.addEventListener('click', function () {
    var collapsed = bodyEl.classList.toggle('collapsed');
    collapseBtn.classList.toggle('collapsed', collapsed);
  });

  // Click-to-browse
  dropEl.addEventListener('click', function () { fileInput.click(); });
  fileInput.addEventListener('change', function () {
    if (fileInput.files[0]) _loadRefFile(fileInput.files[0]);
  });

  // Drag-and-drop
  dropEl.addEventListener('dragover',  function (e) { e.preventDefault(); dropEl.classList.add('drag-over'); });
  dropEl.addEventListener('dragleave', function ()  { dropEl.classList.remove('drag-over'); });
  dropEl.addEventListener('drop', function (e) {
    e.preventDefault(); dropEl.classList.remove('drag-over');
    var f = e.dataTransfer.files[0];
    if (f && f.type.startsWith('image/')) _loadRefFile(f);
  });

  function _loadRefFile(file) {
    var url = URL.createObjectURL(file);
    _refSrc = url;
    thumbEl.src = url;
    _showLoaded(true);
    _applyRefToCanvas();
  }

  // Remove
  removeBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    _refSrc = null;
    thumbEl.src = '';
    _showLoaded(false);
    if (typeof clearRef === 'function') clearRef();
  });

  // Opacity
  opSlider.addEventListener('input', function () {
    _refOpacityPct = parseInt(opSlider.value);
    opVal.textContent = _refOpacityPct + '%';
    if (typeof setRefOpacity === 'function') setRefOpacity(_refOpacityPct / 100);
  });

  // Show/hide toggle
  toggle.addEventListener('change', function () {
    _refOn = toggle.checked;
    if (typeof setRefVisible === 'function') setRefVisible(_refOn);
  });
}

// ── Keyboard shortcuts ────────────────────────────────────────────────────────

function initKeyboard() {
  document.addEventListener('keydown', function (e) {
    if (!document.body.classList.contains('mode-paint')) return;
    if (e.target.tagName === 'INPUT') return;

    if (e.code === 'Space') { e.preventDefault(); setSpaceHeld(true); return; }

    if (e.key === 'p' || e.key === 'P') setActiveTool('pen');
    if (e.key === 'e' || e.key === 'E') setActiveTool('eraser');
    if (e.key === 'i' || e.key === 'I') setActiveTool('eyedropper');
    if (e.key === 'b' || e.key === 'B') setActiveTool('bucket');
    if (e.key === 'r' || e.key === 'R') setActiveTool('rect');
    if (e.key === 'o' || e.key === 'O') setActiveTool('oval');
    if (e.key === 'w' || e.key === 'W') setActiveTool('wand');
    if (e.key === 'Escape') { _exitSelMode(); }

    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (typeof getSelectionCount === 'function' && getSelectionCount() > 0) {
        e.preventDefault();
        if (typeof eraseSelection === 'function') eraseSelection();
        document.body.classList.remove('sel-mode');
      }
    }

    if ((e.ctrlKey || e.metaKey) && (e.key === 'd' || e.key === 'D')) {
      e.preventDefault();
      _exitSelMode();
    }

    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'z') {
      e.preventDefault(); undoCanvas();
    }
    if ((e.ctrlKey || e.metaKey) && (e.shiftKey && e.key === 'Z' || e.key === 'y')) {
      e.preventDefault(); redoCanvas();
    }

    // Zoom
    if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+')) {
      e.preventDefault();
      var el = document.getElementById('canvas-scroll');
      if (el) { var r=el.getBoundingClientRect(); _zoomAt(r.left+r.width/2, r.top+r.height/2, 1.5); }
    }
    if ((e.ctrlKey || e.metaKey) && e.key === '-') {
      e.preventDefault();
      var el2 = document.getElementById('canvas-scroll');
      if (el2) { var r2=el2.getBoundingClientRect(); _zoomAt(r2.left+r2.width/2, r2.top+r2.height/2, 1/1.5); }
    }
    if ((e.ctrlKey || e.metaKey) && e.key === '0') { e.preventDefault(); fitToWindow(); }
  });

  document.addEventListener('keyup', function (e) {
    if (e.code === 'Space') setSpaceHeld(false);
  });
}

// ── Message router ────────────────────────────────────────────────────────────

window.onmessage = function (ev) {
  var m = ev.data.pluginMessage;
  if (!m) return;

  switch (m.type) {
    case 'selection':  handleSelection(m); break;
    case 'filled':     handleFilled(m);    break;
    case 'reopened':   handleReopened(m);  break;
    case 'done':       showToast(m.text || 'Done!'); break;
    case 'error':      showToast('⚠ ' + m.message); break;

    case 'figma-color-picked':
      _exitPickMode();
      if (m.hex) {
        armColor(m.hex, m.hex);
        showToast('Picked ' + m.hex);
      } else {
        showToast('No solid fill on that element');
      }
      break;

    case 'recent-colors':
      _recentColors = (m.colors || []).map(function (c) {
        return typeof c === 'string' ? { hex: c } : c;
      });
      renderRecentTray();
      break;

    case 'libraries':
      handleLibraries(m.libs || []);
      break;

    case 'lib-colors':
      handleLibColors(m.colors || []);
      break;

    case 'custom-palette':
      _customPalette = (m.colors || []).map(function (c) {
        return typeof c === 'string' ? { hex: c, name: c } : c;
      });
      renderCustomGrid();
      break;

  }
};

// ── Window resize handle ──────────────────────────────────────────────────────

function initResizeHandle() {
  var handle = document.getElementById('win-resize-handle');
  if (!handle) return;
  handle.addEventListener('mousedown', function (e) {
    if (e.button !== 0) return;
    var startX = e.clientX, startY = e.clientY;
    var startW = window.innerWidth, startH = window.innerHeight;
    e.preventDefault();

    function onMove(e) {
      var newW = Math.max(500, startW + (e.clientX - startX));
      var newH = Math.max(400, startH + (e.clientY - startY));
      postMsg({ type: 'resize-window', w: Math.round(newW), h: Math.round(newH) });
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

// ── Boot ──────────────────────────────────────────────────────────────────────

initSetupTab();
initToolButtons();
initSelectionBanner();
initShapeSection();
initApplyButtons();
initThumbCollapse();
buildQuickGrid();
// Pre-arm the first preset color so the pen works immediately without having to pick a color first
_armedColor = QUICK_PALETTE[0].hex.toUpperCase();
_setHSBFromHex(_armedColor);
document.querySelectorAll('.quick-swatch').forEach(function (s) {
  s.classList.toggle('armed', s.dataset.hex === _armedColor);
});
initColorTabs();
initLibraryPanel();
initCustomPalette();
initZoomControls();
initRefPanel();
initKeyboard();
initResizeHandle();

postMsg({ type: 'init', screenW: screen.width, screenH: screen.height });
