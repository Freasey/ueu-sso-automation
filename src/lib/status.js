// Logika status — port verbatim dari src/App.jsx project ueu-sso-automation.

// "Monday, 15 June 2026, 11:59 PM" -> "15 Jun 2026"
export function fmtDate(s) {
  if (!s) return null
  const m = /(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/.exec(s)
  return m ? `${m[1]} ${m[2].slice(0, 3)} ${m[3]}` : s
}

// Red = not done AND today is inside the active window (no start => open since
// always; no due => never red; past due => not red anymore). A forum with no
// discussions is informational, never red.
export function isRed(a) {
  if (!a || a.done || a.noTopics || a.dueTs == null) return false
  const now = Date.now()
  if (now > a.dueTs) return false
  if (a.startTs != null && now < a.startTs) return false
  return true
}
