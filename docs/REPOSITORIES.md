# Cyrix repositories

Every repository in [`CYRIX-Healthcare-Pvt-Ltd`](https://github.com/orgs/CYRIX-Healthcare-Pvt-Ltd/repositories),
what it is and where it runs. Checked against each repository's code on
25 Oct 2026. Add a row when a repository is created, and change a row in the
same pull request that changes what it says. Each README follows
[README-TEMPLATE.md](README-TEMPLATE.md).

System-wide picture: [Cyrix One Platform — System Architecture](https://claude.ai/artifact/HNYWoBqCJ6Xh3XcREuKpTu)
(a living doc; ask Adrian for access).

## The platform

[app.cyrix.in](https://app.cyrix.in) is the portal: one sign-in, then a tile
per module. The portal (`cyrix-platform`) is served at the root, and every
module is its own repository and its own deployment, reached through the
rewrites in this repository's `vercel.json`.

| Repository | What it is | Served at | Hosting | Database | Maintainers | Status |
|---|---|---|---|---|---|---|
| [cyrix-platform](https://github.com/CYRIX-Healthcare-Pvt-Ltd/cyrix-platform) | The portal: sign-in, module tiles, Cyrix Digest, device check | `app.cyrix.in/` | Vercel | Shared | Kevin | Live |
| [Cyrix-KPI](https://github.com/CYRIX-Healthcare-Pvt-Ltd/Cyrix-KPI) | Monthly KPI and appraisal scoring; also the shared admin console (SW Admin) and **the migrations for the shared database** | `/kpi/` | Vercel `cyrix-kpi` | Shared (owns its migrations) | Kevin | Live |
| [Cyrix-Spare-Mapping](https://github.com/CYRIX-Healthcare-Pvt-Ltd/Cyrix-Spare-Mapping) | Spare / equipment barcode tagging and mapping to the Cyrix item master | `/spare/` | Vercel `cyrix-spare-mapping` | Shared | Kevin | Live |
| [Cyrix-Bemmp-Dashboard](https://github.com/CYRIX-Healthcare-Pvt-Ltd/Cyrix-Bemmp-Dashboard) | BEMMP service-ticket analytics, penalty and the daily ticket tracker | `/bemmp/` | Vercel `cyrix-bemmp-dashboard` (also Docker, GitHub Pages) | Shared (meeting notes, accounts); ticket data is files | Kevin | Live |
| [Cyrix-Revive-Lab](https://github.com/CYRIX-Healthcare-Pvt-Ltd/Cyrix-Revive-Lab) | Repair tracking for defective spares through a Revive Lab | `/revive/` | Vercel `cyrix-revive-lab` | Shared, `revive_*` | Kevin | Live |
| [Cyrix-Travel](https://github.com/CYRIX-Healthcare-Pvt-Ltd/Cyrix-Travel) | Field engineers' travel, ride by ride, and the expense claim | `/travel/` | Vercel `cyrix-travel` | Shared, `travel_*` | Kevin | Live |
| [Cyrix-Task](https://github.com/CYRIX-Healthcare-Pvt-Ltd/Cyrix-Task) | My Task: daily tasks approved by the reporting manager | `/tasks/` | Vercel `cyrix-task` | Shared, `mt_*` migrations | Kevin | Live |
| [Cyrix-Inventory](https://github.com/CYRIX-Healthcare-Pvt-Ltd/Cyrix-Inventory) | Who holds which company asset: IT, Warehouse, Admin | `/inventory/` (planned) | Vercel (planned) | Shared, `inv_*`; staging on cyrix-svc01 | Adrian | In testing; no portal rewrite yet |
| [Cyrix-Cyra](https://github.com/CYRIX-Healthcare-Pvt-Ltd/Cyrix-Cyra) | Cyra Assist (CYRA V2): field-service capture and AI guidance | `/cyra/` | Vercel (app) + Render (engine) | CYRA project, schema `cyra_v2` | CYRA team, Kevin | Live (portal sign-in) |
| [Cyrix-Pulse](https://github.com/CYRIX-Healthcare-Pvt-Ltd/Cyrix-Pulse) | Executive MIS from SAP Business One (Pulse and the original OneView) | `/pulse/`, `pulse.cyrix.in`, `oneview.cyrix.in` | Docker on `cyrix-svc01` | SQL Server on `cyrix-svc01` | Adrian | Live; not yet announced to directors |

"Shared" is the portal's Supabase project `emuvmihfbnndhbpsndvc`: one
`auth.users`, one `employees` table, one sign-in (`<ecode>@cyrix.local`) for
every module on it. Its schema is changed only by migrations in
`Cyrix-KPI/supabase/migrations`, except for each module's own prefixed tables,
which that module's repository migrates (`rl_*`, `te_*`, `mt_*`, `inv_*`).

## Outside the portal

| Repository | What it is | Hosting | Database | Status |
|---|---|---|---|---|
| [remix-of-cyra-v1](https://github.com/CYRIX-Healthcare-Pvt-Ltd/remix-of-cyra-v1) | CYRA V1: the original admin, engineer and reviewer app, built in Lovable | Lovable / Cloudflare Workers | CYRA project, `public.*` (V2 reads it) | Last change 30 Aug 2026 |
| [ServiceReport-Verification](https://github.com/CYRIX-Healthcare-Pvt-Ltd/ServiceReport-Verification) | Empty: no commits yet | — | — | Empty |
| [cyrix-app-template](https://github.com/CYRIX-Healthcare-Pvt-Ltd/cyrix-app-template) | Empty: no commits yet | — | — | Empty |

## Supabase projects

| Project ref | Used by | Region |
|---|---|---|
| `emuvmihfbnndhbpsndvc` | Portal, KPI, Spare, BEMMP, Revive Lab, Travel, Task, Inventory; Pulse verifies its sessions | Tokyo |
| `hpsbecwbegwzsqmytqti` | CYRA V1 and V2 | Mumbai |

Project refs and publishable (anon) keys are not secret: they ship in every
browser bundle. Service-role keys, database passwords and connection strings
are, and never belong in a repository or a `VITE_` variable.
