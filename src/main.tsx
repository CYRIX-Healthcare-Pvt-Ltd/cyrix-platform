import React from 'react'
import { startTheme } from './lib/theme'
import ReactDOM from 'react-dom/client'
import '@fontsource-variable/inter'
import { Boot } from './Boot'
import App from './App'
import './index.css'

// Before render, so nobody sees a flash of the wrong palette and a
// choice made in another module is already in force here.
startTheme()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Boot>
      <App />
    </Boot>
  </React.StrictMode>,
)
