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
export default defineConfig({
  plugins: [react()],
  server: { port: 5174 },
})
