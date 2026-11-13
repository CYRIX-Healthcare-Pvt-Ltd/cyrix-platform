// First of all: storage the browser refuses must not crash the page (lib/safeStorage).
import './lib/safeStorage'
import React from 'react'
import { startTheme } from './lib/theme'
import { watchInstallability } from './lib/pwa'
import { startIdleSignOut } from './lib/idleSignOut'
import { supabase } from './lib/supabase'
import { startErrorReporting } from './lib/reportErrors'
import ReactDOM from 'react-dom/client'
import '@fontsource-variable/inter'
import { Boot } from './Boot'
import App from './App'
import { DigestPreview } from './Digest'
import './index.css'
import Splash from './Splash'

/*
  A number box changes only by typing: the mouse wheel over a focused one changed its value (Travel, 22 Oct;
  every app 13 Nov: "when scrolling numbers are changing ... we dont need"). The box lets go as the wheel turns,
  so the page scrolls, and the up and down arrow keys do nothing.
*/
document.addEventListener('wheel', () => {
  const el = document.activeElement
  if (el instanceof HTMLInputElement && el.type === 'number') el.blur()
}, { passive: true })
document.addEventListener('keydown', e => {
  if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && e.target instanceof HTMLInputElement && e.target.type === 'number') e.preventDefault()
})

// Before render, so nobody sees a flash of the wrong palette and a
// choice made in another module is already in force here.
startTheme()
// Before React mounts, so an error during the first render is caught too (0230).
startErrorReporting(supabase, 'portal', import.meta.env.VITE_VERCEL_GIT_COMMIT_SHA?.slice(0, 7))
// Before React mounts too: beforeinstallprompt fires once and early, and a
// button that has not rendered yet cannot catch it.
watchInstallability()
/** KPI's Digest page frames the portal to show a draft (DigestPreview): no session, nothing else. */
const digestPreview = new URLSearchParams(location.search).has('digest-preview')
// Signed out after 3 hours with nothing done, across every Cyrix app — not the preview,
// which has nobody signed in and would be reloaded away from itself.
if (!digestPreview) startIdleSignOut(supabase)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Boot>
      {/* KPI's Digest page frames this to show a draft as people will see it. */}
      {digestPreview ? <DigestPreview /> : <><Splash /><App /></>}
    </Boot>
  </React.StrictMode>,
)
