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
      // Re-request permission if needed
      if (Notification.permission === 'default') await Notification.requestPermission()
      if (Notification.permission !== 'granted') {
        alert('Notifications are blocked. Enable them in your browser/phone settings for this site.')
        bell.textContent = '🔔'; bell.disabled = false; return
      }
      // Re-register subscription
      if (typeof window.setupNotifications === 'function') await window.setupNotifications()
      // Fire a test notification
      try {
        const reg = await navigator.serviceWorker.ready
        await reg.showNotification('ARK — Notifications Active', {
          body: 'You\'ll receive alerts for new guest requests.',
          icon: './icons/icon-192.png',
          badge: './icons/icon-192.png',
          tag: 'ark-test',
        })
        bell.textContent = '✓'
        setTimeout(() => { bell.textContent = '🔔'; bell.disabled = false }, 2000)
      } catch(e) {
        alert('Notification test failed: ' + e.message)
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
