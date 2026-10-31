# README template for Cyrix repositories

Every repository in `CYRIX-Healthcare-Pvt-Ltd` uses this layout, with the
sections in this order and with these exact headings, so that anybody who has
read one README knows where to look in the next. A section that does not apply
stays in and says so in one line ("No database: ..."), rather than being
dropped; a missing heading reads as forgotten.

Copy everything below the line into a new repository's `README.md`. When you
add a repository, add a row for it to [REPOSITORIES.md](REPOSITORIES.md).

Two rules for every section:

- **Never write a secret.** Environment variables are listed by name, with
  where they are set. No keys, passwords, connection strings or test-login
  passwords, not even "example" ones that are real.
- **Write what the code does today.** When a change makes a sentence untrue,
  fix the sentence in the same pull request.

---

```markdown
# <Product name>

<One paragraph: what it does, for whom, in plain words.>

> Part of **Cyrix One**, the platform at [app.cyrix.in](https://app.cyrix.in).
> System-wide picture: [Cyrix One Platform — System Architecture](https://claude.ai/artifact/HNYWoBqCJ6Xh3XcREuKpTu)
> (ask Adrian for access). Every repository: [REPOSITORIES.md](https://github.com/CYRIX-Healthcare-Pvt-Ltd/cyrix-platform/blob/main/docs/REPOSITORIES.md).

## At a glance

| | |
|---|---|
| Served at | <URL(s)> |
| Stack | <languages, frameworks> |
| Database | <which Supabase project / SQL Server; schema or table prefix> |
| Sign-in | <portal session / own login / none> |
| Hosting | <Vercel project name / Render service / cyrix-svc01> |
| Maintainers | <names, from who does the work> |
| Status | <live / in testing / not deployed / legacy> |

## Run locally

<Commands, from a fresh clone, to a running app. Which port.>

## Environment variables

| Name | Where it is set | Secret? | What it is for |
|---|---|---|---|
| `EXAMPLE_NAME` | `.env.local`, Vercel | no | <purpose> |

## Database

<Which project, where migrations live, how they are applied, what this repo
may and may not change in shared tables.>

## Deploy

<What deploys it, from which branch, and anything that must be done by hand.>

## Checks before merging

<The commands to run: typecheck, build, tests, lint.>

## How it works

<The business rules and design decisions that are easy to get wrong.>

## Related docs

<Links to deeper docs in this repo and in others.>
```
