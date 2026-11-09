// ============================================================================
// Aarohan Captain: start-up. Loaded last.
// ============================================================================
(function () {
  'use strict';
  var AR = window.AR;
  var wired = false;
  function wire() {
    if (wired || !AR.store()) return; wired = true;
    AR.store().subscribe(function (state, ev, payload) {
      if (ev === 'TRIP_OFFERED') { if (AR.D.online || (payload && payload.offer)) AR.D.showOffer(payload); }
      else if (AR.D.onTripEvent) AR.D.onTripEvent(ev, payload);
    });
  }

  async function boot() {
    var mk = document.getElementById('splash-mark'); if (mk) mk.innerHTML = AR.mark(84);
    window.showToast = AR.toast;
    var cc = document.getElementById('chat-close-btn'); if (cc) cc.innerHTML = AR.icon('close', 20);
    var cs = document.getElementById('chat-send-btn'); if (cs) cs.innerHTML = AR.icon('send', 20);
    var off = document.createElement('div'); off.id = 'offline'; off.className = 'hide'; off.textContent = 'You are offline. You will not get trips until you reconnect.'; document.body.appendChild(off);
    var sync = function () { off.classList.toggle('hide', navigator.onLine !== false); }; window.addEventListener('online', sync); window.addEventListener('offline', sync); sync();
    var cfg = {}; try { cfg = await fetch('/api/app-config').then(function (r) { return r.json(); }); } catch (_) {}
    AR.state.cfg = cfg; AR.state.authMode = cfg.authMode === 'email' ? 'email' : 'phone';
    wire();
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(function () {});
    AR.D.wireApproval();
    window.authFetch = function (u, o) { return window.aarohanAuth.fetchWithAuth(u, o); }; // used by the native push code to register the phone
    window.handleIncomingPushTripOffer = function () { try { AR.nav.resetTo('home'); } catch (_) {} }; // tapping a push opens Home, where the offer card appears
    AR.onSocket('driver:commission_limit', function (p) {
      AR.D.online = false; AR.D.stopGps(); AR.haptic([40, 60, 40]);
      AR.sheet.open({ dismissable: false, html: '<h2>Time to pay your commission</h2><p class="dim">You owe Aarohan <b>' + AR.fmt.money(p.debtMWK) + '</b>, which has reached your limit of ' + AR.fmt.money(p.limitMWK) + '. You will not get new orders until you pay. You have been taken offline.</p><div class="stack gap12 mt24"><button class="btn btn-gold" id="pay">Pay commission now</button><button class="btn btn-ghost" style="width:100%" id="later">Later</button></div>',
        onOpen: function (c) { AR.$('#pay', c.el).addEventListener('click', function () { c.close(); AR.D.payCommission(p.debtMWK, function () { if (AR.nav.tabs.home && AR.nav.tabs.home.inst.show) AR.nav.tabs.home.inst.show(); }); }); AR.$('#later', c.el).addEventListener('click', function () { c.close(); if (AR.nav.tabs.home && AR.nav.tabs.home.inst.show) AR.nav.tabs.home.inst.show(); }); } });
    });
    if (window.aarohanAuth) window.aarohanAuth.setReady(window.aarohanAuth.getUser());
    var started = false;
    if (window.aarohanAuth && window.aarohanAuth.isAuthenticated()) {
      try { await AR.session.start(); started = true; }
      catch (e) { if (e.status === 401 || e.status === 403) window.aarohanAuth.clearSession(); else AR.toast('Could not reach Aarohan. Check your internet.', 'gold'); }
    }
    if (!started) {
      var seen = false; try { seen = localStorage.getItem('aarohan_intro_seen') === '1'; } catch (_) {}
      document.getElementById('app').innerHTML = ''; AR.nav.stack = [];
      if (!AR.lang.chosen()) AR.nav.go('language', { first: true }, { anim: 'fade' }); else AR.nav.go(seen ? 'auth' : 'intro', {}, { anim: 'fade' });
    }
    await AR.sleep(500); document.getElementById('splash').classList.add('gone');
    AR.checkUpdate(); setInterval(AR.checkUpdate, 10 * 60 * 1000); document.addEventListener('visibilitychange', function () { if (!document.hidden) AR.checkUpdate(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
