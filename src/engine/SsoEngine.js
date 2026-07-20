// SsoEngine — Pola A on-device. WebView tersembunyi menggantikan
// Chrome+Playwright dari project asal: login SSO, handshake ke Moodle, lalu
// semua data diambil via fetch same-origin yang di-inject ke halaman
// e-learning. Saat Cloudflare menantang, WebView ditampilkan (modal) sampai
// user lolos, lalu disembunyikan lagi. Lihat ueu-mobile-app-plan.md §5.
import { createContext, useContext, useRef, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { WebView } from 'react-native-webview'
import { COURSES_URL, DASHBOARD_URL, ELEARNING_ORIGIN, SSO_ORIGIN } from './constants'
import {
  PAGE_HTML,
  fetchTextExpr,
  fillLoginForm,
  moodleAjaxExpr,
  postMoodleFormExpr,
  submitFormSelf,
} from './injected'
import {
  extractSesskey,
  extractUserId,
  isAuthenticated,
  isCloudflareWall,
  isCredentialError,
} from '../parsing/detect'
import { parseUser } from '../parsing/user'
import { parseCourseName, parseCourses } from '../parsing/courses'
import { parseAssign } from '../parsing/assign'
import { parseQuiz } from '../parsing/quiz'
import { parseForum } from '../parsing/forum'
import {
  classifyQuizPage,
  findContinueAttemptUrl,
  findStartAttemptAction,
} from '../parsing/quizAttempt'
import { parseActivityDates } from '../parsing/dates'
import { strip } from '../parsing/html'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Log tracing alur quiz — tampil di terminal Metro (npx expo start).
const QUIZ_DEBUG = true
const qlog = (...args) => {
  if (QUIZ_DEBUG) console.log('[quiz]', ...args)
}

function failure({ blocked = false, reason, finalUrl = null }) {
  return { success: false, blocked, reason, finalUrl, user: null, courses: [] }
}

class Engine {
  constructor() {
    this.host = null // diisi provider: { inject(js), setVisible(bool) }
    this.pending = new Map() // id -> { resolve, reject, timer }
    this.seq = 0
    this.url = 'about:blank'
    this.loading = false
    this.lastLoadEnd = 0
    this.creds = null // in-memory; TODO: expo-secure-store (opt-in)
    this.sesskey = null
    this.userid = null
    this.reloginPromise = null
    // Antrean job dengan konkurensi terbatas supaya tidak memicu rate-limit /
    // Cloudflare (rencana §5: maks 4 fetch aktivitas sekaligus).
    this.queue = []
    this.active = 0
    this.maxConcurrent = 4
  }

  // --- Wiring dari WebView ---------------------------------------------------

  onMessage(raw) {
    let msg
    try {
      msg = JSON.parse(raw)
    } catch {
      return
    }
    if (!msg || msg.__sso !== 1) return
    const p = this.pending.get(msg.id)
    if (!p) return
    this.pending.delete(msg.id)
    clearTimeout(p.timer)
    if (msg.ok) p.resolve(msg.value)
    else p.reject(new Error(msg.value || 'injected_error'))
  }

  onNav(url, loading) {
    this.url = url || this.url
    this.loading = !!loading
  }

  onLoadEnd(url) {
    if (url) this.url = url
    this.loading = false
    this.lastLoadEnd = Date.now()
  }

  // --- Primitif komunikasi & navigasi ---------------------------------------

  /** Jalankan EKSPRESI JS di halaman; hasil (boleh Promise) dikirim balik. */
  runInPage(expr, { timeout = 30_000 } = {}) {
    const id = `sso_${++this.seq}`
    const wrapped = `(function(){
      var send = function(ok, value){
        window.ReactNativeWebView.postMessage(JSON.stringify({ __sso: 1, id: ${JSON.stringify(id)}, ok: ok, value: value }));
      };
      try {
        Promise.resolve((function(){ return (${expr}); })())
          .then(function(v){ send(true, v); }, function(e){ send(false, String((e && e.message) || e)); });
      } catch (e) { send(false, String((e && e.message) || e)); }
    })(); true;`

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('injected_timeout'))
      }, timeout)
      this.pending.set(id, { resolve, reject, timer })
      this.host.inject(wrapped)
    })
  }

  getHtml() {
    return this.runInPage(PAGE_HTML, { timeout: 15_000 })
  }

  /**
   * Tunggu sampai halaman "tenang": tidak loading dan sudah >= minQuiet ms
   * sejak load terakhir selesai. Panggil markNavigating() dulu bila navigasi
   * baru akan dipicu (submit form / ganti URL).
   */
  markNavigating() {
    this.lastLoadEnd = 0
    this.loading = true
  }

  waitForSettle({ timeout = 60_000, minQuiet = 800, until = null } = {}) {
    const started = Date.now()
    return new Promise((resolve, reject) => {
      const check = () => {
        const quiet =
          !this.loading && this.lastLoadEnd && Date.now() - this.lastLoadEnd >= minQuiet
        if (quiet && (!until || until(this.url))) return resolve(this.url)
        if (Date.now() - started > timeout) return reject(new Error('nav_timeout'))
        setTimeout(check, 250)
      }
      setTimeout(check, 300)
    })
  }

  async navigate(url, opts = {}) {
    this.markNavigating()
    this.host.inject(`window.location.href = ${JSON.stringify(url)}; true;`)
    return this.waitForSettle(opts)
  }

  // --- Cloudflare ------------------------------------------------------------

  /**
   * Tampilkan WebView (modal) sampai halaman lolos dari wall Cloudflare, lalu
   * sembunyikan lagi. cf_clearance tersimpan di cookie storage WebView yang
   * persisten antar-run. -> true bila lolos.
   */
  async solveChallenge({ timeout = 180_000 } = {}) {
    this.host.setVisible(true)
    try {
      const deadline = Date.now() + timeout
      while (Date.now() < deadline) {
        await sleep(1500)
        const html = await this.getHtml().catch(() => '')
        if (html && !isCloudflareWall(html)) return true
      }
      return false
    } finally {
      this.host.setVisible(false)
    }
  }

  /** Ambil HTML halaman saat ini; kalau kena wall, minta user lolos dulu. */
  async getHtmlPastChallenge() {
    let html = await this.getHtml()
    if (isCloudflareWall(html)) {
      const passed = await this.solveChallenge()
      if (!passed) return null
      html = await this.getHtml()
    }
    return isCloudflareWall(html) ? null : html
  }

  // --- Login (Stage 1–3, pemetaan 1:1 dari ssoLogin project asal) ------------

  async login({ username, password }) {
    this.creds = { username, password }
    this.sesskey = null

    // Stage 0: buka SSO; selesaikan challenge bila ada.
    await this.navigate(`${SSO_ORIGIN}/`).catch(() => {})
    let html = await this.getHtmlPastChallenge()
    if (html == null) return failure({ blocked: true, reason: 'cloudflare', finalUrl: this.url })

    // Stage 1: isi & submit form login (lewati bila sesi SSO masih hidup).
    if (!/\/dashboard/.test(this.url)) {
      const hasForm = await this.runInPage(fillLoginForm(username, password))
      if (!hasForm) return failure({ reason: 'session', finalUrl: this.url })
      this.markNavigating()
      await this.waitForSettle().catch(() => {})

      html = await this.getHtmlPastChallenge()
      if (html == null) return failure({ blocked: true, reason: 'cloudflare', finalUrl: this.url })

      // Gagal jelas: masih di halaman login / ada teks error kredensial.
      if (!/\/dashboard/.test(this.url)) {
        if (isCredentialError(html)) return failure({ reason: 'credentials', finalUrl: this.url })
        return failure({ reason: 'session', finalUrl: this.url })
      }
    }

    // Stage 2: handshake SSO->Moodle. Form dashboard ber-target=_BLANK;
    // dipaksa _self supaya tetap di WebView ini. Rantai form auto-submit
    // membawa kita ke origin e-learning.
    const submitted = await this.runInPage(submitFormSelf('\\/dashboard\\/moodle'))
    if (!submitted) return failure({ reason: 'session', finalUrl: this.url })
    this.markNavigating()

    const onElearning = (url) => url.indexOf(ELEARNING_ORIGIN) === 0
    await this.waitForSettle({ until: onElearning, timeout: 60_000 }).catch(async () => {
      // Halaman perantara tidak auto-submit? Dorong manual.
      await this.runInPage(submitFormSelf('login\\/index\\.php')).catch(() => {})
      this.markNavigating()
      await this.waitForSettle({ until: onElearning, timeout: 60_000 })
    }).catch(() => {})
    if (!onElearning(this.url)) {
      return failure({ reason: 'session', finalUrl: this.url })
    }

    // Mendarat di e-learning; pastikan di halaman courses.
    if (!/\/my\/courses\.php/.test(this.url)) {
      await this.navigate(COURSES_URL).catch(() => {})
    }
    html = await this.getHtmlPastChallenge()
    if (html == null) return failure({ blocked: true, reason: 'cloudflare', finalUrl: this.url })
    if (!isAuthenticated(html)) return failure({ reason: 'session', finalUrl: this.url })

    // Stage 3: sesi terkonfirmasi — user + sesskey + daftar course (AJAX JSON
    // dulu, fallback scrape markup).
    const user = parseUser(html)
    this.sesskey = extractSesskey(html)
    this.userid = extractUserId(html)

    let courses = null
    if (this.sesskey) courses = await this.fetchCoursesJson().catch(() => null)
    if (!courses || courses.length === 0) {
      const scraped = parseCourses(html)
      if (scraped.length) courses = scraped
    }
    courses = courses || []

    return {
      success: true, // login adalah sinyal sukses, BUKAN jumlah course
      blocked: false,
      reason: courses.length ? null : 'no-courses',
      finalUrl: this.url,
      user,
      courses,
    }
  }

  async fetchCoursesJson() {
    const entry = await this.runInPage(
      moodleAjaxExpr(this.sesskey, 'core_course_get_enrolled_courses_by_timeline_classification', {
        offset: 0,
        limit: 0,
        classification: 'all',
        sort: 'fullname',
      }),
    )
    if (!entry || entry.error) return null
    return (entry.data?.courses || []).map((c) => ({
      id: String(c.id),
      url: c.viewurl || `${ELEARNING_ORIGIN}/course/view.php?id=${c.id}`,
      raw: c.fullname,
      shortname: c.shortname,
      ...parseCourseName(c.fullname || ''),
    }))
  }

  // --- Re-login diam-diam saat sesi kadaluarsa -------------------------------

  /** Single-flight: banyak job boleh menunggu satu re-login yang sama. */
  relogin() {
    if (!this.creds) return Promise.reject(new Error('not_authenticated'))
    if (!this.reloginPromise) {
      this.reloginPromise = this.login(this.creds).finally(() => {
        this.reloginPromise = null
      })
    }
    return this.reloginPromise
  }

  // --- Antrean job (konkurensi terbatas) -------------------------------------

  enqueue(fn) {
    return new Promise((resolve, reject) => {
      this.queue.push({ fn, resolve, reject })
      this.pump()
    })
  }

  pump() {
    while (this.active < this.maxConcurrent && this.queue.length) {
      const job = this.queue.shift()
      this.active++
      job
        .fn()
        .then(job.resolve, job.reject)
        .finally(() => {
          this.active--
          this.pump()
        })
    }
  }

  // --- Data terstruktur (Stage 3 rencana §4) ---------------------------------

  /** fetch same-origin dari dalam halaman e-learning. */
  fetchText(url) {
    return this.runInPage(fetchTextExpr(url))
  }

  /** Courseformat state JSON; refresh sesskey basi sekali (pola project asal). */
  async getCourseState(courseid) {
    const call = () =>
      this.runInPage(
        moodleAjaxExpr(this.sesskey, 'core_courseformat_get_state', {
          courseid: Number(courseid),
        }),
      )

    let entry = await call()
    if (
      entry?.error &&
      /sesskey|session key|invalidsesskey/i.test(JSON.stringify(entry.exception || ''))
    ) {
      const html = await this.fetchText(`${ELEARNING_ORIGIN}/course/view.php?id=${courseid}`)
      this.sesskey = extractSesskey(html) || this.sesskey
      this.userid = extractUserId(html) || this.userid
      entry = await call()
    }
    if (!entry || entry.error) return null
    return JSON.parse(entry.data)
  }

  /**
   * Course OUTLINE — struktur cepat (1 panggilan AJAX): sesi + item
   * assign/quiz/forum (type, name, url, cmid), tanpa status.
   */
  getOutline(courseid) {
    return this.enqueue(async () => {
      if (!this.sesskey) throw new Error('not_authenticated')
      const state = await this.getCourseState(courseid)
      if (!state) throw new Error('course_state_unavailable')

      const cmById = Object.fromEntries(state.cm.map((c) => [String(c.id), c]))
      const RELEVANT = /\/mod\/(assign|quiz|forum)\//
      const sessions = []

      for (const sec of state.section) {
        if (sec.visible === false) continue
        const items = sec.cmlist
          .map((id) => cmById[String(id)])
          .filter(
            (cm) =>
              cm && cm.uservisible !== false && cm.visible !== false && RELEVANT.test(cm.url || ''),
          )
          .map((cm) => ({
            type: RELEVANT.exec(cm.url)[1],
            name: cm.name,
            url: cm.url,
            cmid: String(cm.id),
          }))

        if (items.length) sessions.push({ number: sec.number, title: strip(sec.title), items })
      }

      return { id: String(courseid), sessions }
    })
  }

  /**
   * Status + tanggal SATU aktivitas dari halamannya. `done` dinormalisasi:
   * tugas = submitted, quiz = ada attempt Finished, forum = >=1 diskusi
   * ter-subscribe. Sesi kadaluarsa -> re-login diam-diam + retry sekali.
   */
  getActivityStatus({ type, url }) {
    return this.enqueue(async () => {
      if (!type || !url) throw new Error('bad_request')

      let html = await this.fetchText(url)
      if (isCloudflareWall(html)) throw new Error('cloudflare')
      if (!isAuthenticated(html)) {
        await this.relogin()
        html = await this.fetchText(url)
      }

      const dates = parseActivityDates(html)
      if (type === 'assign') {
        const a = parseAssign(html)
        return { ...a, ...dates, done: a.submitted }
      }
      if (type === 'quiz') {
        const q = parseQuiz(html)
        return { ...q, ...dates, done: q.attempts.some((at) => /finished/i.test(at.state)) }
      }
      return { ...parseForum(html), ...dates }
    })
  }

  // --- Mengerjakan quiz (jawab + submit langsung) ----------------------------
  // Sempat dicoba pindah ke JSON (mod_quiz_* lewat lib/ajax/service.php, pola
  // sama dengan core_courseformat_get_state di getOutline) tapi server ini
  // menolak dengan "servicenotavailable" untuk core_course_get_course_module —
  // artinya fungsi itu (dan kemungkinan besar mod_quiz_* juga) tidak
  // di-whitelist di endpoint AJAX sesi ini (beda dengan API bertoken yang
  // dipakai app mobile resmi Moodle, yang butuh alur otentikasi terpisah).
  // Jadi tetap pakai scraping HTML/form di bawah ini.

  /** Ambil HTML halaman e-learning; relogin diam-diam sekali bila sesi habis. */
  async fetchAuthed(url) {
    qlog('fetchAuthed: GET', url)
    let html
    try {
      html = await this.fetchText(url)
    } catch (e) {
      qlog('fetchAuthed: fetchText THREW', e.message)
      throw e
    }
    qlog('fetchAuthed: got', html?.length, 'chars')
    if (isCloudflareWall(html)) {
      qlog('fetchAuthed: hit Cloudflare wall')
      throw new Error('cloudflare')
    }
    if (!isAuthenticated(html)) {
      qlog('fetchAuthed: session looks logged-out, relogin…')
      await this.relogin()
      html = await this.fetchText(url)
      if (isCloudflareWall(html)) {
        qlog('fetchAuthed: Cloudflare wall after relogin')
        throw new Error('cloudflare')
      }
      if (!isAuthenticated(html)) {
        qlog('fetchAuthed: still not authenticated after relogin')
        throw new Error('not_authenticated')
      }
      qlog('fetchAuthed: relogin OK')
    }
    return html
  }

  /**
   * Halaman muka quiz (view.php) TANPA menyentuh attempt: riwayat attempt,
   * tanggal, aturan (attempts allowed / time limit / grading method,
   * best-effort), dan aksi yang tersedia (lanjut/mulai). Dipakai layar intro
   * sebelum user menekan "Mulai".
   */
  getQuizInfo(viewUrl) {
    return this.enqueue(async () => {
      qlog('info: fetching', viewUrl)
      const html = await this.fetchAuthed(viewUrl)
      const rules = {}
      for (const [key, re] of [
        ['attemptsAllowed', /Attempts allowed:\s*([^<]+)/i],
        ['timeLimit', /Time limit:\s*([^<]+)/i],
        ['gradingMethod', /Grading method:\s*([^<]+)/i],
      ]) {
        const m = re.exec(html)
        if (m) rules[key] = strip(m[1])
      }
      const result = {
        ...parseQuiz(html),
        ...parseActivityDates(html),
        ...rules,
        canContinue: !!findContinueAttemptUrl(html),
        canStart: !!findStartAttemptAction(html),
      }
      qlog('info: result =', {
        attempts: result.attempts?.length,
        canContinue: result.canContinue,
        canStart: result.canStart,
      })
      return result
    })
  }

  /**
   * Masuk ke attempt quiz: lanjutkan attempt yang berjalan bila ada, kalau
   * tidak mulai attempt baru via startattempt.php. -> { url, ...page } dengan
   * page hasil classifyQuizPage (kind: question/summary/review/unknown).
   * (Tanpa antrean — dipakai internal oleh getQuizEntry/getQuizFull.)
   */
  async quizEntryJob(viewUrl) {
    qlog('entry: GET view', viewUrl)
    let html
    try {
      html = await this.fetchAuthed(viewUrl)
    } catch (e) {
      qlog('entry: fetchAuthed(view) FAILED', e.message)
      throw e
    }

    const cont = findContinueAttemptUrl(html)
    const startAction = findStartAttemptAction(html)
    qlog('entry: continueUrl=', cont, 'startAction=', startAction)

    if (cont) {
      qlog('entry: continuing existing attempt ->', cont)
      let contHtml
      try {
        contHtml = await this.fetchAuthed(cont)
      } catch (e) {
        qlog('entry: fetchAuthed(continue) FAILED', e.message)
        throw e
      }
      const page = classifyQuizPage(contHtml)
      qlog('entry: continue -> kind=', page.kind)
      return { url: cont, ...page }
    }

    if (startAction) {
      qlog('entry: starting new attempt via', startAction)
      // Beberapa quiz (mis. berwaktu) menampilkan halaman konfirmasi
      // ("Time limit... you must...") sebagai HASIL dari POST pertama —
      // bukan halaman yang bisa di-GET terpisah. chain: submit form kedua
      // itu langsung dari HTML yang sudah didapat, tanpa fetch ulang.
      let res
      try {
        res = await this.runInPage(
          postMoodleFormExpr(viewUrl, {
            formSelector: 'form[action*="startattempt"]',
            chain: { formSelector: 'form[action*="startattempt"]', maxHops: 2 },
          }),
          { timeout: 45_000 },
        )
      } catch (e) {
        qlog('entry: startattempt runInPage THREW', e.message)
        throw e
      }
      qlog('entry: startattempt result =', res && {
        url: res.url,
        error: res.error,
        htmlLen: res.html?.length,
      })
      if (res && res.html && !res.error) {
        const page = classifyQuizPage(res.html)
        qlog('entry: start -> kind=', page.kind)
        if (page.kind === 'unknown') qlog('entry: unknown-page notice =', page.notice)
        return { url: res.url || viewUrl, ...page }
      }
      qlog('entry: startattempt did not return usable html — falling through to noentry')
    }

    // Tidak bisa memulai (mis. sudah habis attempt / butuh password) —
    // biar UI menawarkan buka di browser.
    qlog('entry: noentry (no continue link, no start form found/usable)')
    return { kind: 'noentry', url: viewUrl, raw: html }
  }

  getQuizEntry(viewUrl) {
    return this.enqueue(() => this.quizEntryJob(viewUrl))
  }

  /**
   * Seperti getQuizEntry, tapi memuat SEMUA halaman soal attempt sekaligus
   * (GET attempt.php?page=N tidak memproses jawaban, hanya menampilkan).
   * -> { kind:'question', pages:[{ url, questions, ... } terurut] } atau
   * hasil quizEntryJob apa adanya untuk kind lain. Halaman yang gagal dibaca
   * (mis. quiz bernavigasi sekuensial) dilewati.
   */
  getQuizFull(viewUrl) {
    return this.enqueue(async () => {
      qlog('full: starting for', viewUrl)
      const entry = await this.quizEntryJob(viewUrl)
      qlog('full: entry kind=', entry.kind, 'url=', entry.url, 'page=', entry.page)
      if (entry.kind !== 'question') {
        qlog('full: entry is not a question page, returning as-is')
        return entry
      }

      const total = entry.page?.total || 1
      const current = (entry.page?.current || 1) - 1
      const pageUrl = (n) => {
        const base = entry.url.replace(/([?&])page=\d+(&?)/, (m, pre, post) =>
          post ? pre : '',
        )
        return `${base}${base.includes('?') ? '&' : '?'}page=${n}`
      }

      qlog('full: fetching', total, 'page(s), current index=', current)
      const pages = new Array(total)
      pages[current] = entry
      for (let n = 0; n < total; n++) {
        if (pages[n]) continue
        const url = pageUrl(n)
        try {
          const p = classifyQuizPage(await this.fetchAuthed(url))
          qlog('full: page', n, '->', url, 'kind=', p.kind, 'questions=', p.questions?.length)
          if (p.kind === 'question') pages[n] = { url, ...p }
          else qlog('full: page', n, 'was not a question page (kind=', p.kind, ') — skipped')
        } catch (e) {
          qlog('full: page', n, 'fetch FAILED —', e.message, '— skipped')
        }
      }

      const result = {
        kind: 'question',
        url: entry.url,
        timeLeft: entry.timeLeft,
        pages: pages.filter(Boolean),
      }
      qlog('full: done —', result.pages.length, '/', total, 'page(s) loaded,',
        result.pages.reduce((n, p) => n + p.questions.length, 0), 'question(s) total')
      return result
    })
  }

  /**
   * Kirim satu halaman soal: isi jawaban lalu tekan tombol navigasi (default
   * 'next'). answers = { inputName: value }. -> { url, ...page } berikutnya.
   */
  submitQuizPage({ pageUrl, answers = {}, button = 'next' }) {
    return this.enqueue(async () => {
      qlog('submit: POST', pageUrl, 'button=', button, 'answers=', answers)
      let res
      try {
        res = await this.runInPage(
          postMoodleFormExpr(pageUrl, {
            formSelector: '#responseform',
            set: answers,
            submitterName: button,
          }),
          { timeout: 45_000 },
        )
      } catch (e) {
        qlog('submit: runInPage THREW —', e.message)
        throw e
      }
      qlog('submit: result =', res && { url: res.url, error: res.error, htmlLen: res.html?.length })
      if (!res || res.error || !res.html) throw new Error(res?.error || 'submit_failed')
      const page = classifyQuizPage(res.html)
      qlog('submit: next page kind=', page.kind)
      return { url: res.url || pageUrl, ...page }
    })
  }

  /** Finalisasi attempt dari halaman summary ("Submit all and finish"). */
  finishAttempt(summaryUrl) {
    return this.enqueue(async () => {
      qlog('finish: POST', summaryUrl)
      let res
      try {
        res = await this.runInPage(
          postMoodleFormExpr(summaryUrl, {
            formSelector: 'form[action*="processattempt"]',
            set: { finishattempt: '1' },
            submitterValueIncludes: 'submit all',
          }),
          { timeout: 45_000 },
        )
      } catch (e) {
        qlog('finish: runInPage THREW —', e.message)
        throw e
      }
      qlog('finish: result =', res && { url: res.url, error: res.error, htmlLen: res.html?.length })
      if (!res || res.error || !res.html) throw new Error(res?.error || 'finish_failed')
      const page = classifyQuizPage(res.html)
      qlog('finish: landed on kind=', page.kind)
      return { url: res.url || summaryUrl, ...page }
    })
  }
}

// --- Provider + WebView host -------------------------------------------------

const EngineContext = createContext(null)

export function useEngine() {
  return useContext(EngineContext)
}

export function SsoEngineProvider({ children }) {
  const webViewRef = useRef(null)
  const engineRef = useRef(null)
  const [visible, setVisible] = useState(false)

  if (!engineRef.current) engineRef.current = new Engine()
  const engine = engineRef.current
  engine.host = {
    inject: (js) => webViewRef.current?.injectJavaScript(js),
    setVisible,
  }

  return (
    <EngineContext.Provider value={engine}>
      <View style={styles.fill}>
        {children}

        {/* WebView selalu ter-mount (engine hidup); hanya visibilitasnya yang
            berubah saat challenge Cloudflare perlu diselesaikan user. */}
        <View
          style={visible ? styles.challenge : styles.hidden}
          pointerEvents={visible ? 'auto' : 'none'}
        >
          {visible && (
            <View style={styles.challengeHead}>
              <Text style={styles.challengeTitle}>Verifikasi keamanan</Text>
              <Text style={styles.challengeText}>
                Cloudflare minta verifikasi sekali — tap kotaknya, layar ini menutup sendiri.
              </Text>
            </View>
          )}
          <WebView
            ref={webViewRef}
            source={{ uri: 'about:blank' }}
            onMessage={(e) => engine.onMessage(e.nativeEvent.data)}
            onNavigationStateChange={(nav) => engine.onNav(nav.url, nav.loading)}
            onLoadEnd={(e) => engine.onLoadEnd(e.nativeEvent.url)}
            // Cookie persisten = cf_clearance & sesi bertahan antar-run.
            incognito={false}
            sharedCookiesEnabled
            thirdPartyCookiesEnabled
            javaScriptEnabled
            domStorageEnabled
            // target=_BLANK / window.open tetap di WebView ini (fallback dari
            // rewrite target='_self' di injected.js).
            setSupportMultipleWindows={false}
            style={styles.fill}
          />
        </View>
      </View>
    </EngineContext.Provider>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  // Tersembunyi tapi tetap dirender: ukuran kecil + hampir transparan supaya
  // OS tidak mem-pause halaman.
  hidden: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: 3,
    height: 3,
    opacity: 0.02,
  },
  challenge: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#fff',
    zIndex: 10,
  },
  challengeHead: {
    paddingTop: 48,
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: '#0f172a',
  },
  challengeTitle: { color: '#fff', fontWeight: '700', fontSize: 16 },
  challengeText: { color: '#cbd5e1', fontSize: 13, marginTop: 4 },
})
