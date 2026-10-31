import { useEffect } from 'react'
import { ConflictDialog } from './components/ConflictDialog'
import { LeelaMark } from './components/LeelaMark'
import { TabBar } from './components/TabBar'
import { Toasts } from './components/Toasts'
import { useLeela } from './lib/store'
import { applyTheme } from './lib/theme'
import { AuthScreen } from './screens/AuthScreen'
import { DiaryScreen } from './screens/DiaryScreen'
import { FamilyScreen } from './screens/FamilyScreen'
import { HistoryScreen } from './screens/HistoryScreen'
import { OnboardingScreen } from './screens/OnboardingScreen'
import { TodayScreen } from './screens/TodayScreen'

export function App() {
  const status = useLeela((s) => s.status)
  const onboarding = useLeela((s) => s.onboarding)
  const tab = useLeela((s) => s.tab)
  const family = useLeela((s) => s.family)

  useEffect(() => {
    applyTheme(family)
    const t = window.setInterval(() => applyTheme(useLeela.getState().family), 60_000)
    return () => window.clearInterval(t)
  }, [family])

  let screen: React.ReactNode
  if (status === 'loading') {
    screen = (
      <div className="grid min-h-dvh place-items-center" aria-busy="true" aria-label="Loading Leela">
        <LeelaMark className="h-16 w-16 animate-pulse" />
      </div>
    )
  } else if (status === 'signed_out') {
    screen = <AuthScreen />
  } else if (status === 'no_family' || onboarding || !family) {
    screen = <OnboardingScreen />
  } else {
    screen = (
      <>
        <main>
          {tab === 'today' && <TodayScreen />}
          {tab === 'history' && <HistoryScreen />}
          {tab === 'diary' && <DiaryScreen />}
          {tab === 'family' && <FamilyScreen />}
        </main>
        <TabBar />
        <ConflictDialog />
      </>
    )
  }

  return (
    <>
      {screen}
      <Toasts />
    </>
  )
}
