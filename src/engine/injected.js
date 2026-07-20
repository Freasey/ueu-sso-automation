// Pembangun snippet JS yang di-inject ke halaman di dalam WebView.
// Konvensi: tiap snippet adalah EKSPRESI yang menghasilkan nilai (boleh
// Promise); SsoEngine.runInPage membungkusnya agar hasilnya dikirim balik via
// window.ReactNativeWebView.postMessage.

/** Ambil seluruh HTML halaman saat ini. */
export const PAGE_HTML = 'document.documentElement.outerHTML'

/** Isi & submit form login SSO. -> true bila form ditemukan. */
export function fillLoginForm(username, password) {
  return `(function(){
    var u = document.querySelector('input[name="username"]');
    var p = document.querySelector('input[name="password"]');
    if (!u || !p) return false;
    u.value = ${JSON.stringify(username)};
    p.value = ${JSON.stringify(password)};
    var f = p.form || u.form || document.querySelector('form');
    if (!f) return false;
    f.submit();
    return true;
  })()`
}

/**
 * Submit form yang action-nya cocok regex, dengan target dipaksa '_self'
 * supaya navigasi terjadi di WebView yang sama (form asli ber-target=_BLANK).
 * -> true bila form ditemukan.
 */
export function submitFormSelf(actionRegexSource) {
  return `(function(){
    var re = new RegExp(${JSON.stringify(actionRegexSource)});
    var f = [].slice.call(document.querySelectorAll('form')).filter(function(x){
      return re.test(x.action || '');
    })[0];
    if (!f) return false;
    f.target = '_self';
    f.submit();
    return true;
  })()`
}

/** fetch() same-origin -> teks respons. Dipakai untuk halaman aktivitas. */
export function fetchTextExpr(url) {
  return `fetch(${JSON.stringify(url)}, { credentials: 'same-origin' })
    .then(function(r){ return r.text() })`
}

/**
 * Ambil satu halaman Moodle, isi form-nya (pilih jawaban / set hidden field),
 * lalu POST form itu ke action-nya — semua di dalam page, tanpa menavigasi
 * WebView. Mengembalikan { url, html } dari respons akhir, atau { error, html }
 * bila form tidak ketemu.
 *
 * opts = {
 *   formSelector,             // default '#responseform'
 *   set,                      // { inputName: value } — radio/checkbox dicek
 *                             //   bila value cocok, selain itu di-uncheck;
 *                             //   field lain di-set .value; nama baru
 *                             //   ditambahkan sebagai hidden input.
 *   submitterName,            // nama tombol submit yang "ditekan"
 *   submitterValueIncludes,   // fallback: cocokkan tombol via teks value-nya
 *   chain: {                  // opsional: kalau respons form pertama TERNYATA
 *     formSelector,           //   berisi form lain yang cocok selector ini
 *     maxHops,                //   (mis. halaman konfirmasi "Time limit..."
 *   }                         //   Moodle), submit form itu juga — pakai HTML
 *                             //   yang SUDAH ada di memori, TANPA fetch/GET
 *                             //   ulang (halaman konfirmasi itu hasil POST,
 *                             //   bukan halaman yang bisa di-GET langsung).
 * }
 */
export function postMoodleFormExpr(pageUrl, opts = {}) {
  const cfg = {
    formSelector: opts.formSelector || '#responseform',
    set: opts.set || {},
    submitterName: opts.submitterName || null,
    submitterValueIncludes: opts.submitterValueIncludes || null,
    chain: opts.chain || null,
  }
  // Setiap tahap dibungkus try/catch dan dilabeli ('stage:...') supaya kalau
  // gagal, error yang sampai ke SsoEngine (lewat reject -> Error(message))
  // langsung menyebutkan di tahap mana masalahnya, bukan cuma "injected_error".
  return `(function(){
    var cfg = ${JSON.stringify(cfg)};

    function fillAndSubmit(html, baseUrl, formSelector, set, submitterName, submitterValueIncludes) {
      var doc;
      try { doc = new DOMParser().parseFromString(html, 'text/html'); }
      catch (e) { throw new Error('stage:domparser_failed — ' + (e && e.message || e)); }

      var form = doc.querySelector(formSelector);
      if (!form) return Promise.resolve({ error: 'no_form', html: html, url: baseUrl });

      try {
        Object.keys(set || {}).forEach(function(name){
          var val = String(set[name]);
          var sel = '[name="' + name.replace(/"/g, '\\\\"') + '"]';
          var nodes = [].slice.call(form.querySelectorAll(sel));
          if (!nodes.length) {
            var inp = doc.createElement('input');
            inp.type = 'hidden'; inp.name = name; inp.value = val;
            form.appendChild(inp);
            return;
          }
          nodes.forEach(function(n){
            if (n.type === 'radio' || n.type === 'checkbox') {
              n.checked = (String(n.value) === val);
            } else {
              n.value = val;
            }
          });
        });
      } catch (e) { throw new Error('stage:set_fields_failed — ' + (e && e.message || e)); }

      var submitter = null;
      try {
        var btns = [].slice.call(form.querySelectorAll('input[type=submit], button[type=submit], button:not([type])'));
        if (submitterName) {
          submitter = btns.filter(function(b){ return b.name === submitterName; })[0] || null;
        }
        if (!submitter && submitterValueIncludes) {
          var needle = submitterValueIncludes.toLowerCase();
          submitter = btns.filter(function(b){
            return ((b.value || b.textContent || '').toLowerCase().indexOf(needle) >= 0);
          })[0] || null;
        }
      } catch (e) { throw new Error('stage:find_submitter_failed — ' + (e && e.message || e)); }

      var fd;
      try {
        try { fd = new FormData(form, submitter || undefined); }
        catch (e) { fd = new FormData(form); }
        if (submitter && submitter.name && !fd.has(submitter.name)) {
          fd.append(submitter.name, submitter.value != null ? submitter.value : '1');
        }
      } catch (e) { throw new Error('stage:formdata_failed — ' + (e && e.message || e)); }

      var action = form.getAttribute('action') || baseUrl;
      return fetch(action, { method: 'POST', credentials: 'same-origin', body: fd })
        .then(function(resp){
          if (!resp.ok) throw new Error('stage:post_status_' + resp.status + ' url=' + resp.url);
          return resp.text().then(function(t){ return { url: resp.url, html: t }; });
        })
        .catch(function(e){
          if (String(e && e.message || e).indexOf('stage:') === 0) throw e;
          throw new Error('stage:post_failed — ' + (e && e.message || e));
        });
    }

    return fetch(${JSON.stringify(pageUrl)}, { credentials: 'same-origin' })
      .then(function(r){
        if (!r.ok) throw new Error('stage:get_status_' + r.status);
        return r.text();
      })
      .catch(function(e){ throw new Error('stage:get_failed — ' + (e && e.message || e)); })
      .then(function(html){
        return fillAndSubmit(html, ${JSON.stringify(pageUrl)}, cfg.formSelector, cfg.set, cfg.submitterName, cfg.submitterValueIncludes);
      })
      .then(function(res){
        if (!cfg.chain || !res || res.error || !res.html) return res;
        var maxHops = cfg.chain.maxHops || 1;
        var chainSelector = cfg.chain.formSelector || cfg.formSelector;

        function tryChain(cur, hop) {
          if (hop >= maxHops) return cur;
          var doc2;
          try { doc2 = new DOMParser().parseFromString(cur.html, 'text/html'); }
          catch (e) { return cur; }
          if (!doc2.querySelector(chainSelector)) return cur;
          // HTML sudah di memori (cur.html) — submit LANGSUNG, tanpa fetch/GET
          // ulang (halaman ini hasil POST sebelumnya, belum tentu bisa di-GET).
          return fillAndSubmit(cur.html, cur.url, chainSelector, {}, null, null)
            .then(function(next){ return tryChain(next, hop + 1); });
        }
        return tryChain(res, 0);
      });
  })()`
}

/** Panggilan AJAX internal Moodle (lib/ajax/service.php) -> entry pertama. */
export function moodleAjaxExpr(sesskey, methodname, args) {
  const url = `/lib/ajax/service.php?sesskey=${encodeURIComponent(sesskey)}&info=${methodname}`
  const body = JSON.stringify([{ index: 0, methodname, args }])
  return `fetch(${JSON.stringify(url)}, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: ${JSON.stringify(body)}
  }).then(function(r){ return r.json() }).then(function(j){ return j && j[0] })`
}
