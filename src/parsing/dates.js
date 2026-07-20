// Port verbatim dari ueu-sso-automation/server/browser.js.
import { strip } from './html'

/** Parse a Moodle date like "Saturday, 9 May 2026, 12:00 AM" to epoch ms. */
export function toTimestamp(text) {
  if (!text) return null
  const t = Date.parse(text.replace(/^[A-Za-z]+,\s*/, '').replace(',', ''))
  return Number.isNaN(t) ? null : t
}

/**
 * Pull start/due dates from an activity page's "activity-dates" block.
 * Assign: Opened + Due. Quiz: Opened + Closed. Forum: Due only (no start).
 */
export function parseActivityDates(html) {
  const text = strip(html)
  const DATE = '([A-Za-z]+,\\s*\\d{1,2}\\s+[A-Za-z]+\\s+\\d{4},\\s*\\d{1,2}:\\d{2}\\s*[AP]M)'
  const find = (labels) => {
    for (const l of labels) {
      const m = new RegExp(l + '\\s*:?\\s*' + DATE, 'i').exec(text)
      if (m) return m[1]
    }
    return null
  }
  const start = find(['Opened', 'Opens'])
  const due = find(['Due', 'Closed', 'Closes'])
  return { start, startTs: toTimestamp(start), due, dueTs: toTimestamp(due) }
}
