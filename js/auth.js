document.documentElement.style.visibility = 'hidden'

;(async () => {
  const { data: { session } } = await window._db.auth.getSession()

  if (!session) {
    window.location.replace('./auth.html')
    return
  }

  const { data: profile, error: profileErr } = await window._db
    .from('profiles')
    .select('role, name')
    .eq('id', session.user.id)
    .single()

  if (profileErr || !profile) {
    console.error('Profile load failed:', profileErr?.message)
    await window._db.auth.signOut()
    document.documentElement.style.visibility = ''
    document.body.innerHTML = `<div style="font-family:sans-serif;padding:40px;color:#8A4A4A">
      Profile load failed — permission denied.<br><br>
      <small>${profileErr?.message || 'No profile row found'}</small><br><br>
      <a href="./auth.html">Back to login</a>
    </div>`
    return
  }

  window._session  = session
  window._user     = session.user
  window._role     = profile.role
  window._userName = profile.name || session.user.email

  // Load all data now that session is confirmed — RLS will pass
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

  // Inject sign-out button into nav
  const navActions = document.querySelector('.nav-actions')
  if (navActions) {
    const btn = document.createElement('button')
    btn.setAttribute('onclick', 'signOut()')
    btn.className = 'btn-signout'
    btn.style.cssText = [
      'font-family:var(--sans)', 'font-size:8px', 'font-weight:400',
      'letter-spacing:2px', 'text-transform:uppercase', 'padding:7px 14px',
      'border:0.5px solid var(--border)', 'background:transparent',
      'color:var(--ink-muted)', 'cursor:pointer', 'white-space:nowrap',
      'transition:all 160ms ease'
    ].join(';')
    btn.textContent = window._userName + ' · Sign Out'
    btn.onmouseenter = () => { btn.style.borderColor = 'var(--sea)'; btn.style.color = 'var(--sea-dim)' }
    btn.onmouseleave = () => { btn.style.borderColor = 'var(--border)'; btn.style.color = 'var(--ink-muted)' }
    navActions.appendChild(btn)
  }

  // Data is loaded — hand off to page
  if (typeof window.onRoleReady === 'function') window.onRoleReady(window._role)

  document.documentElement.style.visibility = ''
})()

function signOut() {
  window._db.auth.signOut().then(() => {
    window.location.href = './auth.html'
  })
}
