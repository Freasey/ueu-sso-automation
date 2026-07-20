import { StyleSheet, Text, View } from 'react-native'

const COLORS = {
  ok: { bg: '#dcfce7', fg: '#15803d' },
  no: { bg: '#fee2e2', fg: '#b91c1c' },
  info: { bg: '#dbeafe', fg: '#1d4ed8' },
  muted: { bg: '#f1f5f9', fg: '#64748b' },
  loading: { bg: '#f1f5f9', fg: '#94a3b8' },
}

export function Badge({ tone = 'muted', children }) {
  const c = COLORS[tone] || COLORS.muted
  return (
    <View style={[styles.badge, { backgroundColor: c.bg }]}>
      <Text style={[styles.badgeText, { color: c.fg }]}>{children}</Text>
    </View>
  )
}

// Port dari StatusBadges di src/App.jsx asal.
export function StatusBadges({ type, a }) {
  if (type === 'assign') {
    if (a.submitted) {
      return (
        <View style={styles.row}>
          <Badge tone="ok">Terkumpul</Badge>
          {a.grade ? <Badge tone="info">Nilai {a.grade}</Badge> : <Badge>Belum dinilai</Badge>}
        </View>
      )
    }
    if (a.submission) return <Badge tone="no">Belum dikumpulkan</Badge>
    return <Badge>—</Badge>
  }

  if (type === 'quiz') {
    return a.attempts?.length ? (
      <View style={styles.row}>
        {a.attempts.map((at) => (
          <Badge key={at.attempt} tone="info">
            #{at.attempt} {at.state} · {at.grade ?? at.marks}
            {a.gradeMax ? ` / ${a.gradeMax}` : ''}
          </Badge>
        ))}
      </View>
    ) : (
      <Badge tone="no">Belum dikerjakan</Badge>
    )
  }

  // forum
  if (a.done) return <Badge tone="ok">Subscribed</Badge>
  if (a.noTopics) return <Badge>Tidak ada diskusi</Badge>
  return <Badge tone="no">Belum subscribe</Badge>
}

const styles = StyleSheet.create({
  badge: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
    alignSelf: 'flex-start',
  },
  badgeText: { fontSize: 11, fontWeight: '600' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
})
