import { useEffect, useRef, useState } from 'react'
import { LockKeyhole } from 'lucide-react'

export default function IotUploadPasswordDialog({ onUnlock, onDismiss }) {
  const dialogRef = useRef(null)
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    const dialog = dialogRef.current
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    if (!dialog.open) dialog.showModal()
    return () => {
      dialog.close()
      document.body.style.overflow = previousOverflow
    }
  }, [])

  const submit = (event) => {
    event.preventDefault()
    if (password !== '0000') {
      setError(password ? 'Incorrect password. Please try again.' : 'Enter the password to continue.')
      return
    }
    onUnlock()
  }

  return (
    <dialog
      ref={dialogRef}
      className="iot-password-dialog"
      aria-labelledby="iot-password-title"
      aria-describedby="iot-password-description"
      onCancel={(event) => { event.preventDefault(); onDismiss() }}
    >
      <div className="iot-password-heading">
        <LockKeyhole size={22} aria-hidden="true" />
        <h2 id="iot-password-title">IoT Data Upload</h2>
      </div>
      <p id="iot-password-description">Enter the password to open the upload page.</p>
      <form onSubmit={submit} noValidate>
        <label className="iot-password-label" htmlFor="iot-upload-password">Password</label>
        <input
          id="iot-upload-password"
          className="iot-password-input"
          type="password"
          autoComplete="current-password"
          autoFocus
          value={password}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? 'iot-password-error' : undefined}
          onChange={(event) => { setPassword(event.target.value); setError('') }}
        />
        {error && <p id="iot-password-error" className="iot-password-error" role="alert">{error}</p>}
        <div className="iot-password-actions">
          <button type="button" className="iot-password-cancel" onClick={onDismiss}>Cancel</button>
          <button type="submit" className="fsr-export-btn">Open Upload</button>
        </div>
      </form>
    </dialog>
  )
}
