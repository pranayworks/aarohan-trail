// ============================================================================
// Aarohan rider: language. Chosen once at first launch, changeable in Settings.
// Anything not translated yet shows in English. Chichewa wording needs a native speaker's review.
// ============================================================================
(function () {
  'use strict';
  var AR = window.AR;
  var D = {
    en: { tab_home: 'Home', tab_activity: 'Activity', tab_account: 'Account', where_to: 'Where to?', ride: 'Ride', parcel: 'Parcel', cont: 'Continue', start: 'Get started', skip: 'Skip', hello: 'Hello', morning: 'Good morning', afternoon: 'Good afternoon', evening: 'Good evening', language: 'Language', choose_lang: 'Choose your language', lang_sub: 'You can change this later in Settings.' },
    ny: { tab_home: 'Kunyumba', tab_activity: 'Maulendo', tab_account: 'Akaunti', where_to: 'Mukupita kuti?', ride: 'Kukwera', parcel: 'Katundu', cont: 'Pitirizani', start: 'Yambani', skip: 'Dumphani', hello: 'Moni', morning: 'Moni', afternoon: 'Moni', evening: 'Moni', language: 'Chilankhulo', choose_lang: 'Sankhani chilankhulo', lang_sub: 'Mutha kusintha izi mu Settings.' }
  };
  var LANGS = [['en', 'English', 'English'], ['ny', 'Chichewa', 'Chichewa']];
  var cur = 'en';
  try { var s = localStorage.getItem('aarohan_lang'); if (s && D[s]) cur = s; } catch (_) {}
  AR.lang = { get: function () { return cur; }, chosen: function () { try { return !!localStorage.getItem('aarohan_lang'); } catch (_) { return true; } },
    set: function (l) { if (!D[l]) return; cur = l; try { localStorage.setItem('aarohan_lang', l); } catch (_) {} document.documentElement.lang = l === 'ny' ? 'ny' : 'en'; } };
  AR.t = function (k) { return (D[cur] && D[cur][k]) || D.en[k] || k; };

  // params: { first: true } at first launch, otherwise opened from Settings
  AR.register('language', {
    locked: true,
    mount: function (el, params) {
      var first = !!params.first;
      el.innerHTML = (first ? '<div class="topbar"></div>' : '<div class="topbar"><button class="icon-btn" data-back aria-label="Back">' + AR.icon('chevronLeft') + '</button></div>') +
        '<div class="scroll"><div style="padding:' + (first ? '40px' : '8px') + ' 4px 20px"><div class="art-tile" style="width:84px;height:84px;border-radius:26px;animation:pop 600ms var(--ease-spring) both;margin-bottom:22px">' + AR.icon('map', 38) + '</div>' +
        '<h1 style="font-size:30px;line-height:1.1">Choose your language</h1><p class="dim mt8">Sankhani chilankhulo</p></div>' +
        '<div class="list stagger">' + LANGS.map(function (l) { return '<button class="row" data-l="' + l[0] + '"><span class="grow"><div class="r-title" style="font-size:18px">' + l[1] + '</div></span><span class="r-end">' + (cur === l[0] && !first ? AR.icon('check', 22, 'gold') : '') + '</span></button>'; }).join('') + '</div>' +
        '<p class="small dim mt16 center">You can change this later in Settings.</p></div>';
      var back = AR.$('[data-back]', el); if (back) back.addEventListener('click', function () { AR.nav.back(); });
      AR.$$('[data-l]', el).forEach(function (b) {
        b.addEventListener('click', function () {
          AR.lang.set(b.dataset.l);
          if (first) { var seen = false; try { seen = localStorage.getItem('aarohan_intro_seen') === '1'; } catch (_) {} AR.nav.replace(seen ? 'auth' : 'intro'); }
          else { AR.toast('Language changed.'); setTimeout(function () { location.reload(); }, 500); }
        });
      });
    }
  });
})();
