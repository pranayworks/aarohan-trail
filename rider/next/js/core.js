// ============================================================================
// Aarohan rider: core (icons, helpers, API, router, sheets, toasts). No sounds anywhere.
// ============================================================================
(function () {
  'use strict';
  const AR = (window.AR = { screens: {}, state: {} });

  // ------------------------------------------------------------------ icons
  // Drawn by hand on a 24 grid: 1.7px strokes, round caps. No emoji, no icon font.
  const ICONS = {
    search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.2 4.2"/>',
    pin: '<path d="M12 21c-4.2-3.9-6.5-7-6.5-10.2A6.5 6.5 0 0 1 12 4.3a6.5 6.5 0 0 1 6.5 6.5C18.5 14 16.2 17.1 12 21Z"/><circle cx="12" cy="10.6" r="2.3"/>',
    locate: '<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="7.5"/><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.3V12l3.2 1.9"/>',
    home: '<path d="M4.5 10.8 12 4.5l7.5 6.3v8a1 1 0 0 1-1 1h-4.2v-5.6H9.7v5.6H5.5a1 1 0 0 1-1-1z"/>',
    activity: '<path d="M5 6.5h14M5 12h14M5 17.5h8"/>',
    user: '<circle cx="12" cy="8.3" r="3.6"/><path d="M5 20c.9-3.6 3.8-5.6 7-5.6s6.1 2 7 5.6"/>',
    chevronRight: '<path d="m9.5 5.5 6.5 6.5-6.5 6.5"/>',
    chevronLeft: '<path d="m14.5 5.5-6.5 6.5 6.5 6.5"/>',
    chevronDown: '<path d="m5.5 9.5 6.5 6.5 6.5-6.5"/>',
    close: '<path d="m6.5 6.5 11 11M17.5 6.5l-11 11"/>',
    check: '<path d="m5.5 12.5 4.3 4.3 8.7-9.6"/>',
    plus: '<path d="M12 5.5v13M5.5 12h13"/>',
    minus: '<path d="M5.5 12h13"/>',
    phone: '<path d="M7.2 4.5h2.6l1.4 3.6-1.8 1.4a10.6 10.6 0 0 0 5.1 5.1l1.4-1.8 3.6 1.4v2.6a1.8 1.8 0 0 1-2 1.8A14.9 14.9 0 0 1 5.4 6.5a1.8 1.8 0 0 1 1.8-2Z"/>',
    chat: '<path d="M5.5 5.5h13A1.5 1.5 0 0 1 20 7v8.2a1.5 1.5 0 0 1-1.5 1.5H11l-4.2 3.3v-3.3H5.5A1.5 1.5 0 0 1 4 15.2V7a1.5 1.5 0 0 1 1.5-1.5Z"/>',
    share: '<circle cx="6.5" cy="12" r="2.2"/><circle cx="17.5" cy="6.3" r="2.2"/><circle cx="17.5" cy="17.7" r="2.2"/><path d="m8.5 10.9 7-3.5M8.5 13.1l7 3.5"/>',
    send: '<path d="M20.2 3.8 10.3 13.7"/><path d="m20.2 3.8-6.2 16.4-3.7-6.5-6.5-3.7z"/>',
    shield: '<path d="M12 3.6 5.2 6.1v5.4c0 4.2 2.8 7.4 6.8 9 4-1.6 6.8-4.8 6.8-9V6.1z"/>',
    shieldCheck: '<path d="M12 3.6 5.2 6.1v5.4c0 4.2 2.8 7.4 6.8 9 4-1.6 6.8-4.8 6.8-9V6.1z"/><path d="m9 12 2.2 2.2L15.3 10"/>',
    bell: '<path d="M6.4 16.4v-4.8a5.6 5.6 0 0 1 11.2 0v4.8l1.4 1.6H5z"/><path d="M10 20.4a2.2 2.2 0 0 0 4 0"/>',
    star: '<path d="m12 3.9 2.4 5 5.5.8-4 3.9.9 5.5-4.8-2.6-4.8 2.6.9-5.5-4-3.9 5.5-.8z"/>',
    heart: '<path d="M12 19.6S4.9 15.4 4.9 10a4 4 0 0 1 7.1-2.5A4 4 0 0 1 19.1 10c0 5.4-7.1 9.6-7.1 9.6Z"/>',
    wallet: '<rect x="4" y="6.5" width="16" height="12" rx="2.3"/><path d="M4 9.5V8a2.2 2.2 0 0 1 2.2-2.2H17"/><circle cx="16.2" cy="12.6" r="1.1"/>',
    gift: '<rect x="4.5" y="9.5" width="15" height="10.5" rx="1.6"/><path d="M4 9.5h16V7.2H4zM12 7.2V20M12 7.2c-1.2-2.8-4.5-3.2-4.8-1.6-.3 1.5 2.2 1.6 4.8 1.6Zm0 0c1.2-2.8 4.5-3.2 4.8-1.6.3 1.5-2.2 1.6-4.8 1.6Z"/>',
    coin: '<circle cx="12" cy="12" r="8.4"/><path d="M12 7.6v8.8M9.6 10.2c.3-1 1.2-1.5 2.4-1.5 1.5 0 2.4.7 2.4 1.7s-.9 1.4-2.4 1.7-2.4.7-2.4 1.8 1 1.8 2.5 1.8c1.2 0 2.1-.5 2.4-1.5"/>',
    ticket: '<path d="M4 8.2a2 2 0 0 0 0 3.8v1.9a2 2 0 0 0 0 3.8V19h16v-1.3a2 2 0 0 0 0-3.8V12a2 2 0 0 0 0-3.8V6.6H4z"/><path d="M9.5 6.6V19"/>',
    help: '<circle cx="12" cy="12" r="8.5"/><path d="M9.6 9.6a2.5 2.5 0 0 1 4.8.8c0 1.7-2.4 2-2.4 3.6M12 17h.01"/>',
    parcel: '<path d="m12 3.6 7.6 4v8.8l-7.6 4-7.6-4V7.6z"/><path d="m4.6 7.8 7.4 4 7.4-4M12 11.8v8.4"/>',
    moto: '<circle cx="6" cy="16.2" r="3"/><circle cx="18" cy="16.2" r="3"/><path d="M6 16.2 9.2 9.6h4.1l2.1 4.2M9.2 9.6l-1-2.1H6.2M13.3 9.6h2.3M15.4 13.8l2.6 2.4"/>',
    auto: '<path d="M4.5 15.4V9.8l3.2-3.6h7.8l3 3.6v5.6"/><path d="M4.5 15.4h15M12 6.2v4"/><circle cx="7.6" cy="17.4" r="1.9"/><circle cx="16.4" cy="17.4" r="1.9"/>',
    car: '<path d="m5 14.2 1.5-4.4a2 2 0 0 1 1.9-1.3h7.2a2 2 0 0 1 1.9 1.3l1.5 4.4"/><rect x="3.8" y="14.2" width="16.4" height="4.4" rx="1.4"/><circle cx="7.6" cy="16.4" r=".7"/><circle cx="16.4" cy="16.4" r=".7"/><path d="M6.4 18.6V20M17.6 18.6V20"/>',
    route: '<circle cx="6.5" cy="6.5" r="2.2"/><rect x="15.3" y="15.3" width="4.4" height="4.4" rx="1.2"/><path d="M8.7 6.5h5.3a3.2 3.2 0 0 1 0 6.4h-4a3.2 3.2 0 0 0 0 6.4h4"/>',
    edit: '<path d="m4.8 19.2.9-3.9L16.4 4.6a1.8 1.8 0 0 1 2.5 0l.5.5a1.8 1.8 0 0 1 0 2.5L8.7 18.3z"/>',
    trash: '<path d="M5.5 7h13M9.5 7V5.2h5V7M7.2 7l.8 12.2h8L16.8 7"/>',
    logout: '<path d="M10 4.8H6.6A1.6 1.6 0 0 0 5 6.4v11.2a1.6 1.6 0 0 0 1.6 1.6H10M14.2 8l4 4-4 4M18.2 12H9.5"/>',
    settings: '<path d="M4.5 7.5h8M17 7.5h2.5M4.5 16.5H7M11.5 16.5h8"/><circle cx="14.8" cy="7.5" r="2.2"/><circle cx="9.2" cy="16.5" r="2.2"/>',
    info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 7.9h.01"/>',
    lock: '<rect x="5.5" y="10.5" width="13" height="9.5" rx="2.2"/><path d="M8.5 10.5V8.2a3.5 3.5 0 0 1 7 0v2.3"/>',
    mail: '<rect x="3.8" y="6" width="16.4" height="12" rx="2.2"/><path d="m4.4 7.6 7.6 5.6 7.6-5.6"/>',
    calendar: '<rect x="4.2" y="5.6" width="15.6" height="14.2" rx="2.2"/><path d="M4.2 10h15.6M8.6 3.8v3.6M15.4 3.8v3.6"/>',
    map: '<path d="m9 5-5 2v12l5-2 6 2 5-2V5l-5 2z"/><path d="M9 5v12M15 7v12"/>',
    swap: '<path d="m7 5.5-3 3 3 3M4 8.5h12M17 18.5l3-3-3-3M20 15.5H8"/>',
    users: '<circle cx="9" cy="8.5" r="3.2"/><path d="M3.5 19c.7-3.2 3-4.8 5.5-4.8s4.8 1.6 5.5 4.8M16 5.6a3 3 0 0 1 0 5.8M17.5 14.4c1.6.5 2.7 2 3 4.6"/>',
    file: '<path d="M7 3.6h7l4 4V20.4H7z"/><path d="M14 3.6v4h4M9.6 12h5.6M9.6 15.6h5.6"/>',
    filter: '<path d="M4.5 6h15l-5.8 6.8v5l-3.4 1.8v-6.8z"/>',
    sort: '<path d="M7.5 5.5v13M7.5 18.5l-3-3M7.5 18.5l3-3M16.5 18.5v-13M16.5 5.5l-3 3M16.5 5.5l3 3"/>',
    arrowRight: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    flag: '<path d="M6 20.5V4.5M6 5h11l-2.2 3.6L17 12H6"/>',
    copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5v-2a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2"/>',
    building: '<rect x="5.5" y="4.5" width="13" height="15.5" rx="1.6"/><path d="M9 8.5h1.6M13.4 8.5H15M9 12h1.6M13.4 12H15M10.2 20v-3.4h3.6V20"/>',
    warning: '<path d="M12 4.2 20.6 19H3.4z"/><path d="M12 10v4M12 16.6h.01"/>',
    bag: '<path d="M6 8.5h12l-1 11H7z"/><path d="M9 8.5V7a3 3 0 0 1 6 0v1.5"/>'
  };
  AR.icon = function (name, size, cls) {
    return '<svg class="ic ' + (cls || '') + '" width="' + (size || 22) + '" height="' + (size || 22) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[name] || '') + '</svg>';
  };
  AR.vehicleIcon = function (tier) { return tier === 'moto' ? 'moto' : (tier === 'cab' ? 'car' : 'auto'); };

  // The Aarohan mark in gold (the "A" from the logo, recoloured to the new palette).
  AR.mark = function (size) {
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 192 192" aria-hidden="true"><defs><linearGradient id="gm" x1="0" y1="1" x2="1" y2="0"><stop offset="0" style="stop-color:var(--mark-a)"/><stop offset="1" style="stop-color:var(--mark-b)"/></linearGradient></defs><rect width="192" height="192" rx="44" style="fill:var(--mark-bg)"/><g transform="translate(38 34) scale(.23)"><path d="M256 36 500 476H380L256 220 132 476H12Z" fill="url(#gm)"/><polygon points="160,340 352,340 310,410 202,410" style="fill:var(--mark-bg)"/><circle cx="256" cy="140" r="32" style="fill:var(--mark-dot)"/></g></svg>';
  };

  // ---------------------------------------------------------------- helpers
  AR.$ = function (s, r) { return (r || document).querySelector(s); };
  AR.$$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  AR.esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  AR.el = function (html) { var t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
  AR.sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  AR.debounce = function (fn, ms) { var t; return function () { var a = arguments, c = this; clearTimeout(t); t = setTimeout(function () { fn.apply(c, a); }, ms); }; };

  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  AR.fmt = {
    money: function (n) { return 'MK ' + Number(n || 0).toLocaleString('en-US'); },
    km: function (n) { return (Math.round(Number(n || 0) * 10) / 10) + ' km'; },
    date: function (d) { d = new Date(d); return d.getDate() + ' ' + MONTHS[d.getMonth()].slice(0, 3) + ' ' + d.getFullYear(); },
    time: function (d) { return new Date(d).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); },
    dateTime: function (d) { return AR.fmt.date(d) + ', ' + AR.fmt.time(d); },
    month: function (d) { d = new Date(d); return MONTHS[d.getMonth()] + ' ' + d.getFullYear(); },
    initials: function (n) { return String(n || '?').trim().split(/\s+/).slice(0, 2).map(function (w) { return w.charAt(0).toUpperCase(); }).join(''); },
    cap: function (s) { s = String(s || '').toLowerCase().replace(/_/g, ' '); return s.charAt(0).toUpperCase() + s.slice(1); }
  };

  // -------------------------------------------------------------------- API
  AR.api = async function (path, opts) {
    opts = opts || {};
    var auth = window.aarohanAuth;
    var init = { method: opts.method || 'GET', headers: Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {}) };
    if (opts.body !== undefined) init.body = JSON.stringify(opts.body);
    var url = path.indexOf('/api') === 0 ? path : '/api' + path;
    var res;
    try { res = await auth.fetchWithAuth(url, init); } catch (e) { throw new Error('Cannot reach Aarohan. Check your internet and try again.'); }
    if (!res) throw new Error('Please sign in again.');
    var data = {};
    try { data = await res.json(); } catch (_) { /* empty body */ }
    if (!res.ok) { var err = new Error(data.error || data.message || 'Something went wrong (' + res.status + ')'); err.status = res.status; err.data = data; throw err; }
    return data;
  };

  // ------------------------------------------------------------------ theme
  AR.css = function (n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); };
  AR.haptic = function (ms) { try { if (navigator.vibrate) navigator.vibrate(ms || 12); } catch (_) {} };
  // ----------------------------------------------------------------- toasts
  AR.toast = function (msg, kind) {
    var root = AR.$('#toast-root'); if (!root) return;
    var t = AR.el('<div class="toast ' + (kind || '') + '">' + AR.esc(msg) + '</div>');
    root.appendChild(t);
    setTimeout(function () { t.classList.add('out'); setTimeout(function () { t.remove(); }, 320); }, 2800);
  };

  // ----------------------------------------------------------------- sheets
  AR.sheet = {
    open: function (opts) {
      var root = AR.$('#sheet-root');
      var back = AR.el('<div class="backdrop"></div>');
      var sh = AR.el('<div class="sheet" role="dialog"><div class="sheet-handle"></div><div class="sheet-body">' + (opts.html || '') + '</div></div>');
      root.appendChild(back); root.appendChild(sh);
      root.style.pointerEvents = 'auto';
      requestAnimationFrame(function () { requestAnimationFrame(function () { back.classList.add('on'); sh.classList.add('on'); }); });
      var closed = false;
      var ctl = {
        el: AR.$('.sheet-body', sh),
        sheet: sh,
        close: function (result) {
          if (closed) return; closed = true;
          back.classList.remove('on'); sh.classList.remove('on');
          setTimeout(function () { back.remove(); sh.remove(); if (!root.children.length) root.style.pointerEvents = 'none'; if (opts.onClose) opts.onClose(result); }, 380);
        }
      };
      if (opts.dismissable !== false) back.addEventListener('click', function () { ctl.close(); });
      if (opts.onOpen) opts.onOpen(ctl);
      return ctl;
    }
  };
  AR.confirm = function (o) {
    return new Promise(function (resolve) {
      var ctl = AR.sheet.open({
        html: '<h2>' + AR.esc(o.title) + '</h2><p class="dim">' + AR.esc(o.body || '') + '</p><div class="stack gap12 mt24"><button class="btn ' + (o.danger ? 'btn-line' : 'btn-gold') + '" data-yes>' + AR.esc(o.yes || 'Confirm') + '</button><button class="btn btn-ghost" style="width:100%" data-no>' + AR.esc(o.no || 'Not now') + '</button></div>',
        onClose: function (r) { resolve(r === true); },
        onOpen: function (c) {
          AR.$('[data-yes]', c.el).addEventListener('click', function () { c.close(true); });
          AR.$('[data-no]', c.el).addEventListener('click', function () { c.close(false); });
        }
      });
    });
  };

  // ----------------------------------------------------------------- router
  // Tab screens stay alive; other screens are created and removed. Screens animate in and out.
  var nav = (AR.nav = { stack: [], tabs: {}, activeTab: null, tabbar: null });
  function root() { return document.getElementById('app'); }

  AR.register = function (name, def) { AR.screens[name] = def; };

  function build(name, params, enterClass) {
    var def = AR.screens[name];
    if (!def) throw new Error('Unknown screen: ' + name);
    var el = document.createElement('section');
    el.className = 'screen ' + (enterClass || '');
    el.dataset.screen = name;
    root().appendChild(el);
    var inst = def.mount(el, params || {}) || {};
    return { name: name, el: el, inst: inst, def: def };
  }
  function destroy(entry) { try { if (entry.inst.destroy) entry.inst.destroy(); } catch (e) { console.warn(e); } entry.el.remove(); }

  function showTabbar(on) { if (nav.tabbar) nav.tabbar.classList.toggle('hide', !on); }

  nav.go = function (name, params, opts) {
    opts = opts || {};
    var top = nav.stack[nav.stack.length - 1];
    var entry = build(name, params, opts.anim === 'up' ? 'enter-up' : (opts.anim === 'fade' ? 'enter-fade' : 'enter-right'));
    nav.stack.push(entry);
    try { history.pushState({ ar: nav.stack.length }, ''); } catch (_) {}
    showTabbar(false);
    if (top) setTimeout(function () { if (nav.stack.indexOf(top) !== -1 && top !== nav.stack[nav.stack.length - 1]) top.el.style.visibility = 'hidden'; }, 480);
    return entry;
  };
  nav.back = function () {
    var top = nav.stack.pop();
    if (!top) return;
    var below = nav.stack[nav.stack.length - 1];
    if (below) below.el.style.visibility = '';
    top.el.classList.remove('enter-right', 'enter-up', 'enter-fade');
    top.el.classList.add(top.el.dataset.leave === 'down' ? 'leave-down' : 'leave-right');
    setTimeout(function () { destroy(top); }, 300);
    if (!below) { showTabbar(true); var tab = nav.tabs[nav.activeTab]; if (tab && tab.inst.show) tab.inst.show(); }
    else if (below.inst.show) below.inst.show();
  };
  // Replace the top screen without a slide (used between ride states).
  nav.replace = function (name, params) {
    var top = nav.stack.pop();
    var entry = build(name, params, 'enter-fade');
    nav.stack.push(entry);
    if (top) setTimeout(function () { destroy(top); }, 320);
    showTabbar(false);
    return entry;
  };
  nav.resetTo = function (tabName) {
    while (nav.stack.length) destroy(nav.stack.pop());
    nav.tab(tabName || nav.activeTab || 'home', true);
  };
  nav.current = function () { return nav.stack[nav.stack.length - 1] || nav.tabs[nav.activeTab] || null; };

  nav.tab = function (name, force) {
    if (!force && nav.activeTab === name && !nav.stack.length) return;
    Object.keys(nav.tabs).forEach(function (k) { if (k !== name) nav.tabs[k].el.style.display = 'none'; });
    if (!nav.tabs[name]) nav.tabs[name] = build(name, {}, 'enter-fade');
    var t = nav.tabs[name];
    t.el.style.display = '';
    t.el.classList.remove('enter-fade'); void t.el.offsetWidth; t.el.classList.add('enter-fade');
    nav.activeTab = name;
    if (t.inst.show) t.inst.show();
    if (nav.tabbar) AR.$$('.tab', nav.tabbar).forEach(function (b) { b.classList.toggle('on', b.dataset.tab === name); });
    showTabbar(true);
  };

  nav.mountTabbar = function (custom) {
    if (nav.tabbar) { nav.tabbar.remove(); }
    nav.tabbar = AR.el('<nav class="tabbar hide"><div class="tabbar-inner">' +
      (custom || [['home', 'home', AR.t('tab_home')], ['activity', 'activity', AR.t('tab_activity')], ['account', 'user', AR.t('tab_account')]]).map(function (t) {
        return '<button class="tab" data-tab="' + t[0] + '" aria-label="' + t[2] + '">' + AR.icon(t[1], 24) + '<span>' + t[2] + '</span></button>';
      }).join('') + '</div></nav>');
    root().appendChild(nav.tabbar);
    nav.tabbar.addEventListener('click', function (e) {
      var b = e.target.closest('.tab'); if (!b) return;
      if (nav.stack.length) nav.resetTo(b.dataset.tab); else nav.tab(b.dataset.tab);
    });
  };

  // Swipe in from the left edge to go back (like a native app).
  (function () {
    var x0 = null, y0 = 0;
    document.addEventListener('touchstart', function (e) { var t = e.touches[0]; if (t.clientX < 24 && nav.stack.length) { x0 = t.clientX; y0 = t.clientY; } else x0 = null; }, { passive: true });
    document.addEventListener('touchend', function (e) {
      if (x0 == null) return; var t = e.changedTouches[0], dx = t.clientX - x0, dy = Math.abs(t.clientY - y0); x0 = null;
      var top = nav.stack[nav.stack.length - 1];
      if (dx > 80 && dy < 60 && top && !top.def.locked) nav.back();
    }, { passive: true });
  })();

  // Android/browser back button support.
  window.addEventListener('popstate', function () { if (nav.stack.length && !nav.stack[nav.stack.length - 1].def.locked) nav.back(); });
  AR.pushHistory = function () { try { history.pushState({ ar: 1 }, ''); } catch (_) {} };
})();
