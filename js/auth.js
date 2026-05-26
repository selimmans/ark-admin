// Hide page immediately to prevent flash of unauthenticated content
document.documentElement.style.visibility = 'hidden'

;(async () => {
  const { data: { session } } = await window._db.auth.getSession()

  if (!session) {
    window.location.replace('./auth.html')
    return
  }

  // Fetch role from profiles table
  const { data: profile } = await window._db
    .from('profiles')
    .select('role, name')
    .eq('id', session.user.id)
    .single()

  window._session  = session
  window._user     = session.user
  window._role     = profile?.role || 'staff'
  window._userName = profile?.name || session.user.email

  // Inject sign-out button into nav-actions
  const navActions = document.querySelector('.nav-actions')
  if (navActions) {
    const btn = document.createElement('button')
    btn.setAttribute('onclick', 'signOut()')
    btn.style.cssText = [
      'font-family:var(--sans)',
      'font-size:8px',
      'font-weight:400',
      'letter-spacing:2px',
      'text-transform:uppercase',
      'padding:7px 14px',
      'border:0.5px solid var(--border)',
      'background:transparent',
      'color:var(--ink-muted)',
      'cursor:pointer',
      'white-space:nowrap',
      'transition:all 160ms ease'
    ].join(';')
    btn.textContent = window._userName + ' · Sign Out'
    btn.onmouseenter = () => { btn.style.borderColor = 'var(--sea)'; btn.style.color = 'var(--sea-dim)' }
    btn.onmouseleave = () => { btn.style.borderColor = 'var(--border)'; btn.style.color = 'var(--ink-muted)' }
    navActions.appendChild(btn)
  }

  // Show page
  document.documentElement.style.visibility = ''
})()

function signOut() {
  window._db.auth.signOut().then(() => {
    window.location.href = './auth.html'
  })
}
