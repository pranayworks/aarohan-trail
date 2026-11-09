// ============================================================================
// Aarohan rider: send a parcel (route, item, weight, receiver, who pays), then prices by vehicle.
// ============================================================================
(function () {
  'use strict';
  var AR = window.AR;
  var CATEGORIES = ['Documents', 'Food', 'Clothes', 'Electronics', 'Gift', 'Other'];

  function sizeFor(kg) { return kg <= 5 ? 'SMALL' : (kg <= 20 ? 'MEDIUM' : 'LARGE'); }
  function advice(kg) {
    var L = AR.ride.LIMIT_KG;
    if (!kg || kg <= 0) return { t: 'Enter the weight to see which vehicle fits.', ok: true };
    if (kg <= L.moto) return { t: 'At ' + kg + ' kg a Moto is enough for your parcel.', ok: true };
    if (kg <= L.auto) return { t: 'At ' + kg + ' kg your parcel needs an Auto.', ok: true };
    if (kg <= L.cab) return { t: 'At ' + kg + ' kg your parcel needs a Cab.', ok: true };
    return { t: 'Too heavy. Our vehicles carry up to ' + L.cab + ' kg.', ok: false };
  }

  AR.register('parcel', {
    mount: function (el) {
      var T = AR.trip; T.serviceType = 'PARCEL';
      var P = T.parcel || (T.parcel = { category: 'Documents', weightKg: 2, fragile: false, notes: '', recipientName: '', recipientPhone: '', payer: 'SENDER_AT_PICKUP', accepted: false });
      var layers = [];

      el.innerHTML = '<div class="topbar"><button class="icon-btn" data-back aria-label="Back">' + AR.icon('chevronLeft') + '</button><h1>Send a parcel</h1></div>' +
        '<div class="scroll"><div class="stack gap16">' +
        '<div style="position:relative;height:190px;border-radius:22px;overflow:hidden;border:1px solid var(--line)" class="map-wrap" id="pw"><div class="map" id="pm"></div></div>' +
        '<div><div class="section-title" style="padding-top:4px">Route</div><div class="list">' +
        '<button class="row" id="r-from"><span class="r-ic" style="color:var(--steel-300)">' + AR.icon('pin', 20) + '</span><span class="grow"><div class="r-sub">Pickup</div><div class="r-title ellipsis" id="t-from"></div></span><span class="r-end">' + AR.icon('chevronRight', 18) + '</span></button>' +
        '<button class="row" id="r-to"><span class="r-ic gold">' + AR.icon('flag', 20) + '</span><span class="grow"><div class="r-sub">Drop-off</div><div class="r-title ellipsis" id="t-to"></div></span><span class="r-end">' + AR.icon('chevronRight', 18) + '</span></button></div></div>' +
        '<div><div class="section-title" style="padding-top:4px">What are you sending?</div><div class="chips" id="cats"></div>' +
        '<div class="field mt12"><input class="input" id="notes" maxlength="120" placeholder="Describe the item (optional)" value="' + AR.esc(P.notes) + '"/></div>' +
        '<button class="row card" id="fragile" style="margin-top:12px;border-radius:var(--r-md);min-height:56px"><span class="grow"><div class="r-title">Fragile</div><div class="r-sub">Handle with extra care</div></span><span class="toggle ' + (P.fragile ? 'on' : '') + '"></span></button></div>' +
        '<div><div class="section-title" style="padding-top:4px">How heavy is it?</div><div class="hstack gap12"><button class="icon-btn" id="wminus" aria-label="Less">' + AR.icon('minus', 20) + '</button>' +
        '<div class="input-wrap grow"><input class="input center num" id="kg" inputmode="decimal" style="font-size:22px;font-weight:700" value="' + AR.esc(P.weightKg) + '"/></div><span class="dim" style="font-weight:600">kg</span><button class="icon-btn" id="wplus" aria-label="More">' + AR.icon('plus', 20) + '</button></div>' +
        '<div class="chips mt12" id="wq"></div><div class="suggest mt12" id="adv"></div></div>' +
        '<div><div class="section-title" style="padding-top:4px">Who receives it?</div><div class="stack gap12">' +
        '<input class="input" id="rname" autocomplete="off" placeholder="Receiver\'s full name" value="' + AR.esc(P.recipientName) + '"/>' +
        '<div class="input-wrap"><span class="prefix">+265</span><input class="input has-prefix" id="rphone" type="tel" inputmode="tel" placeholder="99 123 4567" value="' + AR.esc(P.recipientPhone ? P.recipientPhone.replace('+265', '') : '') + '"/></div></div></div>' +
        '<div><div class="section-title" style="padding-top:4px">Who pays? (cash)</div><div class="stack gap8" id="payer"></div></div>' +
        '<div class="card"><div class="hstack gap12">' + AR.icon('lock', 22, 'gold') + '<div><div style="font-weight:700">Two codes keep it safe</div><div class="small dim mt8">After booking you get a <b>pickup code</b> for your captain to collect the parcel, and a <b>delivery code</b> to share with the receiver. The parcel is handed over only when the code matches.</div></div></div></div>' +
        '<button class="consent" id="ok" type="button" style="text-align:left"><span class="check ' + (P.accepted ? 'on' : '') + '">' + AR.icon('check', 16) + '</span><span>This parcel has no illegal, dangerous or prohibited items.</span></button>' +
        '<div class="hint err hide" id="err"></div><button class="btn btn-gold" id="go">See price and vehicles</button></div></div>';

      var map = AR.map.create(AR.$('#pm', el), { center: T.pickup || AR.map.LILONGWE, zoom: 14 });
      ['dragging', 'touchZoom', 'scrollWheelZoom', 'doubleClickZoom', 'boxZoom', 'keyboard'].forEach(function (h) { try { map[h].disable(); } catch (_) {} });

      function paintMap() {
        layers.forEach(function (l) { try { map.removeLayer(l); } catch (_) {} }); layers = [];
        var pts = [];
        if (T.pickup) { layers.push(AR.map.marker(map, T.pickup, 'steel')); pts.push([T.pickup.lat, T.pickup.lng]); }
        if (T.dest) { layers.push(AR.map.marker(map, T.dest, 'gold')); pts.push([T.dest.lat, T.dest.lng]); }
        if (pts.length === 2) { layers.push(L.polyline(pts, { color: AR.css('--route'), weight: 3, dashArray: '6 8', opacity: 0.9 }).addTo(map)); map.fitBounds(pts, { padding: [40, 40], maxZoom: 15 }); }
        else if (pts.length === 1) map.setView(pts[0], 15);
      }
      function paintRoute() { AR.$('#t-from', el).textContent = (T.pickup && T.pickup.name) || 'Choose pickup'; AR.$('#t-to', el).textContent = (T.dest && T.dest.name) || 'Choose drop-off'; paintMap(); }

      AR.$('[data-back]', el).addEventListener('click', function () { AR.nav.back(); });
      AR.$('#r-from', el).addEventListener('click', function () { AR.nav.go('search', { field: 'pickup', onSelect: function (p) { T.pickup = p; paintRoute(); } }); });
      AR.$('#r-to', el).addEventListener('click', function () { AR.nav.go('search', { field: 'dest', onSelect: function (p) { T.dest = p; paintRoute(); } }); });

      // item
      var cats = AR.$('#cats', el);
      function paintCats() { cats.innerHTML = CATEGORIES.map(function (c) { return '<button class="chip ' + (P.category === c ? 'on' : '') + '" data-c="' + c + '">' + c + '</button>'; }).join(''); AR.$$('[data-c]', cats).forEach(function (b) { b.addEventListener('click', function () { P.category = b.dataset.c; paintCats(); }); }); }
      paintCats();
      AR.$('#fragile', el).addEventListener('click', function () { P.fragile = !P.fragile; AR.$('.toggle', el).classList.toggle('on', P.fragile); });

      // weight
      var kgIn = AR.$('#kg', el);
      function setKg(v) { v = Math.max(0, Math.round(v * 10) / 10); P.weightKg = v; kgIn.value = v || ''; paintAdvice(); }
      function paintAdvice() {
        var a = advice(Number(P.weightKg)); var box = AR.$('#adv', el);
        box.innerHTML = AR.icon(a.ok ? 'info' : 'warning', 22) + '<span>' + AR.esc(a.t) + '</span>'; box.style.borderColor = a.ok ? '' : 'var(--gold-500)'; box.style.color = a.ok ? '' : 'var(--gold-200)';
      }
      kgIn.addEventListener('input', function () { P.weightKg = parseFloat(kgIn.value.replace(',', '.')) || 0; paintAdvice(); });
      AR.$('#wminus', el).addEventListener('click', function () { setKg((Number(P.weightKg) || 0) - (P.weightKg > 10 ? 5 : 1)); });
      AR.$('#wplus', el).addEventListener('click', function () { setKg((Number(P.weightKg) || 0) + (P.weightKg >= 10 ? 5 : 1)); });
      var wq = AR.$('#wq', el); wq.innerHTML = [1, 5, 10, 20, 50, 100].map(function (n) { return '<button class="chip" data-w="' + n + '">' + n + ' kg</button>'; }).join('');
      AR.$$('[data-w]', wq).forEach(function (b) { b.addEventListener('click', function () { setKg(+b.dataset.w); }); });
      paintAdvice();

      // who pays
      var payer = AR.$('#payer', el);
      function paintPayer() {
        payer.innerHTML = [['SENDER_AT_PICKUP', 'I pay at pickup', 'You pay your captain in cash when they collect the parcel.'], ['RECEIVER_AT_DELIVERY', 'The receiver pays on delivery', 'The receiver pays your captain in cash when the parcel arrives.']].map(function (o) {
          return '<button class="reason ' + (P.payer === o[0] ? 'on' : '') + '" data-p="' + o[0] + '" style="align-items:flex-start;margin:0"><span class="radio" style="margin-top:2px"></span><span><div>' + o[1] + '</div><div class="small dim" style="font-weight:500">' + o[2] + '</div></span></button>';
        }).join('');
        AR.$$('[data-p]', payer).forEach(function (b) { b.addEventListener('click', function () { P.payer = b.dataset.p; paintPayer(); }); });
      }
      paintPayer();
      AR.$('#ok', el).addEventListener('click', function () { P.accepted = !P.accepted; AR.$('.check', AR.$('#ok', el)).classList.toggle('on', P.accepted); });

      function err(m) { var h = AR.$('#err', el); h.textContent = m || ''; h.classList.toggle('hide', !m); if (m) h.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
      AR.$('#go', el).addEventListener('click', function () {
        P.notes = AR.$('#notes', el).value.trim(); P.recipientName = AR.$('#rname', el).value.trim();
        var ph = AR.phone.normalize(AR.$('#rphone', el).value);
        var kg = Number(P.weightKg);
        if (!T.pickup) return err('Choose where the parcel is picked up.');
        if (!T.dest) return err('Choose where the parcel is going.');
        if (!(kg > 0)) return err('Enter the weight of your parcel.');
        if (kg > AR.ride.LIMIT_KG.cab) return err('This parcel is too heavy. Our vehicles carry up to ' + AR.ride.LIMIT_KG.cab + ' kg.');
        if (P.recipientName.length < 2) return err('Enter the receiver\'s name.');
        if (!AR.phone.valid(ph)) return err('Enter a valid Malawian mobile number for the receiver.');
        if (!P.accepted) return err('Please confirm the parcel has no prohibited items.');
        err('');
        P.recipientPhone = ph; P.size = sizeFor(kg); P.prohibitedAccepted = true; P.weightKg = kg;
        T.stops = []; T.quote = null; T.tierId = AR.ride.recommend(kg);
        AR.nav.go('options');
      });

      paintRoute();
      return { show: function () { map.invalidateSize(); paintRoute(); }, destroy: function () { try { map.remove(); } catch (_) {} } };
    }
  });
})();
