// Port verbatim dari ueu-sso-automation/server/browser.js.
import { ELEARNING_ORIGIN } from '../engine/constants'

/** Split "CSF412 Pemrograman Web KJ101 8495" into its parts. */
export function parseCourseName(raw) {
  const m = /^(\S+)\s+(.*?)\s+([A-Z]{2}\d{3})\s+(\d+)$/.exec(raw)
  if (m) return { code: m[1], name: m[2], section: m[3], number: m[4] }
  const m2 = /^(\S+)\s+(.*)$/.exec(raw)
  return { code: m2?.[1] || '', name: m2?.[2] || raw, section: '', number: '' }
}

/** Fallback: pull the enrolled courses out of the courses page markup. */
export function parseCourses(html) {
  const re =
    /course\/view\.php\?id=(\d+)"[^>]*>\s*<div class="text_to_html">([^<]+)<\/div>/g
  const seen = new Set()
  const courses = []
  let m
  while ((m = re.exec(html))) {
    const id = m[1]
    if (seen.has(id)) continue
    seen.add(id)
    const raw = m[2].replace(/\s+/g, ' ').trim()
    courses.push({
      id,
      url: `${ELEARNING_ORIGIN}/course/view.php?id=${id}`,
      raw,
      ...parseCourseName(raw),
    })
  }
  return courses
}
