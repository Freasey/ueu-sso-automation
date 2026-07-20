// Heuristik deteksi halaman — port dari isCloudflareWall/isAuthenticated di
// ueu-sso-automation/server/browser.js (tanpa status HTTP: di WebView kita
// hanya pegang HTML-nya).

export function isCloudflareWall(html) {
  return /just a moment|challenge-platform|cf-chl|_cf_chl|attention required|cf-mitigated/i.test(
    html || '',
  )
}

/** A Moodle page where we're authenticated shows the logout link / user line. */
export function isAuthenticated(html) {
  return /You are logged in as/i.test(html) || /\/login\/logout\.php/i.test(html)
}

/** Unambiguous SSO credential rejection (same regex as project asal). */
export function isCredentialError(html) {
  return /invalid|salah|gagal|incorrect|tidak terdaftar|denied|wrong/i.test(html || '')
}

/** The per-session CSRF token Moodle embeds in M.cfg; needed for AJAX calls. */
export function extractSesskey(html) {
  return (
    /"sesskey":"([^"]+)"/.exec(html)?.[1] ||
    /sesskey=([A-Za-z0-9]+)/.exec(html)?.[1] ||
    null
  )
}

/** The logged-in user's numeric id. */
export function extractUserId(html) {
  return /"userid":(\d+)/.exec(html)?.[1] || /user\/view\.php\?id=(\d+)/.exec(html)?.[1] || null
}
