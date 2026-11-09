// ============================================================================
// Aarohan rider: Help, tickets, notifications, refer and earn, rewards, coins, claims, payment.
// ============================================================================
(function () {
  'use strict';
  var AR = window.AR;

  var CAT = { WRONG_FARE: 'Fare issue', DRIVER_CONDUCT: 'Captain or vehicle', PAYMENT_DISPUTE: 'Payment', PARCEL_ISSUE: 'Parcel', LOST_ITEM: 'Lost item', SAFETY: 'Safety', APP_ISSUE: 'App problem', OTHER: 'Something else' };
  var TOPICS = {
    fare: { title: 'Fare related issues', icon: 'coin', cat: 'WRONG_FARE', items: [
      ['Why is my fare different from the estimate?', 'Your fare comes from the route distance and trip time. A longer route, extra stops or heavy traffic can change it. Open the trip in My rides to see the fare, booking fee and stop fee.'],
      ['My captain asked for more than the fare shown', 'Pay only the fare shown in the app. If a captain asks for more, raise a ticket with that trip selected so we can look into it.'],
      ['I want a fare explanation', 'Open My rides, tap the trip, and look under Payment. If something still looks wrong, raise a ticket.']] },
    captain: { title: 'Captain and vehicle related issues', icon: 'car', cat: 'DRIVER_CONDUCT', items: [
      ['My captain was rude or drove unsafely', 'We are sorry. Please raise a ticket with the trip selected. If you ever feel unsafe during a trip, press SOS and call 997.'],
      ['The vehicle did not match the app', 'Check the number plate and vehicle shown in the app before you board. If they do not match, do not ride, and raise a ticket.'],
      ['My captain did not arrive or was not moving', 'You can cancel and choose the reason, then book again. Raise a ticket if it keeps happening.'],
      ['I left something in the vehicle', 'Raise a ticket with the trip selected and describe the item. We will help you reach your captain.']] },
    payment: { title: 'Pass and payment related issues', icon: 'wallet', cat: 'PAYMENT_DISPUTE', items: [
      ['How do I pay?', 'For now Aarohan is cash only. You pay your captain at the end of the trip, or for parcels at pickup or delivery, depending on what you chose.'],
      ['I paid but something looks wrong', 'Raise a ticket with the trip selected and tell us what you paid and to whom.'],
      ['Passes and subscriptions', 'Passes are not available yet. We will tell you here when they are.']] },
    parcel: { title: 'Parcel related issues', icon: 'parcel', cat: 'PARCEL_ISSUE', items: [
      ['The delivery code is not working', 'Check you are using the delivery code shown on your trip screen. The code can only be tried a few times, so if it keeps failing, raise a ticket.'],
      ['My parcel is late', 'Open your trip to see where your captain is. If it is much later than expected, raise a ticket.'],
      ['My parcel is damaged or missing', 'Raise a ticket with the trip selected and describe what happened. Photos can be sent to support in the ticket chat later.']] },
    other: { title: 'Other topics', icon: 'help', cat: 'OTHER', items: [
      ['I have a safety concern', 'If you are in danger now, press SOS in a trip and call 997. For anything else, raise a ticket and choose Safety.', 'SAFETY'],
      ['Something is not working in the app', 'Close and reopen the app. If it still fails, raise a ticket and tell us what you were doing.', 'APP_ISSUE'],
      ['My account or personal details', 'You can edit your details in Account, Personal details. You can also delete your account in Settings.', 'OTHER'],
      ['Something else', 'Tell us about it in a ticket and we will get back to you.', 'OTHER']] }
  };

  function relTime(d) {
    var s = Math.max(0, (Date.now() - new Date(d).getTime()) / 1000);
    if (s < 60) return 'Just now'; if (s < 3600) return Math.floor(s / 60) + ' min ago'; if (s < 86400) return Math.floor(s / 3600) + ' h ago';
    if (s < 604800) return Math.floor(s / 86400) + ' d ago'; return AR.fmt.date(d);
  }
  AR.relTime = relTime;

  // -------------------------------------------------------------------- help
  AR.register('help', {
    mount: function (el) {
      var body = AR.page(el, 'Help', '<button class="btn btn-line btn-sm" id="tk">' + AR.icon('ticket', 18) + 'Tickets</button>');
      AR.$('#tk', el).addEventListener('click', function () { AR.nav.go('tickets'); });
      body.innerHTML = '<div class="section-title" style="padding-top:4px">Need help with a trip?</div><div id="trips"><div class="skeleton sk-row"></div><div class="skeleton sk-row"></div></div>' +
        '<div class="section-title">Help topics</div><div class="list">' + Object.keys(TOPICS).map(function (k) { return AR.row({ id: k, icon: TOPICS[k].icon, title: TOPICS[k].title }); }).join('') + '</div>';
      var map = {}; Object.keys(TOPICS).forEach(function (k) { map[k] = function () { AR.nav.go('help-topic', { key: k }); }; });
      AR.bindRows(body, map);
      (async function () {
        var host = AR.$('#trips', body);
        try {
          var list = await AR.loadTrips(false);
          if (!list.length) { host.innerHTML = '<div class="card dim small">You have no trips yet. Once you ride, you can ask about them here.</div>'; return; }
          host.innerHTML = '<div class="small dim" style="padding:0 4px 8px">Your last trip</div>' + AR.tripCardHtml(list[0], 0) + (list.length > 1 ? '<div class="small dim" style="padding:8px 4px">Earlier trips</div>' + list.slice(1).map(function (t, i) { return AR.tripCardHtml(t, i + 1); }).join('') : '');
          AR.$$('.trip-card', host).forEach(function (b) { b.addEventListener('click', function () { AR.nav.go('trip-detail', { id: b.dataset.id }); }); });
        } catch (e) { host.innerHTML = '<div class="card dim small">Could not load your trips. ' + AR.esc(e.message) + '</div>'; }
      })();
    }
  });

  AR.register('help-topic', {
    mount: function (el, params) {
      var T = TOPICS[params.key], body = AR.page(el, T.title);
      body.innerHTML = '<div class="list">' + T.items.map(function (it, i) {
        return '<div class="faq" data-i="' + i + '"><button class="row" data-q="' + i + '"><span class="grow"><div class="r-title" style="font-size:15.5px">' + AR.esc(it[0]) + '</div></span><span class="r-end" data-chev>' + AR.icon('chevronDown', 18) + '</span></button><div class="hide" data-a="' + i + '" style="padding:0 16px 16px"><p class="dim" style="font-size:15px">' + AR.esc(it[1]) + '</p><button class="btn btn-line btn-sm mt12" data-t="' + i + '">' + AR.icon('ticket', 18) + 'Still need help? Raise a ticket</button></div></div>';
      }).join('') + '</div>';
      AR.$$('[data-q]', body).forEach(function (b) { b.addEventListener('click', function () { var a = AR.$('[data-a="' + b.dataset.q + '"]', body); a.classList.toggle('hide'); AR.$('[data-chev]', b).style.transform = a.classList.contains('hide') ? '' : 'rotate(180deg)'; }); });
      AR.$$('[data-t]', body).forEach(function (b) { b.addEventListener('click', function () { var it = T.items[+b.dataset.t]; AR.nav.go('new-ticket', { category: it[2] || T.cat, subject: it[0] }); }); });
    }
  });

  // ----------------------------------------------------------------- tickets
  AR.register('tickets', {
    mount: function (el) {
      var body = AR.page(el, 'Tickets');
      function paint(list) {
        body.innerHTML = '<button class="btn btn-gold" id="new">' + AR.icon('plus', 20) + 'New ticket</button><div class="section-title">Previous tickets</div>' +
          (list.length ? '<div class="list">' + list.map(function (k) { return AR.row({ id: k.id, icon: 'ticket', title: k.subject, sub: (CAT[k.category] || 'Ticket') + ' · ' + AR.relTime(k.createdAt), end: '<span class="badge ' + (k.status === 'RESOLVED' || k.status === 'CLOSED' ? 'steel' : 'gold') + '">' + AR.esc(AR.fmt.cap(k.status)) + '</span>' }); }).join('') + '</div>' : '<div class="empty" style="padding:30px 12px">' + AR.icon('ticket', 40) + '<h3>No tickets yet</h3><p>If something goes wrong, raise a ticket and we will help.</p></div>');
        AR.$('#new', body).addEventListener('click', function () { AR.nav.go('new-ticket', {}); });
        var map = {}; list.forEach(function (k) { map[k.id] = function () { AR.nav.go('ticket', { id: k.id }); }; }); AR.bindRows(body, map);
      }
      async function load() {
        body.innerHTML = '<div class="skeleton sk-row"></div><div class="skeleton sk-row"></div>';
        try { var d = await AR.api('/tickets'); paint(d.tickets || []); } catch (e) { body.innerHTML = '<div class="empty"><h3>Could not load tickets</h3><p>' + AR.esc(e.message) + '</p></div>'; }
      }
      load();
      return { show: load };
    }
  });

  AR.register('new-ticket', {
    mount: function (el, params) {
      var body = AR.page(el, 'New ticket');
      var F = { category: params.category || 'OTHER', tripId: params.tripId || '' };
      body.innerHTML = '<div class="stack gap16"><div class="field"><label>What is it about?</label><div class="chips" id="cats">' + Object.keys(CAT).map(function (k) { return '<button class="chip ' + (F.category === k ? 'on' : '') + '" data-c="' + k + '">' + CAT[k] + '</button>'; }).join('') + '</div></div>' +
        '<div class="field"><label>Which trip is this about?</label><button class="row card" id="tripbtn" style="border-radius:var(--r-md);min-height:60px"><span class="r-ic">' + AR.icon('route', 20) + '</span><span class="grow" style="min-width:0"><div class="r-title ellipsis" id="tripname">Not about a trip</div><div class="r-sub">Tap to choose a trip</div></span><span class="r-end">' + AR.icon('chevronRight', 18) + '</span></button></div>' +
        '<div class="field"><label>Subject</label><input class="input" id="subject" maxlength="100" placeholder="A short title" value="' + AR.esc(params.subject || '') + '"/></div>' +
        '<div class="field"><label>Tell us what happened</label><textarea class="textarea" id="desc" maxlength="1000" placeholder="Give us as much detail as you can"></textarea></div>' +
        '<div class="hint err hide" id="err"></div><button class="btn btn-gold" id="send">Send ticket</button></div>';
      AR.$$('[data-c]', body).forEach(function (b) { b.addEventListener('click', function () { F.category = b.dataset.c; AR.$$('[data-c]', body).forEach(function (x) { x.classList.toggle('on', x === b); }); }); });
      var tripsList = [];
      function nameTrip() { var t = tripsList.filter(function (x) { return x.id === F.tripId; })[0]; AR.$('#tripname', body).textContent = t ? (AR.fmt.date(t.when) + ' · ' + t.to.split(',')[0]) : 'Not about a trip'; }
      AR.loadTrips(false).then(function (list) { tripsList = list; nameTrip(); }).catch(function () {});
      AR.$('#tripbtn', body).addEventListener('click', function () {
        AR.sheet.open({
          html: '<h2>Choose a trip</h2><p class="dim small">Pick the ride or parcel you need help with.</p><div class="mt16"><button class="reason ' + (F.tripId ? '' : 'on') + '" data-t=""><span class="radio"></span><span>Not about a trip</span></button>' +
            (tripsList.length ? tripsList.slice(0, 20).map(function (t) { return '<button class="reason ' + (t.id === F.tripId ? 'on' : '') + '" data-t="' + AR.esc(t.id) + '" style="align-items:flex-start"><span class="radio" style="margin-top:3px"></span><span style="min-width:0"><div class="ellipsis">' + AR.esc(t.to) + '</div><div class="small dim" style="font-weight:500">' + AR.esc(AR.fmt.dateTime(t.when)) + ' · ' + AR.fmt.money(t.fare) + ' · ' + AR.esc(t.isParcel ? 'Parcel' : t.tier) + '</div></span></button>'; }).join('') : '<p class="dim small">No trips yet.</p>') + '</div>',
          onOpen: function (c) { AR.$$('[data-t]', c.el).forEach(function (b) { b.addEventListener('click', function () { F.tripId = b.dataset.t; nameTrip(); c.close(); }); }); }
        });
      });
      function err(m) { var h = AR.$('#err', body); h.textContent = m || ''; h.classList.toggle('hide', !m); }
      var send = AR.$('#send', body);
      send.addEventListener('click', async function () {
        var subject = AR.$('#subject', body).value.trim(), desc = AR.$('#desc', body).value.trim(), trip = F.tripId;
        if (subject.length < 3) return err('Add a short subject (at least 3 letters).');
        if (desc.length < 10) return err('Tell us a little more (at least 10 characters).');
        send.classList.add('is-loading'); err('');
        try {
          var d = await AR.api('/tickets', { method: 'POST', body: { category: F.category, subject: subject, description: desc, tripId: trip || undefined } });
          AR.toast('Ticket sent. We will reply here.'); AR.nav.replace('ticket', { id: d.ticket.id });
        } catch (e) { err(e.message); send.classList.remove('is-loading'); }
      });
    }
  });

  AR.register('ticket', {
    mount: function (el, params) {
      var body = AR.page(el, 'Ticket'), timer = null;
      async function load() {
        try {
          var d = await AR.api('/tickets/' + params.id), k = d.ticket, closed = k.status === 'CLOSED';
          var msgs = [{ body: k.description, mine: true, at: k.createdAt }].concat((k.messages || []).map(function (m) { return { body: m.body, mine: m.authorRole === 'RIDER' || m.authorId === k.userId, at: m.createdAt }; }));
          var keep = AR.$('#reply', body) ? AR.$('#reply', body).value : '';
          body.innerHTML = '<div class="card"><div class="hstack gap8" style="justify-content:space-between"><span class="badge gold">' + AR.esc(CAT[k.category] || 'Ticket') + '</span><span class="badge ' + (k.status === 'RESOLVED' || closed ? 'steel' : '') + '">' + AR.esc(AR.fmt.cap(k.status)) + '</span></div><h3 class="mt12" style="font-size:19px">' + AR.esc(k.subject) + '</h3><div class="small dim mt8">Opened ' + AR.esc(AR.fmt.dateTime(k.createdAt)) + '</div></div>' +
            (k.resolution ? '<div class="suggest mt12">' + AR.icon('check', 20) + '<span><b>Resolution:</b> ' + AR.esc(k.resolution) + '</span></div>' : '') +
            '<div class="stack gap8 mt16">' + msgs.map(function (m) { return '<div style="align-self:' + (m.mine ? 'flex-end' : 'flex-start') + ';max-width:86%"><div class="card" style="padding:12px 14px;border-radius:16px;' + (m.mine ? 'background:rgba(var(--tint2-rgb), .22);border-color:rgba(var(--tint2-rgb), .4)' : '') + '">' + AR.esc(m.body) + '</div><div class="tiny faint" style="margin:4px 6px;text-align:' + (m.mine ? 'right' : 'left') + '">' + (m.mine ? 'You' : 'Aarohan support') + ' · ' + AR.esc(AR.relTime(m.at)) + '</div></div>'; }).join('') + '</div>' +
            (closed ? '<p class="center dim small mt24">This ticket is closed.</p>' : '<div class="hstack gap8 mt24"><input class="input" id="reply" placeholder="Write a reply" maxlength="1000" value="' + AR.esc(keep) + '"/><button class="icon-btn" id="rsend" aria-label="Send" style="width:52px;height:52px;border-radius:16px;background:var(--cta);color:var(--on-cta);border:0">' + AR.icon('send', 20) + '</button></div>');
          var rs = AR.$('#rsend', body);
          if (rs) rs.addEventListener('click', async function () {
            var v = AR.$('#reply', body).value.trim(); if (!v) return;
            rs.classList.add('is-loading');
            try { await AR.api('/tickets/' + params.id + '/messages', { method: 'POST', body: { body: v } }); AR.$('#reply', body).value = ''; await load(); } catch (e) { AR.toast(e.message, 'gold'); } finally { rs.classList.remove('is-loading'); }
          });
        } catch (e) { body.innerHTML = '<div class="empty"><h3>Could not open this ticket</h3><p>' + AR.esc(e.message) + '</p></div>'; }
      }
      body.innerHTML = '<div class="skeleton sk-row"></div>'; load();
      timer = setInterval(function () { if (!AR.$('#reply', body) || !AR.$('#reply', body).value) load(); }, 20000);
      return { destroy: function () { clearInterval(timer); } };
    }
  });

  // ----------------------------------------------------------- notifications
  var NICON = { TRIP: 'route', TICKET: 'ticket', INFO: 'bell' };
  AR.register('notifications', {
    mount: function (el) {
      var body = AR.page(el, 'Notifications');
      body.innerHTML = '<div class="skeleton sk-row"></div><div class="skeleton sk-row"></div>';
      (async function () {
        try {
          var d = await AR.api('/me/notifications'), seen = Number(localStorage.getItem('aarohan_notif_seen') || 0);
          var list = d.notifications || [];
          body.innerHTML = list.length ? '<div class="list stagger">' + list.map(function (n) {
            var fresh = new Date(n.at).getTime() > seen;
            return AR.row({ id: n.id, icon: NICON[n.type] || 'bell', title: n.title, sub: n.body, gold: fresh, end: '<span class="tiny dim">' + AR.esc(AR.relTime(n.at)) + '</span>' });
          }).join('') + '</div>' : '<div class="empty">' + AR.icon('bell', 44) + '<h3>No notifications yet</h3><p>Updates about your trips and tickets show up here.</p></div>';
          var map = {}; list.forEach(function (n) { map[n.id] = function () { if (n.tripId) AR.nav.go('trip-detail', { id: n.tripId }); else if (n.ticketId) AR.nav.go('ticket', { id: n.ticketId }); }; });
          AR.bindRows(body, map);
          try { localStorage.setItem('aarohan_notif_seen', String(Date.now())); } catch (_) {}
        } catch (e) { body.innerHTML = '<div class="empty"><h3>Could not load notifications</h3><p>' + AR.esc(e.message) + '</p></div>'; }
      })();
    }
  });

  // ---------------------------------------------------- rewards, coins, refer
  var rewards = null;
  async function loadRewards(force) { if (!rewards || force) rewards = await AR.api('/me/rewards'); return rewards; }

  AR.register('refer', {
    mount: function (el) {
      var body = AR.page(el, 'Refer and earn');
      body.innerHTML = '<div class="skeleton" style="height:160px"></div>';
      (async function () {
        try {
          var r = await loadRewards(true);
          var link = location.origin + '/rider/next/', msg = 'Join me on Aarohan for safe rides and parcels in Lilongwe. Use my code ' + r.referralCode + ' when you sign up. ' + link;
          body.innerHTML = '<div class="card center" style="padding:24px 16px"><div class="s-ic" style="width:56px;height:56px;margin:0 auto 12px;border-radius:18px;background:rgba(var(--tint-rgb), .12);color:var(--gold-300);display:flex;align-items:center;justify-content:center">' + AR.icon('gift', 28) + '</div><h2 style="font-size:24px">Give a friend Aarohan</h2><p class="dim mt8">Earn ' + r.perReferral + ' Aarohan coins when a friend you invite finishes their first trip.</p></div>' +
            '<div class="section-title">Your code</div><div class="code-box"><b>' + AR.esc(r.referralCode) + '</b><button class="btn btn-gold btn-sm" id="share">' + AR.icon('share', 18) + 'Share</button></div>' +
            '<button class="btn btn-line mt12" id="copy">' + AR.icon('copy', 20) + 'Copy code</button>' +
            '<div class="section-title">Your friends</div><div class="stats"><div class="stat"><b>' + r.referredCount + '</b><span>Joined</span></div><div class="stat"><b>' + r.qualifiedReferrals + '</b><span>Took a first trip</span></div><div class="stat"><b>' + (r.qualifiedReferrals * r.perReferral) + '</b><span>Coins earned</span></div></div>' +
            '<div class="section-title">How it works</div><div class="card stack gap16">' + [['Share your code', 'Send it to a friend in Lilongwe.'], ['They sign up', 'They enter your code when creating their account.'], ['You both ride', 'You get coins when they finish their first trip.']].map(function (s, i) { return '<div class="benefit"><span class="b-ic num" style="font-weight:700">' + (i + 1) + '</span><div><strong>' + s[0] + '</strong><span>' + s[1] + '</span></div></div>'; }).join('') + '</div>';
          AR.$('#share', body).addEventListener('click', function () { if (navigator.share) navigator.share({ title: 'Aarohan', text: msg }).catch(function () {}); else navigator.clipboard.writeText(msg).then(function () { AR.toast('Invite copied. Paste it to a friend.'); }); });
          AR.$('#copy', body).addEventListener('click', function () { navigator.clipboard.writeText(r.referralCode).then(function () { AR.toast('Code copied.'); }); });
        } catch (e) { body.innerHTML = '<div class="empty"><h3>Could not load</h3><p>' + AR.esc(e.message) + '</p></div>'; }
      })();
    }
  });

  function historyList(h) {
    return h.length ? '<div class="list">' + h.map(function (x) { return AR.row({ icon: x.type === 'REFERRAL' ? 'gift' : (x.type === 'PARCEL' ? 'parcel' : 'route'), title: x.title, sub: (x.detail ? x.detail + ' · ' : '') + AR.fmt.date(x.at), end: '<span class="num gold" style="font-weight:700">+' + x.coins + '</span>' }); }).join('') + '</div>'
      : '<div class="empty" style="padding:30px 12px">' + AR.icon('coin', 40) + '<h3>No coins yet</h3><p>Finish a trip to earn your first coins.</p></div>';
  }
  AR.register('coins', {
    mount: function (el) {
      var body = AR.page(el, 'Aarohan coins');
      body.innerHTML = '<div class="skeleton" style="height:160px"></div>';
      (async function () {
        try {
          var r = await loadRewards(true);
          body.innerHTML = '<div class="card center" style="padding:28px 16px;background:linear-gradient(160deg,var(--midnight-700),var(--midnight-800))"><div class="hstack gap8" style="justify-content:center;color:var(--gold-300)">' + AR.icon('coin', 26) + '<span class="small" style="font-weight:700">Your balance</span></div><div class="big-rating gold mt8" id="bal">0</div><div class="small dim mt8">' + (r.redeemable ? 'Ready to use' : 'You can start using coins soon') + '</div></div>' +
            '<div class="section-title">How to earn</div><div class="list">' + AR.row({ icon: 'route', title: 'Finish a trip', end: '<span class="gold" style="font-weight:700">+' + r.perTrip + '</span>' }) + AR.row({ icon: 'parcel', title: 'Get a parcel delivered', end: '<span class="gold" style="font-weight:700">+' + r.perTrip + '</span>' }) + AR.row({ icon: 'gift', title: 'A friend takes their first trip', end: '<span class="gold" style="font-weight:700">+' + r.perReferral + '</span>' }) + '</div>' +
            '<div class="section-title">History</div>' + historyList(r.history);
          var n = 0, target = r.coins, b = AR.$('#bal', body), step = Math.max(1, Math.ceil(target / 30));
          var t = setInterval(function () { n = Math.min(target, n + step); b.textContent = n.toLocaleString('en-US'); if (n >= target) clearInterval(t); }, 24);
        } catch (e) { body.innerHTML = '<div class="empty"><h3>Could not load</h3><p>' + AR.esc(e.message) + '</p></div>'; }
      })();
    }
  });

  AR.register('rewards', {
    mount: function (el) {
      var body = AR.page(el, 'My rewards');
      body.innerHTML = '<div class="skeleton" style="height:140px"></div>';
      (async function () {
        try {
          var r = await loadRewards(true), trips = r.history.filter(function (h) { return h.type !== 'REFERRAL'; }).length;
          body.innerHTML = '<div class="stats" style="margin-top:0"><div class="stat"><b>' + trips + '</b><span>Trips and parcels</span></div><div class="stat"><b>' + r.qualifiedReferrals + '</b><span>Friends who rode</span></div><div class="stat"><b>' + r.coins + '</b><span>Coins</span></div></div>' +
            '<div class="suggest">' + AR.icon('gift', 22) + '<span>Rewards you can spend are not open yet. Everything you earn now is saved, so nothing is lost.</span></div>' +
            '<div class="section-title">Rewards earned</div>' + historyList(r.history);
        } catch (e) { body.innerHTML = '<div class="empty"><h3>Could not load</h3><p>' + AR.esc(e.message) + '</p></div>'; }
      })();
    }
  });

  // ------------------------------------------------------- claims and payment
  AR.register('claims', {
    mount: function (el) {
      var body = AR.page(el, 'Claims');
      body.innerHTML = '<div class="empty" style="padding-top:90px">' + AR.icon('file', 52) + '<h3>No claims</h3><p>Nothing here yet.</p></div>';
    }
  });

  AR.register('payment', {
    mount: function (el) {
      var body = AR.page(el, 'Payment');
      body.innerHTML = '<div class="list">' + AR.row({ icon: 'wallet', gold: true, title: 'Cash', sub: 'Pay your captain at the end of the trip. For parcels, at pickup or delivery.', end: '<span class="badge steel">In use</span>' }) + '</div>' +
        '<div class="card mt16 small dim">Mobile money and cards are not available yet. We will add them here when they are ready.</div>';
    }
  });
})();
