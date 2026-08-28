import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * The portal sits at the root of app.cyrix.in and owns the domain.
 *
 * Every module lives one level down — /kpi, /spare, /bemmp — served by
 * its own Vercel project and reached through the rewrites in
 * vercel.json. This app holds no data of its own and makes no decisions
 * beyond "who are you, and which tiles do you get", which is deliberate:
 * a portal that starts holding rules becomes a third place to look for
 * them.
 */
/**
 * Where each module's dev server listens, for the proxy below.
 *
 * In production the rewrites in vercel.json do this and these ports do not
 * exist. Locally there is nothing serving /kpi at all, so the tiles led to
 * the portal's own 404 and the one thing worth testing — clicking through
 * to a module on a shared session — could only be tested after deploying.
 *
 * A module that is not running simply fails to proxy, which is the honest
 * outcome: you get an error for the one you did not start, not a silent
 * fallback to the portal's index.html pretending to be the module.
 */
const MODULE_PORTS = { kpi: 5173, spare: 5175, bemmp: 5176 }

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    proxy: Object.fromEntries(
      Object.entries(MODULE_PORTS).map(([name, port]) => [
        `/${name}`,
        { target: `http://localhost:${port}`, changeOrigin: true },
      ]),
    ),
  },
})
