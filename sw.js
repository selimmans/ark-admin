const CACHE   = 'ark-os-v17'
const BASE_URL = 'https://selimmans.github.io/ark-admin'

const SHELL = [
  './',
  './index.html',
  './tasks.html',
  './requests.html',
  './finance.html',
  './analytics.html',
  './invoice.html',
  './auth.html',
  './guest.html',
  './js/supabase.js',
  './js/db.js',
  './js/auth.js',
  './js/notifications.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://fonts.googleapis.com/css2?family=Cinzel:wght@400;500&family=Cormorant+Garamond:ital,wght@0,300;0,400;1,300;1,400&family=Jost:wght@300;400;500&display=swap',
]

// Install: cache the app shell
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())
  )
})

// Activate: delete old caches
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

// Fetch strategy:
//   .html + .js  → network-first  (always fresh code when online, cache fallback offline)
//   everything else → cache-first (fonts, CSS, icons load instantly)
//   Supabase API  → network-only  (db.js handles offline queuing)
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return

  const url = new URL(e.request.url)

  // Supabase API — bypass SW entirely
  if (url.hostname.includes('supabase.co')) return

  const isCode = url.pathname.endsWith('.html') || url.pathname.endsWith('.js')

  if (isCode) {
    // Network-first: always try to get fresh code, fall back to cache when offline
    e.respondWith(
      fetch(e.request)
        .then(r => {
          if (r.ok) caches.open(CACHE).then(c => c.put(e.request, r.clone()))
          return r
        })
        .catch(() => caches.match(e.request).then(c => c || caches.match('./index.html')))
    )
  } else {
    // Cache-first: fonts, CSS, icons — serve instantly, refresh in background
    e.respondWith(
      caches.match(e.request).then(cached => {
        if (cached) {
          fetch(e.request).then(fresh => {
            if (fresh.ok) caches.open(CACHE).then(c => c.put(e.request, fresh))
          }).catch(() => {})
          return cached
        }
        return fetch(e.request).then(r => {
          if (r.ok) caches.open(CACHE).then(c => c.put(e.request, r.clone()))
          return r
        }).catch(() => caches.match('./index.html'))
      })
    )
  }
})

// ── Push: show notification when a background push arrives ──
self.addEventListener('push', e => {
  let data = { title: 'ARK OS', body: 'New update', icon: './icons/icon-192.png' }
  try { data = { ...data, ...e.data.json() } } catch(_) {}

  const tasks = [
    self.registration.showNotification(data.title, {
      body:     data.body,
      icon:     data.icon || './icons/icon-192.png',
      badge:    './icons/icon-192.png',
      tag:      'ark-daily',
      renotify: false,
      data:     { url: data.url || BASE_URL + '/index.html', count: data.count || 1 },
    }),
    // Set badge number if the push includes a count
    data.count
      ? self.registration.badge?.set(data.count).catch(() => {}) ?? Promise.resolve()
      : (navigator.setAppBadge ? navigator.setAppBadge(1).catch(() => {}) : Promise.resolve()),
  ]

  e.waitUntil(Promise.all(tasks))
})

// ── Notification click: focus/open the app ──
self.addEventListener('notificationclick', e => {
  e.notification.close()
  const target = e.notification.data?.url || BASE_URL + '/index.html'
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) {
        if (c.url.includes('ark-admin') && 'focus' in c) return c.focus()
      }
      return clients.openWindow(target)
    })
  )
})
