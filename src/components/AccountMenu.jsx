import { LogOut } from 'lucide-react'
import './auth.css'

export default function AccountMenu({ user, onSignOut, signingOut, signOutError, isAdmin = false }) {
  return (
    <div className="account-menu">
      <span className="account-email" title={user?.email}>{user?.email || 'Public dashboard'}</span>
      {isAdmin && <a className="account-admin-link" href="#admin">Administration</a>}
      <button type="button" onClick={onSignOut} disabled={signingOut}>
        <LogOut size={16} />{signingOut ? 'Signing out...' : 'Sign out'}
      </button>
      {signOutError && <p className="auth-error" role="alert">{signOutError}</p>}
    </div>
  )
}
