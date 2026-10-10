import React from 'react'
import { startTheme } from './lib/theme'
import { watchInstallability } from './lib/pwa'
import { startIdleSignOut } from './lib/idleSignOut'
import { supabase } from './lib/supabase'
import ReactDOM from 'react-dom/client'
import '@fontsource-variable/inter'
import { Boot } from './Boot'
import App from './App'
import './index.css'

// Before render, so nobody sees a flash of the wrong palette and a
// choice made in another module is already in force here.
startTheme()
// Before React mounts too: beforeinstallprompt fires once and early, and a
// button that has not rendered yet cannot catch it.
watchInstallability()
// Signed out after 3 hours with nothing done, across every Cyrix app.
startIdleSignOut(supabase)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Boot>
      <App />
    </Boot>
  </React.StrictMode>,
)
