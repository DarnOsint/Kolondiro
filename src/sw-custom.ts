/// <reference lib="webworker" />
import { registerRoute } from 'workbox-routing'
import { NetworkFirst } from 'workbox-strategies'
import { CacheableResponsePlugin } from 'workbox-cacheable-response'
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching'

declare const self: ServiceWorkerGlobalScope

cleanupOutdatedCaches()

const rawManifest = ((self as any).__WB_MANIFEST || []) as Array<{ url?: string }>
// Avoid pinning old SPA shells (index.html) forever — always try network first for navigations.
const manifest = rawManifest.filter((entry) => {
  const u = entry?.url || ''
  return !(u === 'index.html' || u === '/index.html' || u.endsWith('/index.html'))
})
precacheAndRoute(manifest as any)

registerRoute(
  ({ request }) => request.mode === 'navigate',
  new NetworkFirst({
    cacheName: 'html-navigate',
    plugins: [new CacheableResponsePlugin({ statuses: [200] })],
  })
)

self.skipWaiting()
;(self as any).clients?.claim()

// ── Push notifications ─────────────────────────────────────────────────────
self.addEventListener('push', (event: PushEvent) => {
  if (!event.data) return

  let payload: { title?: string; body?: string; data?: Record<string, unknown> }
  try {
    payload = event.data.json() as typeof payload
  } catch {
    payload = { title: "Kolondiro", body: event.data.text() }
  }

  const title = payload.title || "Kolondiro"
  const options: NotificationOptions & { renotify?: boolean; vibrate?: number[] } = {
    body: payload.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: 'restaurantos',
    renotify: true,
    data: payload.data || {},
    vibrate: [200, 100, 200],
  }

  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event: NotificationEvent) => {
  event.notification.close()
  event.waitUntil(
    (self as any).clients
      .matchAll({ type: 'window', includeUncontrolled: true })

      .then((clients: any[]) => {
        if (clients.length > 0) {
          return clients[0].focus()
        }

        return (self as any).clients.openWindow('/')
      })
  )
})
