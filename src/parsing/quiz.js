// Port verbatim dari ueu-sso-automation/server/browser.js.
import { strip } from './html'

/** Quiz: each attempt's state + marks + grade from mod/quiz/view.php. */
export function parseQuiz(html) {
  const table =
    /Summary of your previous attempts[\s\S]*?<table[^>]*>([\s\S]*?)<\/table>/i.exec(html)?.[1]
  if (!table) return { attempts: [] }
  const cellsOf = (row) =>
    [...row.matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((m) => strip(m[1]))
  const rows = [...table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) => cellsOf(m[1]))
  const header = rows.find((c) => c.some((x) => /^state$/i.test(x))) || rows[0] || []
  const stateIdx = header.findIndex((h) => /^state/i.test(h))
  const marksIdx = header.findIndex((h) => /^marks/i.test(h))
  const gradeIdx = header.findIndex((h) => /^grade/i.test(h))
  const attempts = []
  for (const c of rows) {
    if (!/^\d+$/.test(c[0] || '')) continue // attempt rows start with a number
    const stateCell = stateIdx >= 0 ? c[stateIdx] : ''
    attempts.push({
      attempt: c[0],
      state: (/(Finished|In progress|Never submitted|Overdue|Abandoned)/i.exec(stateCell) || [stateCell])[0],
      marks: marksIdx >= 0 ? c[marksIdx] || null : null,
      grade: gradeIdx >= 0 ? c[gradeIdx] || null : null,
    })
  }
  return {
    attempts,
    marksMax: marksIdx >= 0 ? (header[marksIdx] || '').replace(/^marks\s*\/?\s*/i, '') : null,
    gradeMax: gradeIdx >= 0 ? (header[gradeIdx] || '').replace(/^grade\s*\/?\s*/i, '') : null,
  }
}
