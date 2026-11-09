// ============================================================================
// Aarohan Captain: camera screens.
//  - 'liveness': live face check (turn right, left, up, down in the order the server asks). No gallery, no uploads.
//  - 'scan': documents are photographed with the camera and checked for blur and light. No gallery.
// The head-turn detection (MediaPipe face landmarks) runs on the phone. It is a first filter: a person
// always reviews the frames before approval.
// ============================================================================
(function () {
  'use strict';
  var AR = window.AR, D = AR.D;
  var VISION = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
  var MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
  var LIVE = (AR.live = AR.live || { _det: null, thresholds: { yaw: 0.16, pitch: 0.13 } });

  // ---------------------------------------------------------------- camera
  function openCamera(facing) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return Promise.reject({ name: 'Unsupported' });
    return navigator.mediaDevices.getUserMedia({ video: facing === true ? true : { facingMode: facing, width: { ideal: 960 }, height: { ideal: 1280 } }, audio: false });
  }
  function cameraProblem(e) {
    var n = e && e.name;
    if (n === 'NotAllowedError' || n === 'SecurityError') return 'The camera is blocked. Tap the lock icon next to the web address, set Camera to Allow, then try again.';
    if (n === 'NotFoundError' || n === 'OverconstrainedError') return 'No camera was found on this device.';
    if (n === 'NotReadableError') return 'Another app is using the camera. Close it and try again.';
    if (n === 'Unsupported') return 'This browser cannot open the camera. Please use an up-to-date Chrome or Safari on your phone.';
    return 'The camera could not be opened. Please try again.';
  }
  function stopStream(s) { try { if (s) s.getTracks().forEach(function (t) { t.stop(); }); } catch (_) {} }
  function grab(video, maxW, mirror) {
    var w = video.videoWidth, h = video.videoHeight, k = Math.min(1, maxW / w), c = document.createElement('canvas');
    c.width = Math.round(w * k); c.height = Math.round(h * k); var x = c.getContext('2d');
    if (mirror) { x.translate(c.width, 0); x.scale(-1, 1); }
    x.drawImage(video, 0, 0, c.width, c.height); return c;
  }
  var toBlob = function (c, q) { return new Promise(function (r) { c.toBlob(r, 'image/jpeg', q || 0.85); }); };

  // ------------------------------------------------ face detector (loaded in the background, never blocks the driver)
  // Order: (1) files hosted on our own server (/vendor/mediapipe), (2) the public CDN, (3) none: the check then runs in
  // GUIDED mode (timed prompts, no automatic detection) and the photos are checked by a person.
  function withTimeout(p, ms) { return new Promise(function (res, rej) { var t = setTimeout(function () { rej(new Error('timeout')); }, ms); p.then(function (v) { clearTimeout(t); res(v); }, function (e) { clearTimeout(t); rej(e); }); }); }
  async function loadDetector(b) {
    var head = await fetch(b.model, { method: 'HEAD' }); if (!head.ok) throw new Error('model missing');
    var mod = await import(b.vision + '/vision_bundle.mjs');
    var fileset = await mod.FilesetResolver.forVisionTasks(b.vision + '/wasm');
    var lm;
    try { lm = await mod.FaceLandmarker.createFromOptions(fileset, { baseOptions: { modelAssetPath: b.model, delegate: 'GPU' }, runningMode: 'VIDEO', numFaces: 2 }); }
    catch (_) { lm = await mod.FaceLandmarker.createFromOptions(fileset, { baseOptions: { modelAssetPath: b.model, delegate: 'CPU' }, runningMode: 'VIDEO', numFaces: 2 }); }
    return {
      // Returns { faces, yaw, pitch, cx, cy, size } for the first face. yaw < 0 means the person turned to THEIR right.
      detect: function (video) {
        var r = lm.detectForVideo(video, performance.now()), f = r.faceLandmarks || [];
        if (!f.length) return { faces: 0 };
        var p = f[0], nose = p[1], re = p[33], le = p[263], eyeDist = Math.abs(le.x - re.x) || 0.0001;
        var mx = (re.x + le.x) / 2, my = (re.y + le.y) / 2, xs = p.map(function (q) { return q.x; }), ys = p.map(function (q) { return q.y; });
        return { faces: f.length, yaw: (nose.x - mx) / eyeDist, pitch: (nose.y - my) / eyeDist, cx: (Math.min.apply(null, xs) + Math.max.apply(null, xs)) / 2, cy: (Math.min.apply(null, ys) + Math.max.apply(null, ys)) / 2, size: Math.max.apply(null, xs) - Math.min.apply(null, xs) };
      }
    };
  }
  // Resolves to the detector, or to null when it cannot be loaded (never rejects, never waits more than about 25 seconds in total).
  LIVE.getDetector = async function () {
    if (LIVE._det) return LIVE._det;
    if (LIVE._failedAt && Date.now() - LIVE._failedAt < 60000) return null;
    if (!LIVE._loading) {
      LIVE._loading = (async function () {
        var bases = [{ vision: '/vendor/mediapipe', model: '/vendor/mediapipe/face_landmarker.task' }, { vision: VISION, model: MODEL }];
        for (var i = 0; i < bases.length; i++) { try { LIVE._det = await withTimeout(loadDetector(bases[i]), i === 0 ? 15000 : 12000); return LIVE._det; } catch (_) { /* try the next place */ } }
        LIVE._failedAt = Date.now(); return null;
      })().then(function (d) { LIVE._loading = null; return d; });
    }
    return LIVE._loading;
  };
  // Called early (when the driver opens the application) so the check starts instantly later.
  LIVE.preload = function () { try { LIVE.getDetector(); } catch (_) {} };

  var WORDS = { RIGHT: 'Turn your head to your RIGHT', LEFT: 'Turn your head to your LEFT', UP: 'Tilt your head UP', DOWN: 'Tilt your head DOWN' };
  var ARROWS = { RIGHT: 'Right &rarr;', LEFT: '&larr; Left', UP: 'Up &uarr;', DOWN: 'Down &darr;' };

  // ----------------------------------------------------------- live face check
  AR.register('liveness', {
    locked: true,
    mount: function (el) {
      var stream = null, alive = true, dev = !!(AR.state.cfg && AR.state.cfg.allowLocationSimulation);
      el.innerHTML = '<div class="topbar"><button class="icon-btn" data-back aria-label="Back">' + AR.icon('chevronLeft') + '</button><h1>Face check</h1></div><div class="scroll" id="lv"></div>';
      var host = AR.$('#lv', el);
      AR.$('[data-back]', el).addEventListener('click', function () { cleanup(); AR.nav.back(); });
      function cleanup() { alive = false; stopStream(stream); stream = null; }
      var wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

      function intro(msg, stuck) {
        host.innerHTML = '<div class="center" style="padding:10px 0"><div class="waiting-art" style="animation:none">' + AR.icon('user', 54) + '</div><h2 style="font-size:24px">Let us check it is really you</h2>' +
          '<p class="dim mt12">We will open your camera and ask you to turn your head right, left, up and down. It takes about 20 seconds.</p>' +
          (msg ? '<div class="suggest mt16" style="border-color:var(--gold-500);text-align:left">' + AR.icon('warning', 20) + '<span>' + AR.esc(msg) + '</span></div>' : '') +
          '<ul class="small dim mt16" style="text-align:left;line-height:1.7;padding-left:18px"><li>Find good light on your face</li><li>Take off sunglasses and any hat</li><li>Hold the phone at eye level</li></ul>' +
          '<button class="btn btn-gold mt24" id="open">' + (stuck ? 'Try again' : 'Open camera') + '</button>' +
          '<button class="btn ' + (stuck ? 'btn-line' : 'btn-ghost') + ' mt12" style="width:100%" id="alt">I cannot use my camera</button></div>';
        AR.$('#open', host).addEventListener('click', begin);
        AR.$('#alt', host).addEventListener('click', alternative);
      }

      // No camera, or the camera will not work: the driver is never stuck. The team verifies by a short video call instead.
      function alternative() {
        var reasons = ['My phone camera is broken', 'My phone has no front camera', 'The camera permission keeps failing', 'Something else'], pick = reasons[0];
        host.innerHTML = '<div class="center" style="padding:10px 0"><div class="waiting-art" style="animation:none">' + AR.icon('phone', 48) + '</div><h2 style="font-size:22px">No problem, we will verify you another way</h2><p class="dim mt12">Tell us what is wrong. Our team will call you for a short video check. You can carry on with your documents now.</p></div>' +
          '<div class="chips mt16" id="rs" style="justify-content:center">' + reasons.map(function (r, i) { return '<button class="chip ' + (i === 0 ? 'on' : '') + '" data-r="' + i + '">' + AR.esc(r) + '</button>'; }).join('') + '</div><div class="hint err hide center mt12" id="aerr"></div>' +
          '<button class="btn btn-gold mt24" id="send">Ask for a video check</button><button class="btn btn-ghost mt12" style="width:100%" id="back">Back to the camera</button>';
        AR.$$('[data-r]', host).forEach(function (b) { b.addEventListener('click', function () { pick = reasons[+b.dataset.r]; AR.$$('[data-r]', host).forEach(function (x) { x.classList.toggle('on', x === b); }); }); });
        AR.$('#back', host).addEventListener('click', function () { intro(''); });
        AR.$('#send', host).addEventListener('click', async function () {
          var btn = this; btn.classList.add('is-loading');
          try { await AR.api('/driver/liveness/alternative', { method: 'POST', body: { reason: pick } }); try { await AR.D.reloadApp(); } catch (_) {}
            host.innerHTML = '<div class="center" style="padding:40px 0"><div class="done-ring"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m5.5 12.5 4.3 4.3 8.7-9.6"/></svg></div><h2 style="font-size:24px">Video check requested</h2><p class="dim mt12">Our team will call you on your phone number for a short video check. Please keep your phone with you. Now continue with your documents.</p><button class="btn btn-gold mt24" id="done">Continue</button></div>';
            AR.$('#done', host).addEventListener('click', function () { AR.nav.back(); });
          } catch (e) { btn.classList.remove('is-loading'); var er = AR.$('#aerr', host); er.textContent = e.message; er.classList.remove('hide'); }
        });
      }

      async function begin() {
        alive = true;
        host.innerHTML = '<div class="center" style="padding:60px 0"><div class="spinner"></div><p class="dim">Asking for your camera...</p></div>';
        try { stream = await openCamera('user'); }
        catch (e) { try { stream = await openCamera(true); } catch (e2) { return intro(cameraProblem(e), true); } } // any camera is better than none
        host.innerHTML = '<div class="center" style="padding:60px 0"><div class="spinner"></div><p class="dim">Getting ready...</p></div>';
        var det = await LIVE.getDetector(); // null means: guided mode
        var ch; try { ch = await AR.api('/driver/liveness/start', { method: 'POST', body: {} }); } catch (e) { cleanup(); alive = true; return intro(e.message, true); }
        run(det, ch);
      }

      function stage() {
        host.innerHTML = '<div style="position:relative;width:100%;max-width:360px;margin:0 auto;aspect-ratio:3/4;border-radius:28px;overflow:hidden;background:#111"><video id="cam" playsinline muted autoplay style="width:100%;height:100%;object-fit:cover;transform:scaleX(-1)"></video>' +
          '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none"><div id="oval" style="width:62%;height:70%;border:3px solid rgba(255,255,255,.85);border-radius:50%;box-shadow:0 0 0 999px rgba(20,24,30,.35);transition:border-color .2s"></div></div>' +
          '<div id="arrow" style="position:absolute;left:0;right:0;top:12px;text-align:center;color:#fff;font-weight:700"></div><div id="count" style="position:absolute;left:0;right:0;bottom:14px;text-align:center;color:#fff;font-weight:800;font-size:44px;text-shadow:0 2px 8px rgba(0,0,0,.5)"></div></div>' +
          '<div class="center mt16"><div class="status-line" id="prompt">Look straight at the camera</div><div class="small dim mt8" id="hint">Keep your whole face inside the oval</div>' +
          '<div class="progress mt16"><i id="bar" style="width:0"></i></div><div class="tiny dim mt8" id="stepn"></div>' + (dev ? '<div class="tiny faint mt8" id="dbg"></div>' : '') + '</div>';
        var video = AR.$('#cam', host); video.srcObject = stream; return video;
      }

      async function run(det, ch) {
        var video = stage(); try { await video.play(); } catch (_) {}
        for (var w = 0; w < 50 && !video.videoWidth; w++) await wait(100);
        var steps = ch.steps, frames = [], metrics = [], t0 = performance.now(), base = null, T = LIVE.thresholds, guided = !det;
        var prompt = AR.$('#prompt', host), hint = AR.$('#hint', host), oval = AR.$('#oval', host), arrow = AR.$('#arrow', host), bar = AR.$('#bar', host), stepn = AR.$('#stepn', host), dbg = AR.$('#dbg', host), count = AR.$('#count', host);
        var snap = async function () { frames.push(await toBlob(grab(video, 720, false), 0.84)); AR.haptic(15); };
        try {
          if (guided) {
            // GUIDED MODE: the phone could not load the head-turn detector. Timed prompts, then a person checks the photos.
            hint.textContent = 'Follow the instructions. Our team will check your photos.';
            var counting = async function (n) { for (var k = n; k >= 1 && alive; k--) { count.textContent = k; await wait(1000); } count.textContent = ''; };
            prompt.textContent = 'Look straight at the camera'; stepn.textContent = 'Step 1 of ' + (steps.length + 1); await counting(3); if (!alive) return; await snap(); bar.style.width = (1 / (steps.length + 1)) * 100 + '%';
            for (var g = 0; g < steps.length && alive; g++) {
              prompt.textContent = WORDS[steps[g]]; arrow.innerHTML = '<span style="font-size:22px">' + ARROWS[steps[g]] + '</span>'; stepn.textContent = 'Step ' + (g + 2) + ' of ' + (steps.length + 1);
              await counting(3); if (!alive) return; metrics.push({ step: steps[g], at: Math.round(performance.now() - t0), guided: true }); await snap(); bar.style.width = ((g + 2) / (steps.length + 1)) * 100 + '%';
              prompt.textContent = 'Now look straight again'; arrow.textContent = ''; await wait(1200);
            }
          } else {
            var holdUntil = async function (test, hintText, timeoutMs) {
              var heldSince = 0, start = performance.now();
              while (alive) {
                if (performance.now() - start > timeoutMs) throw new Error('timeout');
                var r = det.detect(video); if (dbg && r.faces) dbg.textContent = 'yaw ' + r.yaw.toFixed(2) + ' pitch ' + r.pitch.toFixed(2);
                var msg = null;
                if (!r.faces) msg = 'We cannot see your face. Move into the oval.'; else if (r.faces > 1) msg = 'Only one person in the picture, please.'; else if (r.size < 0.18) msg = 'Move a little closer.'; else if (r.size > 0.75) msg = 'Move a little back.';
                if (msg) { hint.textContent = msg; oval.style.borderColor = '#C9CDD3'; heldSince = 0; }
                else { hint.textContent = hintText; var ok = test(r); oval.style.borderColor = ok ? '#7DBA8C' : 'rgba(255,255,255,.85)'; if (ok) { if (!heldSince) heldSince = performance.now(); if (performance.now() - heldSince > 650) return r; } else heldSince = 0; }
                await wait(70);
              }
              throw new Error('stopped');
            };
            prompt.textContent = 'Look straight at the camera'; stepn.textContent = 'Step 1 of ' + (steps.length + 1);
            var r0 = await holdUntil(function (r) { return Math.abs(r.yaw) < 0.08 && Math.abs(r.cx - 0.5) < 0.18; }, 'Keep your whole face inside the oval', 30000);
            base = { yaw: r0.yaw, pitch: r0.pitch }; await snap(); bar.style.width = (1 / (steps.length + 1)) * 100 + '%';
            for (var i = 0; i < steps.length; i++) {
              var st = steps[i];
              prompt.textContent = WORDS[st]; arrow.innerHTML = '<span style="font-size:22px">' + ARROWS[st] + '</span>'; stepn.textContent = 'Step ' + (i + 2) + ' of ' + (steps.length + 1);
              var test = st === 'RIGHT' ? function (r) { return r.yaw < base.yaw - T.yaw; } : st === 'LEFT' ? function (r) { return r.yaw > base.yaw + T.yaw; } : st === 'UP' ? function (r) { return r.pitch < base.pitch - T.pitch; } : function (r) { return r.pitch > base.pitch + T.pitch; };
              var rr = await holdUntil(test, 'Turn slowly and hold for a moment', 25000);
              metrics.push({ step: st, at: Math.round(performance.now() - t0), yaw: +rr.yaw.toFixed(3), pitch: +rr.pitch.toFixed(3) });
              await snap(); bar.style.width = ((i + 2) / (steps.length + 1)) * 100 + '%';
              prompt.textContent = 'Good. Now look straight again'; arrow.textContent = '';
              await holdUntil(function (r) { return Math.abs(r.yaw - base.yaw) < 0.09 && Math.abs(r.pitch - base.pitch) < 0.09; }, 'Look straight at the camera', 15000);
            }
          }
        } catch (e) {
          if (!alive) return; cleanup(); alive = true;
          // Detection could not follow the head turns in time: offer the guided way instead of a dead end.
          return intro(e.message === 'timeout' ? 'We could not see the head turns clearly. Move to a brighter place and try again. If it keeps happening, choose "I cannot use my camera" below.' : 'The face check stopped. Please try again.', true);
        }
        if (!alive) return;
        prompt.textContent = 'Checking...'; arrow.textContent = ''; hint.textContent = 'Please wait';
        var fd = new FormData(); fd.append('challengeId', ch.challengeId); fd.append('metrics', JSON.stringify(metrics));
        frames.forEach(function (b, k) { fd.append('frames', b, 'frame' + k + '.jpg'); });
        try {
          var res = await window.aarohanAuth.fetchWithAuth('/api/driver/liveness/submit', { method: 'POST', body: fd });
          var data = {}; try { data = await res.json(); } catch (_) {}
          if (!res.ok) throw new Error(data.error || 'The face check was not accepted.');
          cleanup(); try { await AR.D.reloadApp(); } catch (_) {}
          host.innerHTML = '<div class="center" style="padding:40px 0"><div class="done-ring"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m5.5 12.5 4.3 4.3 8.7-9.6"/></svg></div><h2 style="font-size:24px">Face check complete</h2><p class="dim mt12">Our team will review your photos together with your documents.</p><button class="btn btn-gold mt24" id="done">Continue</button></div>';
          AR.$('#done', host).addEventListener('click', function () { AR.nav.back(); });
        } catch (e) { cleanup(); alive = true; intro(e.message, true); }
      }
      intro('');
      return { destroy: cleanup };
    }
  });

  // ---------------------------------------------------------- document scanner
  // params: { type, label, hint }
  AR.register('scan', {
    locked: true,
    mount: function (el, params) {
      var stream = null, shot = null;
      el.innerHTML = '<div class="topbar"><button class="icon-btn" data-back aria-label="Back">' + AR.icon('chevronLeft') + '</button><h1>' + AR.esc(params.label || 'Scan document') + '</h1></div><div class="scroll" id="sc"></div>';
      var host = AR.$('#sc', el);
      AR.$('[data-back]', el).addEventListener('click', function () { stopStream(stream); AR.nav.back(); });
      function intro(msg) {
        host.innerHTML = '<div class="center" style="padding:10px 0"><div class="waiting-art" style="animation:none">' + AR.icon('file', 54) + '</div><h2 style="font-size:22px">' + AR.esc(params.label) + '</h2><p class="dim mt12">' + AR.esc(params.hint || '') + '</p><p class="small dim mt12">Take the photo with your camera. Photos from your gallery are not accepted.</p>' + (msg ? '<div class="suggest mt16" style="border-color:var(--gold-500);text-align:left">' + AR.icon('warning', 20) + '<span>' + AR.esc(msg) + '</span></div>' : '') + '<button class="btn btn-gold mt24" id="open">Open camera</button></div>';
        AR.$('#open', host).addEventListener('click', live);
      }
      async function live() {
        host.innerHTML = '<div class="center" style="padding:60px 0"><div class="spinner"></div></div>';
        try { stream = await openCamera('environment'); } catch (e) { return intro(cameraProblem(e)); }
        host.innerHTML = '<div style="position:relative;width:100%;max-width:420px;margin:0 auto;aspect-ratio:3/4;border-radius:24px;overflow:hidden;background:#111"><video id="cam" playsinline muted autoplay style="width:100%;height:100%;object-fit:cover"></video><div style="position:absolute;inset:8% 6%;border:3px dashed rgba(255,255,255,.85);border-radius:16px;pointer-events:none"></div></div><p class="center small dim mt12">Fit the whole document inside the frame. Avoid glare and shadows.</p><button class="btn btn-gold mt16" id="snap">Take photo</button><div class="hint err hide center mt12" id="err"></div>';
        var video = AR.$('#cam', host); video.srcObject = stream; try { await video.play(); } catch (_) {}
        AR.$('#snap', host).addEventListener('click', function () {
          if (!video.videoWidth) return;
          var c = grab(video, 1280, false), q = quality(c), err = AR.$('#err', host);
          if (!q.ok) { err.textContent = q.msg; err.classList.remove('hide'); return; }
          // Small files upload quickly on slow networks: about 150 KB is plenty to read a document.
          toBlob(c, 0.8).then(function (b) { return b.size > 380 * 1024 ? toBlob(c, 0.62) : b; }).then(function (b) { shot = b; stopStream(stream); stream = null; review(URL.createObjectURL(b)); });
        });
      }
      // Rejects photos that are too dark or too blurry to read (blur = low variance of the edges).
      function quality(c) {
        var s = document.createElement('canvas'), W = 240, H = Math.round(240 * c.height / c.width); s.width = W; s.height = H; var x = s.getContext('2d'); x.drawImage(c, 0, 0, W, H);
        var d = x.getImageData(0, 0, W, H).data, g = new Float32Array(W * H), sum = 0, i;
        for (i = 0; i < W * H; i++) { g[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]; sum += g[i]; }
        var mean = sum / (W * H); if (mean < 45) return { ok: false, msg: 'It is too dark. Find better light and try again.' }; if (mean > 245) return { ok: false, msg: 'It is too bright. Avoid glare and try again.' };
        var vals = [], m = 0, y, xx; for (y = 1; y < H - 1; y++) for (xx = 1; xx < W - 1; xx++) { var l = g[(y - 1) * W + xx] + g[(y + 1) * W + xx] + g[y * W + xx - 1] + g[y * W + xx + 1] - 4 * g[y * W + xx]; vals.push(l); m += l; }
        m /= vals.length; var v = 0; for (i = 0; i < vals.length; i++) v += (vals[i] - m) * (vals[i] - m); v /= vals.length;
        if (v < 18) return { ok: false, msg: 'The photo is blurry. Hold the phone steady and try again.' };
        return { ok: true };
      }
      function review(url) {
        host.innerHTML = '<img src="' + url + '" alt="Your photo" style="width:100%;max-width:420px;display:block;margin:0 auto;border-radius:18px;border:1px solid var(--line)"/><p class="center small dim mt12">Can you read every detail clearly?</p><div class="stack gap12 mt16"><button class="btn btn-gold" id="use">Use this photo</button><button class="btn btn-line" id="again">Take it again</button></div><div class="hint err hide center mt12" id="err"></div>';
        AR.$('#again', host).addEventListener('click', function () { URL.revokeObjectURL(url); live(); });
        AR.$('#use', host).addEventListener('click', function () {
          // Hand the photo to the background upload and go straight back: the driver does not wait.
          AR.D.uploads.start(params.type, shot); AR.haptic(15); AR.toast('Saved. Uploading in the background.'); AR.nav.back();
        });
      }
      intro('');
      return { destroy: function () { stopStream(stream); } };
    }
  });
})();
