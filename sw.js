const CACHE = 'ark-os-v1'

const SHELL = [
  './',
  './index.html',
  './cleaning.html',
  './tasks.html',
  './finance.html',
  './analytics.html',
  './auth.html',
  './js/supabase.js',
  './js/db.js',
  './js/auth.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js',
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

// Fetch: cache-first for shell, network-only for Supabase API
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return

  const url = new URL(e.request.url)

  // Let Supabase API calls go straight to network — db.js handles offline queuing
  if (url.hostname.includes('supabase.co')) return

  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) {
        // Serve from cache immediately, update in background
        fetch(e.request).then(fresh => {
          if (fresh.ok) caches.open(CACHE).then(c => c.put(e.request, fresh))
        }).catch(() => {})
        return cached
      }
      // Not in cache — fetch and cache it
      return fetch(e.request).then(r => {
        if (r.ok) caches.open(CACHE).then(c => c.put(e.request, r.clone()))
        return r
      }).catch(() => caches.match('./index.html')) // offline fallback
    })
  )
})
