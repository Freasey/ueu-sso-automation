import { useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { DEFAULT_AI_SETTINGS, loadAiSettings, saveAiSettings } from '../lib/aiSettings'

// Form pengaturan AI (API key, base URL, model) dipakai fitur "Periksa
// Jawaban" di QuizScreen. Disimpan terenkripsi lewat aiSettings.js.
export default function AiSettingsScreen({ onClose }) {
  const [settings, setSettings] = useState(DEFAULT_AI_SETTINGS)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let alive = true
    loadAiSettings().then((s) => {
      if (alive) {
        setSettings(s)
        setLoading(false)
      }
    })
    return () => {
      alive = false
    }
  }, [])

  const set = (key) => (value) => setSettings((s) => ({ ...s, [key]: value }))

  const save = async () => {
    setSaving(true)
    try {
      await saveAiSettings(settings)
      onClose()
    } catch (e) {
      Alert.alert('Gagal menyimpan', e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <View style={styles.root}>
      <View style={styles.head}>
        <Pressable style={styles.close} onPress={onClose} hitSlop={8}>
          <Text style={styles.closeText}>✕</Text>
        </Pressable>
        <Text style={styles.title}>Pengaturan AI</Text>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#1d4ed8" />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.body}>
          <Text style={styles.hint}>
            Dipakai fitur "Periksa Jawaban" saat mengerjakan quiz. Kompatibel dengan API
            bergaya OpenAI (OpenAI, OpenRouter, Groq, atau server lokal seperti LM
            Studio/Ollama) — cukup ganti Base URL &amp; Model sesuai penyedia yang dipakai.
          </Text>

          <Text style={styles.label}>API Key</Text>
          <TextInput
            style={styles.input}
            value={settings.apiKey}
            onChangeText={set('apiKey')}
            placeholder="sk-..."
            placeholderTextColor="#94a3b8"
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
          />

          <Text style={styles.label}>Base URL</Text>
          <TextInput
            style={styles.input}
            value={settings.baseUrl}
            onChangeText={set('baseUrl')}
            placeholder="https://api.openai.com/v1"
            placeholderTextColor="#94a3b8"
            autoCapitalize="none"
            autoCorrect={false}
          />

          <Text style={styles.label}>Model</Text>
          <TextInput
            style={styles.input}
            value={settings.model}
            onChangeText={set('model')}
            placeholder="gpt-4o-mini"
            placeholderTextColor="#94a3b8"
            autoCapitalize="none"
            autoCorrect={false}
          />

          <Pressable style={[styles.btn, saving && styles.disabled]} onPress={save} disabled={saving}>
            {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Simpan</Text>}
          </Pressable>
        </ScrollView>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f1f5f9' },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 10,
    backgroundColor: '#0f172a',
  },
  close: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  closeText: { color: '#fff', fontSize: 18, fontWeight: '700' },
  title: { color: '#fff', fontSize: 15, fontWeight: '700' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  body: { padding: 16, paddingBottom: 32 },
  hint: { color: '#475569', fontSize: 12, lineHeight: 18, marginBottom: 16 },
  label: { fontSize: 12, fontWeight: '700', color: '#334155', marginBottom: 6, marginTop: 10 },
  input: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#0f172a',
  },
  btn: {
    backgroundColor: '#1d4ed8',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 22,
  },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  disabled: { opacity: 0.5 },
})
