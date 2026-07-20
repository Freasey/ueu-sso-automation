import { useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { useEngine } from '../engine/SsoEngine'
import { clearCreds, loadCreds, saveCreds, unlockWithDeviceAuth } from '../lib/credentials'
import { resetAiSettingsIfAccountChanged } from '../lib/aiSettings'

// Port LoginForm dari src/App.jsx asal — tapi login berjalan on-device lewat
// SsoEngine (WebView tersembunyi), tanpa server. Kredensial yang pernah sukses
// tersimpan di SecureStore; saat app dibuka lagi, auto-login digerbangi
// fingerprint / kunci layar HP. Kredensial dihapus bila server bilang salah.
export default function LoginScreen({ onSuccess, allowAuto = true }) {
  const engine = useEngine()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  // 'checking' = baca SecureStore, 'auto' = auto-login berjalan, 'form' = manual
  const [phase, setPhase] = useState(allowAuto ? 'checking' : 'form')
  const autoTried = useRef(false)

  async function doLogin({ username, password }) {
    setLoading(true)
    setError(null)

    try {
      const data = await engine.login({ username: username.trim(), password })

      if (!data.success) {
        if (data.reason === 'credentials') {
          // NIM/password salah — buang simpanan, minta login ulang.
          await clearCreds()
          setPassword('')
          setError('NIM atau password salah — silakan login ulang.')
        } else if (data.blocked) {
          setError('Diblokir Cloudflare — verifikasi belum terselesaikan. Coba lagi.')
        } else {
          setError('Kredensial terkirim tapi sesi e-learning tidak terbentuk. Coba lagi.')
        }
        setPhase('form')
        return
      }

      await saveCreds({ username: username.trim(), password })
      await resetAiSettingsIfAccountChanged(username.trim())
      onSuccess({ user: data.user, courses: data.courses })
    } catch (err) {
      setError(`Login gagal: ${err.message}. Periksa koneksi internet lalu coba lagi.`)
      setPhase('form')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (autoTried.current) return
    autoTried.current = true
    let alive = true
    ;(async () => {
      const creds = await loadCreds()
      if (!alive) return
      if (!creds) {
        setPhase('form')
        return
      }
      // Prefill supaya form manual tinggal tekan Masuk.
      setUsername(creds.username)
      setPassword(creds.password)
      if (!allowAuto) {
        setPhase('form')
        return
      }
      const unlocked = await unlockWithDeviceAuth()
      if (!alive) return
      if (!unlocked) {
        setPhase('form')
        return
      }
      setPhase('auto')
      doLogin(creds)
    })()
    return () => {
      alive = false
    }
  }, [])

  function handleSubmit() {
    if (!username || !password || loading) return
    doLogin({ username, password })
  }

  if (phase === 'checking' || phase === 'auto') {
    return (
      <View style={styles.autoWrap}>
        <View style={styles.card}>
          <View style={styles.logo}>
            <Text style={styles.logoText}>UEU</Text>
          </View>
          <ActivityIndicator color="#1d4ed8" size="large" style={styles.autoSpinner} />
          <Text style={styles.title}>
            {phase === 'checking' ? 'Memeriksa akun tersimpan…' : 'Masuk otomatis…'}
          </Text>
          {phase === 'auto' && (
            <Text style={styles.subtitle}>
              Login sebagai {username} — bisa ±30 detik. Kalau muncul layar verifikasi
              Cloudflare, tap kotaknya sekali.
            </Text>
          )}
          {phase === 'auto' && (
            <Pressable style={styles.ghost} onPress={() => setPhase('form')}>
              <Text style={styles.ghostText}>Pakai akun lain</Text>
            </Pressable>
          )}
        </View>
      </View>
    )
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.wrap} keyboardShouldPersistTaps="handled">
        <View style={styles.card}>
          <View style={styles.logo}>
            <Text style={styles.logoText}>UEU</Text>
          </View>
          <Text style={styles.title}>SSO Esa Unggul</Text>
          <Text style={styles.subtitle}>Masuk dengan akun Single Sign-On Anda</Text>

          <Text style={styles.label}>Username</Text>
          <TextInput
            style={styles.input}
            value={username}
            onChangeText={setUsername}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="NIM / NIP"
          />

          <Text style={styles.label}>Password</Text>
          <View style={styles.passwordRow}>
            <TextInput
              style={[styles.input, styles.flex]}
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPassword}
              autoCapitalize="none"
              placeholder="••••••••"
            />
            <Pressable style={styles.toggle} onPress={() => setShowPassword((v) => !v)}>
              <Text style={styles.toggleText}>{showPassword ? 'Sembunyikan' : 'Lihat'}</Text>
            </Pressable>
          </View>

          <Pressable
            style={[styles.submit, loading && styles.submitDisabled]}
            onPress={handleSubmit}
            disabled={loading}
          >
            {loading ? (
              <View style={styles.submitRow}>
                <ActivityIndicator color="#fff" size="small" />
                <Text style={styles.submitText}> Memproses…</Text>
              </View>
            ) : (
              <Text style={styles.submitText}>Masuk</Text>
            )}
          </Pressable>

          {loading && (
            <Text style={styles.hint}>
              Login SSO + membuka e-learning berjalan di perangkat ini, bisa ±30 detik. Kalau
              muncul layar verifikasi Cloudflare, tap kotaknya sekali.
            </Text>
          )}

          {error && (
            <View style={styles.errBox}>
              <Text style={styles.errTitle}>✕ Gagal</Text>
              <Text style={styles.errText}>{error}</Text>
            </View>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  wrap: { flexGrow: 1, justifyContent: 'center', padding: 20, backgroundColor: '#f1f5f9' },
  autoWrap: { flex: 1, justifyContent: 'center', padding: 20, backgroundColor: '#f1f5f9' },
  autoSpinner: { marginVertical: 12 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  logo: {
    alignSelf: 'center',
    backgroundColor: '#1d4ed8',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginBottom: 10,
  },
  logoText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  title: { fontSize: 20, fontWeight: '700', textAlign: 'center', color: '#0f172a' },
  subtitle: { fontSize: 13, textAlign: 'center', color: '#64748b', marginBottom: 16 },
  ghost: {
    alignSelf: 'center',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginTop: 4,
  },
  ghostText: { color: '#334155', fontSize: 13, fontWeight: '600' },
  label: { fontSize: 12, fontWeight: '600', color: '#475569', marginBottom: 4, marginTop: 10 },
  input: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    backgroundColor: '#fff',
  },
  passwordRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  toggle: { paddingHorizontal: 8, paddingVertical: 10 },
  toggleText: { color: '#1d4ed8', fontSize: 12, fontWeight: '600' },
  submit: {
    backgroundColor: '#1d4ed8',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 18,
  },
  submitDisabled: { opacity: 0.7 },
  submitRow: { flexDirection: 'row', alignItems: 'center' },
  submitText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  hint: { marginTop: 10, fontSize: 12, color: '#64748b', textAlign: 'center' },
  errBox: {
    marginTop: 14,
    backgroundColor: '#fef2f2',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#fecaca',
  },
  errTitle: { color: '#b91c1c', fontWeight: '700', marginBottom: 2 },
  errText: { color: '#b91c1c', fontSize: 13 },
})
