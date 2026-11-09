// ============================================================================
// Ads from Aarohan: a picture or a short muted video, set up in the admin panel.
// Shared by the rider app (audience RIDER) and the driver app (audience DRIVER).
// ============================================================================
(function () {
  'use strict';
  var AR = window.AR, seen = {};
  function ev(id, type) { try { AR.api('/ads/' + id + '/event', { method: 'POST', body: { type: type } }).catch(function () {}); } catch (_) {} }

  AR.ads = {
    // placement: HOME (default), SEARCHING, COMPLETED for riders; HOME, EARNINGS for drivers.
    // The phone's rounded location is sent only so ads meant for one area can be matched. The server never stores it.
    mount: async function (host, audience, placement) {
      var loc = AR.map && AR.map._last;
      for (var w = 0; w < 10 && !loc; w++) { await new Promise(function (r) { setTimeout(r, 250); }); loc = AR.map && AR.map._last; }
      var q = '/ads?audience=' + audience + '&placement=' + (placement || 'HOME') + (loc ? '&lat=' + loc.lat.toFixed(3) + '&lng=' + loc.lng.toFixed(3) : '');
      var list; try { list = (await AR.api(q)).ads || []; } catch (_) { list = []; }
      if (!host || !host.isConnected) return;
      if (!list.length) { host.classList.add('hide'); host.innerHTML = ''; return; }
      var i = 0, timer = null;
      function show() {
        var a = list[i % list.length];
        var media = a.mediaType === 'VIDEO'
          ? '<video src="' + AR.esc(a.mediaUrl) + '" muted autoplay loop playsinline preload="metadata"></video>'
          : '<img src="' + AR.esc(a.mediaUrl) + '" alt="' + AR.esc(a.title) + '" loading="lazy"/>';
        host.innerHTML = '<div class="ad-card" role="button" tabindex="0" aria-label="' + AR.esc(a.title) + '"><div class="ad-media">' + media + '<span class="ad-tag">Ad</span></div>' +
          (a.title || a.caption ? '<div class="ad-text"><b>' + AR.esc(a.title) + '</b>' + (a.caption ? '<span>' + AR.esc(a.caption) + '</span>' : '') + '</div>' : '') +
          (list.length > 1 ? '<div class="ad-dots">' + list.map(function (_, k) { return '<i class="' + (k === i % list.length ? 'on' : '') + '"></i>'; }).join('') + '</div>' : '') + '</div>';
        host.classList.remove('hide');
        if (!seen[a.id]) { seen[a.id] = 1; ev(a.id, 'impression'); }
        AR.$('.ad-card', host).addEventListener('click', function () { ev(a.id, 'click'); if (a.linkUrl && /^https:\/\//i.test(a.linkUrl)) window.open(a.linkUrl, '_blank', 'noopener'); });
      }
      show();
      if (list.length > 1) { timer = setInterval(function () { if (!host.isConnected) return clearInterval(timer); i++; show(); }, 8000); }
    }
  };
})();
