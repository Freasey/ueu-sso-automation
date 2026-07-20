// Kirim soal + pilihan ganda quiz ke AI dan minta saran jawaban + penjelasan
// singkat. Pakai format chat/completions bergaya OpenAI (didukung OpenAI,
// OpenRouter, Groq, maupun server lokal seperti LM Studio/Ollama) supaya
// baseUrl/model bisa diganti bebas dari layar Pengaturan AI. Ini HANYA
// membaca soal dan menampilkan saran — tidak pernah mengubah/submit apa pun
// ke Moodle.

function buildPrompt(items) {
  return items
    .map((it) => {
      const choiceLines = it.choices
        .map((c, i) => `${String.fromCharCode(97 + i)}. ${c.label}`)
        .join('\n')
      return `ID: ${it.id}\nSoal: ${it.text}\n${choiceLines}`
    })
    .join('\n\n')
}

function extractJsonArray(text) {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/, '')
    .trim()
  const start = cleaned.indexOf('[')
  const end = cleaned.lastIndexOf(']')
  if (start < 0 || end < 0) throw new Error('Balasan AI tidak berisi JSON array yang valid')
  return JSON.parse(cleaned.slice(start, end + 1))
}

const SYSTEM_PROMPT =
  'Anda adalah asisten belajar untuk mahasiswa yang sedang mengerjakan quiz. Untuk tiap soal ' +
  'pilihan ganda yang diberikan, tentukan huruf pilihan yang paling tepat dan berikan penjelasan ' +
  'singkat (maksimal 2 kalimat, Bahasa Indonesia) kenapa itu jawabannya. Balas HANYA dengan JSON ' +
  'array valid tanpa teks lain di luar array, dengan format persis: ' +
  '[{"id":"<ID soal>","letter":"a","explanation":"..."}]'

/**
 * items: [{ id, text, choices: [{ label }] }]
 * -> { [id]: { letter, explanation } }
 */
export async function checkQuizAnswers({ baseUrl, apiKey, model }, items) {
  if (!apiKey) throw new Error('API key AI belum diisi. Buka Pengaturan AI dahulu.')
  if (!items || items.length === 0) return {}

  const res = await fetch(`${String(baseUrl).replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildPrompt(items) },
      ],
    }),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`AI API gagal (${res.status}): ${body.slice(0, 200)}`)
  }

  const json = await res.json()
  const content = json.choices?.[0]?.message?.content
  if (!content) throw new Error('Balasan AI kosong atau format tidak dikenali')

  const arr = extractJsonArray(content)
  const out = {}
  for (const it of arr) {
    if (it && it.id != null) {
      out[String(it.id)] = {
        letter: String(it.letter || '').toLowerCase(),
        explanation: it.explanation || '',
      }
    }
  }
  return out
}
