import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native'
import { useEngine } from '../engine/SsoEngine'
import CourseCard from '../components/CourseCard'
import QuizScreen from './QuizScreen'
import AiSettingsScreen from './AiSettingsScreen'

// Dashboard lazy: TIDAK ada fetch otomatis setelah login. Data satu course
// baru diambil saat course-nya diketuk (outline dulu, lalu tiap item mengisi
// statusnya sendiri lewat antrean SsoEngine). Fetch yang sudah jalan tidak
// dibatalkan walau user pindah course. Tombol "Muat Semua Data" memicu fetch
// untuk seluruh course sekaligus.
export default function DashboardScreen({ session, onLogout }) {
  const engine = useEngine()
  const { user, courses } = session
  const [outlines, setOutlines] = useState({})
  const [activities, setActivities] = useState({})
  const [expanded, setExpanded] = useState({})
  const [refreshing, setRefreshing] = useState(false)
  const [activeQuiz, setActiveQuiz] = useState(null) // { name, url, cmid } | null
  const [aiSettingsOpen, setAiSettingsOpen] = useState(false)
  // Sumber kebenaran sinkron course mana yang fetch-nya sudah dimulai
  // (state outlines menyusul di render berikutnya).
  const startedRef = useRef(new Set())
  const aliveRef = useRef(true)

  useEffect(
    () => () => {
      aliveRef.current = false
    },
    [],
  )

  const fetchCourse = useCallback(
    (course) => {
      const id = course.id
      if (startedRef.current.has(id)) return
      startedRef.current.add(id)
      const setO = (v) => aliveRef.current && setOutlines((s) => ({ ...s, [id]: v }))
      const setA = (k, v) => aliveRef.current && setActivities((s) => ({ ...s, [k]: v }))

      setO({ status: 'loading' })
      engine
        .getOutline(id)
        .then((j) => {
          setO({ status: 'done', data: j })
          for (const sec of j.sessions) {
            for (const it of sec.items) {
              const key = `${id}:${it.cmid}`
              setA(key, { status: 'loading' })
              engine
                .getActivityStatus({ type: it.type, url: it.url })
                .then((aj) => setA(key, { status: 'done', data: aj }))
                .catch((err) => setA(key, { status: 'error', error: err.message }))
            }
          }
        })
        .catch((err) => setO({ status: 'error', error: err.message }))
    },
    [engine],
  )

  const onPressCourse = useCallback(
    (course) => {
      const o = outlines[course.id]
      if (o?.status === 'error') {
        // Ketuk lagi setelah gagal = coba ulang.
        startedRef.current.delete(course.id)
        fetchCourse(course)
        setExpanded((s) => ({ ...s, [course.id]: true }))
        return
      }
      if (!startedRef.current.has(course.id)) {
        fetchCourse(course)
        setExpanded((s) => ({ ...s, [course.id]: true }))
        return
      }
      setExpanded((s) => ({ ...s, [course.id]: !s[course.id] }))
    },
    [outlines, fetchCourse],
  )

  const loadAll = useCallback(() => {
    for (const c of courses) fetchCourse(c)
  }, [courses, fetchCourse])

  // Refresh = ulangi fetch untuk course yang sudah pernah dimulai saja.
  const onRefresh = useCallback(() => {
    const ids = new Set(startedRef.current)
    if (ids.size === 0) return
    setRefreshing(true)
    startedRef.current = new Set()
    setOutlines({})
    setActivities({})
    for (const c of courses) if (ids.has(c.id)) fetchCourse(c)
  }, [courses, fetchCourse])

  useEffect(() => {
    if (!refreshing) return
    const pending = [...startedRef.current].some((id) => outlines[id]?.status === 'loading')
    if (!pending) setRefreshing(false)
  }, [refreshing, outlines])

  // Progres global untuk tombol Muat Semua: course selesai penuh = outline done
  // dan semua item aktivitasnya sudah tidak loading.
  const progress = useMemo(() => {
    let started = 0
    let loaded = 0
    for (const c of courses) {
      const o = outlines[c.id]
      if (!o) continue
      started++
      if (o.status === 'error') {
        loaded++
        continue
      }
      if (o.status !== 'done') continue
      const resolved = o.data.sessions
        .flatMap((s) => s.items)
        .every((it) => {
          const a = activities[`${c.id}:${it.cmid}`]
          return a && a.status !== 'loading'
        })
      if (resolved) loaded++
    }
    return { started, loaded, total: courses.length }
  }, [courses, outlines, activities])

  const allStarted = progress.started >= courses.length
  const allDone = allStarted && progress.loaded >= courses.length

  if (activeQuiz) {
    return <QuizScreen quiz={activeQuiz} onClose={() => setActiveQuiz(null)} />
  }

  if (aiSettingsOpen) {
    return <AiSettingsScreen onClose={() => setAiSettingsOpen(false)} />
  }

  return (
    <View style={styles.root}>
      <View style={styles.head}>
        <View style={styles.flex}>
          <Text style={styles.title}>Mata Kuliah Saya</Text>
          {user && (
            <Text style={styles.user}>
              {user.name} · <Text style={styles.muted}>{user.nim}</Text>
            </Text>
          )}
        </View>
        <Pressable style={[styles.ghost, styles.ghostGap]} onPress={() => setAiSettingsOpen(true)}>
          <Text style={styles.ghostText}>Pengaturan AI</Text>
        </Pressable>
        <Pressable style={styles.ghost} onPress={onLogout}>
          <Text style={styles.ghostText}>Keluar</Text>
        </Pressable>
      </View>

      {courses.length === 0 ? (
        <View style={styles.errBox}>
          <Text style={styles.errTitle}>Login berhasil</Text>
          <Text style={styles.errText}>
            Tapi daftar mata kuliah tidak bisa dibaca dari halaman e-learning.
          </Text>
        </View>
      ) : (
        <FlatList
          data={courses}
          keyExtractor={(c) => String(c.id)}
          ListHeaderComponent={
            <View style={styles.toolbar}>
              <Pressable
                style={[styles.loadAll, allStarted && styles.loadAllDisabled]}
                onPress={loadAll}
                disabled={allStarted}
              >
                <Text style={styles.loadAllText}>
                  {allDone
                    ? 'Semua data dimuat'
                    : allStarted
                      ? `Memuat semua… ${progress.loaded}/${progress.total}`
                      : 'Muat Semua Data'}
                </Text>
              </Pressable>
              <Text style={styles.toolbarHint}>
                {progress.started === 0
                  ? 'Ketuk mata kuliah untuk memuat datanya.'
                  : `${progress.loaded}/${progress.total} mata kuliah dimuat`}
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <CourseCard
              course={item}
              outline={outlines[item.id]}
              activities={activities}
              expanded={!!expanded[item.id]}
              onPress={() => onPressCourse(item)}
              onOpenQuiz={(it) => setActiveQuiz({ name: it.name, url: it.url, cmid: it.cmid })}
            />
          )}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f1f5f9' },
  flex: { flex: 1 },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
  },
  title: { fontSize: 20, fontWeight: '800', color: '#0f172a' },
  user: { fontSize: 13, color: '#334155', marginTop: 2 },
  muted: { color: '#64748b' },
  ghost: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  ghostText: { color: '#334155', fontSize: 13, fontWeight: '600' },
  ghostGap: { marginRight: 8 },
  list: { padding: 16, paddingTop: 8 },
  toolbar: { marginBottom: 12 },
  loadAll: {
    backgroundColor: '#1d4ed8',
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  loadAllDisabled: { backgroundColor: '#93c5fd' },
  loadAllText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  toolbarHint: { fontSize: 12, color: '#64748b', textAlign: 'center', marginTop: 6 },
  errBox: {
    margin: 16,
    backgroundColor: '#fef2f2',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#fecaca',
  },
  errTitle: { color: '#b91c1c', fontWeight: '700', marginBottom: 2 },
  errText: { color: '#b91c1c', fontSize: 13 },
})
