import { Linking, Pressable, StyleSheet, Text, View } from 'react-native'
import { Badge, StatusBadges } from './Badges'
import { fmtDate, isRed } from '../lib/status'

const TYPE_LABEL = { assign: 'Tugas', quiz: 'Quiz', forum: 'Forum' }
const TYPE_COLOR = { assign: '#7c3aed', quiz: '#0891b2', forum: '#ca8a04' }

// Satu baris aktivitas. `activity` bisa masih loading (progressive fill).
// Quiz diketuk membuka QuizScreen (dikerjakan di app); lainnya buka browser.
export default function ActivityItem({ item, activity, onOpenQuiz }) {
  const loading = !activity || activity.status === 'loading'
  const a = activity?.status === 'done' ? activity.data : null
  const red = a ? isRed(a) : false
  const onPress =
    item.type === 'quiz' && onOpenQuiz ? () => onOpenQuiz(item) : () => Linking.openURL(item.url)

  return (
    <View style={[styles.item, red && styles.itemRed]}>
      <View style={styles.head}>
        <Text style={[styles.type, { color: TYPE_COLOR[item.type] }]}>
          {TYPE_LABEL[item.type]}
        </Text>
        <Pressable style={styles.nameWrap} onPress={onPress}>
          <Text style={styles.name}>{item.name}</Text>
          {item.type === 'quiz' && onOpenQuiz && (
            <Text style={styles.kerjakan}>Ketuk untuk kerjakan di app →</Text>
          )}
        </Pressable>
      </View>

      <View style={styles.status}>
        {loading && <Badge tone="loading">memuat…</Badge>}
        {activity?.status === 'error' && <Badge>gagal</Badge>}
        {a && <StatusBadges type={item.type} a={a} />}
      </View>

      {a && (a.start || a.due) && (
        <Text style={styles.dates}>
          {a.start ? `mulai ${fmtDate(a.start)}` : ''}
          {a.start && a.due ? ' · ' : ''}
          {a.due ? `due ${fmtDate(a.due)}` : ''}
        </Text>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  item: {
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 8,
    marginBottom: 4,
    backgroundColor: '#fafafa',
  },
  itemRed: { backgroundColor: '#fef2f2', borderWidth: 1, borderColor: '#fecaca' },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  type: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', marginTop: 2 },
  nameWrap: { flex: 1 },
  name: { fontSize: 13, color: '#0f172a' },
  kerjakan: { fontSize: 11, color: '#0891b2', fontWeight: '600', marginTop: 2 },
  status: { marginTop: 4 },
  dates: { marginTop: 4, fontSize: 11, color: '#64748b' },
})
