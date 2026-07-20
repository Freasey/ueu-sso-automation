// Util HTML mentah — port verbatim dari ueu-sso-automation/server/browser.js.

/** Strip tags/entities/whitespace from an HTML fragment into plain text. */
export function strip(s) {
  return (s || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Given the index of an opening `<div ...>` tag, return the index just past
 * its matching `</div>` (counting nested divs). -1 if unbalanced/not found.
 */
export function matchDivEnd(html, start) {
  const openTag = /^<div\b[^>]*>/i.exec(html.slice(start))
  if (!openTag) return -1
  const tagRe = /<div\b[^>]*>|<\/div>/gi
  tagRe.lastIndex = start + openTag[0].length
  let depth = 1
  let m
  while ((m = tagRe.exec(html))) {
    depth += m[0][1] === '/' ? -1 : 1
    if (depth === 0) return tagRe.lastIndex
  }
  return -1
}

/** Map a 2-cell Moodle table (th -> td) into { lowercased label: text }. */
export function twoColRows(html) {
  const map = {}
  for (const r of html.matchAll(
    /<tr[^>]*>\s*<t[hd][^>]*>([\s\S]*?)<\/t[hd]>\s*<t[hd][^>]*>([\s\S]*?)<\/t[hd]>\s*<\/tr>/gi,
  )) {
    const k = strip(r[1]).toLowerCase()
    if (k && !(k in map)) map[k] = strip(r[2])
  }
  return map
}
