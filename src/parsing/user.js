// Port verbatim dari ueu-sso-automation/server/browser.js.

/** Extract the logged-in user from the Moodle "You are logged in as" line. */
export function parseUser(html) {
  const m = /You are logged in as\s*<a[^>]*>([^<]+)<\/a>/i.exec(html)
  if (!m) return null
  const full = m[1].replace(/\s+/g, ' ').trim() // "20240801333 Daffa Ardhana"
  const nim = (full.match(/^\d+/) || [''])[0]
  const name = full.replace(/^\d+\s*/, '').trim()
  return { full, nim, name }
}
