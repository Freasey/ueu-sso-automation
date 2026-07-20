// Port verbatim dari ueu-sso-automation/server/browser.js.

/**
 * Forum status from its view page. Subscription is PER-DISCUSSION: each
 * discussion row is `<tr class="discussion subscribed">` when the user follows
 * it. The forum is "safe" (done) if at least one discussion is subscribed; a
 * forum with discussions but none subscribed is actionable (can go red); a
 * forum with no discussions at all is just informational.
 */
export function parseForum(html) {
  const rows = [...html.matchAll(/<tr class="(discussion[^"]*)"[\s\S]{0,500}?data-discussionid="\d+"/gi)]
  const discussions = rows.length || (/discuss\.php\?d=\d+/.test(html) ? 1 : 0)
  const subscribed = rows.filter((r) => /\bsubscribed\b/.test(r[1])).length
  return {
    discussions,
    subscribed,
    noTopics: discussions === 0,
    done: subscribed >= 1,
  }
}
