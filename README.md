# Cyrix One portal

The front door of [app.cyrix.in](https://app.cyrix.in), branded **Cyra**. A
person signs in once with their employee code, sees a tile for each module
they are offered, and the Cyrix Digest (company news, meetings, polls and
forms) underneath. Every module behind a tile is its own repository and its
own deployment; this one only answers "who are you, and which tiles do you
get".

> Part of **Cyrix One**, the platform at [app.cyrix.in](https://app.cyrix.in).
> System-wide picture: [Cyrix One Platform — System Architecture](https://claude.ai/artifact/HNYWoBqCJ6Xh3XcREuKpTu)
> (ask Adrian for access). Every repository: [docs/REPOSITORIES.md](docs/REPOSITORIES.md).

## At a glance

| | |
|---|---|
| Served at | `https://app.cyrix.in/` (modules one level down: `/kpi`, `/spare`, `/bemmp`, `/revive`, `/travel`, `/tasks`, `/cyra`, `/pulse`) |
| Stack | React 18, TypeScript, Vite 5, plain CSS, `@supabase/supabase-js`, installable PWA with web push |
| Database | Shared Supabase project `emuvmihfbnndhbpsndvc`; this repo has no migrations of its own |
| Sign-in | Employee code → `<ecode>@cyrix.local` + password (Supabase Auth). The session is read by every module on the same origin |
| Hosting | Vercel, serving the `app.cyrix.in` domain |
| Maintainers | Kevin (most of the code), Adrian |
| Status | Live |

## Run locally

```bash
npm install
cp .env.example .env.local   # fill in the two public Supabase values
npm run dev                  # http://localhost:5174
```

The dev server proxies `/kpi`, `/spare` and `/bemmp` to those modules' own dev
servers (ports 5173, 5175, 5176; see `vite.config.ts`), so clicking a tile
works locally when that module is also running. A module that is not running
fails to proxy instead of falling back to the portal.

## Environment variables

| Name | Where it is set | Secret? | What it is for |
|---|---|---|---|
| `VITE_SUPABASE_URL` | `.env.local`, Vercel | no | The shared Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | `.env.local`, Vercel | no (publishable key) | Browser access; row-level security does the protecting |
| `VITE_AUTH_EMAIL_DOMAIN` | `.env.local`, Vercel | no | Domain an employee code is turned into; defaults to `cyrix.local` |

Only `VITE_` variables belong here, and every one of them is readable by
anyone who opens the site. A service-role key or database URL must never be
added to this project.

## Database

No schema lives here. The portal reads the shared project through:

- `my_modules()`: the tiles a person is offered (the module registry,
  `app_modules` / `employee_modules`)
- `employees`, `user_roles`: name, photo, and whether the person is an admin
- `device_check()`, `my_session_state()`: the "already signed in on another
  device" check and remote sign-out
- `app_settings`: `push_enabled`, `push_public_key`, `idle_sign_out`
- `digest_*` functions: the Digest feed, likes, comments, polls and forms
- Edge function `password-otp`: emailed codes for password reset and the
  device check

All of these are created by migrations in
[Cyrix-KPI `supabase/migrations`](https://github.com/CYRIX-Healthcare-Pvt-Ltd/Cyrix-KPI/tree/main/supabase/migrations)
(module registry 0057, device check 0149, Digest 0163 onwards, CYRA 0171), and
the edge functions are deployed from that repository too. A change the portal
needs in the database is a KPI migration.

## Deploy

Vercel builds `main` on every push (`npm run build` → `dist`). `vercel.json`
does three jobs, and is the file to edit when a module is added or moves:

- **Rewrites** each module path to that module's own Vercel deployment
  (`/kpi/*` → `cyrix-kpi.vercel.app`, and so on) and `/pulse/*` to
  `pulse.cyrix.in` on cyrix-svc01.
- **Redirects** old KPI paths (`/my-kpi`, `/admin`, ...) to `/kpi/...`.
- **Headers**: HSTS, `nosniff`, referrer policy, and no-cache on `sw.js` and
  `push-sw.js`.

To add a module: give it its own Vercel project with a Vite `base` of
`/<path>/`, add the two rewrites here, and add its row to `app_modules` with a
KPI migration. `/inventory` does not have its rewrite yet.

## Checks before merging

```bash
npm run build    # tsc -b (typecheck) + vite build
```

There are no tests in this repository.

## How it works

- **A tile is an offer, not a lock.** `my_modules()` decides what is shown;
  every module still enforces its own access with row-level security, so
  hiding a tile never stands in for a permission.
- **Admins go straight to KPI.** HR, SW, IT and Marketing admins are forwarded
  to `/kpi` once per browser session; coming back through the Apps control
  shows the tiles.
- **CYRA has its own accounts** on another Supabase project. Its tile hands
  this session's access token to `/cyra/sso` in the URL fragment (never sent
  to a server), renewing it first if it is older than five minutes.
- **One idle clock** (`src/lib/idleSignOut.ts`, also copied into every module):
  three hours without activity anywhere on app.cyrix.in signs out (the
  installed app is left alone by default). Both come from
  `app_settings.idle_sign_out`.
- **Storage the browser refuses never crashes the app**: `src/lib/safeStorage.ts`
  loads first and every read and write goes through `src/lib/storage.ts`.

| File | What |
|---|---|
| `src/App.tsx` | Sign-in, tiles, admin forwarding, CYRA hand-off |
| `src/Digest.tsx` | Cyrix Digest feed and post view |
| `src/DeviceGate.tsx`, `src/lib/session.ts` | Already signed in elsewhere |
| `src/ForgotPassword.tsx`, `src/lib/passwordOtp.ts` | Password reset by emailed code |
| `src/lib/push.ts`, `public/push-sw.js`, `src/NotifyCard.tsx` | Web push |
| `src/lib/pwa.ts`, `src/InstallButton.tsx`, `public/sw.js` | Installable app |

## Related docs

- [docs/REPOSITORIES.md](docs/REPOSITORIES.md): every Cyrix repository, where it runs
- [docs/README-TEMPLATE.md](docs/README-TEMPLATE.md): the README layout every repository follows
- [Cyrix-KPI README](https://github.com/CYRIX-Healthcare-Pvt-Ltd/Cyrix-KPI#readme): the shared database, migrations and admin console
