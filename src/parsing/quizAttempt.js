// Parser untuk halaman soal quiz (mod/quiz/attempt.php) — verified terhadap
// sample HTML asli (tema remui, qtype multichoice). Bagian summary/review
// (mod/quiz/summary.php, mod/quiz/review.php) masih heuristik kasar
// (classifyQuizPage) sampai ada sample HTML asli untuk itu.
import { matchDivEnd, strip } from './html'

// Label tombol navigasi yang kita kenali di halaman attempt.
const NAV_LABELS = /^(next|previous|finish attempt|submit all and finish)/i

function parseAnswerRows(answerHtml) {
  const rows = []
  const inputRe = /<input\b[^>]*>/gi
  let m
  while ((m = inputRe.exec(answerHtml))) {
    const tag = m[0]
    const type = /type="(radio|checkbox)"/i.exec(tag)?.[1]
    if (!type) continue
    const name = /name="([^"]+)"/i.exec(tag)?.[1]
    const value = /value="([^"]*)"/i.exec(tag)?.[1]
    const id = /\bid="([^"]+)"/i.exec(tag)?.[1]
    const checked = /\bchecked(=("|')?checked\2)?\b/i.test(tag)

    // Teks pilihan ada di div berlabel `id="{id}_label"`, terpisah dari input.
    let label = ''
    if (id) {
      const markerIdx = answerHtml.indexOf(`id="${id}_label"`)
      const divStart = markerIdx >= 0 ? answerHtml.lastIndexOf('<div', markerIdx) : -1
      const divEnd = divStart >= 0 ? matchDivEnd(answerHtml, divStart) : -1
      if (divEnd > 0) {
        label = strip(answerHtml.slice(divStart, divEnd)).replace(/^[a-z]\.\s*/i, '')
      }
    }
    if (name && value != null) rows.push({ type, name, value, checked, label })
  }
  return rows
}

function parseQuestionBlock(qubaid, slot, classes, block) {
  const type = (classes.split(/\s+/)[0] || '').toLowerCase()
  const qno = strip(/<span class="qno">([\s\S]*?)<\/span>/i.exec(block)?.[1] || '') || slot
  const state = strip(/<div class="state">([\s\S]*?)<\/div>/i.exec(block)?.[1] || '')
  const grade = strip(/<div class="grade">([\s\S]*?)<\/div>/i.exec(block)?.[1] || '')
  const text = strip(
    (/<div class="qtext">([\s\S]*?)<\/div>\s*<div class="ablock/i.exec(block) ||
      /<div class="qtext">([\s\S]*?)<\/div>/i.exec(block) ||
      [])[1] || '',
  )

  let choices = []
  const answerStart = block.indexOf('<div class="answer">')
  if (answerStart >= 0) {
    const answerEnd = matchDivEnd(block, answerStart)
    if (answerEnd > 0) choices = parseAnswerRows(block.slice(answerStart, answerEnd))
  }

  return { qubaid, slot, type, qno, state, grade, text, choices }
}

// Ambil sisa waktu quiz. Moodle sering merender <span id="quiz-time-left">
// KOSONG di HTML lalu mengisi teksnya belakangan lewat JS timer client-side
// (nilai awal-nya dikirim ke JS lewat inline <script>, bukan sebagai teks
// span) — jadi span-nya sendiri tidak selalu bisa diandalkan. Coba beberapa
// pola secara berurutan: (1) isi span kalau memang sudah terisi teks di HTML
// awal, (2) angka detik yang dioper ke JS timer lewat inline script.
function extractTimeLeft(html) {
  const spanText = strip(
    /<span[^>]*\bid=["']quiz-time-left["'][^>]*>([\s\S]*?)<\/span>/i.exec(html)?.[1] || '',
  )
  if (spanText) return { text: spanText, seconds: null }

  const jsMatch =
    /\btimeleft["']?\s*[:=]\s*(\d+)/i.exec(html) ||
    /M\.mod_quiz\.timer\.init\([^,]*,\s*(\d+)/i.exec(html)
  if (jsMatch) return { text: null, seconds: Number(jsMatch[1]) }

  return { text: null, seconds: null }
}

/** Parse satu halaman soal quiz (bisa berisi >1 soal). */
export function parseQuizAttemptPage(html) {
  const formTag = /<form[^>]*\bid="responseform"[^>]*>/i.exec(html)?.[0] || ''
  const formAction = /action="([^"]*)"/i.exec(formTag)?.[1] || null

  const questions = []
  const qRe = /<div id="question-(\d+)-(\d+)" class="que ([^"]*)"/gi
  let m
  while ((m = qRe.exec(html))) {
    const end = matchDivEnd(html, m.index)
    if (end < 0) {
      qRe.lastIndex = m.index + 1
      continue
    }
    questions.push(parseQuestionBlock(m[1], m[2], m[3], html.slice(m.index, end)))
    qRe.lastIndex = end
  }

  const actions = [...html.matchAll(/<input type="submit" name="([^"]+)" value="([^"]+)"/gi)]
    .map((a) => ({ name: a[1], value: a[2] }))
    .filter((a) => NAV_LABELS.test(a.value))

  const titleText = /<title>([\s\S]*?)<\/title>/i.exec(html)?.[1] || ''
  const pageMatch = /\(page (\d+) of (\d+)\)/i.exec(titleText)
  const timeLeft = extractTimeLeft(html)

  return {
    kind: 'question',
    formAction,
    attempt: /name="attempt" value="(\d+)"/i.exec(html)?.[1] || null,
    thispage: /name="thispage" value="(\d+)"/i.exec(html)?.[1] || null,
    timeLeft: timeLeft.text,
    timeLeftSeconds: timeLeft.seconds,
    page: pageMatch ? { current: Number(pageMatch[1]), total: Number(pageMatch[2]) } : null,
    questions,
    actions,
  }
}

/**
 * Ambil teks yang mungkin menjelaskan halaman "unknown": notifikasi Moodle
 * (.alert/.notifyproblem/.errormessage), atau isi #region-main sebagai
 * fallback (dipotong pendek) — supaya kelihatan di log tanpa perlu HTML utuh.
 */
function extractPageNotice(html) {
  const alert =
    /<div[^>]*class="[^"]*\b(alert-danger|alert-warning|notifyproblem|errormessage)\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i.exec(
      html,
    )
  if (alert) return strip(alert[2]).slice(0, 300)

  const mainStart = html.search(/<section id="region-main"|<div id="region-main"/i)
  if (mainStart >= 0) return strip(html.slice(mainStart, mainStart + 4000)).slice(0, 300)

  return null
}

/** Ada form kedua (konfirmasi) yang juga menuju startattempt.php di halaman ini? */
function hasStartAttemptConfirmForm(html) {
  return /<form[^>]*action="[^"]*\/mod\/quiz\/startattempt\.php[^"]*"[^>]*>/i.test(html)
}

/**
 * Klasifikasi halaman setelah submit: soal (verified), summary/review
 * (heuristik — belum ada sample asli, jadi cuma ditandai + raw HTML supaya
 * caller bisa fallback ke browser daripada menebak-nebak submit final).
 */
export function classifyQuizPage(html) {
  if (/id="responseform"/i.test(html) && /class="que /.test(html)) {
    return parseQuizAttemptPage(html)
  }
  if (/mod\/quiz\/summary\.php/i.test(html) || /page-mod-quiz-summary/i.test(html)) {
    return { kind: 'summary', raw: html }
  }
  if (/page-mod-quiz-review/i.test(html) || /id="page-mod-quiz-review"/i.test(html)) {
    return { kind: 'review', raw: html }
  }
  return {
    kind: 'unknown',
    notice: extractPageNotice(html),
    hasStartAttemptConfirmForm: hasStartAttemptConfirmForm(html),
    raw: html,
  }
}

/** Link "Continue your attempt" di halaman view.php (attempt sudah jalan). */
export function findContinueAttemptUrl(html) {
  return /<a[^>]*href="([^"]*\/mod\/quiz\/attempt\.php\?attempt=\d+[^"]*)"/i.exec(html)?.[1] || null
}

/** Form "Attempt quiz now" / "Re-attempt quiz" di halaman view.php. */
export function findStartAttemptAction(html) {
  const form = /<form[^>]*action="([^"]*\/mod\/quiz\/startattempt\.php[^"]*)"[^>]*>/i.exec(html)
  return form?.[1] || null
}
