import { useMemo } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import ActivityItem from './ActivityItem'
import { Badge } from './Badges'

// Kartu satu course, lazy: sebelum diketuk hanya judul + ajakan memuat.
// Setelah dimuat, ringkasan "belum" (tugas/quiz/forum) tampil per course —
// menggantikan ringkasan global yang dulu ada di header dashboard — lalu
// detail sesi bisa dibuka/tutup tanpa membatalkan fetch yang berjalan.
export default function CourseCard({ course, outline, activities, expanded, onPress, onOpenQuiz }) {
  const status = outline?.status // undefined = belum dimulai

  // Hitungan item belum selesai milik course ini (forum tanpa diskusi tidak
  // dihitung); pending = item yang statusnya masih dimuat.
  const summary = useMemo(() => {
    if (status !== 'done') return null
    const belum = { assign: 0, quiz: 0, forum: 0 }
    let pending = 0
    for (const it of outline.data.sessions.flatMap((s) => s.items)) {
      const a = activities[`${course.id}:${it.cmid}`]
      if (!a || a.status === 'loading') {
        pending++
        continue
      }
      if (a.status !== 'done' || a.data.done !== false) continue
      if (it.type === 'forum' && a.data.noTopics) continue
      belum[it.type]++
    }
    return { ...belum, pending }
  }, [status, outline, activities, course.id])

  return (
    <View style={styles.card}>
      <Pressable onPress={onPress}>
        <View style={styles.headRow}>
          <Text style={styles.code}>{course.code}</Text>
          {course.section ? (
            <View style={styles.chip}>
              <Text style={styles.chipText}>{course.section}</Text>
            </View>
          ) : null}
          <View style={styles.flex} />
          <Text style={styles.chevron}>{status === 'done' && !expanded ? '▸' : '▾'}</Text>
        </View>
        <Text style={styles.name}>{course.name}</Text>

        {!status && <Text style={styles.hint}>Ketuk untuk memuat data mata kuliah ini</Text>}

        {status === 'loading' && (
          <View style={styles.skeletons}>
            <View style={styles.skeleton} />
            <View style={styles.skeleton} />
            <View style={styles.skeleton} />
          </View>
        )}

        {status === 'error' && (
          <Text style={styles.err}>Gagal memuat: {outline.error} — ketuk untuk coba lagi.</Text>
        )}

        {summary && (
          <View style={styles.counts}>
            <Badge tone={summary.assign ? 'no' : 'ok'}>Tugas belum: {summary.assign}</Badge>
            <Badge tone={summary.quiz ? 'no' : 'ok'}>Quiz belum: {summary.quiz}</Badge>
            <Badge tone={summary.forum ? 'no' : 'ok'}>Forum belum: {summary.forum}</Badge>
            {summary.pending > 0 && <Badge tone="loading">menghitung {summary.pending}…</Badge>}
          </View>
        )}
      </Pressable>

      {status === 'done' &&
        expanded &&
        (outline.data.sessions.length === 0 ? (
          <Text style={styles.err}>Tidak ada sesi dengan tugas/quiz/forum.</Text>
        ) : (
          outline.data.sessions.map((s) => (
            <View key={s.number} style={styles.session}>
              <Text style={styles.sessionTitle}>
                {/sesi/i.test(s.title)
                  ? s.title.replace(/^perkuliahan\s*/i, '')
                  : `Sesi ${s.number}`}
              </Text>
              {s.items.map((it) => (
                <ActivityItem
                  key={it.cmid}
                  item={it}
                  activity={activities[`${course.id}:${it.cmid}`]}
                  onOpenQuiz={onOpenQuiz}
                />
              ))}
            </View>
          ))
        ))}
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  flex: { flex: 1 },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  code: { fontSize: 12, fontWeight: '700', color: '#1d4ed8' },
  chip: {
    backgroundColor: '#eef2ff',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  chipText: { fontSize: 10, color: '#4338ca', fontWeight: '600' },
  chevron: { fontSize: 13, color: '#94a3b8' },
  name: { fontSize: 15, fontWeight: '600', color: '#0f172a', marginTop: 2, marginBottom: 8 },
  hint: { fontSize: 12, color: '#64748b' },
  skeletons: { gap: 6 },
  skeleton: { height: 14, borderRadius: 4, backgroundColor: '#f1f5f9' },
  err: { fontSize: 12, color: '#b91c1c' },
  counts: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  session: { marginTop: 8 },
  sessionTitle: { fontSize: 12, fontWeight: '700', color: '#475569', marginBottom: 4 },
})
