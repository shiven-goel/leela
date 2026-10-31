import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './index.css'
import { supabase } from './lib/supabase'
import { bootstrap, watchConnectivity } from './lib/sync'

watchConnectivity()

supabase.auth.onAuthStateChange((event) => {
  if (event === 'SIGNED_OUT') void bootstrap()
})

const preview = import.meta.env.DEV && new URLSearchParams(window.location.search).has('preview')
if (preview) {
  void import('./dev/seed').then((m) => m.seed(new URLSearchParams(window.location.search).get('preview') ?? ''))
} else {
  void bootstrap()
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
