# Cyrix One portal

The front door of [app.cyrix.in](https://app.cyrix.in), branded **Cyra**. A
person signs in once with their employee code, sees a tile for each module
they are offered, and the Cyrix Digest (company news, meetings, polls and
forms) underneath. Every module behind a tile is its own repository and its
own deployment; this one only answers "who are you, and which tiles do you
get".

It also carries the **Ops page** (`/ops`), the one screen where the people who
run the platform see every app's health, deploys, errors and cost.

> Part of **Cyrix One**, the platform at [app.cyrix.in](https://app.cyrix.in).
> System-wide picture: [Cyrix One Platform — System Architecture](https://claude.ai/artifact/HNYWoBqCJ6Xh3XcREuKpTu)
> (ask Adrian for access). Every repository: [docs/REPOSITORIES.md](docs/REPOSITORIES.md).

## At a glance

| | |
|---|---|
| Served at | `https://app.cyrix.in/` (modules one level down: `/kpi`, `/spare`, `/bemmp`, `/revive`, `/travel`, `/tasks`, `/workplace`, `/projects`, `/cyra`, `/pulse`; `/inventory` redirects to `/workplace`). The portal's own pages: `/` and `/ops` |
| Stack | React 18, TypeScript, Vite 5, plain CSS, `@supabase/supabase-js`, installable PWA with web push |
| Database | Shared Supabase project `cyrix-mumbai` (`ejtylrqwvxatbrifksbb`, Mumbai; moved from the Tokyo project on 21 Nov 2026); this repo has no migrations of its own |
| Sign-in | Employee code → `<ecode>@cyrix.local` + password (Supabase Auth). The session is read by every module on the same origin |
| Hosting | Vercel, serving the `app.cyrix.in` domain; the `api/` functions run in Mumbai (`bom1`) since 21 Nov 2026 |
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

Every `VITE_` variable is readable by anyone who opens the site. The `api/`
functions read these server-side ones from Vercel; none of them is ever
returned, logged or echoed:

| Name | Where it is set | Secret? | What it is for |
|---|---|---|---|
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | Vercel | no | Shared project for `api/`; falls back to the `VITE_` pair |
| `VERCEL_TOKEN`, `VERCEL_TEAM_ID` | Vercel | **yes** (token) | Ops: read-only token for team `cyrix4`, for deploys and Web Analytics |
| `GITHUB_TOKEN` | Vercel | **yes** | Ops: read-only (contents + metadata) token, for commits across the repos |
| `OPS_REPOS` | Vercel | no | Ops: which repositories the Changes panel lists |
| `CYRA_SUPABASE_URL`, `CYRA_SERVICE_KEY` | Vercel | **yes** (key) | Ops: CYRA's errors and AI usage, read from its own project |
| `SUPABASE_ACCESS_TOKEN` | Vercel | **yes**, optional | Ops: region, request counts and compute size of both projects |
| `RENDER_API_KEY` | Vercel | **yes**, optional | Ops: the CYRA engine's plan and region |
| `SUPABASE_REGION` | Vercel | no, optional | Ops: region for Supabase's status feed; defaults to `ap-south-1` |
| `OPS_USD_INR` | Vercel | no, optional | Ops: exchange rate for AI cost in rupees |

None of the shared database's service key is held here: `api/` asks the
database with the caller's own token or the public anon key, and the database
decides.

## Database

No schema lives here. The portal reads the shared project through:

- `my_modules()`: the tiles a person is offered (the module registry,
  `app_modules` / `employee_modules`)
- `employees`, `user_roles`: name, photo, and whether the person is an admin
- `device_check()`, `my_session_state()`: the "already signed in on another
  device" check and remote sign-out
- `app_settings`: `push_enabled`, `push_public_key`, `idle_sign_out`
- `digest_*` functions: the Digest feed, likes, comments, polls and forms
- `ops_overview()`, `is_ops_admin()`, `ops_heartbeat()`: the Ops page
  (KPI 0227 onwards)
- `platform_maintenance()`: the maintenance switch (KPI 0305)
- `kpi_rank_ones`: the Rank 1s bar on the home page (KPI 0276)
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
  (`/kpi/*` to `cyrix-kpi.vercel.app`, `/workplace/*` to
  `cyrix-workplace.vercel.app`, `/projects/*` to `cyrix-projects.vercel.app`,
  and so on) and `/pulse/*` to `pulse.cyrix.in` on cyrix-svc01.
- **Redirects** old KPI paths (`/my-kpi`, `/admin`, ...) to `/kpi/...`, and
  `/inventory` to `/workplace`.
- **Headers**: HSTS, `nosniff`, referrer policy, no-cache on `sw.js` and
  `push-sw.js`, and a frame policy that lets only `/tasks/outlook*` be shown
  inside Outlook (the Make task add-in).

To add a module: give it its own Vercel project with a Vite `base` of
`/<path>/`, add the two rewrites here, and add its row to `app_modules` with a
KPI migration.

Android users can also install `public/Cyra.apk`, offered from the sign-in
pop-up.

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
- **The Ops page** (`/ops`, `src/Ops.tsx`) is for Ops admins only, and
  `ops_overview()` refuses anyone else, so the page hiding itself is a
  courtesy. `api/ops.js` covers what a browser cannot reach (pinging other
  origins, Vercel, GitHub, CYRA's database); a source whose key is not set
  answers `configured: false` and the panel says so.
- **Heartbeat**: `api/heartbeat.js` answers `200 ok` or `503` for an outside
  pinger, so a database that is down still raises an alert.
- **Maintenance**: one screen for every app (`src/lib/maintenance.ts`, the
  same file in KPI, Travel, Revive Lab and My Task), switched on from
  SW Admin, or by itself when the database stops answering. CYRA reads the
  switch through `api/maintenance.js`.
- **Tiles can be arranged** per person (long press or held double click), and
  the order is saved to the account (`src/lib/tileOrder.ts`, KPI 0309).
- **Storage the browser refuses never crashes the app**: `src/lib/safeStorage.ts`
  loads first and every read and write goes through `src/lib/storage.ts`.

| File | What |
|---|---|
| `src/App.tsx` | Sign-in, tiles, admin forwarding, CYRA hand-off |
| `src/Ops.tsx`, `api/ops.js`, `api/heartbeat.js` | The Ops page and its server half |
| `src/RankOne.tsx`, `src/Leaders.tsx` | The Rank 1s bar and list |
| `src/lib/maintenance.ts`, `api/maintenance.js` | The maintenance screen |
| `src/Digest.tsx` | Cyrix Digest feed and post view |
| `src/DeviceGate.tsx`, `src/lib/session.ts` | Already signed in elsewhere |
| `src/ForgotPassword.tsx`, `src/lib/passwordOtp.ts` | Password reset by emailed code |
| `src/lib/push.ts`, `public/push-sw.js`, `src/NotifyCard.tsx` | Web push |
| `src/lib/pwa.ts`, `src/InstallButton.tsx`, `public/sw.js` | Installable app |

## Related docs

- [docs/REPOSITORIES.md](docs/REPOSITORIES.md): every Cyrix repository, where it runs
- [docs/README-TEMPLATE.md](docs/README-TEMPLATE.md): the README layout every repository follows
- [Cyrix-KPI README](https://github.com/CYRIX-Healthcare-Pvt-Ltd/Cyrix-KPI#readme): the shared database, migrations and admin console
