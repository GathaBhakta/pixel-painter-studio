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

// Brief dark pill, top-center of the canvas in paint mode (top of the window
// in setup mode). kind: 'ok' (default, check) · 'warn' · 'lock'. Messages that
// start with ⚠ (sandbox errors) are shown as 'warn'.
function showToast(msg, kind) {
  var t = document.getElementById('toast');
  if (!t) return;
  msg = String(msg);
  if (/^⚠/.test(msg)) { kind = 'warn'; msg = msg.replace(/^⚠\s*/, ''); }
  var stage = document.getElementById('canvas-stage');
  var host  = document.body.classList.contains('mode-paint') && stage ? stage : document.body;
  if (t.parentNode !== host) host.appendChild(t);
  t.classList.toggle('in-stage', host === stage);
  t.dataset.kind = kind || 'ok';
  t.querySelector('.toast-msg').textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(function () { t.classList.remove('show'); }, kind === 'warn' ? 2600 : 1800);
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

  // Floating hex pill (collapse-panels mode) + selection-bar Fill chip
  document.documentElement.style.setProperty('--armed', hex);
  var fh = document.getElementById('float-hex-val');
  if (fh) fh.textContent = hex;

  // Note: recent colors are added when a color is actually painted to the
  // canvas (see canvas.js _onCellPainted / _floodFill / _commitShape), not
  // when it is merely armed — arming fires on every HSB-picker drag step.
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

// Cache of the most recent lib-colors response, so the empty-state message
// can be corrected once `libraries` arrives (it's a separate, slower async
// round-trip than the local-color read, so it often lands second).
var _lastLibColors = null;
var _lastLibKey     = '__local__';
var _lastLibName    = '__local__';

// Marks the given key's row as the checked one in the library dropdown —
// called whenever the active library changes, whether from the dropdown
// itself or one of the "select a library" empty-state buttons.
function _setLibMenuChecked(key) {
  var menu = document.getElementById('lib-menu');
  if (!menu) return;
  menu.querySelectorAll('.lib-menu-item').forEach(function (x) {
    x.classList.toggle('checked', x.dataset.libKey === key);
  });
}

function handleLibraries(libs) {
  _availableLibs = libs || [];
  var menu = document.getElementById('lib-menu');
  if (menu) {
    menu.innerHTML = '';

    function _makeItem(label, key, name, collectionKeys) {
      var item = document.createElement('div');
      item.className = 'lib-menu-item pop-item pop-item-plain' +
        (key === _lastLibKey ? ' checked' : '');
      item.dataset.libKey = key;
      item.innerHTML = '<svg class="pop-check" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg><span>' +
        label.replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</span>';
      item.addEventListener('click', function () {
        document.getElementById('lib-name').textContent = label;
        _setLibMenuChecked(key);
        menu.classList.remove('open');
        var empty = document.getElementById('lib-empty');
        var grid  = document.getElementById('lib-swatch-grid');
        if (empty) { empty.style.display = ''; empty.textContent = 'Loading…'; }
        if (grid)  grid.innerHTML = '';
        postMsg({ type: 'load-lib-colors', key: key, name: name, collectionKeys: collectionKeys });
      });
      menu.appendChild(item);
    }

    _makeItem('Local styles & variables', '__local__', '__local__');
    libs.forEach(function (lib) { _makeItem(lib.name, lib.key, lib.name, lib.collections); });
  }

  // If we already rendered an empty state for local colors before this
  // library list arrived, re-render now that we know whether libraries exist.
  if (_lastLibKey === '__local__' && _lastLibColors && !_lastLibColors.length) {
    handleLibColors(_lastLibColors, _lastLibKey, _lastLibName);
  }
}

function handleLibColors(colors, key, name) {
  var grid  = document.getElementById('lib-swatch-grid');
  var empty = document.getElementById('lib-empty');
  if (!grid) return;

  key = key || '__local__';
  _lastLibColors = colors || [];
  _lastLibKey    = key;
  _lastLibName   = name || key;

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

      if (key !== '__local__') {
        // Figma's plugin API can only enumerate Variables from a library,
        // not classic Color Styles — this is a platform limitation, not a bug.
        var lmsg1 = document.createElement('p');
        lmsg1.className = 'hint'; lmsg1.textContent = 'No color variables found in "' + name + '".';
        var lmsg2 = document.createElement('p');
        lmsg2.className = 'hint';
        lmsg2.textContent = 'If this library publishes classic Color Styles instead of Variables, plugins can’t read them — that’s a Figma API limitation.';
        empty.appendChild(lmsg1); empty.appendChild(lmsg2);
        var backBtn = document.createElement('button');
        backBtn.className = 'btn-small btn-ghost lib-switch-btn';
        backBtn.textContent = 'Back to Local styles & variables';
        backBtn.addEventListener('click', function () {
          document.getElementById('lib-name').textContent = 'Local styles & variables';
          _setLibMenuChecked('__local__');
          if (empty) { empty.style.display = ''; empty.textContent = 'Loading…'; }
          grid.innerHTML = '';
          postMsg({ type: 'load-lib-colors', key: '__local__', name: '__local__' });
        });
        empty.appendChild(backBtn);
      } else if (_availableLibs.length > 0) {
        var msg1 = document.createElement('p');
        msg1.className = 'hint'; msg1.textContent = 'No local variables in this file.';
        var msg2 = document.createElement('p');
        msg2.className = 'hint'; msg2.textContent = 'Select from available libraries:';
        empty.appendChild(msg1); empty.appendChild(msg2);
        _availableLibs.forEach(function (lib) {
          var btn = document.createElement('button');
          btn.className = 'btn-small btn-ghost lib-switch-btn';
          btn.textContent = lib.name;
          btn.addEventListener('click', function () {
            document.getElementById('lib-name').textContent = lib.name;
            _setLibMenuChecked(lib.key);
            if (empty) { empty.style.display = ''; empty.textContent = 'Loading…'; }
            grid.innerHTML = '';
            postMsg({ type: 'load-lib-colors', key: lib.key, name: lib.name, collectionKeys: lib.collections });
          });
          empty.appendChild(btn);
        });
      } else {
        var msg3 = document.createElement('p');
        msg3.className = 'hint';
        msg3.textContent = 'No local variables exist. Import a library in your file to work from preset colors.';
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
// Interaction mimics the Claude Design mockup: swatches pick on click and open
// a context menu on right-click ("Use color" / "Remove swatch"); removing (a
// single swatch, or Clear) is a plain array edit backed by one slot of
// dedicated undo — Ctrl/Cmd+Z immediately after restores it, checked ahead of
// the normal canvas undo stack in initKeyboard(). No native confirm()/alert()
// — those don't reliably work inside Figma's plugin iframe.

var _customPalette     = [];
var _customPaletteUndo = null; // previous _customPalette array, or null

function saveCustomPalette() {
  postMsg({ type: 'save-custom-palette', colors: _customPalette });
}

function undoCustomPalette() {
  if (!_customPaletteUndo) return false;
  _customPalette = _customPaletteUndo;
  _customPaletteUndo = null;
  renderCustomGrid();
  saveCustomPalette();
  showToast('Restored');
  return true;
}

function removeCustomSwatch(hex) {
  var prev = _customPalette;
  _customPalette = prev.filter(function (c) { return c.hex !== hex; });
  _customPaletteUndo = prev;
  renderCustomGrid();
  saveCustomPalette();
  showToast('Removed ' + hex + ' · ' + (navigator.platform.indexOf('Mac') === 0 ? '⌘Z' : 'Ctrl+Z') + ' to undo');
}

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
  _customPalette.forEach(function (c) {
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
      openCtxMenu(e.clientX, e.clientY, [
        { label: 'Use color', run: function () { armColor(c.hex, c.name || c.hex); } },
        'sep',
        { label: 'Remove swatch', danger: true, key: 'Del', run: function () { removeCustomSwatch(c.hex); } },
      ]);
    });
    grid.appendChild(sw);
  });
}

// ── Add-swatch popover ───────────────────────────────────────────────────────
// A small HSB pad + hue strip + hex field, pre-seeded from the currently
// armed color, so you can nudge it before committing — rather than the old
// button that added whatever was armed with no chance to adjust it first.

var _swAdd = null; // null = closed, else { h, s, v }
var _swAddSvEl = null, _swAddHueEl = null;

function _swAddHex() { return _hsbToHex(_swAdd.h, _swAdd.s, _swAdd.v).toUpperCase(); }

function _renderSwAddSv() {
  if (!_swAddSvEl) return;
  var w = _swAddSvEl.width, h = _swAddSvEl.height;
  var ctx = _swAddSvEl.getContext('2d');
  var rgb = _hsbToRgb(_swAdd.h, 100, 100);
  var hueColor = 'rgb(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ')';
  var gH = ctx.createLinearGradient(0, 0, w, 0);
  gH.addColorStop(0, '#ffffff'); gH.addColorStop(1, hueColor);
  ctx.fillStyle = gH; ctx.fillRect(0, 0, w, h);
  var gV = ctx.createLinearGradient(0, 0, 0, h);
  gV.addColorStop(0, 'rgba(0,0,0,0)'); gV.addColorStop(1, 'rgba(0,0,0,1)');
  ctx.fillStyle = gV; ctx.fillRect(0, 0, w, h);
}
function _renderSwAddHue() {
  if (!_swAddHueEl) return;
  var w = _swAddHueEl.width, h = _swAddHueEl.height;
  var ctx = _swAddHueEl.getContext('2d');
  var g = ctx.createLinearGradient(0, 0, w, 0);
  for (var i = 0; i <= 12; i++) {
    var rgb = _hsbToRgb(i * 30, 100, 100);
    g.addColorStop(i / 12, 'rgb(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ')');
  }
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
}
function _syncSwAddUI() {
  if (!_swAdd) return;
  _renderSwAddSv();
  var svThumb = document.getElementById('sw-add-sv-thumb');
  if (svThumb) { svThumb.style.left = _swAdd.s + '%'; svThumb.style.top = (100 - _swAdd.v) + '%'; }
  var hueThumb = document.getElementById('sw-add-hue-thumb');
  if (hueThumb) hueThumb.style.left = (_swAdd.h / 360 * 100) + '%';
  var hex = _swAddHex();
  var hexInp = document.getElementById('sw-add-hex');
  if (hexInp && document.activeElement !== hexInp) hexInp.value = hex.slice(1);
  var prev = document.getElementById('sw-add-preview');
  if (prev) prev.style.background = hex;
  var dupe = _customPalette.some(function (c) { return c.hex === hex; });
  var confirmBtn = document.getElementById('sw-add-confirm');
  if (confirmBtn) { confirmBtn.disabled = dupe; confirmBtn.textContent = dupe ? 'Already added' : 'Add'; }
}

function openSwAddPopover() {
  var seed = _armedColor ? _hexToRgb(_armedColor) : null;
  var hsb  = seed ? _rgbToHsb(seed.r, seed.g, seed.b) : { h: _hue, s: _sat, b: _bri };
  _swAdd = { h: hsb.h, s: hsb.s, v: hsb.b };
  _swAddSvEl  = document.getElementById('sw-add-sv-canvas');
  _swAddHueEl = document.getElementById('sw-add-hue-canvas');
  _renderSwAddHue();
  _syncSwAddUI();
  // Fixed-position + computed viewport coordinates, same pattern as the
  // toolbar's submenus (_toggleMenu) — the trigger button sits inside a
  // scrollable panel that can put it anywhere, so an absolutely-positioned
  // popover nested inside that panel would get clipped by its overflow.
  var pop = document.getElementById('sw-add-pop');
  var row = document.getElementById('btn-add-custom');
  pop.classList.add('open');
  var rowRect = row.getBoundingClientRect(), popH = pop.offsetHeight, popW = pop.offsetWidth;
  pop.style.top = pop.style.bottom = '';
  if (rowRect.top >= popH + 6) {
    pop.style.bottom = Math.round(window.innerHeight - rowRect.top + 6) + 'px';
  } else {
    pop.style.top = Math.round(rowRect.bottom + 6) + 'px';
  }
  pop.style.left = Math.round(Math.max(8, Math.min(window.innerWidth - popW - 8, rowRect.left))) + 'px';
}
function closeSwAddPopover() {
  _swAdd = null;
  var pop = document.getElementById('sw-add-pop');
  if (pop) pop.classList.remove('open');
}

function _pickSwAddSvAt(e, wrap) {
  var rect = wrap.getBoundingClientRect();
  _swAdd.s = Math.max(0, Math.min(100, (e.clientX - rect.left) / rect.width * 100));
  _swAdd.v = Math.max(0, Math.min(100, (1 - (e.clientY - rect.top) / rect.height) * 100));
  _syncSwAddUI();
}
function _pickSwAddHueAt(e, wrap) {
  var rect = wrap.getBoundingClientRect();
  _swAdd.h = Math.max(0, Math.min(359.99, (e.clientX - rect.left) / rect.width * 360));
  _renderSwAddSv();
  _syncSwAddUI();
}

function initCustomPalette() {
  document.getElementById('btn-add-custom').addEventListener('click', function (e) {
    e.stopPropagation();
    if (_swAdd) { closeSwAddPopover(); return; }
    openSwAddPopover();
  });
  document.getElementById('btn-clear-custom').addEventListener('click', function () {
    if (!_customPalette.length) return;
    var n = _customPalette.length;
    _customPaletteUndo = _customPalette;
    _customPalette = [];
    renderCustomGrid();
    saveCustomPalette();
    showToast('Cleared ' + n + (n === 1 ? ' color' : ' colors') + ' · ' +
      (navigator.platform.indexOf('Mac') === 0 ? '⌘Z' : 'Ctrl+Z') + ' to undo');
  });

  var svWrap = document.querySelector('.sw-add-sv-wrap');
  if (svWrap) svWrap.addEventListener('mousedown', function (e) {
    e.stopPropagation(); _swAddSvDragging = true; _pickSwAddSvAt(e, svWrap); e.preventDefault();
  });
  var hueWrap = document.querySelector('.sw-add-hue-wrap');
  if (hueWrap) hueWrap.addEventListener('mousedown', function (e) {
    e.stopPropagation(); _swAddHueDragging = true; _pickSwAddHueAt(e, hueWrap); e.preventDefault();
  });
  document.addEventListener('mousemove', function (e) {
    if (_swAddSvDragging && svWrap) _pickSwAddSvAt(e, svWrap);
    if (_swAddHueDragging && hueWrap) _pickSwAddHueAt(e, hueWrap);
  });
  document.addEventListener('mouseup', function () {
    _swAddSvDragging = false; _swAddHueDragging = false;
  });

  var hexInp = document.getElementById('sw-add-hex');
  if (hexInp) {
    hexInp.addEventListener('click', function (e) { e.stopPropagation(); });
    hexInp.addEventListener('input', function () {
      var v = hexInp.value.trim().replace(/^#/, '');
      if (/^[0-9a-fA-F]{6}$/.test(v)) {
        var rgb = _hexToRgb('#' + v), hsb = _rgbToHsb(rgb.r, rgb.g, rgb.b);
        _swAdd.h = hsb.h; _swAdd.s = hsb.s; _swAdd.v = hsb.b;
        _renderSwAddSv(); _syncSwAddUI();
      }
    });
  }

  var pop = document.getElementById('sw-add-pop');
  if (pop) pop.addEventListener('mousedown', function (e) { e.stopPropagation(); });
  document.getElementById('sw-add-cancel').addEventListener('click', closeSwAddPopover);
  document.getElementById('sw-add-confirm').addEventListener('click', function () {
    if (!_swAdd) return;
    var hex = _swAddHex();
    if (_customPalette.some(function (c) { return c.hex === hex; })) return;
    _customPalette.push({ hex: hex, name: hex });
    renderCustomGrid();
    saveCustomPalette();
    armColor(hex, hex);
    closeSwAddPopover();
    showToast('Added to custom palette');
  });
  // Click anywhere else closes the popover, same as the toolbar/library menus.
  document.addEventListener('mousedown', function () { if (_swAdd) closeSwAddPopover(); });
}

var _swAddSvDragging = false, _swAddHueDragging = false;

// ── Tool buttons ──────────────────────────────────────────────────────────────

function setActiveTool(name) {
  var wasEye = _activeTool === 'eyedropper';
  _activeTool = name;

  if (typeof refreshToolbar === 'function') refreshToolbar();
  refreshCanvasCursor();

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

var _TOOL_CURSORS  = { eraser: 'cell', eyedropper: 'crosshair', bucket: 'copy', rect: 'crosshair',
                       oval: 'crosshair', line: 'crosshair', wand: 'default', move: 'move' };
var _EDITING_TOOLS = { pen: 1, eraser: 1, bucket: 1, rect: 1, oval: 1, line: 1, move: 1 };

// Per-tool canvas cursor — or not-allowed when the active layer is locked/hidden
function refreshCanvasCursor() {
  var canvasEl = document.getElementById('paint-canvas');
  if (!canvasEl) return;
  var blocked = _EDITING_TOOLS[_activeTool] && typeof isActiveLayerEditable === 'function' &&
                typeof _layers !== 'undefined' && _layers.length > 0 && !isActiveLayerEditable();
  canvasEl.style.cursor = blocked ? 'not-allowed' : (_TOOL_CURSORS[_activeTool] || 'crosshair');
}

function _exitPickMode() {
  if (_activeTool === 'eyedropper') setActiveTool('pen');
}

// ── Selection action bar (count/visibility: onWandSelection in tools.js) ──────

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
    if (typeof fillSelection === 'function' && fillSelection(color)) document.body.classList.remove('sel-mode');
  });

  if (removeBtn) removeBtn.addEventListener('click', function () {
    if (typeof eraseSelection === 'function' && eraseSelection()) document.body.classList.remove('sel-mode');
  });

  if (deselectBtn) deselectBtn.addEventListener('click', _exitSelMode);
}

// ─────────────────────────────────────────────────────────────────────────────

function initToolButtons() {
  if (typeof initToolbar === 'function') initToolbar();
  if (typeof initPanelsToggle === 'function') initPanelsToggle();
  var cancelBtn = document.getElementById('pick-cancel');
  if (cancelBtn) cancelBtn.addEventListener('click', _exitPickMode);
  document.getElementById('tool-undo').addEventListener('click', function () { undoCanvas(); });
  document.getElementById('tool-redo').addEventListener('click', function () { redoCanvas(); });
  document.getElementById('tool-clear').addEventListener('click', function () {
    var L = (typeof getActiveLayer === 'function') ? getActiveLayer() : null;
    if (clearCanvas()) showToast('Cleared ' + (L ? L.name : 'layer') + ' · Ctrl+Z to undo');
  });
  document.getElementById('btn-back').addEventListener('click', exitPaintMode);
  var backFloat = document.getElementById('btn-back-float');
  if (backFloat) backFloat.addEventListener('click', exitPaintMode);
}

// ── Symmetry ──────────────────────────────────────────────────────────────────

var _symMode = 'none';

function _setSymMode(mode) {
  _symMode = mode;
  if (typeof setSymmetry === 'function') setSymmetry(mode);
  if (typeof _noteSymMode === 'function') _noteSymMode(mode);
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

  document.getElementById('rotate-ccw')  .addEventListener('click', function () { rotateView(-15); });
  document.getElementById('rotate-cw')   .addEventListener('click', function () { rotateView(15); });
  document.getElementById('rotate-reset').addEventListener('click', resetViewRotation);
}

// ── Left panel: collapsible, drag-to-reorder sections ─────────────────────────

var SEC_DEFAULT_ORDER = ['layers', 'preview', 'ref'];
var _secOrder = SEC_DEFAULT_ORDER.slice();
var _secDrag  = null;
var _previewH = 96;

function _secEl(id) { return document.getElementById('sec-' + id); }

function _applySecOrder() {
  _secOrder.forEach(function (id, i) {
    var el = _secEl(id);
    if (el) el.style.order = i;
  });
}

function isSecOpen(id) {
  var el = _secEl(id);
  return !!el && !el.classList.contains('closed');
}

function toggleSection(id, open) {
  var el = _secEl(id);
  if (!el) return;
  var willOpen = typeof open === 'boolean' ? open : el.classList.contains('closed');
  el.classList.toggle('closed', !willOpen);
  if (willOpen && id === 'preview' && typeof updateThumbnail === 'function') updateThumbnail();
}

function moveSection(id, dir) {
  var i = _secOrder.indexOf(id), j = i + dir;
  if (i < 0 || j < 0 || j >= _secOrder.length) return;
  var t = _secOrder[i]; _secOrder[i] = _secOrder[j]; _secOrder[j] = t;
  _applySecOrder();
}

function _dtHasFiles(e) {
  var types = e.dataTransfer && e.dataTransfer.types;
  if (!types) return false;
  for (var i = 0; i < types.length; i++) if (types[i] === 'Files') return true;
  return false;
}

function initLeftSections() {
  _applySecOrder();

  document.querySelectorAll('[data-sec-toggle]').forEach(function (btn) {
    btn.addEventListener('click', function () { toggleSection(btn.dataset.secToggle); });
  });

  document.querySelectorAll('.lp-sec').forEach(function (sec) {
    var id = sec.dataset.sec;
    var hd = sec.querySelector('.lp-sec-hd');

    hd.addEventListener('dragstart', function (e) {
      _secDrag = id;
      e.dataTransfer.setData('text/x-section', id);
      e.dataTransfer.effectAllowed = 'move';
      sec.classList.add('dragging');
    });
    hd.addEventListener('dragend', function () {
      _secDrag = null;
      document.querySelectorAll('.lp-sec').forEach(function (s) {
        s.classList.remove('dragging', 'drop-before', 'drop-after', 'file-over');
      });
    });

    sec.addEventListener('dragover', function (e) {
      if (_secDrag) {
        e.preventDefault();
        if (_secDrag === id) return;
        var before = _secOrder.indexOf(_secDrag) > _secOrder.indexOf(id);
        sec.classList.toggle('drop-before', before);
        sec.classList.toggle('drop-after', !before);
        return;
      }
      if (id === 'ref' && _dtHasFiles(e)) { e.preventDefault(); sec.classList.add('file-over'); }
    });
    sec.addEventListener('dragleave', function (e) {
      if (sec.contains(e.relatedTarget)) return;
      sec.classList.remove('drop-before', 'drop-after', 'file-over');
    });
    sec.addEventListener('drop', function (e) {
      sec.classList.remove('drop-before', 'drop-after', 'file-over');
      if (_secDrag) {
        e.preventDefault();
        var from = _secDrag;
        _secDrag = null;
        if (from === id) return;
        var fi = _secOrder.indexOf(from), to = _secOrder.indexOf(id);
        var o = _secOrder.filter(function (x) { return x !== from; });
        o.splice(o.indexOf(id) + (fi < to ? 1 : 0), 0, from);
        _secOrder = o;
        _applySecOrder();
        return;
      }
      if (id === 'ref') {
        var f = e.dataTransfer.files && e.dataTransfer.files[0];
        if (f && f.type.indexOf('image/') === 0) { e.preventDefault(); _loadRefFile(f); }
      }
    });

    hd.addEventListener('contextmenu', function (e) {
      e.preventDefault();
      var i = _secOrder.indexOf(id), open = isSecOpen(id);
      openCtxMenu(e.clientX, e.clientY, [
        { label: open ? 'Collapse' : 'Expand', run: function () { toggleSection(id); } },
        'sep',
        { label: 'Move up',     disabled: i === 0,                    run: function () { moveSection(id, -1); } },
        { label: 'Move down',   disabled: i === _secOrder.length - 1, run: function () { moveSection(id, 1); } },
        { label: 'Reset order', disabled: _secOrder.join() === SEC_DEFAULT_ORDER.join(),
          run: function () { _secOrder = SEC_DEFAULT_ORDER.slice(); _applySecOrder(); } },
      ]);
    });
  });

  // Resize handles: left panel (far edge), right panel (near edge), preview height
  var lp = document.getElementById('left-panel');
  var lr = document.getElementById('left-resize');
  if (lp && lr) lr.addEventListener('mousedown', function (e) {
    if (e.button !== 0) return;
    drag1D(e, 'x', lp.offsetWidth, 180, 320, function (v) { lp.style.width = v + 'px'; }, 1);
  });
  var rp = document.getElementById('right-panel');
  var rr = document.getElementById('right-resize');
  if (rp && rr) rr.addEventListener('mousedown', function (e) {
    if (e.button !== 0) return;
    drag1D(e, 'x', rp.offsetWidth, 220, 340, function (v) { rp.style.width = v + 'px'; }, -1);
  });
  var wrap = document.getElementById('thumb-wrap');
  var pr   = document.getElementById('preview-resize');
  if (wrap) wrap.style.height = _previewH + 'px';
  if (wrap && pr) pr.addEventListener('mousedown', function (e) {
    if (e.button !== 0) return;
    drag1D(e, 'y', _previewH, 64, 220, function (v) {
      _previewH = v;
      wrap.style.height = v + 'px';
      if (typeof updateThumbnail === 'function') updateThumbnail();
    }, 1);
  });
}

function onPreviewStats(painted, colors) {
  var el = document.getElementById('preview-stats');
  if (el) el.textContent = painted + (painted === 1 ? ' cell · ' : ' cells · ') +
                           colors  + (colors  === 1 ? ' color'   : ' colors');
}

// ── Layers panel ──────────────────────────────────────────────────────────────

var _SVG_EYE     = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/></svg>';
var _SVG_EYE_OFF = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"/><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"/><path d="m2 2 20 20"/></svg>';
var _SVG_LOCK    = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>';
var _SVG_UNLOCK  = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>';

var _layerSig    = '';    // structure signature — skip full rebuilds when only the active row changes
var _layerDragId = null;

function onLayersChanged() { renderLayersPanel(); }

function _setDisabled(id, v) {
  var el = document.getElementById(id);
  if (el) el.disabled = !!v;
}

function renderLayersPanel() {
  var list = document.getElementById('layer-list');
  if (!list || typeof getLayers !== 'function') return;
  var layers = getLayers();
  if (!layers.length) return;
  var activeId = getActiveLayerId();

  var sig = layers.map(function (L) {
    return L.id + '|' + L.name + '|' + (L.visible ? 1 : 0) + (L.locked ? 1 : 0);
  }).join('/') + '#' + _cols + 'x' + _rows;

  if (sig !== _layerSig) {
    _layerSig = sig;
    list.innerHTML = '';
    layers.forEach(function (L) {
      list.appendChild(_buildLayerRow(L));
      drawLayerThumb(L);
    });
  } else {
    // Pixels may have changed (undo/redo, move, clear) — refresh thumbnails in place
    layers.forEach(function (L) { drawLayerThumb(L); });
  }
  list.querySelectorAll('.layer-row').forEach(function (row) {
    row.classList.toggle('active', row.dataset.id === activeId);
  });

  var A = getActiveLayer();
  var op = document.getElementById('layer-op-input');
  if (op && document.activeElement !== op) op.value = A ? A.opacity : 100;
  var idx = layers.indexOf(A);
  _setDisabled('layer-up',   idx <= 0);
  _setDisabled('layer-down', idx < 0 || idx >= layers.length - 1);
  _setDisabled('layer-del',  layers.length < 2);
  var count = document.getElementById('layer-count');
  if (count) count.textContent = layers.length + (layers.length === 1 ? ' layer' : ' layers');
}

function _layerIconBtn(cls, svg, title) {
  var b = document.createElement('button');
  b.className = 'layer-icon-btn ' + cls;
  b.innerHTML = svg;
  b.title = title;
  b.draggable = false;
  return b;
}

function _buildLayerRow(L) {
  var row = document.createElement('div');
  row.className = 'layer-row' + (L.visible ? '' : ' is-hidden') + (L.locked ? ' is-locked' : '');
  row.dataset.id = L.id;
  row.draggable = true;
  row.title = 'Double-click to rename · drag to reorder · right-click for options';

  var th = document.createElement('canvas');
  th.className = 'layer-thumb';
  th.dataset.id = L.id;
  row.appendChild(th);

  var name = document.createElement('span');
  name.className = 'layer-name';
  name.textContent = L.name;
  row.appendChild(name);

  var lock = _layerIconBtn('layer-lock', L.locked ? _SVG_LOCK : _SVG_UNLOCK, L.locked ? 'Unlock layer' : 'Lock layer');
  lock.addEventListener('click', function (e) { e.stopPropagation(); setLayerLocked(L.id, !L.locked); });
  row.appendChild(lock);

  var eye = _layerIconBtn('layer-eye', L.visible ? _SVG_EYE : _SVG_EYE_OFF, L.visible ? 'Hide layer' : 'Show layer');
  eye.addEventListener('click', function (e) { e.stopPropagation(); setLayerVisible(L.id, !L.visible); });
  row.appendChild(eye);

  row.addEventListener('click', function () { setActiveLayer(L.id); });
  row.addEventListener('dblclick', function (e) {
    if (e.target.closest && e.target.closest('button')) return;
    _startLayerRename(L.id);
  });
  row.addEventListener('contextmenu', function (e) {
    e.preventDefault();
    setActiveLayer(L.id);
    _openLayerCtx(e, L.id);
  });

  // Drag to reorder
  row.addEventListener('dragstart', function (e) {
    _layerDragId = L.id;
    e.dataTransfer.setData('text/x-layer', L.id);
    e.dataTransfer.effectAllowed = 'move';
    row.classList.add('dragging');
    e.stopPropagation();
  });
  row.addEventListener('dragend', function () {
    _layerDragId = null;
    document.querySelectorAll('.layer-row').forEach(function (r) {
      r.classList.remove('dragging', 'drop-before', 'drop-after');
    });
  });
  row.addEventListener('dragover', function (e) {
    if (!_layerDragId) return;
    e.preventDefault(); e.stopPropagation();
    if (_layerDragId === L.id) return;
    var r = row.getBoundingClientRect();
    var after = e.clientY > r.top + r.height / 2;
    row.classList.toggle('drop-after', after);
    row.classList.toggle('drop-before', !after);
  });
  row.addEventListener('dragleave', function () { row.classList.remove('drop-before', 'drop-after'); });
  row.addEventListener('drop', function (e) {
    if (!_layerDragId) return;
    e.preventDefault(); e.stopPropagation();
    var dragId = _layerDragId;
    _layerDragId = null;
    var after = row.classList.contains('drop-after');
    row.classList.remove('drop-before', 'drop-after');
    if (dragId === L.id) return;
    var ids  = getLayers().map(function (x) { return x.id; });
    var from = ids.indexOf(dragId), t = ids.indexOf(L.id);
    var ins  = t + (after ? 1 : 0);
    if (from < ins) ins--;
    moveLayerTo(dragId, ins);
  });

  return row;
}

function _startLayerRename(id) {
  var row = document.querySelector('.layer-row[data-id="' + id + '"]');
  var nameEl = row && row.querySelector('.layer-name');
  var L = null;
  getLayers().forEach(function (x) { if (x.id === id) L = x; });
  if (!nameEl || !L) return;

  var inp = document.createElement('input');
  inp.className  = 'layer-name-input';
  inp.value      = L.name;
  inp.spellcheck = false;
  row.draggable  = false;
  nameEl.parentNode.replaceChild(inp, nameEl);
  inp.focus();
  inp.select();

  var done = false;
  function finish(save) {
    if (done) return;
    done = true;
    if (save) renameLayer(id, inp.value);
    _layerSig = '';            // force a rebuild so the input is swapped back out
    renderLayersPanel();
  }
  inp.addEventListener('keydown', function (e) {
    e.stopPropagation();
    if (e.key === 'Enter')  finish(true);
    if (e.key === 'Escape') finish(false);
  });
  inp.addEventListener('blur', function () { finish(true); });
  ['click', 'dblclick', 'mousedown'].forEach(function (t) {
    inp.addEventListener(t, function (e) { e.stopPropagation(); });
  });
}

function _deleteLayerWithToast(id) {
  var L = null;
  getLayers().forEach(function (x) { if (x.id === id) L = x; });
  var name = L ? L.name : 'layer';
  if (deleteLayer(id)) showToast('Deleted ' + name + ' · Ctrl+Z to undo');
}

function _openLayerCtx(e, id) {
  var layers = getLayers();
  var i = -1;
  layers.forEach(function (x, k) { if (x.id === id) i = k; });
  if (i < 0) return;
  var L = layers[i];
  openCtxMenu(e.clientX, e.clientY, [
    { label: 'Rename', key: 'Double-click', run: function () { _startLayerRename(id); } },
    { label: 'Duplicate', run: function () { duplicateLayer(id); } },
    'sep',
    { label: 'Move up',   disabled: i === 0,                 run: function () { moveLayer(id, -1); } },
    { label: 'Move down', disabled: i === layers.length - 1, run: function () { moveLayer(id, 1); } },
    'sep',
    { label: L.visible ? 'Hide' : 'Show',   run: function () { setLayerVisible(id, !L.visible); } },
    { label: L.locked ? 'Unlock' : 'Lock',  run: function () { setLayerLocked(id, !L.locked); } },
    'sep',
    { label: 'Delete layer', danger: true, disabled: layers.length < 2, run: function () { _deleteLayerWithToast(id); } },
  ]);
}

function initLayersPanel() {
  document.getElementById('layer-add').addEventListener('click', function (e) { e.stopPropagation(); addLayer(); });
  document.getElementById('layer-dup').addEventListener('click', function () { duplicateLayer(getActiveLayerId()); });
  document.getElementById('layer-del').addEventListener('click', function () { _deleteLayerWithToast(getActiveLayerId()); });
  document.getElementById('layer-up').addEventListener('click', function () { moveLayer(getActiveLayerId(), -1); });
  document.getElementById('layer-down').addEventListener('click', function () { moveLayer(getActiveLayerId(), 1); });

  bindNumField(document.getElementById('layer-op-input'), document.getElementById('layer-op-scrub'), {
    min: 0, max: 100,
    get: function () { var A = getActiveLayer(); return A ? A.opacity : 100; },
    set: function (v) { var A = getActiveLayer(); if (A) setLayerOpacity(A.id, v); },
  });
}


// ── Mode switching ────────────────────────────────────────────────────────────

function enterPaintMode() {
  document.body.classList.add('mode-paint');
  window.focus(); // claim keyboard focus so Ctrl+Z/Ctrl+Y and tool hotkeys hit the plugin, not Figma
}

function exitPaintMode() {
  if (typeof closeMenus === 'function') closeMenus();
  document.body.classList.remove('mode-paint', 'panels-hidden', 'sel-mode');
  postMsg({ type: 'resize-default' });
}

// ── Setup screen ──────────────────────────────────────────────────────────────
// Ported from the "Pixel Painter Setup v2" mockup. One state object, one
// render function: handleSelection() and the grid pickers update state, then
// call renderSetup(). The math mirrors fillFrame() in the sandbox exactly
// (cols = floor((W + gap) / (cell + gap)), centred offsets), so the numbers on
// this screen are the numbers Figma will get.

var _setup = {
  sel: 'none',      // 'none' | 'invalid' | 'frame' | 'canvas'
  id: null,         // canvas id (canvas mode) — used to keep picker edits across re-selects
  name: '', W: 0, H: 0,
  base: null,       // canvas mode: the canvas's current { cell, gap, cols, rows }
  filling: false,
};
var _paintFrameId = null;   // frame whose pixels are currently loaded in the paint canvas
var SETUP_MAX_CELLS = 10000;

function _gridFor(W, H, cell, gap) {
  var stride = cell + gap;
  var cols = Math.max(1, Math.floor((W + gap) / stride));
  var rows = Math.max(1, Math.floor((H + gap) / stride));
  return {
    cols: cols, rows: rows, total: cols * rows,
    offX: Math.max(0, Math.round((W - (cols * stride - gap)) / 2)),
    offY: Math.max(0, Math.round((H - (rows * stride - gap)) / 2)),
  };
}

function _gridSummary(cell, gap) { return cell + 'px · ' + (gap ? '1px gap' : 'No gap'); }

function _setDelta(key, now, prev) {
  var el = document.getElementById('su-d-' + key);
  document.getElementById('su-prev-' + key).textContent = 'Prev ' + prev.toLocaleString();
  el.textContent = now === prev ? '=' : (now > prev ? '↑ ' : '↓ ') + Math.abs(now - prev).toLocaleString();
  el.classList.toggle('same', now === prev);
}

function _syncGridPickers() {
  document.querySelectorAll('#snap-setup .snap').forEach(function (x) {
    x.classList.toggle('on', parseInt(x.dataset.s, 10) === _cellSize);
  });
  document.getElementById('sp1').classList.toggle('on', _gap === 1);
  document.getElementById('sp0').classList.toggle('on', _gap === 0);
}

function renderSetup() {
  var S = _setup;
  var panel = document.getElementById('panel-setup');
  if (!panel) return;
  var hasFrame = S.sel === 'frame' || S.sel === 'canvas';
  var g        = hasFrame ? _gridFor(S.W, S.H, _cellSize, _gap) : null;
  var base     = S.sel === 'canvas' ? S.base : null;
  var changed  = !!base && (_cellSize !== base.cell || _gap !== base.gap);
  var tooMany  = hasFrame && g.total > SETUP_MAX_CELLS;

  panel.dataset.sel = S.sel;
  panel.classList.toggle('is-changed', changed);
  panel.classList.toggle('is-too-many', tooMany);

  // Status row
  document.getElementById('su-status-text').textContent =
    S.sel === 'canvas' ? 'Painted frame' :
    S.sel === 'frame'  ? '1 frame' :
    S.sel === 'invalid' ? 'Not a frame' : 'Nothing selected';

  // Scaled frame outline + a grid pattern that reflects the real cell size / gap
  if (hasFrame) {
    var scale = Math.min(360 / S.W, 72 / S.H);
    var boxW  = Math.max(1, Math.round(S.W * scale));
    var boxH  = Math.max(1, Math.round(S.H * scale));
    var c     = (_cellSize + _gap) * scale;   // one grid step, in preview px
    var frame = document.getElementById('su-frame');
    frame.style.width  = boxW + 'px';
    frame.style.height = boxH + 'px';

    var grid = document.getElementById('su-grid');
    grid.style.width  = Math.min(boxW, Math.round(g.cols * c)) + 'px';
    grid.style.height = Math.min(boxH, Math.round(g.rows * c)) + 'px';
    if (_gap) {
      grid.style.backgroundColor = '#D9D9D9';
      // Below ~3px per step the 1px gap lines would swallow the cells — show flat.
      grid.style.backgroundImage = c >= 3
        ? 'linear-gradient(to right, #FFFFFF 1px, transparent 1px), linear-gradient(to bottom, #FFFFFF 1px, transparent 1px)'
        : 'none';
      grid.style.backgroundSize = c + 'px ' + c + 'px';
    } else {
      grid.style.backgroundColor = '#E6E6E6';
      grid.style.backgroundImage = c >= 1.5
        ? 'conic-gradient(#D9D9D9 25%, #EDEDED 0 50%, #D9D9D9 0 75%, #EDEDED 0)'
        : 'none';
      grid.style.backgroundSize = (c * 2) + 'px ' + (c * 2) + 'px';
    }

    var nameEl  = document.getElementById('su-frame-name');
    var stageW  = frame.parentNode.clientWidth || 428;
    nameEl.textContent = S.name || 'Unnamed frame';
    nameEl.title       = S.name || '';
    nameEl.style.maxWidth = Math.max(40, Math.floor(stageW / 2 + boxW / 2) - 8) + 'px';
    document.getElementById('su-frame-dims').textContent = S.W + ' × ' + S.H;
    document.getElementById('su-margins').textContent = '· Margins ' + g.offX + ' × ' + g.offY + 'px';
  }

  // Result
  document.getElementById('gc-cols').textContent  = hasFrame ? g.cols : '—';
  document.getElementById('gc-rows').textContent  = hasFrame ? g.rows : '—';
  document.getElementById('gc-total').textContent = hasFrame ? g.total.toLocaleString() : '—';
  if (changed) {
    _setDelta('cols',  g.cols,  base.cols);
    _setDelta('rows',  g.rows,  base.rows);
    _setDelta('total', g.total, base.cols * base.rows);
    document.getElementById('su-prev-params').textContent = _gridSummary(base.cell, base.gap);
    document.getElementById('su-new-params').textContent  = _gridSummary(_cellSize, _gap);
  }
  document.getElementById('su-warn-text').textContent =
    'This will clear the current frame.' + (tooMany ? ' Over 10k cells may be slow.' : '');

  // Footer
  var foot = document.getElementById('su-foot');
  foot.classList.toggle('is-canvas', S.sel === 'canvas');
  document.getElementById('su-foot-note').textContent =
    S.sel === 'canvas'
      ? (changed ? 'Grid settings changed.' : 'This frame was made with Pixel Painter.')
      : 'The window resizes to match your frame.';
  var btnFill = document.getElementById('btn-fill');
  btnFill.disabled    = S.sel !== 'frame' || S.filling;
  btnFill.textContent = S.filling && S.sel === 'frame' ? 'Filling…' : 'Fill frame & open canvas';
  var btnRefill = document.getElementById('btn-refill');
  btnRefill.disabled    = !changed || S.filling;
  btnRefill.textContent = S.filling && S.sel === 'canvas' ? 'Filling…' : 'Re-fill frame';
}

// Kept under its old name — every grid-picker change and selection update
// funnels through here.
function updateGridCalc() { renderSetup(); }

function _doFill() {
  if (_setup.filling) return;
  var targetId = _selectedFrameId || _currentCanvasFrameId;
  if (!targetId) return;

  if (!_selectedFrameId && _currentCanvasFrameId) {
    // Re-fill an existing canvas. The warning banner on this screen ("This will
    // clear the current frame.") is the confirmation — Figma's plugin iframe is
    // sandboxed without allow-modals, so window.confirm() can't be relied on.
    // If this exact canvas is loaded in the painter with art on it, save that
    // art to a new frame first (never another canvas's art).
    var saveMsg    = _paintFrameId === targetId ? buildApplyMessage(true) : null;
    var hasContent = !!saveMsg && flatHasContent(saveMsg.cells);
    if (hasContent) {
      postMsg(saveMsg);
      showToast('Saving art to a new frame, then re-filling…');
    } else {
      showToast('Re-filling frame…');
    }
  } else {
    showToast('Filling frame…');
  }

  _setup.filling = true;
  _paintFrameId  = targetId;
  renderSetup();
  postMsg({ type: 'fill-frame', frameId: targetId, cellSize: _cellSize, gap: _gap });
}

function initSetupTab() {
  document.querySelectorAll('#snap-setup .snap').forEach(function (b) {
    b.addEventListener('click', function () {
      _cellSize = parseInt(b.dataset.s, 10);
      _syncGridPickers();
      updateGridCalc();
    });
  });
  document.getElementById('sp1').addEventListener('click', function () {
    _gap = 1; _syncGridPickers(); updateGridCalc();
  });
  document.getElementById('sp0').addEventListener('click', function () {
    _gap = 0; _syncGridPickers(); updateGridCalc();
  });

  document.getElementById('btn-fill').addEventListener('click', _doFill);
  document.getElementById('btn-refill').addEventListener('click', _doFill);

  document.getElementById('btn-open-canvas').addEventListener('click', function () {
    if (!_currentCanvasFrameId) return;
    _paintFrameId = _currentCanvasFrameId;
    showToast('Loading canvas…');
    postMsg({ type: 'open-canvas', frameId: _currentCanvasFrameId });
  });

  // "Frame selection" shortcut, per platform
  var isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');
  var fk = document.getElementById('su-frame-key');
  if (fk) fk.textContent = isMac ? '⌥⌘G' : 'Ctrl+Alt+G';

  renderSetup();
}

// ── Cell shape section ────────────────────────────────────────────────────────

var _cellShapeMode = 'radius'; // 'radius' | 'cross' — read by Apply handlers

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

  function _setActivePreset(matchFn) {
    presets.forEach(function (b) { b.classList.toggle('active', matchFn(b)); });
  }

  function _applyRadius(pct) {
    _cellShapeMode = 'radius';
    _cellRadiusPct = pct;
    if (slider) { slider.disabled = false; slider.value = pct; }
    if (valEl)  valEl.textContent = _radiusLabel(pct);
    _setActivePreset(function (b) { return !b.dataset.shape && +b.dataset.radius === pct; });
    if (typeof setCellShapeMode === 'function') setCellShapeMode('radius');
    if (typeof setCellRadius === 'function') setCellRadius(pct);
  }

  function _applyCrossShape() {
    _cellShapeMode = 'cross';
    if (slider) slider.disabled = true;
    if (valEl)  valEl.textContent = 'Cross-stitch';
    _setActivePreset(function (b) { return b.dataset.shape === 'cross'; });
    if (typeof setCellShapeMode === 'function') setCellShapeMode('cross');
  }

  if (slider) {
    slider.addEventListener('input', function () { _applyRadius(+slider.value); });
  }

  presets.forEach(function (b) {
    b.addEventListener('click', function () {
      if (b.dataset.shape === 'cross') _applyCrossShape();
      else _applyRadius(+b.dataset.radius);
    });
  });

  _applyRadius(0); // default: square
}

// ── Apply buttons ─────────────────────────────────────────────────────────────

function initApplyButtons() {
  // Both paths flatten every visible layer into one cells grid (export.js)
  document.getElementById('btn-apply-selected').addEventListener('click', function () {
    var targetId = _currentCanvasFrameId || _selectedFrameId;
    var msg      = buildApplyMessage(false, targetId);
    if (!msg)      { showToast('Paint something first'); return; }
    if (!targetId) { showToast('Select a pixel canvas in Figma first', 'warn'); return; }
    postMsg(msg);
    showToast('Applying to Figma…');
  });

  document.getElementById('btn-apply-new').addEventListener('click', function () {
    var msg = buildApplyMessage(true);
    if (!msg) { showToast('Paint something first'); return; }
    postMsg(msg);
    showToast('Creating new frame…');
  });
}

// ── Selection → Setup state ───────────────────────────────────────────────────

function handleSelection(m) {
  if (m.mode === 'frame') {
    _selectedFrameId   = m.frameId;
    _selectedFrameW    = m.width;
    _selectedFrameH    = m.height;
    _selectedFrameName = m.name || 'Unnamed frame';
    _setup.sel = 'frame'; _setup.id = null; _setup.base = null;
    _setup.name = _selectedFrameName; _setup.W = m.width; _setup.H = m.height;

  } else if (m.mode === 'canvas') {
    _selectedFrameId      = null;
    _currentCanvasFrameId = m.id || null;
    _selectedFrameW       = m.width  || 0;
    _selectedFrameH       = m.height || 0;
    _canvasName           = m.name || '';
    var cs = m.cellSize || 16;
    var cg = m.gap !== undefined ? m.gap : 1;
    var fallback = _gridFor(_selectedFrameW, _selectedFrameH, cs, cg);
    var base = { cell: cs, gap: cg, cols: m.cols || fallback.cols, rows: m.rows || fallback.rows };
    // selectionchange re-fires for the same canvas (clicks, nudges). Only reset
    // the pickers to the canvas's settings when it's a different canvas or its
    // grid changed — otherwise the user's in-progress edit would be thrown away.
    var prev = _setup.sel === 'canvas' && _setup.id === m.id ? _setup.base : null;
    var sameCanvas = !!prev && prev.cell === base.cell && prev.gap === base.gap &&
                     prev.cols === base.cols && prev.rows === base.rows;
    if (!sameCanvas) { _cellSize = cs; _gap = cg; _syncGridPickers(); }
    _setup.sel = 'canvas'; _setup.id = m.id; _setup.base = base;
    _setup.name = _canvasName; _setup.W = _selectedFrameW; _setup.H = _selectedFrameH;

  } else {
    _selectedFrameId = null;
    _setup.sel  = m.mode === 'invalid' ? 'invalid' : 'none';
    _setup.id   = null; _setup.base = null;
  }
  renderSetup();
}

// ── Filled / Reopened → paint mode ───────────────────────────────────────────

var _selectedFrameName = '';   // name of the plain frame last selected (fill path)
var _canvasName        = '';   // name of the pixel canvas last selected (reopen path)

function _setPaintHeader(name, cols, rows) {
  var n = name || 'Pixel canvas';
  ['paint-title', 'float-title'].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) { el.textContent = n; el.title = n; }
  });
  var d = document.getElementById('paint-dims');
  if (d) d.textContent = cols + ' × ' + rows;
}

// The frame-fitted window can be narrower than the side panels + floating
// toolbar need. Widen it through the existing 'resize-window' message
// (UI-only — the sandbox protocol is unchanged).
function _ensurePaintWindowWidth() {
  var lp = document.getElementById('left-panel');
  var rp = document.getElementById('right-panel');
  var need = (lp ? lp.offsetWidth : 220) + (rp ? rp.offsetWidth : 248) + 440;
  var maxW = ((screen && (screen.availWidth || screen.width)) || 1400) - 80;
  need = Math.min(need, maxW);
  if (window.innerWidth < need) {
    postMsg({ type: 'resize-window', w: Math.round(need), h: Math.round(window.innerHeight) });
  }
}

function handleFilled(m) {
  _setup.filling = false;
  // The frame just filled is now the canvas being painted. Point Apply at it
  // right away instead of relying on the follow-up selectionchange — otherwise
  // a canvas selected earlier in the session could stay the Apply target.
  if (_paintFrameId) _currentCanvasFrameId = _paintFrameId;
  renderSetup();
  _gap = m.gap !== undefined ? m.gap : _gap;
  enterPaintMode();
  showToast('Filled: ' + m.cols + '×' + m.rows + ' (' + m.cellSize + 'px)');
  _setPaintHeader(_selectedFrameName, m.cols, m.rows);
  setTimeout(function () {
    _ensurePaintWindowWidth();
    initCanvas(m.cols, m.rows, m.canvasW, m.canvasH, m.gap !== undefined ? m.gap : _gap, m.cellSize);
    initHSBPicker();
    _applyRefToCanvas();
  }, 0);
}

function handleReopened(m) {
  _gap = m.gap !== undefined ? m.gap : 1;
  enterPaintMode();
  showToast('Loaded ' + m.cols + '×' + m.rows + ' canvas');
  _setPaintHeader(_canvasName, m.cols, m.rows);
  setTimeout(function () {
    _ensurePaintWindowWidth();
    initCanvas(m.cols, m.rows, m.canvasW, m.canvasH, m.gap, m.cellSize);
    if (m.cells) loadCells(m.cells);
    initHSBPicker();
    _applyRefToCanvas();
  }, 0);
}

// ── Reference section (left panel) ────────────────────────────────────────────

var _refSrc        = null;   // object URL of loaded reference image
var _refOpacityPct = 40;     // 10–100
var _refOn         = true;   // visibility toggle

function _applyRefToCanvas() {
  if (!_refSrc) return;
  if (typeof setRefImage  === 'function') setRefImage(_refSrc, _refOpacityPct / 100);
  if (typeof setRefVisible === 'function') setRefVisible(_refOn);
}

function _refUI() {
  var has = !!_refSrc;
  var dropEl   = document.getElementById('ref-drop-mini');
  var loadedEl = document.getElementById('ref-loaded');
  var status   = document.getElementById('ref-status');
  var visBtn   = document.getElementById('ref-vis-toggle');
  var opInp    = document.getElementById('ref-opacity');
  if (dropEl)   dropEl.style.display   = has ? 'none' : 'flex';
  if (loadedEl) loadedEl.style.display = has ? 'flex' : 'none';
  if (status)   status.textContent = has ? (_refOn ? _refOpacityPct + '%' : 'Hidden') : 'None';
  if (visBtn)   visBtn.textContent = _refOn ? 'Hide' : 'Show';
  if (opInp && document.activeElement !== opInp) opInp.value = _refOpacityPct;
}

function _loadRefFile(file) {
  if (!file || file.type.indexOf('image/') !== 0) return;
  if (_refSrc) URL.revokeObjectURL(_refSrc);
  _refSrc = URL.createObjectURL(file);
  _refOn  = true;
  var thumbEl = document.getElementById('ref-thumb');
  if (thumbEl) thumbEl.src = _refSrc;
  toggleSection('ref', true);
  _refUI();
  _applyRefToCanvas();
}

function initRefPanel() {
  var dropEl     = document.getElementById('ref-drop-mini');
  var fileInput  = document.getElementById('ref-file-input');
  var thumbEl    = document.getElementById('ref-thumb');
  var removeBtn  = document.getElementById('ref-remove-btn');
  var replaceBtn = document.getElementById('ref-replace-btn');
  var visBtn     = document.getElementById('ref-vis-toggle');

  // Click-to-browse (drag-and-drop onto the whole Reference section is wired in initLeftSections)
  dropEl.addEventListener('click', function () { fileInput.click(); });
  replaceBtn.addEventListener('click', function () { fileInput.click(); });
  fileInput.addEventListener('change', function () {
    if (fileInput.files[0]) _loadRefFile(fileInput.files[0]);
    fileInput.value = '';
  });

  // Remove
  removeBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    if (_refSrc) URL.revokeObjectURL(_refSrc);
    _refSrc = null;
    thumbEl.src = '';
    if (typeof clearRef === 'function') clearRef();
    _refUI();
  });

  // Opacity — number field with scrub handle
  bindNumField(document.getElementById('ref-opacity'), document.getElementById('ref-op-scrub'), {
    min: 10, max: 100,
    get: function () { return _refOpacityPct; },
    set: function (v) {
      _refOpacityPct = v;
      if (typeof setRefOpacity === 'function') setRefOpacity(v / 100);
      _refUI();
    },
  });

  // Show / hide on canvas
  visBtn.addEventListener('click', function () {
    _refOn = !_refOn;
    if (typeof setRefVisible === 'function') setRefVisible(_refOn);
    _refUI();
  });

  _refUI();
}

// ── Keyboard shortcuts ────────────────────────────────────────────────────────

function initKeyboard() {
  document.addEventListener('keydown', function (e) {
    if (!document.body.classList.contains('mode-paint')) return;
    if (e.target.tagName === 'INPUT') return;

    var mod = e.ctrlKey || e.metaKey;

    if (e.code === 'Space') { e.preventDefault(); setSpaceHeld(true); return; }

    // Collapse / restore side panels
    if (mod && (e.key === '\\' || e.code === 'Backslash')) {
      e.preventDefault();
      if (typeof togglePanels === 'function') togglePanels();
      return;
    }

    if (!mod && !e.altKey) {
      var k = e.key.toLowerCase();
      var map = { v: 'move', p: 'pen', e: 'eraser', i: 'eyedropper', g: 'bucket',
                  r: 'rect', o: 'oval', l: 'line', w: 'wand' };
      if (map[k]) setActiveTool(map[k]);
    }

    if (e.key === 'Escape') {
      if (typeof closeMenus === 'function') closeMenus();
      _exitSelMode();
    }

    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (typeof getSelectionCount === 'function' && getSelectionCount() > 0) {
        e.preventDefault();
        if (typeof eraseSelection === 'function' && eraseSelection()) document.body.classList.remove('sel-mode');
      }
    }

    if (mod && (e.key === 'd' || e.key === 'D')) {
      e.preventDefault();
      _exitSelMode();
    }

    if (mod && !e.shiftKey && e.key === 'z') {
      e.preventDefault(); e.stopPropagation();
      if (_customPaletteUndo) { undoCustomPalette(); return; }
      undoCanvas();
    }
    if (mod && (e.shiftKey && e.key === 'Z' || e.key === 'y')) {
      e.preventDefault(); e.stopPropagation(); redoCanvas();
    }

    // Zoom
    if (mod && (e.key === '=' || e.key === '+')) {
      e.preventDefault();
      var el = document.getElementById('canvas-scroll');
      if (el) { var r=el.getBoundingClientRect(); _zoomAt(r.left+r.width/2, r.top+r.height/2, 1.5); }
    }
    if (mod && e.key === '-') {
      e.preventDefault();
      var el2 = document.getElementById('canvas-scroll');
      if (el2) { var r2=el2.getBoundingClientRect(); _zoomAt(r2.left+r2.width/2, r2.top+r2.height/2, 1/1.5); }
    }
    if (mod && e.key === '0') { e.preventDefault(); fitToWindow(); }
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
    case 'error':
      if (_setup.filling) { _setup.filling = false; renderSetup(); }
      showToast('⚠ ' + m.message);
      break;

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
      handleLibColors(m.colors || [], m.key, m.name);
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
initLeftSections();
initLayersPanel();
buildQuickGrid();
// Pre-arm the first preset color so the pen works immediately without having to pick a color first
_armedColor = QUICK_PALETTE[0].hex.toUpperCase();
_setHSBFromHex(_armedColor);
document.querySelectorAll('.quick-swatch').forEach(function (s) {
  s.classList.toggle('armed', s.dataset.hex === _armedColor);
});
document.documentElement.style.setProperty('--armed', _armedColor);
(function () { var fh = document.getElementById('float-hex-val'); if (fh) fh.textContent = _armedColor; })();
initColorTabs();
initLibraryPanel();
initCustomPalette();
initZoomControls();
initRefPanel();
initKeyboard();
initResizeHandle();

postMsg({ type: 'init', screenW: screen.width, screenH: screen.height });
