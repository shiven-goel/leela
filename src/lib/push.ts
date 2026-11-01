// Sweet spot reminders on this phone: ask permission, subscribe for Web Push, and save the
// subscription (with how many minutes ahead) so the server can send reminders. Per person, per phone.
import { getState } from './store'
import { supabase } from './supabase'

const VAPID = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined
const LOCAL = 'leela-reminders'

export type PushSupport = 'ok' | 'ios-install' | 'unsupported' | 'denied'

const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
const standalone = () => window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true

export function pushSupport(): PushSupport {
  const capable = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && Boolean(VAPID)
  if (isIos() && !standalone()) return 'ios-install'
  if (!capable) return 'unsupported'
  if (Notification.permission === 'denied') return 'denied'
  return 'ok'
}

function keyBytes(b64url: string): Uint8Array<ArrayBuffer> {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b64url.length % 4)) % 4)
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

async function registration(waitMs = 10_000): Promise<ServiceWorkerRegistration> {
  const ready = navigator.serviceWorker.ready
  const timeout = new Promise<never>((_, no) => setTimeout(() => no(new Error('no service worker')), waitMs))
  return Promise.race([ready, timeout])
}

export async function currentSubscription(waitMs?: number): Promise<PushSubscription | null> {
  if (pushSupport() !== 'ok') return null
  try {
    return await (await registration(waitMs)).pushManager.getSubscription()
  } catch {
    return null
  }
}

/** This phone's reminder setting as last saved: minutes ahead, or null when off. */
export function localReminder(): number | null {
  try {
    const v = JSON.parse(localStorage.getItem(LOCAL) ?? 'null')
    return typeof v?.lead === 'number' ? v.lead : null
  } catch {
    return null
  }
}
function remember(lead: number | null, endpoint?: string) {
  try {
    if (lead === null) localStorage.removeItem(LOCAL)
    else localStorage.setItem(LOCAL, JSON.stringify({ lead, endpoint }))
  } catch {
    /* fine */
  }
}

/** Reads what the server has for this phone, so the setting is right after reinstalling. */
export async function savedReminder(): Promise<number | null> {
  const sub = await currentSubscription()
  const { userId } = getState()
  if (!sub || !userId) return null
  const { data } = await supabase.from('push_subscriptions').select('lead_min, disabled_at').eq('user_id', userId).eq('endpoint', sub.endpoint).maybeSingle()
  const lead = data && !data.disabled_at ? data.lead_min : null
  remember(lead, sub.endpoint)
  return lead
}

export type EnableResult = { ok: true } | { ok: false; reason: 'denied' | 'unsupported' | 'ios-install' | 'failed'; detail?: string }

export async function enableReminders(leadMin: number): Promise<EnableResult> {
  const support = pushSupport()
  if (support !== 'ok') return { ok: false, reason: support }
  const { userId, family } = getState()
  if (!userId || !family) return { ok: false, reason: 'failed', detail: 'not signed in' }
  try {
    const permission = await Notification.requestPermission()
    if (permission !== 'granted') return { ok: false, reason: 'denied' }
    const reg = await registration()
    let sub = await reg.pushManager.getSubscription()
    // A subscription made with another key can't receive Leela's messages: replace it.
    const key = sub?.options?.applicationServerKey
    if (sub && key && new Uint8Array(key).join() !== keyBytes(VAPID!).join()) {
      await sub.unsubscribe()
      sub = null
    }
    sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID!) })
    const json = sub.toJSON() as { endpoint: string; keys?: { p256dh?: string; auth?: string } }
    if (!json.keys?.p256dh || !json.keys.auth) return { ok: false, reason: 'failed', detail: 'no keys' }
    const { error } = await supabase.from('push_subscriptions').upsert(
      {
        user_id: userId,
        family_id: family.id,
        endpoint: json.endpoint,
        p256dh: json.keys.p256dh,
        auth: json.keys.auth,
        lead_min: leadMin,
        app_url: new URL(import.meta.env.BASE_URL, window.location.origin).href,
        user_agent: navigator.userAgent.slice(0, 300),
        disabled_at: null,
        disabled_reason: null,
      },
      { onConflict: 'user_id,endpoint' },
    )
    if (error) return { ok: false, reason: 'failed', detail: error.message }
    remember(leadMin, json.endpoint)
    return { ok: true }
  } catch (e) {
    return { ok: false, reason: 'failed', detail: String((e as Error)?.message ?? e) }
  }
}

export async function setReminderLead(leadMin: number): Promise<boolean> {
  const sub = await currentSubscription()
  const { userId } = getState()
  if (!sub || !userId) return false
  const { error } = await supabase.from('push_subscriptions').update({ lead_min: leadMin }).eq('user_id', userId).eq('endpoint', sub.endpoint)
  if (!error) remember(leadMin, sub.endpoint)
  return !error
}

/** Stops reminders on this phone for this person (also used when signing out or leaving). */
export async function disableReminders(reason = 'turned off'): Promise<void> {
  remember(null)
  // Quick: this also runs on the way out of signing out.
  const sub = await currentSubscription(2000)
  const { userId } = getState()
  if (!sub || !userId) return
  await supabase.from('push_subscriptions').update({ disabled_at: new Date().toISOString(), disabled_reason: reason }).eq('user_id', userId).eq('endpoint', sub.endpoint)
}

export async function sendTestReminder(): Promise<boolean> {
  const sub = await currentSubscription()
  if (!sub) return false
  const { data, error } = await supabase.functions.invoke('sweetspot-push', { body: { action: 'test', endpoint: sub.endpoint } })
  return !error && Boolean((data as { ok?: boolean } | null)?.ok)
}
