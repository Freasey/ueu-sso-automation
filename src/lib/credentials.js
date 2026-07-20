import * as SecureStore from 'expo-secure-store'
import * as LocalAuthentication from 'expo-local-authentication'

// Kredensial SSO tersimpan terenkripsi di SecureStore (Keystore/Keychain).
// Akses aplikasi digerbangi LocalAuthentication (fingerprint / kunci layar HP),
// bukan opsi requireAuthentication SecureStore, supaya perilakunya seragam
// Android/iOS dan tetap jalan di perangkat tanpa biometrik.
const CREDS_KEY = 'ueu.sso.creds'

export async function loadCreds() {
  try {
    const raw = await SecureStore.getItemAsync(CREDS_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export async function saveCreds({ username, password }) {
  try {
    await SecureStore.setItemAsync(CREDS_KEY, JSON.stringify({ username, password }))
  } catch {
    // Gagal menyimpan bukan alasan menggagalkan login.
  }
}

export async function clearCreds() {
  try {
    await SecureStore.deleteItemAsync(CREDS_KEY)
  } catch {}
}

/**
 * Minta fingerprint / kunci layar sebelum auto-login. -> true bila lolos.
 * Perangkat tanpa kunci layar/biometrik tidak diblokir (dianggap lolos);
 * hanya penolakan eksplisit user yang mengembalikan false.
 */
export async function unlockWithDeviceAuth() {
  try {
    const res = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Masuk otomatis ke UEU E-Learning',
      cancelLabel: 'Pakai NIM & password',
    })
    if (res.success) return true
    return res.error === 'not_enrolled' || res.error === 'passcode_not_set' || res.error === 'not_available'
  } catch {
    return false
  }
}
