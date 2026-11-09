// ============================================================================
// Trip chat screen (shared by the rider and driver apps).
// Needs the page to contain #chat-modal, #chat-messages-container, #chat-custom-input and, optionally,
// #chat-title, #chat-avatar and #chat-unread-dot. The logic lives in the store (shared/state.js).
// ============================================================================
(function (window) {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  var clock = function (iso) {
    try { return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); } catch (_) { return ''; }
  };
  var store = function () { return window.mwendoStore; };

  var QUICK = {
    rider: ["I'm at the pickup point", "I'll be there in 1 minute", 'Please call me', 'Where are you?'],
    driver: ["I'm at the pickup point", "I'm about 2 minutes away", "I'm stuck in traffic", 'Please call me']
  };

  function otherName() {
    var s = store() && store().getState ? store().getState() : {};
    if (store().chatMyRole() === 'driver') {
      var r = (s.activeTrip && s.activeTrip.rider) || {};
      return r.name || 'Passenger';
    }
    return (s.driver && s.driver.name) || 'Your captain';
  }

  function isOpen() { var m = $('chat-modal'); return !!m && !m.classList.contains('hidden'); }

  function updateBadge() {
    var dot = $('chat-unread-dot');
    if (!dot || !store()) return;
    var c = store().chatState();
    dot.classList.toggle('hidden', !(c.unread > 0));
  }

  function render() {
    var list = $('chat-messages-container');
    if (!list || !store()) return;
    var c = store().chatState();
    var me = store().chatMyRole();
    var name = otherName();

    var title = $('chat-title'); if (title) title.textContent = name;
    var av = $('chat-avatar'); if (av) av.textContent = (name || '?').trim().charAt(0).toUpperCase();

    if (!c.tripId) {
      list.innerHTML = '<div class="chat-empty">Chat opens when a trip is on its way.</div>';
      return;
    }
    if (!c.messages.length) {
      list.innerHTML = '<div class="chat-empty">Say hello to ' + esc(name) + '. Messages stay between the two of you for this trip.</div>';
      return;
    }
    list.innerHTML = c.messages.map(function (m) {
      var mine = m.sender === me;
      var meta;
      if (mine && m.status === 'failed') meta = '<button class="bubble-retry" data-retry="' + esc(m.clientId) + '">Not sent. Tap to retry</button>';
      else if (mine && m.status === 'sending') meta = 'Sending...';
      else meta = esc(clock(m.createdAt));
      return '<div class="bubble-row ' + (mine ? 'me' : 'them') + '">' +
        '<div class="bubble ' + (mine ? 'me' : 'them') + (m.status === 'failed' ? ' failed' : '') + '" data-keep-emoji>' + esc(m.text) + '</div>' +
        '<div class="bubble-meta">' + meta + '</div></div>';
    }).join('');
    list.scrollTop = list.scrollHeight;
  }

  function buildQuick() {
    var host = $('chat-quick');
    if (!host || !store()) return;
    var set = QUICK[store().chatMyRole()] || QUICK.rider;
    host.innerHTML = set.map(function (t) { return '<button type="button" data-quick="' + esc(t) + '">' + esc(t) + '</button>'; }).join('');
  }

  function notify(msg) {
    if (window.showToast) window.showToast(msg); else if (msg) console.warn('[Chat]', msg);
  }

  window.openChatDrawer = function () {
    var m = $('chat-modal');
    if (!m || !store()) return;
    var c = store().chatState();
    if (!c.tripId) { notify('Chat opens once a captain is on the way.'); return; }
    buildQuick();
    m.classList.remove('hidden');
    store().chatSetOpen(true);
    render();
    updateBadge();
    var input = $('chat-custom-input');
    if (input) setTimeout(function () { input.focus(); }, 120);
  };

  window.closeChatDrawer = function () {
    var m = $('chat-modal');
    if (m) m.classList.add('hidden');
    if (store()) store().chatSetOpen(false);
    updateBadge();
  };

  function send(text) {
    store().chatSend(text, function (res) {
      if (res && !res.success && res.error && !/Tap to retry|retry/i.test(res.error)) notify(res.error);
    });
    render();
  }

  window.sendCannedChat = function (text) { send(text); };
  window.sendCustomChat = function () {
    var input = $('chat-custom-input');
    if (!input) return;
    var text = input.value.trim();
    if (!text) return;
    input.value = '';
    send(text);
  };
  window.retryChat = function (id) { if (store()) store().chatRetry(id); };

  function init() {
    if (!store() || !$('chat-modal') || $('chat-modal').getAttribute('data-ready')) return;
    $('chat-modal').setAttribute('data-ready', '1');

    var list = $('chat-messages-container');
    if (list) list.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-retry]') : null;
      if (b) window.retryChat(b.getAttribute('data-retry'));
    });
    var quick = $('chat-quick');
    if (quick) quick.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-quick]') : null;
      if (b) window.sendCannedChat(b.getAttribute('data-quick'));
    });

    store().subscribe(function (state, eventName) {
      if (eventName === 'CHAT_MESSAGE' || eventName === 'CHAT_THREAD') { if (isOpen()) render(); updateBadge(); return; }
      // Any other event may mean the trip ended: close a chat that no longer has a trip.
      var c = store().chatState();
      if (isOpen() && !c.tripId) window.closeChatDrawer();
      updateBadge();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})(window);
