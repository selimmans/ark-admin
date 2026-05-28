document.documentElement.style.opacity = '0'
document.documentElement.style.transition = 'opacity 180ms ease'

const _PROFILE_CACHE = 'ark_profile_v1'

;(async () => {
  const { data: { session } } = await window._db.auth.getSession()

  if (!session) {
    window.location.replace('./auth.html')
    return
  }

  // Use cached profile to skip the Supabase round-trip on every tab switch.
  // Cache is keyed by user ID so it auto-invalidates if a different user logs in.
  let profile = null
  try {
    const cached = JSON.parse(sessionStorage.getItem(_PROFILE_CACHE))
    if (cached?.uid === session.user.id) profile = cached
  } catch (_) {}

  if (!profile) {
    const { data, error: profileErr } = await window._db
      .from('profiles')
      .select('role, name')
      .eq('id', session.user.id)
      .single()

    if (profileErr || !data) {
      console.error('Profile load failed:', profileErr?.message)
      await window._db.auth.signOut()
      sessionStorage.removeItem(_PROFILE_CACHE)
      document.documentElement.style.opacity = '1'
      document.body.innerHTML = `<div style="font-family:sans-serif;padding:40px;color:#8A4A4A">
        Profile load failed — permission denied.<br><br>
        <small>${profileErr?.message || 'No profile row found'}</small><br><br>
        <a href="./auth.html">Back to login</a>
      </div>`
      return
    }

    profile = { uid: session.user.id, role: data.role, name: data.name }
    try { sessionStorage.setItem(_PROFILE_CACHE, JSON.stringify(profile)) } catch (_) {}
  }

  window._session  = session
  window._user     = session.user
  window._role     = profile.role
  window._userName = profile.name || session.user.email

  // Load all data — hits sessionStorage cache after first load
  if (window.DB) await window.DB.load()

  if (window._role === 'staff') {
    document.body.classList.add('staff-mode')
    const style = document.createElement('style')
    style.textContent = `
      body.staff-mode a[href*="analytics.html"] { display: none !important; }
      body.staff-mode #addBookingBtn            { display: none !important; }
      body.staff-mode #settingsBtn              { display: none !important; }
      body.staff-mode #deleteBookingBtn         { display: none !important; }
      body.staff-mode #deleteCostBtn            { display: none !important; }
      body.staff-mode #deleteBtn                { display: none !important; }
      body.staff-mode #revenue-section          { display: none !important; }
      body.staff-mode #net-section              { display: none !important; }
    `
    document.head.appendChild(style)
  }

  // Inject nav buttons
  const navActions = document.querySelector('.nav-actions')
  if (navActions) {
    const btnStyle = [
      'font-family:var(--sans)', 'font-size:8px', 'font-weight:400',
      'letter-spacing:2px', 'text-transform:uppercase', 'padding:7px 14px',
      'border:0.5px solid var(--border)', 'background:transparent',
      'color:var(--ink-muted)', 'cursor:pointer', 'white-space:nowrap',
      'transition:all 160ms ease'
    ].join(';')

    // Bell button — force-register push and send a test notification
    const bell = document.createElement('button')
    bell.title = 'Test notifications'
    bell.style.cssText = btnStyle + ';padding:7px 10px;font-size:13px;letter-spacing:0'
    bell.textContent = '🔔'
    bell.onclick = async () => {
      bell.textContent = '⏳'
      bell.disabled = true
      const log = []
      try {
        log.push('Permission: ' + Notification.permission)
        if (Notification.permission === 'default') {
          const r = await Notification.requestPermission()
          log.push('After prompt: ' + r)
        }
        if (Notification.permission !== 'granted') {
          alert('Blocked.\n\nGo to Settings → Safari → [this site] → Notifications → Allow.\n\n' + log.join('\n'))
          bell.textContent = '🔔'; bell.disabled = false; return
        }

        const reg = await navigator.serviceWorker.ready
        log.push('SW: ready')

        let sub = await reg.pushManager.getSubscription()
        log.push('Existing sub: ' + (sub ? 'yes' : 'no'))

        if (!sub) {
          sub = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: _urlB64ToUint8(VAPID_PUBLIC_KEY)
          })
          log.push('New sub created ✓')
        }

        const j = sub.toJSON()
        log.push('Endpoint: …' + j.endpoint.slice(-30))

        const { error: upsertErr } = await window._db.from('push_subscriptions').upsert({
          user_id:  window._user?.id,
          endpoint: j.endpoint,
          p256dh:   j.keys.p256dh,
          auth:     j.keys.auth,
        }, { onConflict: 'user_id,endpoint' })

        if (upsertErr) {
          log.push('DB save FAILED: ' + upsertErr.message)
          alert('Subscription save failed:\n\n' + log.join('\n'))
          bell.textContent = '🔔'; bell.disabled = false; return
        }
        log.push('DB save: OK ✓')

        // Fire a test push via the Edge Function
        const testRes = await fetch('https://fqpxbvpjugbqelivtyae.supabase.co/functions/v1/notify-request', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZxcHhidnBqdWdicWVsaXZ0eWFlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk3NDMxODMsImV4cCI6MjA5NTMxOTE4M30.oAekeolXabUxZmS3EmpdkS-hNs-OBuuURhyDzA2zuM8' },
          body: JSON.stringify({ type: 'general', guest_name: 'Test' }),
        })
        const testJson = await testRes.json()
        log.push('Test push: ' + JSON.stringify(testJson))

        alert('Done!\n\n' + log.join('\n'))
        bell.textContent = '✓'
        setTimeout(() => { bell.textContent = '🔔'; bell.disabled = false }, 3000)
      } catch(e) {
        log.push('ERROR: ' + e.message)
        alert('Failed at step:\n\n' + log.join('\n'))
        bell.textContent = '🔔'; bell.disabled = false
      }
    }
    navActions.appendChild(bell)

    // Sign out button
    const signOutBtn = document.createElement('button')
    signOutBtn.setAttribute('onclick', 'signOut()')
    signOutBtn.className = 'btn-signout'
    signOutBtn.style.cssText = btnStyle
    signOutBtn.textContent = window._userName + ' · Sign Out'
    signOutBtn.onmouseenter = () => { signOutBtn.style.borderColor = 'var(--sea)'; signOutBtn.style.color = 'var(--sea-dim)' }
    signOutBtn.onmouseleave = () => { signOutBtn.style.borderColor = 'var(--border)'; signOutBtn.style.color = 'var(--ink-muted)' }
    navActions.appendChild(signOutBtn)
  }

  // Data is loaded — hand off to page
  if (typeof window.onRoleReady === 'function') window.onRoleReady(window._role)

  document.documentElement.style.opacity = '1'

  // Set up push notifications (non-blocking)
  if (typeof window.setupNotifications === 'function') window.setupNotifications()

  // Clear the icon badge when the app is opened — user has "seen" it
  if ('clearAppBadge' in navigator) navigator.clearAppBadge().catch(() => {})
})()

function signOut() {
  sessionStorage.removeItem(_PROFILE_CACHE)
  sessionStorage.removeItem('ark_db_v1')
  window._db.auth.signOut().then(() => {
    window.location.href = './auth.html'
  })
}
