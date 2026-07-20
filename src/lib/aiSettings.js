import * as SecureStore from 'expo-secure-store'

// Pengaturan AI (API key + endpoint + model) tersimpan terenkripsi di
// SecureStore, terpisah dari kredensial SSO (lihat credentials.js) supaya
// bisa diubah/dihapus independen dari sesi login. Record yang tersimpan juga
// menyimpan `ownerUsername` (bukan bagian dari DEFAULT_AI_SETTINGS, jadi tidak
// pernah tampil di form) supaya resetAiSettingsIfAccountChanged tahu kapan
// harus mereset API key saat akun yang login berganti.
const AI_SETTINGS_KEY = 'ueu.ai.settings'

export const DEFAULT_AI_SETTINGS = {
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  model: 'gpt-4o-mini',
}

async function readStored() {
  try {
    const raw = await SecureStore.getItemAsync(AI_SETTINGS_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export async function loadAiSettings() {
  const stored = await readStored()
  return stored ? { ...DEFAULT_AI_SETTINGS, ...stored } : { ...DEFAULT_AI_SETTINGS }
}

export async function saveAiSettings(settings) {
  const stored = await readStored()
  await SecureStore.setItemAsync(
    AI_SETTINGS_KEY,
    JSON.stringify({ ...settings, ownerUsername: stored?.ownerUsername }),
  )
}

/**
 * Panggil sekali tiap login sukses (lihat LoginScreen). Kalau akun yang login
 * beda dari pemilik pengaturan AI yang tersimpan, semua pengaturan AI
 * (termasuk API key) direset ke default supaya API key milik akun sebelumnya
 * tidak ikut kebawa/kepakai di akun yang baru. Login pertama kali / akun yang
 * sama hanya menyimpan/mempertahankan ownerUsername.
 */
export async function resetAiSettingsIfAccountChanged(username) {
  try {
    const stored = await readStored()
    const changed = stored?.ownerUsername && stored.ownerUsername !== username
    const next = changed
      ? { ...DEFAULT_AI_SETTINGS, ownerUsername: username }
      : { ...DEFAULT_AI_SETTINGS, ...stored, ownerUsername: username }
    await SecureStore.setItemAsync(AI_SETTINGS_KEY, JSON.stringify(next))
  } catch {
    // Gagal baca/tulis pengaturan AI bukan alasan menggagalkan login.
  }
}
