// Leela's notifications, loaded into the service worker: show what the server sends (Sweet spot
// reminders) and open Leela when one is tapped.
self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = { body: event.data ? event.data.text() : '' }
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'Leela', {
      body: data.body || '',
      tag: data.tag || 'leela',
      renotify: true,
      icon: 'icon-192.png',
      badge: 'icon-192.png',
      data: { url: data.url || self.registration.scope },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || self.registration.scope
  event.waitUntil(
    (async () => {
      const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      for (const c of open) {
        if (c.url.startsWith(self.registration.scope) && 'focus' in c) return c.focus()
      }
      return self.clients.openWindow(url)
    })(),
  )
})
