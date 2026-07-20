import { useCallback, useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import * as Clipboard from 'expo-clipboard'
import { useEngine } from '../engine/SsoEngine'

// "0:28:35" (format quiz-time-left Moodle, h:mm:ss) -> 1715 (detik).
function parseHms(text) {
  if (!text) return null
  const parts = text.split(':').map(Number)
  if (parts.some(Number.isNaN)) return null
  return parts.reduce((acc, p) => acc * 60 + p, 0)
}

// Detik -> "H:MM:SS", sama seperti tampilan Moodle sendiri.
function formatHms(totalSeconds) {
  const t = Math.max(0, totalSeconds)
  const h = Math.floor(t / 3600)
  const m = Math.floor((t % 3600) / 60)
  const s = Math.floor(t % 60)
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

// Susun semua soal + pilihan ganda jadi teks polos, siap paste (mis. ke Word).
function buildQuizText(pages) {
  const lines = []
  for (const p of pages) {
    for (const q of p.questions) {
      lines.push(`Soal ${q.qno}. ${q.text}`)
      q.choices.forEach((c, i) => {
        lines.push(`${String.fromCharCode(97 + i)}. ${c.label}`)
      })
      lines.push('')
    }
  }
  return lines.join('\n').trim()
}

// Penanda unik yang diminta AI pakai per soal — sengaja bukan kata biasa
// (bukan "Soal"/"Jawaban") supaya kecil kemungkinan diubah/diformat ulang
// (markdown/bold/bullet/numbering) oleh chat app, dan gampang dicari dengan
// regex tanpa peduli ada teks lain di sekitarnya.
const ANSWER_MARKER = 'JAWABQUIZ'

// Susun soal + instruksi format balasan, siap dibagikan ke app AI (ChatGPT/
// Claude/Gemini dst) lewat share sheet. Formatnya (baris "JAWABQUIZ|...")
// sengaja kaku & tidak lazim supaya AI kecil kemungkinan mengubahnya jadi
// markdown/bullet yang bikin parseAiReply gagal membaca balik.
function buildAiPrompt(pages) {
  const lines = [
    'Tolong bantu saya belajar dengan menjawab soal pilihan ganda kuliah berikut.',
    'ATURAN BALASAN (wajib diikuti persis untuk SETIAP soal, tanpa kecuali):',
    `- Tulis SATU baris polos (tanpa markdown/bold/italic/bullet/heading) dengan format persis:`,
    `${ANSWER_MARKER}|<nomor soal>|<huruf jawaban>|<penjelasan singkat 1-2 kalimat>`,
    `- Contoh: ${ANSWER_MARKER}|1|b|Karena b adalah satu-satunya pilihan yang sesuai definisi.`,
    '- Jangan pecah satu baris itu jadi beberapa baris, jangan tambahkan penomoran lain di depannya.',
    '- Boleh ditutup dengan penjelasan tambahan di luar baris itu, tapi baris berformat di atas WAJIB ada untuk tiap soal.',
    '',
    'Soal-soal:',
    '',
  ]
  for (const p of pages) {
    for (const q of p.questions) {
      if (q.choices.length === 0) continue
      lines.push(`Soal ${q.qno}. ${q.text}`)
      q.choices.forEach((c, i) => {
        lines.push(`${String.fromCharCode(97 + i)}. ${c.label}`)
      })
      lines.push('')
    }
  }
  return lines.join('\n').trim()
}

// Cari semua baris "JAWABQUIZ|<no>|<huruf>|<penjelasan>" di mana pun posisinya
// di teks (bukan hanya awal baris) — makin toleran terhadap AI yang tetap
// menambah bullet/nomor/markdown di depannya. Penjelasan boleh berlanjut ke
// baris berikutnya (dipotong saat ketemu marker berikutnya atau teks habis).
function parseMarkedReply(text) {
  const out = {}
  const re = new RegExp(
    `${ANSWER_MARKER}\\s*\\|\\s*(\\d{1,3})\\s*\\|\\s*([a-zA-Z])\\s*\\|\\s*([\\s\\S]*?)(?=${ANSWER_MARKER}\\s*\\||$)`,
    'gi',
  )
  let m
  while ((m = re.exec(text))) {
    // Kalau ada baris kosong sebelum marker soal berikutnya (mis. heading
    // "2. **Soal 2**" yang ditinggal AI di antara dua marker), jangan ikut
    // masukkan sisa teks itu ke penjelasan soal sebelumnya.
    let explanation = m[3]
    const blankIdx = explanation.search(/\n[ \t]*\n/)
    if (blankIdx >= 0) explanation = explanation.slice(0, blankIdx)
    out[m[1]] = { letter: m[2].toLowerCase(), explanation: explanation.trim() }
  }
  return out
}

// Fallback kalau AI tidak memakai format JAWABQUIZ sama sekali (mis. dari
// balasan lama atau model yang mengabaikan instruksi) — coba baca pola bebas
// "Soal <no>: <huruf>) <penjelasan>" per baris, setelah markdown dibuang.
function parseLenientReply(text) {
  const out = {}
  const cleaned = text.replace(/[*_`#>]+/g, '')
  const lineRe = /(?:soal|no\.?|question|nomor)?\s*#?(\d{1,3})\s*[.:\)\-]+\s*([a-hA-H])\)?\s*[.:\-]?\s*(.*)/i
  for (const raw of cleaned.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    const m = lineRe.exec(line)
    if (!m) continue
    out[m[1]] = { letter: m[2].toLowerCase(), explanation: m[3].trim() }
  }
  return out
}

// Coba format ketat (JAWABQUIZ) dulu; kalau tidak ketemu sama sekali, coba
// pola bebas sebagai cadangan.
function parseAiReply(text) {
  const strict = parseMarkedReply(text)
  if (Object.keys(strict).length > 0) return strict
  return parseLenientReply(text)
}

// "b" + soal -> "B. <teks pilihan b>", buat menampilkan saran AI.
function aiChoiceLabel(q, result) {
  const idx = result.letter ? result.letter.charCodeAt(0) - 97 : -1
  const choice = q.choices[idx]
  if (!choice) return result.letter ? result.letter.toUpperCase() : '?'
  return `${result.letter.toUpperCase()}. ${choice.label}`
}

// Layar quiz dua tahap. Tahap intro = halaman muka view.php (riwayat attempt,
// aturan, tanggal) TANPA menyentuh attempt — attempt baru dimulai/dilanjutkan
// hanya saat user menekan tombol "Mulai". Setelah itu SEMUA soal dari semua
// halaman attempt dimuat dan dirender sekaligus (GET attempt.php?page=N hanya
// menampilkan, tidak memproses jawaban) — user tidak perlu klik "Next page".
// Saat menekan "Kirim Jawaban", jawaban di-POST per halaman berurutan lewat
// SsoEngine, berakhir di summary; finalisasi tetap butuh konfirmasi terpisah.
export default function QuizScreen({ quiz, onClose }) {
  const engine = useEngine()
  // info|intro|loading|question|summary|review|error|noentry
  const [phase, setPhase] = useState('info')
  const [info, setInfo] = useState(null) // hasil getQuizInfo utk layar intro
  const [pages, setPages] = useState([]) // [{ url, questions, ... }]
  const [url, setUrl] = useState(quiz.url) // url summary/review setelah submit
  const [secondsLeft, setSecondsLeft] = useState(null) // hitung mundur lokal, sejak dimuat
  const [answers, setAnswers] = useState({}) // { inputName: value }
  const [busy, setBusy] = useState(false)
  const [saveProgress, setSaveProgress] = useState(null) // { done, total } saat submit
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null) // pesan/snippet dari halaman yang tak dikenali
  const [copied, setCopied] = useState(false)
  const [aiSharing, setAiSharing] = useState(false)
  const [aiPasting, setAiPasting] = useState(false)
  const [aiResults, setAiResults] = useState({}) // { [qno]: { letter, explanation } }

  // Hitung mundur lokal (perkiraan) — dimulai dari waktu tersisa saat quiz
  // dimuat, lalu jalan sendiri tiap detik. Timer sesungguhnya tetap di server.
  useEffect(() => {
    if (phase !== 'question') return
    const id = setInterval(() => {
      setSecondsLeft((s) => (s == null || s <= 0 ? s : s - 1))
    }, 1000)
    return () => clearInterval(id)
  }, [phase])

  const copyAll = useCallback(async () => {
    const text = buildQuizText(pages)
    await Clipboard.setStringAsync(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [pages])

  // Salin soal (+ instruksi format balasan) ke clipboard lalu buka share sheet
  // OS supaya user tinggal ketuk ChatGPT/Claude/Gemini dkk — teksnya sudah
  // ikut terkirim ke app yang dipilih, tidak perlu paste manual. App kita
  // tidak pernah membaca/mengontrol app lain; hanya sampai titik "berbagi".
  const shareToAi = useCallback(async () => {
    setAiSharing(true)
    try {
      const prompt = buildAiPrompt(pages)
      await Clipboard.setStringAsync(prompt)
      await Share.share({ message: prompt })
    } catch (e) {
      console.error('[QuizScreen] shareToAi FAILED:', e)
    } finally {
      setAiSharing(false)
    }
  }, [pages])

  // Setelah user menyalin balasan AI (dari app ChatGPT/Claude/Gemini dkk),
  // baca clipboard di sini dan parse jadi saran jawaban per soal. Ini
  // satu-satunya cara "membaca balasan AI" yang mungkin dari app pihak ketiga
  // — tidak ada API buat baca UI/hasil app lain secara otomatis.
  const pasteAiReply = useCallback(async () => {
    setAiPasting(true)
    try {
      const text = await Clipboard.getStringAsync()
      const parsed = parseAiReply(text || '')
      if (Object.keys(parsed).length === 0) {
        Alert.alert(
          'Balasan tidak terbaca',
          'Pastikan kamu sudah menyalin balasan dari app AI (bukan teks lain) sebelum menekan tombol ini.',
        )
        return
      }
      setAiResults((s) => ({ ...s, ...parsed }))
    } catch (e) {
      console.error('[QuizScreen] pasteAiReply FAILED:', e)
      Alert.alert('Gagal membaca clipboard', e.message)
    } finally {
      setAiPasting(false)
    }
  }, [])

  useEffect(() => {
    let alive = true
    console.log('[QuizScreen] loading intro for', quiz.url)
    engine
      .getQuizInfo(quiz.url)
      .then((res) => {
        if (!alive) return
        console.log('[QuizScreen] intro loaded:', {
          canContinue: res.canContinue,
          canStart: res.canStart,
          attempts: res.attempts?.length,
        })
        setInfo(res)
        setPhase('intro')
      })
      .catch((e) => {
        console.error('[QuizScreen] getQuizInfo FAILED:', e)
        if (alive) {
          setError(e.message)
          setPhase('error')
        }
      })
    return () => {
      alive = false
    }
  }, [engine, quiz.url])

  // Baru dipanggil saat user menekan "Mulai/Lanjutkan" di layar intro.
  const startAttempt = useCallback(() => {
    console.log('[QuizScreen] startAttempt() ->', quiz.url)
    setPhase('loading')
    setError(null)
    engine
      .getQuizFull(quiz.url)
      .then((res) => {
        console.log('[QuizScreen] getQuizFull resolved:', {
          kind: res.kind,
          url: res.url,
          pages: res.pages?.length,
        })
        setUrl(res.url || quiz.url)
        if (res.kind === 'question') {
          // Seed pilihan dari jawaban yang sudah tersimpan di server.
          const seed = {}
          for (const p of res.pages) {
            for (const q of p.questions) {
              for (const c of q.choices) if (c.checked) seed[c.name] = c.value
            }
          }
          setAnswers(seed)
          setPages(res.pages)
          setSecondsLeft(res.timeLeftSeconds != null ? res.timeLeftSeconds : parseHms(res.timeLeft))
          setPhase('question')
        } else if (res.kind === 'summary' || res.kind === 'review') {
          setPhase(res.kind)
        } else {
          console.warn(
            '[QuizScreen] getQuizFull returned unexpected kind:',
            res.kind,
            '— notice:',
            res.notice,
            '— url:',
            res.url,
          )
          setNotice(res.notice || null)
          setPhase('noentry')
        }
      })
      .catch((e) => {
        console.error('[QuizScreen] startAttempt (getQuizFull) FAILED:', e)
        setError(e.message)
        setPhase('error')
      })
  }, [engine, quiz.url])

  const pick = (name, value, multi) => {
    setAnswers((s) => {
      if (multi) {
        const next = { ...s }
        if (next[name] === value) delete next[name]
        else next[name] = value
        return next
      }
      return { ...s, [name]: value }
    })
  }

  // Submit semua: POST tiap halaman (hanya jawaban milik halaman itu) secara
  // berurutan; respons halaman terakhir menentukan phase berikutnya.
  const submitAll = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      let last = null
      for (let i = 0; i < pages.length; i++) {
        setSaveProgress({ done: i, total: pages.length })
        const p = pages[i]
        const names = new Set(p.questions.flatMap((q) => q.choices.map((c) => c.name)))
        const pageAnswers = {}
        for (const [k, v] of Object.entries(answers)) if (names.has(k)) pageAnswers[k] = v
        last = await engine.submitQuizPage({ pageUrl: p.url, answers: pageAnswers, button: 'next' })
      }
      setSaveProgress(null)
      setUrl(last?.url || url)
      if (last?.kind === 'summary') setPhase('summary')
      else if (last?.kind === 'review') setPhase('review')
      else if (last?.kind === 'question') {
        // Server mengarahkan balik ke soal (mis. jawaban ditolak) — muat ulang
        // supaya state yang tampil = state server.
        setPhase('summary')
      } else setPhase('summary')
    } catch (e) {
      console.error('[QuizScreen] submitAll FAILED at page', saveProgress?.done, ':', e)
      setSaveProgress(null)
      setError(e.message)
      setPhase('error')
    } finally {
      setBusy(false)
    }
  }, [engine, pages, answers, url])

  const finish = useCallback(() => {
    console.log('[QuizScreen] finish() ->', url)
    setBusy(true)
    setError(null)
    engine
      .finishAttempt(url)
      .then((res) => {
        console.log('[QuizScreen] finishAttempt resolved:', { kind: res.kind, url: res.url })
        setUrl(res.url || url)
        setPhase(res.kind === 'review' ? 'review' : 'summary')
      })
      .catch((e) => {
        console.error('[QuizScreen] finishAttempt FAILED:', e)
        setError(e.message)
        setPhase('error')
      })
      .finally(() => setBusy(false))
  }, [engine, url])

  const totalQ = pages.reduce((n, p) => n + p.questions.length, 0)
  const answeredQ = pages.reduce(
    (n, p) => n + p.questions.filter((q) => q.choices.some((c) => answers[c.name] != null)).length,
    0,
  )

  return (
    <View style={styles.root}>
      <View style={styles.head}>
        <Pressable style={styles.close} onPress={onClose} hitSlop={8}>
          <Text style={styles.closeText}>✕</Text>
        </Pressable>
        <View style={styles.flex}>
          <Text style={styles.title} numberOfLines={1}>
            {quiz.name}
          </Text>
          {phase === 'question' && (
            <Text style={styles.sub}>
              {answeredQ}/{totalQ} terjawab
              {secondsLeft != null && (
                <Text style={secondsLeft <= 300 && styles.subWarn}>
                  {' '}
                  · sisa {formatHms(secondsLeft)}
                </Text>
              )}
            </Text>
          )}
        </View>
      </View>

      {phase === 'info' && (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#1d4ed8" />
          <Text style={styles.hint}>Memuat info quiz…</Text>
        </View>
      )}

      {phase === 'intro' && info && (
        <ScrollView contentContainerStyle={styles.body}>
          <View style={styles.qcard}>
            <Text style={styles.introTitle}>Tentang quiz ini</Text>
            {info.attemptsAllowed && (
              <Text style={styles.introRow}>Attempt diizinkan: {info.attemptsAllowed}</Text>
            )}
            {info.timeLimit && <Text style={styles.introRow}>Batas waktu: {info.timeLimit}</Text>}
            {info.gradingMethod && (
              <Text style={styles.introRow}>Penilaian: {info.gradingMethod}</Text>
            )}
            {(info.start || info.due) && (
              <Text style={styles.introRow}>
                {info.start ? `Dibuka: ${info.start}` : ''}
                {info.start && info.due ? '\n' : ''}
                {info.due ? `Ditutup: ${info.due}` : ''}
              </Text>
            )}
            {!info.attemptsAllowed && !info.timeLimit && !info.gradingMethod && !info.start && !info.due && (
              <Text style={styles.introRow}>Tidak ada info aturan yang terbaca.</Text>
            )}
          </View>

          <View style={styles.qcard}>
            <Text style={styles.introTitle}>Riwayat attempt</Text>
            {info.attempts?.length ? (
              info.attempts.map((at) => (
                <Text key={at.attempt} style={styles.introRow}>
                  #{at.attempt} · {at.state} · nilai {at.grade ?? at.marks ?? '—'}
                  {info.gradeMax ? ` / ${info.gradeMax}` : ''}
                </Text>
              ))
            ) : (
              <Text style={styles.introRow}>Belum pernah dikerjakan.</Text>
            )}
          </View>

          {info.canContinue || info.canStart ? (
            <>
              <Pressable style={styles.btn} onPress={startAttempt}>
                <Text style={styles.btnText}>
                  {info.canContinue ? 'Lanjutkan Attempt' : 'Mulai Kerjakan'}
                </Text>
              </Pressable>
              {!info.canContinue && (
                <Text style={styles.saveNote}>
                  Menekan tombol ini memulai attempt baru di server
                  {info.timeLimit ? ` — timer ${info.timeLimit} langsung berjalan` : ''}.
                </Text>
              )}
            </>
          ) : (
            <>
              <Text style={[styles.errText, styles.introNoStart]}>
                Tidak ada attempt yang bisa dimulai dari app (mungkin sudah habis / belum dibuka).
              </Text>
              <Pressable style={styles.btnGhost} onPress={() => Linking.openURL(quiz.url)}>
                <Text style={styles.btnGhostText}>Buka di browser</Text>
              </Pressable>
            </>
          )}
        </ScrollView>
      )}

      {phase === 'loading' && (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#1d4ed8" />
          <Text style={styles.hint}>Memuat semua soal…</Text>
        </View>
      )}

      {phase === 'error' && (
        <View style={styles.center}>
          <Text style={styles.errTitle}>Gagal</Text>
          <Text style={styles.errText}>{error}</Text>
          <Pressable style={styles.btnGhost} onPress={() => Linking.openURL(quiz.url)}>
            <Text style={styles.btnGhostText}>Buka di browser</Text>
          </Pressable>
        </View>
      )}

      {phase === 'noentry' && (
        <View style={styles.center}>
          <Text style={styles.errTitle}>Tidak bisa memulai dari app</Text>
          <Text style={styles.errText}>
            Quiz ini mungkin butuh konfirmasi khusus (password/waktu) atau attempt sudah habis.
          </Text>
          {notice && <Text style={styles.errText}>Pesan server: "{notice}"</Text>}
          <Pressable style={styles.btnGhost} onPress={() => Linking.openURL(quiz.url)}>
            <Text style={styles.btnGhostText}>Buka di browser</Text>
          </Pressable>
        </View>
      )}

      {phase === 'question' && (
        <>
          <ScrollView contentContainerStyle={styles.body}>
            <View style={styles.toolRow}>
              <Pressable style={styles.copyBtn} onPress={copyAll}>
                <Text style={styles.copyBtnText}>
                  {copied ? 'Tersalin ✓' : 'Salin Semua Soal & Pilihan'}
                </Text>
              </Pressable>
              <Pressable
                style={[styles.copyBtn, styles.aiBtn, aiSharing && styles.disabled]}
                onPress={shareToAi}
                disabled={aiSharing}
              >
                {aiSharing ? (
                  <ActivityIndicator size="small" color="#1d4ed8" />
                ) : (
                  <Text style={[styles.copyBtnText, styles.aiBtnText]}>Kirim ke AI</Text>
                )}
              </Pressable>
              <Pressable
                style={[styles.copyBtn, styles.aiBtn, aiPasting && styles.disabled]}
                onPress={pasteAiReply}
                disabled={aiPasting}
              >
                {aiPasting ? (
                  <ActivityIndicator size="small" color="#1d4ed8" />
                ) : (
                  <Text style={[styles.copyBtnText, styles.aiBtnText]}>Tempel Balasan AI</Text>
                )}
              </Pressable>
            </View>
            <Text style={styles.aiDisclaimer}>
              "Kirim ke AI" membagikan soal ke ChatGPT/Claude/Gemini dkk lewat menu berbagi. Minta
              AI menjawab, salin balasannya, lalu tekan "Tempel Balasan AI" di sini. Saran AI bisa
              salah — pakai sebagai bantuan belajar, bukan jawaban pasti.
            </Text>
            {pages.flatMap((p) =>
              p.questions.map((q) => {
                const aiResult = aiResults[String(q.qno)]
                return (
                  <View key={`${q.qubaid}:${q.slot}`} style={styles.qcard}>
                    <View style={styles.qhead}>
                      <Text style={styles.qno}>Soal {q.qno}</Text>
                      {q.grade ? <Text style={styles.qgrade}>{q.grade}</Text> : null}
                    </View>
                    <Text style={styles.qtext}>{q.text}</Text>
                    {q.choices.length === 0 ? (
                      <Text style={styles.warn}>
                        Tipe soal ini ({q.type}) belum didukung untuk dijawab di app — buka di
                        browser.
                      </Text>
                    ) : (
                      q.choices.map((c) => {
                        const multi = c.type === 'checkbox'
                        const selected = answers[c.name] === c.value
                        return (
                          <Pressable
                            key={c.name + c.value}
                            style={[styles.choice, selected && styles.choiceOn]}
                            onPress={() => pick(c.name, c.value, multi)}
                          >
                            <View
                              style={[styles.dot, multi && styles.box, selected && styles.dotOn]}
                            >
                              {selected && <Text style={styles.tick}>{multi ? '✓' : '●'}</Text>}
                            </View>
                            <Text style={styles.choiceText}>{c.label}</Text>
                          </Pressable>
                        )
                      })
                    )}
                    {aiResult && (
                      <View style={styles.aiBox}>
                        <Text style={styles.aiTitle}>Saran AI: {aiChoiceLabel(q, aiResult)}</Text>
                        {!!aiResult.explanation && (
                          <Text style={styles.aiExplain}>{aiResult.explanation}</Text>
                        )}
                      </View>
                    )}
                  </View>
                )
              }),
            )}
            <Text style={styles.saveNote}>
              Jawaban baru terkirim ke server saat kamu menekan "Kirim Jawaban" di bawah.
            </Text>
          </ScrollView>

          <View style={styles.footer}>
            <Text style={styles.footHint}>
              {answeredQ}/{totalQ}
            </Text>
            <View style={styles.flex} />
            <Pressable
              style={[styles.btn, busy && styles.disabled]}
              onPress={submitAll}
              disabled={busy}
            >
              {busy ? (
                <View style={styles.busyRow}>
                  <ActivityIndicator color="#fff" />
                  {saveProgress && (
                    <Text style={styles.btnText}>
                      {' '}
                      {saveProgress.done + 1}/{saveProgress.total}
                    </Text>
                  )}
                </View>
              ) : (
                <Text style={styles.btnText}>Kirim Jawaban</Text>
              )}
            </Pressable>
          </View>
        </>
      )}

      {phase === 'summary' && (
        <View style={styles.center}>
          <Text style={styles.okTitle}>Semua jawaban terkirim</Text>
          <Text style={styles.hint}>
            Jawabanmu sudah tersimpan di server. Tekan tombol di bawah untuk finalisasi attempt —
            setelah ini biasanya tidak bisa diubah lagi.
          </Text>
          <Pressable style={[styles.btn, busy && styles.disabled]} onPress={finish} disabled={busy}>
            {busy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.btnText}>Selesai & Kirim Final</Text>
            )}
          </Pressable>
          <Pressable style={styles.btnGhost} onPress={() => Linking.openURL(url)}>
            <Text style={styles.btnGhostText}>Cek ringkasan di browser</Text>
          </Pressable>
        </View>
      )}

      {phase === 'review' && (
        <View style={styles.center}>
          <Text style={styles.okTitle}>Attempt selesai ✓</Text>
          <Text style={styles.hint}>Quiz sudah dikirim. Lihat nilai/pembahasan di browser.</Text>
          <Pressable style={styles.btn} onPress={() => Linking.openURL(url)}>
            <Text style={styles.btnText}>Lihat hasil di browser</Text>
          </Pressable>
          <Pressable style={styles.btnGhost} onPress={onClose}>
            <Text style={styles.btnGhostText}>Kembali</Text>
          </Pressable>
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f1f5f9' },
  flex: { flex: 1 },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 10,
    backgroundColor: '#0f172a',
  },
  close: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  closeText: { color: '#fff', fontSize: 18, fontWeight: '700' },
  title: { color: '#fff', fontSize: 15, fontWeight: '700' },
  sub: { color: '#cbd5e1', fontSize: 12, marginTop: 2 },
  subWarn: { color: '#fca5a5', fontWeight: '700' },
  toolRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 4 },
  copyBtn: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: '#94a3b8',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 12,
    backgroundColor: '#fff',
  },
  aiBtn: { borderColor: '#1d4ed8' },
  aiBtnText: { color: '#1d4ed8' },
  copyBtnText: { fontSize: 12, fontWeight: '600', color: '#334155' },
  aiDisclaimer: {
    fontSize: 11,
    color: '#64748b',
    lineHeight: 15,
    marginBottom: 12,
  },
  aiBox: {
    marginTop: 10,
    padding: 10,
    borderRadius: 8,
    backgroundColor: '#eff6ff',
    borderWidth: 1,
    borderColor: '#bfdbfe',
  },
  aiTitle: { fontSize: 12, fontWeight: '700', color: '#1d4ed8', marginBottom: 4 },
  aiExplain: { fontSize: 12, color: '#1e3a8a', lineHeight: 17 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  hint: { color: '#475569', fontSize: 13, textAlign: 'center' },
  body: { padding: 14, paddingBottom: 24 },
  qcard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  qhead: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  qno: { fontSize: 12, fontWeight: '700', color: '#1d4ed8' },
  qgrade: { fontSize: 11, color: '#94a3b8' },
  qtext: { fontSize: 15, color: '#0f172a', marginBottom: 12, lineHeight: 21 },
  choice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    marginBottom: 8,
    backgroundColor: '#fafafa',
  },
  choiceOn: { borderColor: '#1d4ed8', backgroundColor: '#eff6ff' },
  choiceText: { flex: 1, fontSize: 14, color: '#0f172a' },
  dot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: '#cbd5e1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  box: { borderRadius: 6 },
  dotOn: { borderColor: '#1d4ed8', backgroundColor: '#1d4ed8' },
  tick: { color: '#fff', fontSize: 12, lineHeight: 14 },
  warn: { fontSize: 12, color: '#b45309' },
  introTitle: { fontSize: 13, fontWeight: '700', color: '#0f172a', marginBottom: 8 },
  introRow: { fontSize: 13, color: '#334155', marginBottom: 4, lineHeight: 19 },
  introNoStart: { marginTop: 4, marginBottom: 10 },
  saveNote: { fontSize: 11, color: '#94a3b8', textAlign: 'center', marginTop: 4 },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    backgroundColor: '#fff',
  },
  footHint: { fontSize: 13, fontWeight: '600', color: '#475569' },
  busyRow: { flexDirection: 'row', alignItems: 'center' },
  btn: {
    backgroundColor: '#1d4ed8',
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 20,
    alignItems: 'center',
    minWidth: 140,
  },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  btnGhost: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 10,
    paddingVertical: 11,
    paddingHorizontal: 18,
    alignItems: 'center',
  },
  btnGhostText: { color: '#334155', fontWeight: '600', fontSize: 13 },
  disabled: { opacity: 0.5 },
  errTitle: { color: '#b91c1c', fontWeight: '800', fontSize: 16 },
  errText: { color: '#b91c1c', fontSize: 13, textAlign: 'center' },
  okTitle: { color: '#15803d', fontWeight: '800', fontSize: 18 },
})
