import { useEffect } from 'react'
import { ConflictDialog } from './components/ConflictDialog'
import { LeelaMark } from './components/LeelaMark'
import { NoteEditor } from './components/NoteEditor'
import { TabBar } from './components/TabBar'
import { Toasts } from './components/Toasts'
import { useLeela } from './lib/store'
import { applyTheme } from './lib/theme'
import { AuthScreen } from './screens/AuthScreen'
import { DiaryScreen } from './screens/DiaryScreen'
import { FamilyScreen } from './screens/FamilyScreen'
import { HistoryScreen } from './screens/HistoryScreen'
import { BookScreen } from './screens/BookScreen'
import { ImportScreen } from './screens/ImportScreen'
import { NotesScreen } from './screens/NotesScreen'
import { OnboardingScreen } from './screens/OnboardingScreen'
import { TodayScreen } from './screens/TodayScreen'
import { VaccinesScreen } from './screens/VaccinesScreen'
import { ReportScreen } from './screens/ReportScreen'
import { AdminScreen } from './screens/AdminScreen'
import { myPrefs } from './lib/store'

export function App() {
  const status = useLeela((s) => s.status)
  const onboarding = useLeela((s) => s.onboarding)
  const tab = useLeela((s) => s.tab)
  const family = useLeela((s) => s.family)
  const overlay = useLeela((s) => s.overlay)
  const closeOverlay = () => useLeela.getState().set({ overlay: null })

  // A tapped notification can ask for a screen: ?open=vaccines in a new window, or a message from
  // the service worker when Leela was already open (public/push-sw.js).
  const ready = status === 'ready' && Boolean(family) && !onboarding
  useEffect(() => {
    if (!ready) return
    const go = (what: unknown) => {
      if (what === 'vaccines') useLeela.getState().set({ tab: 'today', overlay: { kind: 'vaccines' } })
      else if (what === 'today') useLeela.getState().set({ tab: 'today' })
    }
    const url = new URL(window.location.href)
    const asked = url.searchParams.get('open')
    if (asked) {
      go(asked)
      url.searchParams.delete('open')
      window.history.replaceState(window.history.state, '', url.toString())
    }
    const onMessage = (e: MessageEvent) => go((e.data as { leelaOpen?: unknown } | null)?.leelaOpen)
    navigator.serviceWorker?.addEventListener('message', onMessage)
    return () => navigator.serviceWorker?.removeEventListener('message', onMessage)
  }, [ready])

  useEffect(() => {
    applyTheme(family)
    const t = window.setInterval(() => applyTheme(useLeela.getState().family), 60_000)
    return () => window.clearInterval(t)
  }, [family])

  let screen: React.ReactNode
  if (status === 'loading') {
    screen = (
      <div className="grid min-h-dvh place-items-center" aria-busy="true" aria-label="Loading LAPdiary">
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
          {tab === 'notes' && <NotesScreen />}
          {tab === 'diary' && <DiaryScreen />}
          {tab === 'family' && <FamilyScreen />}
        </main>
        <TabBar />
        <ConflictDialog />
        <ImportScreen open={overlay?.kind === 'import'} onClose={closeOverlay} />
        <NoteEditor open={overlay?.kind === 'note'} noteId={overlay?.kind === 'note' ? overlay.id : undefined} onClose={closeOverlay} />
        <BookScreen open={overlay?.kind === 'book'} onClose={closeOverlay} />
        <VaccinesScreen open={overlay?.kind === 'vaccines'} onClose={closeOverlay} />
        <ReportScreen open={overlay?.kind === 'report'} onClose={closeOverlay} />
        {myPrefs().admin === true && <AdminScreen open={overlay?.kind === 'admin'} onClose={closeOverlay} />}
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
