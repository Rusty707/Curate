import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import './styles/buttons.css'
import App from './App.jsx'
import { AppVersion } from './components/AppVersion'
import { APP_VERSION } from './config/version'

if (import.meta.env.PROD) {
  console.log('Curate Version:', APP_VERSION)
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <App />
      <AppVersion />
    </BrowserRouter>
  </StrictMode>,
)
