import { useState } from 'react'
import { Eye, EyeOff, Layout, LockKeyhole, ArrowRight } from 'lucide-react'
import './auth.css'

export default function LoginPage({ auth, sessionError = '', adminLogin = false }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  async function signIn(event) {
    event.preventDefault()
    if (submitting) return
    setError('')
    setSubmitting(true)
    try {
      const { error: signInError } = await auth.signInWithPassword({ email: email.trim(), password })
      if (signInError) {
        setError(signInError.code === 'invalid_credentials'
          ? 'The email or password is incorrect. Please try again.'
          : signInError.code === 'email_not_confirmed'
            ? 'Please confirm your email before signing in.'
            : 'Unable to sign in. Check your connection and try again.')
      }
    } catch {
      setError('Unable to sign in. Check your connection and try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-card" aria-labelledby="login-title">
        <div className="auth-brand"><Layout size={28} /><span>FleetPro</span></div>
        <div className="auth-icon"><LockKeyhole size={26} /></div>
        <h1 id="login-title">{adminLogin ? 'Admin sign in' : 'Welcome back'}</h1>
        <p className="auth-intro">{adminLogin ? 'Sign in to manage users and dashboard access.' : 'Sign in to your fleet dashboard.'}</p>
        <form onSubmit={signIn} aria-busy={submitting}>
          <label htmlFor="login-email">Email address</label>
          <input id="login-email" name="email" type="email" autoComplete="username" required
            placeholder="you@company.com" value={email} disabled={submitting}
            onChange={(event) => setEmail(event.target.value)} />
          <label htmlFor="login-password">Password</label>
          <div className="auth-password">
            <input id="login-password" name="password" type={showPassword ? 'text' : 'password'}
              autoComplete="current-password" required placeholder="Enter your password"
              value={password} disabled={submitting} onChange={(event) => setPassword(event.target.value)} />
            <button type="button" className="auth-password-toggle" disabled={submitting}
              aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword}
              onClick={() => setShowPassword((shown) => !shown)}>
              {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
            </button>
          </div>
          {(error || sessionError) && <p className="auth-error" role="alert">{error || sessionError}</p>}
          <button className="auth-submit" type="submit" disabled={submitting}>
            {submitting ? 'Signing in...' : 'Sign in'}{!submitting && <ArrowRight size={18} />}
          </button>
        </form>
        <p className="auth-help">Need an account or a password reset? Contact your administrator.</p>
        {adminLogin && <a className="auth-back" href="#dashboard">Back to dashboard</a>}
      </section>
    </main>
  )
}
