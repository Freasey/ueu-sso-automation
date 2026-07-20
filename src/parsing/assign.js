// Port verbatim dari ueu-sso-automation/server/browser.js.
import { twoColRows } from './html'

/** Assignment (tugas): real submission status + grade from mod/assign/view.php. */
export function parseAssign(html) {
  const rows = twoColRows(html)
  const submission = rows['submission status'] || null
  const grading = rows['grading status'] || null
  const gradeRaw = rows['grade']
  const grade = gradeRaw && /\d/.test(gradeRaw) ? gradeRaw : null
  return {
    submission,
    submitted: /submitted for grading|submitted for marking/i.test(submission || ''),
    grading,
    grade,
  }
}
