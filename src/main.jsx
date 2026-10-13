import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import AuthenticatedApp from './components/AuthenticatedApp.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AuthenticatedApp />
  </StrictMode>,
)
