import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { dashboardAccess } from '../lib/dashboardAccess'
import LoginPage from './LoginPage'
import AccountMenu from './AccountMenu'

const DashboardApp = lazy(() => import('../App'))
const AdminPage = lazy(() => import('./AdminPage'))

function AuthLoading({ children }) {
  return <main className="auth-page"><p role="status">{children}</p></main>
}

export default function AuthenticatedApp({ auth = supabase.auth, access = dashboardAccess,
  DashboardComponent = DashboardApp, AdminComponent = AdminPage }) {
  const Dashboard = DashboardComponent
  const Admin = AdminComponent
  const [session, setSession] = useState(null)
  const [checking, setChecking] = useState(true)
  const [sessionError, setSessionError] = useState('')
  const [signingOut, setSigningOut] = useState(false)
  const [signOutError, setSignOutError] = useState('')
  const [settings, setSettings] = useState({ loading: true, enabled: true, error: '' })
  const [profile, setProfile] = useState({ userId: null, data: null, error: '' })
  const [adminRequested, setAdminRequested] = useState(() => window.location.hash === '#admin')
  const [profileRetry, setProfileRetry] = useState(0)
  const settingsVersion = useRef(0)
  const user = session?.user && !session.user.is_anonymous ? session.user : null
  const userId = user?.id ?? null

  useEffect(() => {
    const onHashChange = () => setAdminRequested(window.location.hash === '#admin')
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  useEffect(() => {
    let active = true
    const refresh = async () => {
      const version = ++settingsVersion.current
      try {
        const enabled = await access.getLoginEnabled()
        if (active && version === settingsVersion.current) setSettings({ loading: false, enabled, error: '' })
      } catch {
        if (active && version === settingsVersion.current) setSettings({
          loading: false, enabled: true, error: 'Login settings are unavailable. Contact your administrator.',
        })
      }
    }
    void refresh()
    const timer = window.setInterval(refresh, 15000)
    window.addEventListener('focus', refresh)
    return () => { active = false; window.clearInterval(timer); window.removeEventListener('focus', refresh) }
  }, [access])

  useEffect(() => {
    if (!userId) return
    let active = true
    let version = 0
    const refresh = async () => {
      const request = ++version
      try {
        const data = await access.getProfile(userId)
        if (active && request === version) setProfile({ userId, data, error: data ? '' : 'Your dashboard account is unavailable. Contact your administrator.' })
      } catch {
        if (active && request === version) setProfile({ userId, data: null, error: 'Your account could not be checked. Please try again.' })
      }
    }
    void refresh()
    const timer = window.setInterval(refresh, 15000)
    window.addEventListener('focus', refresh)
    return () => { active = false; window.clearInterval(timer); window.removeEventListener('focus', refresh) }
  }, [access, userId, profileRetry])

  function applyLoginSetting(enabled) {
    settingsVersion.current += 1
    setSettings({ loading: false, enabled, error: '' })
  }

  useEffect(() => {
    let active = true
    let eventVersion = 0
    const { data: { subscription } } = auth.onAuthStateChange((_event, nextSession) => {
      if (!active) return
      eventVersion += 1
      setSession(nextSession)
      setChecking(false)
      setSessionError('')
      setSignOutError('')
    })
    const restoreVersion = eventVersion
    // Never let a slow restoration overwrite a newer sign-in or sign-out event.
    auth.getSession().then(({ data, error }) => {
      if (!active || eventVersion !== restoreVersion) return
      setSession(error ? null : data.session)
      setSessionError(error ? 'Your session could not be restored. Please sign in again.' : '')
      setChecking(false)
    }).catch(() => {
      if (!active || eventVersion !== restoreVersion) return
      setSessionError('Your session could not be restored. Please sign in again.')
      setChecking(false)
    })
    return () => { active = false; subscription.unsubscribe() }
  }, [auth])

  async function signOut() {
    if (signingOut) return
    setSigningOut(true)
    setSignOutError('')
    try {
      const { error } = await auth.signOut({ scope: 'local' })
      if (error) throw error
      setSession(null)
    } catch {
      setSignOutError('Unable to sign out. Check your connection and try again.')
    } finally {
      setSigningOut(false)
    }
  }

  if (checking || settings.loading) return <AuthLoading>Checking your session...</AuthLoading>
  const requiresLogin = settings.enabled || adminRequested
  if (requiresLogin && !user) return <LoginPage auth={auth}
    adminLogin={adminRequested} sessionError={sessionError || settings.error} />
  if (requiresLogin && profile.userId !== userId) return <AuthLoading>Checking your account...</AuthLoading>
  const accountProps = { user, onSignOut: signOut, signingOut, signOutError }
  if (requiresLogin && (!profile.data || (adminRequested && profile.data.role !== 'admin'))) {
    return <main className="auth-page"><section className="auth-card">
      <h1>{adminRequested ? 'Administrator access required' : 'Account unavailable'}</h1>
      <p className="auth-error" role="alert">{profile.error || 'Only administrators can manage users and login settings.'}</p>
      <button className="auth-submit" onClick={() => setProfileRetry((value) => value + 1)}>Check again</button>
      <a className="auth-back" href="#dashboard">Back to dashboard</a>
      <AccountMenu {...accountProps} />
    </section></main>
  }
  const isAdmin = !!user && profile.userId === userId && profile.data?.role === 'admin'

  return (
    <Suspense fallback={<AuthLoading>Opening your dashboard...</AuthLoading>}>
      {adminRequested
        ? <Admin {...accountProps} access={access} loginEnabled={settings.enabled}
            settingsError={settings.error} onLoginSettingChange={applyLoginSetting} />
        : <Dashboard key={userId ?? 'public'} {...accountProps} isAdmin={isAdmin} />}
    </Suspense>
  )
}
