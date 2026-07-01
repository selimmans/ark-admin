// ─── ARK Push Notifications ───────────────────────────────────────────────
// Handles permission, push subscription storage, and in-app daily briefing.

const VAPID_PUBLIC_KEY = 'BI6LmlqTRYBCu8UQ1dk7KpmHHT_i7wBqR_5LpOK-EjDoW7H_0-3enBLxVj-H1t1TQFms6ZTN2CX-zr_ZmSyoEo0'

function _urlB64ToUint8(b64) {
  const pad = '='.repeat((4 - b64.length % 4) % 4)
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)))
}

// Called from auth.js after role is confirmed
window.setupNotifications = async function() {
  if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) return

  // Don't ask on every page load — only if not yet decided
  if (Notification.permission === 'default') {
    // Small delay so it doesn't pop immediately on login
    await new Promise(r => setTimeout(r, 2000))
    await Notification.requestPermission()
  }

  if (Notification.permission !== 'granted') return

  try {
    const reg = await navigator.serviceWorker.ready
    let sub = await reg.pushManager.getSubscription()

    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: _urlB64ToUint8(VAPID_PUBLIC_KEY)
      })
      console.log('[ARK] New push subscription created')
    } else {
      console.log('[ARK] Existing push subscription found')
    }

    // Store subscription in Supabase (upsert — safe to call every login)
    const j = sub.toJSON()
    const { error: upsertErr } = await window._db.from('push_subscriptions').upsert({
      user_id:  window._user.id,
      endpoint: j.endpoint,
      p256dh:   j.keys.p256dh,
      auth:     j.keys.auth,
    }, { onConflict: 'user_id,endpoint' })

    if (upsertErr) {
      console.error('[ARK] Push subscription save failed:', upsertErr.message)
    } else {
      console.log('[ARK] Push subscription saved to DB ✓')
    }
  } catch(e) {
    console.warn('[ARK] Push subscription failed:', e.message)
  }

  // Show an in-app briefing for today
  _notifyToday()

  // Update the app icon badge with today's action count
  _updateBadge()
}

// ── App icon badge (red number) ───────────────────────────────────────────────
// Shows the total count of today's actionable items on the home screen icon.
// Supported on Android Chrome, desktop Chrome/Edge. Clears on app open.
function _updateBadge() {
  if (!('setAppBadge' in navigator)) return

  const today    = new Date().toISOString().split('T')[0]
  const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0]
  const bookings = (window.DB?.getBookings() || []).filter(b => b.status !== 'cancelled')

  const arrivals   = bookings.filter(b => (b.checkIn  || '').startsWith(today)).length
  const departures = bookings.filter(b => (b.checkOut || '').startsWith(today)).length
  const unpaidSoon = bookings.filter(b =>
    b.status === 'confirmed' && b.paymentStatus === 'unpaid' &&
    b.checkIn >= today && b.checkIn <= tomorrow
  ).length

  const total = arrivals + departures + unpaidSoon
  if (total > 0) {
    navigator.setAppBadge(total).catch(() => {})
  } else {
    navigator.clearAppBadge().catch(() => {})
  }
}

// Call when data changes so badge stays current (e.g. after completing a cleaning task)
window.refreshBadge = _updateBadge

function _notifyToday() {
  if (Notification.permission !== 'granted') return

  // Only show once per calendar day per device
  const todayKey = 'ark_notified_' + new Date().toISOString().split('T')[0]
  if (sessionStorage.getItem(todayKey)) return
  sessionStorage.setItem(todayKey, '1')

  const d0 = new Date(); d0.setHours(0,0,0,0)
  const d1 = new Date(d0); d1.setDate(d1.getDate()+1)
  const d2 = new Date(d0); d2.setDate(d2.getDate()+2)
  const today    = d0.toISOString().split('T')[0]
  const tomorrow = d1.toISOString().split('T')[0]
  const in2days  = d2.toISOString().split('T')[0]

  const bookings = (window.DB?.getBookings() || []).filter(b => b.status !== 'cancelled')

  function label(dateStr) {
    if (dateStr === today)    return 'today'
    if (dateStr === tomorrow) return 'tomorrow'
    return 'in 2 days'
  }

  // Gather arrivals and departures within the next 2 days, grouped by when
  const parts = []
  ;[today, tomorrow, in2days].forEach(ds => {
    const arr = bookings.filter(b => (b.checkIn  || '').startsWith(ds)).length
    const dep = bookings.filter(b => (b.checkOut || '').startsWith(ds)).length
    if (arr) parts.push(`${arr} arrival${arr > 1 ? 's' : ''} ${label(ds)}`)
    if (dep) parts.push(`${dep} departure${dep > 1 ? 's' : ''} ${label(ds)}`)
  })

  const unpaidSoon = bookings.filter(b =>
    b.status === 'confirmed' && b.paymentStatus === 'unpaid' &&
    b.checkIn >= today && b.checkIn <= in2days
  ).length
  if (unpaidSoon) parts.push(`${unpaidSoon} unpaid booking${unpaidSoon > 1 ? 's' : ''} due soon`)

  if (!parts.length) return

  new Notification('ARK OS · Upcoming', {
    body:  parts.join(' · '),
    icon:  './icons/icon-192.png',
    badge: './icons/icon-192.png',
    tag:   'ark-daily',
    renotify: false,
  })
}
