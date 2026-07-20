import { useState } from 'react'
import { StatusBar } from 'expo-status-bar'
import { StyleSheet } from 'react-native'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import { SsoEngineProvider } from './src/engine/SsoEngine'
import DashboardScreen from './src/screens/DashboardScreen'
import LoginScreen from './src/screens/LoginScreen'

export default function App() {
  // session = { user, courses } dari SsoEngine.login (on-device, tanpa server)
  const [session, setSession] = useState(null)
  // Auto-login (kredensial tersimpan + fingerprint) hanya saat app dibuka;
  // setelah user menekan Keluar, kembali ke form manual.
  const [allowAuto, setAllowAuto] = useState(true)

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.root}>
        <StatusBar style="dark" />
        <SsoEngineProvider>
          {session ? (
            <DashboardScreen
              session={session}
              onLogout={() => {
                setAllowAuto(false)
                setSession(null)
              }}
            />
          ) : (
            <LoginScreen onSuccess={setSession} allowAuto={allowAuto} />
          )}
        </SsoEngineProvider>
      </SafeAreaView>
    </SafeAreaProvider>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f1f5f9' },
})
