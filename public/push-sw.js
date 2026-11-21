// Leela's notifications, loaded into the service worker: show what the server sends (Sweet spot,
// medicine, vaccine and evening summary notifications) and open Leela when one is tapped. A
// notification can name a screen to open (data.open, e.g. "vaccines"): an open Leela is told by
// message, a new one gets ?open= in its address.
self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = { body: event.data ? event.data.text() : '' }
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'LAPdiary', {
      body: data.body || '',
      tag: data.tag || 'leela',
      renotify: true,
      icon: 'icon-192.png',
      badge: 'icon-192.png',
      data: { url: data.url || self.registration.scope, open: data.open || null },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const data = event.notification.data || {}
  let url = data.url || self.registration.scope
  if (data.open) url += (url.includes('?') ? '&' : '?') + 'open=' + encodeURIComponent(data.open)
  event.waitUntil(
    (async () => {
      const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      for (const c of open) {
        if (c.url.startsWith(self.registration.scope) && 'focus' in c) {
          if (data.open) c.postMessage({ leelaOpen: data.open })
          return c.focus()
        }
      }
      return self.clients.openWindow(url)
    })(),
  )
})
