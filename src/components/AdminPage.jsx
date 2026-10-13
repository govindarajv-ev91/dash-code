import { useEffect, useState } from 'react'
import { Layout, Shield, Trash2, UserPlus } from 'lucide-react'
import AccountMenu from './AccountMenu'
import './admin.css'

export default function AdminPage({ user, onSignOut, signingOut, signOutError, access,
  loginEnabled, settingsError, onLoginSettingChange }) {
  const [users, setUsers] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [reload, setReload] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [listError, setListError] = useState('')
  const [notice, setNotice] = useState('')
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [pendingDelete, setPendingDelete] = useState(null)
  const [confirmPublic, setConfirmPublic] = useState(false)
  const [activeTab, setActiveTab] = useState('login')

  useEffect(() => {
    if (activeTab !== 'users') return
    let active = true
    access.adminAction({ action: 'list-users', page }).then((data) => {
      if (!active) return
      // If deletion emptied the last page, go back to a page with accounts.
      if (!data.users.length && page > 1) { setPage(page - 1); return }
      setUsers(data.users)
      setTotal(data.total)
      setListError('')
      setLoading(false)
    }).catch((failure) => {
      if (active) { setUsers([]); setListError(failure.message); setLoading(false) }
    })
    return () => { active = false }
  }, [access, page, reload, activeTab])

  function refreshUsers() { setLoading(true); setReload((value) => value + 1) }

  async function createUser(event) {
    event.preventDefault()
    if (busy) return
    setBusy(true); setError(''); setNotice('')
    try {
      await access.adminAction({ action: 'create-user', email, password, display_name: name })
      setEmail(''); setName(''); setPassword('')
      setNotice('User created. They can sign in with the email and password you assigned.')
      if (page !== 1) { setLoading(true); setPage(1) } else refreshUsers()
    } catch (failure) { setError(failure.message) }
    finally { setBusy(false) }
  }

  async function deleteUser() {
    if (busy || !pendingDelete) return
    setBusy(true); setError(''); setNotice('')
    try {
      await access.adminAction({ action: 'delete-user', user_id: pendingDelete.id })
      setPendingDelete(null); setNotice('User account deleted.'); refreshUsers()
    } catch (failure) { setError(failure.message) }
    finally { setBusy(false) }
  }

  async function saveLoginSetting(enabled) {
    if (busy) return
    setBusy(true); setError(''); setNotice('')
    try {
      const savedEnabled = await access.setLoginEnabled(enabled)
      onLoginSettingChange(savedEnabled)
      setConfirmPublic(false)
      setNotice(savedEnabled ? 'Login is enabled. Visitors must sign in.' : 'Login is disabled. Visitors can open the dashboard directly.')
    } catch (failure) { setError(failure.message) }
    finally { setBusy(false) }
  }

  return <main className="admin-page">
    <header className="admin-header">
      <div><div className="auth-brand"><Layout size={26} />FleetPro</div>
        <h1><Shield size={26} />Administration</h1>
        <p>Manage dashboard accounts and sign-in requirements.</p></div>
      <div><a className="auth-back" href="#dashboard">Back to dashboard</a>
        <AccountMenu user={user} onSignOut={onSignOut} signingOut={signingOut} signOutError={signOutError} /></div>
    </header>
    <div className="admin-tabs" role="tablist" aria-label="Administration sections">
      <button id="login-settings-tab" role="tab" aria-selected={activeTab === 'login'}
        aria-controls="login-settings-panel" tabIndex={activeTab === 'login' ? 0 : -1}
        onClick={() => setActiveTab('login')} onKeyDown={(event) => {
          if (event.key === 'ArrowRight' || event.key === 'ArrowLeft' || event.key === 'End') {
            event.preventDefault(); setLoading(true); setActiveTab('users'); document.getElementById('user-management-tab')?.focus()
          }
        }}>Sign-in settings</button>
      <button id="user-management-tab" role="tab" aria-selected={activeTab === 'users'}
        aria-controls="user-management-panel" tabIndex={activeTab === 'users' ? 0 : -1}
        onClick={() => { if (activeTab !== 'users') setLoading(true); setActiveTab('users') }} onKeyDown={(event) => {
          if (event.key === 'ArrowRight' || event.key === 'ArrowLeft' || event.key === 'Home') {
            event.preventDefault(); setActiveTab('login'); document.getElementById('login-settings-tab')?.focus()
          }
        }}>User management</button>
    </div>
    {notice && <p className="admin-notice" role="status">{notice}</p>}
    {(error || settingsError) && <p className="auth-error" role="alert">{error || settingsError}</p>}
    <section id="login-settings-panel" className="admin-panel" role="tabpanel"
      aria-labelledby="login-settings-tab" hidden={activeTab !== 'login'}>
      <div className="admin-setting"><div><h2 id="admin-access-title">Enable or disable sign-in</h2>
        <p>{loginEnabled ? 'Enabled — visitors must sign in.' : 'Disabled — visitors open the dashboard directly.'}</p>
        <p>The admin page always requires an administrator login.</p></div>
        <button className="admin-button" type="button" role="switch" aria-checked={loginEnabled}
          aria-label="Require dashboard login" disabled={busy || !!settingsError}
          onClick={() => loginEnabled ? setConfirmPublic(true) : saveLoginSetting(true)}>
          {loginEnabled ? 'Disable login' : 'Enable login'}
        </button></div>
      <div className="admin-login-explanation">
        <p><strong>Enabled:</strong> the sign-in page appears before the dashboard.</p>
        <p><strong>Disabled:</strong> visitors open the dashboard directly.</p>
      </div>
      {confirmPublic && <div className="admin-confirm" role="group" aria-label="Confirm public dashboard">
        <p>Disable login and allow anyone with the dashboard URL to view its pages and use its available tools?</p>
        <div className="admin-actions"><button className="admin-button danger" disabled={busy} onClick={() => saveLoginSetting(false)}>Confirm disable login</button>
          <button className="admin-button secondary" disabled={busy} onClick={() => setConfirmPublic(false)}>Cancel</button></div>
      </div>}
    </section>
    <div id="user-management-panel" role="tabpanel" aria-labelledby="user-management-tab" hidden={activeTab !== 'users'}>
    <section className="admin-panel" aria-labelledby="create-user-title">
      <h2 id="create-user-title"><UserPlus size={20} />Create user</h2>
      <form className="admin-create-form" onSubmit={createUser} aria-busy={busy}>
        <label>Name<input name="display_name" value={name} maxLength={100} autoComplete="off" disabled={busy} onChange={(event) => setName(event.target.value)} placeholder="Staff name" /></label>
        <label>Email address<input name="email" type="email" value={email} required maxLength={254} autoComplete="off" disabled={busy} onChange={(event) => setEmail(event.target.value)} placeholder="staff@company.com" /></label>
        <label>Initial password<input name="password" type="password" value={password} required minLength={6} maxLength={128} autoComplete="new-password" disabled={busy} onChange={(event) => setPassword(event.target.value)} placeholder="At least 6 characters" /></label>
        <button className="admin-button" type="submit" disabled={busy}>{busy ? 'Please wait...' : 'Create user'}</button>
      </form>
      <p className="admin-caption">New accounts have ordinary user access. Share their credentials with them directly.</p>
    </section>
    <section className="admin-panel" aria-labelledby="users-title">
      <div className="admin-setting"><h2 id="users-title">Users <span className="admin-count">{total}</span></h2>
        <button className="admin-button secondary" disabled={busy || loading} onClick={refreshUsers}>Refresh</button></div>
      {listError && <p className="auth-error" role="alert">{listError}</p>}
      {loading ? <p role="status">Loading users...</p> : <div className="admin-table-scroll"><table>
        <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Created</th><th>Action</th></tr></thead>
        <tbody>{users.map((account) => <tr key={account.id}>
          <td>{account.display_name || '—'}</td><td>{account.email}</td><td><span className="admin-role">{account.role}</span></td>
          <td>{account.created_at ? new Date(account.created_at).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' }) : '—'}</td>
          <td>{account.role === 'admin' || account.id === user.id ? <span className="admin-caption">Protected</span>
            : <button className="admin-delete" aria-label={`Delete ${account.email}`} disabled={busy} onClick={() => { setPendingDelete(account); setError('') }}><Trash2 size={16} />Delete</button>}</td>
        </tr>)}</tbody>
      </table>{!users.length && !listError && <p>No accounts found.</p>}</div>}
      {pendingDelete && <div className="admin-confirm" role="group" aria-label="Confirm account deletion">
        <p>Delete <strong>{pendingDelete.email}</strong>? This permanently removes their sign-in account.</p>
        <div className="admin-actions"><button className="admin-button danger" disabled={busy} onClick={deleteUser}>Confirm delete user</button>
          <button className="admin-button secondary" disabled={busy} onClick={() => setPendingDelete(null)}>Cancel</button></div>
      </div>}
      <div className="admin-pagination"><button className="admin-button secondary" disabled={busy || loading || page === 1} onClick={() => { setLoading(true); setPage(page - 1) }}>Previous</button>
        <span>Page {page} of {Math.max(1, Math.ceil(total / 50))}</span>
        <button className="admin-button secondary" disabled={busy || loading || page * 50 >= total} onClick={() => { setLoading(true); setPage(page + 1) }}>Next</button></div>
    </section>
    </div>
  </main>
}
