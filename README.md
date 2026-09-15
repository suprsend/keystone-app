# Keystone × SuprSend — notifications reference app

A Next.js app showing how **Keystone** (a demo project-management product) wires up **SuprSend** for its
notifications: an admin notification catalog, message templates, per-project and per-person preferences,
digests, multi-brand, and an in-app inbox.

This repo is the code companion to the guide
**[Modelling customers in B2B](https://docs.suprsend.com/docs/modelling-customers-b2b)** — the guide
explains the concepts; this app shows the same model in code. Every screen is backed by real SuprSend API
calls, so you can trace exactly *what each screen does* and *which SuprSend call it makes*.

**The demo world.** Keystone's customers are SuprSend workspaces. Setup creates two, **Acme** and
**Globex**, so you can see workspace isolation: each has its own keys, brand, people, and data. There is
no demo data — you add people in SuprSend and create projects in the app, and every screen reads what
your account holds.

> Next.js 16 (App Router) · React 19 · TypeScript (strict) · Tailwind v4 · shadcn/Radix UI.
> SDKs: `@suprsend/node-sdk`, `@suprsend/react`, `@suprsend/react-editor`.

This README has three parts. Read them in order:

1. **[Architecture](#part-1--architecture-how-keystone-maps-to-suprsend)** — how Keystone concepts map onto SuprSend concepts.
2. **[The SuprSend integration](#part-2--the-suprsend-integration-which-api-does-what)** — the actual APIs, hosts, and auth used.
3. **[App walkthrough](#part-3--app-walkthrough-every-screen-what-it-does-what-it-calls)** — each screen, what you can do there, and what it calls.

---

## Getting started

**Prerequisites:** Node.js 20+ and a SuprSend account.

**1. Install**

```bash
npm install
```

**2. Create the workspaces**

The app expects two SuprSend workspaces named **Acme** and **Globex**, and their credentials don't
exist until the workspaces do — so this comes first. Copy the env template, paste your account
service token (Account Settings → Service Tokens) into it, then run the bootstrap:

```bash
cp .env.example .env.local
```

```bash
npm run create-workspaces
```

It creates both workspaces (or adopts them if they already exist — safe to re-run), **auto-fills each
workspace's Workspace Key** (it equals the workspace UID the API returns), and appends a labelled
placeholder to `.env.local` for each remaining credential the next step fills in. (Prefer clicking?
Create them in the dashboard with **Add workspace** instead; the key fill and placeholders still get
written the next time you run the command.)

> The remaining four credentials per workspace are pasted by hand because no API returns them —
> SuprSend shows the secret and the signing-key Base64 exactly once, in the dashboard.

**3. Add the workspace credentials**

Fill in the placeholders in `.env.local` — every value comes from the SuprSend dashboard (switch to
each workspace → **Developers → API Keys**). The [environment variables](#environment-variables) table
below shows where each one lives.

**4. Push the notification assets (SuprSend CLI)**

The demo's preference categories, templates, and workflows live as plain files in `suprsend/`, in the
layout [SuprSend's CLI](https://docs.suprsend.com/reference/cli-intro) defines. This step copies them
into your two workspaces. They're a starting kit — after this, your SuprSend account is the live copy:
anything you change or add in the SuprSend dashboard shows up in the app as is, no code change needed.

```bash
npm run push:assets -- --dry-run
```

Then push for real (commits the assets live in both demo workspaces):

```bash
npm run push:assets
```

That wraps `npx suprsend category|template|workflow push` per workspace (see
`scripts/push-assets.mjs`); you can run the CLI directly instead.

> On a **re-push**, the CLI replaces each remote asset with the local files. For templates that means
> edits made by hand in the SuprSend editor are overwritten — pull them down first
> (`npx suprsend template pull -w acme`) or don't re-push. Workflows are safe to re-push by design:
> the files hold static structure only, and every value a human tunes (role, except, include, the cost
> threshold) lives on the preference category, which the workflow conditions only read.

> **Email needs a vendor.** A fresh SuprSend workspace has no email vendor configured, so email sends fail
> while the in-app inbox works immediately. Configure one under **Vendors** if you want mail to land.

**5. Run**

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Projects is empty until you create one.

**6. Add people and create your first project**

1. **Add people in SuprSend.** In the dashboard, open a workspace → **Users** and add a few users with a
   name and email. The app never creates users — in a real product your backend syncs them — and a
   project needs at least a Project Manager to pick.
2. **Create the project in the app.** Click **+ Project**, name it, and pick a Project Manager (plus an
   optional Process Owner, Sponsor, and Team Members). This creates the project's tenant and object and
   subscribes each person with their role — see [Roles](#roles).

**Deploying (optional).** The app runs anywhere Next.js does (e.g. Vercel). There's no user login;
to share a demo, set `DEMO_PASSWORD` on the deployment and every route sits behind that one shared
password (`proxy.ts`). Remember that a deployed demo reads and writes your real SuprSend account.

### Environment variables

`.env.local` already lists every variable, ready to fill. All values come from the SuprSend dashboard:

| Variable | Where to find it |
|---|---|
| `SUPRSEND_SERVICE_TOKEN` | Account Settings → Service Tokens |
| `SUPRSEND_<WS>_WORKSPACE_KEY` | Auto-filled by the bootstrap (= the workspace UID); also under Workspace → Developers → API Keys → **Workspace Key and Secret** |
| `SUPRSEND_<WS>_WORKSPACE_SECRET` | Workspace → Developers → API Keys → **Workspace Key and Secret** (shown once) |
| `NEXT_PUBLIC_SUPRSEND_<WS>_PUBLIC_KEY` | → **Public Keys** (the `SS.PUBK…` value) |
| `SUPRSEND_<WS>_SIGNING_KEY_UID` | → **Signing Keys** → the `signing_key_…` **UID** (not the `ws_signk_…` ID) |
| `SUPRSEND_<WS>_SIGNING_KEY_B64` | → **Signing Keys** → Generate → the Base64 |

`<WS>` names the workspace — `ACME` and `GLOBEX` for the two the bootstrap creates. The app shows every
workspace whose Workspace Key is set here and that exists in your account; its name, logo, and colour come
from SuprSend (the name from the account, the logo and colour from **Administer → Brand**). The
per-workspace keys live at `https://app.suprsend.com/en/<workspace-slug>/developers/api-keys` — the slug is
usually `acme` / `globex` (SuprSend derives it from the workspace name), but it can differ per account, so
switch workspaces in the dashboard rather than relying on the URL.

---

## Part 1 — Architecture: how Keystone maps to SuprSend

Keystone is a project-management product used by multiple **customers**; each customer runs **projects**,
and each project has **people**. Each customer is its own SuprSend **workspace**. The whole integration is
this mapping:

| In Keystone (what the user sees) | In SuprSend (what we create) | Why |
|---|---|---|
| **Customer** — e.g. Acme, Globex | **Workspace** | One workspace per customer = full data isolation, its own API keys, its own brand. |
| **Project** | **Tenant** *and* **Object**, created together | The **Tenant** holds the project's brand + per-project preferences. The **Object** holds the team roster — each member is subscribed to it with a role, so one trigger can notify everyone on the project. |
| **Notification type** — “Project Started”, “Task Completed”… | A **preference category** | The grouping a person switches on/off. Several notifications can share one category. |
| **A notification** — the message that actually goes out | A **workflow** | What sends it, filed under its type's category. |
| **Person** — a team member | **User** (`distinct_id`) | The recipient of notifications. |
| **Admin's default settings** | **Workspace category defaults** | The org-wide on/off + allowed channels for each notification type. |
| **A project's settings** | **Tenant preferences** | Per-project overrides (e.g. block a channel for this project). |
| **A person's own settings** | **User preferences** | What one user opted into, for a given project. |

Two things to keep straight:

- **A project is two SuprSend things at once.** Adding a project on the Projects screen creates a **tenant**
  (for brand + project preferences) **and** an **object** of type `project` (for the team roster) in the
  same call — see `app/api/admin/create-project/route.ts`.
- **Preferences resolve in three layers.** SuprSend applies them in order — the more specific layer wins:

  | Layer | Scope | Set on the screen |
  |---|---|---|
  | **Category default** | **Global** (whole workspace) — the admin baseline for every project and person | Administer → Preferences |
  | **Tenant default** | **Per-project** — overrides the global default for one project | Project → Notifications → Project Settings |
  | **User preference** | **Per-person, per-project** — overrides both, for one person on one project | Project → Notifications → My / User Settings |

  So the admin's category defaults *are* global; only the tenant defaults and a person's own opt-ins are
  per-project. A user has no single setting that spans all their projects — preferences are always read for
  one project at a time. The resolved value is what gates delivery.

### Roles

A role decides who receives a notification. It lives in three places, each with one job:

| What | Where it lives | Set it in |
|---|---|---|
| **Which roles exist** | The `role` choices on each preference category (`suprsend/preference_categories/categories.json`) | The asset file, or the SuprSend dashboard |
| **A person's role on a project** | A property on their subscription to the project object — so one person can hold different roles on different projects | The app: **+ Project** or the project's **Resources** tab |
| **The project rules** — one required Project Manager, at most one Process Owner and one Sponsor | `lib/roles.ts` | Code |

A workflow's condition compares the recipient's subscription role (`$recipient.subscription.role`) with the
roles its category targets. Add a role choice to a category and it shows up in the app's Recipients pickers.

**Switching context (top of the app):**
- The **Workspace switcher** changes the **customer** (= which SuprSend workspace, and therefore which keys).
- **Viewing as** impersonates a **person** (or the Admin). Screens are scoped to whoever you're viewing as.

```
Keystone (product)
└── Customer = Workspace            (Acme, Globex)
    └── Project = Tenant + Object   (brand/prefs + team roster)
        └── Person = User           (subscribed to the project object, with a role)
```

> **Looking ahead — sub-tenants.** SuprSend is developing sub-tenants, which would let a **customer** be
> the tenant and its **projects** be sub-tenants beneath it, instead of today's workspace-per-customer +
> tenant-per-project. It isn't available yet, so this app models the hierarchy above.

---

## Part 2 — The SuprSend integration: which API does what

Secrets (workspace key/secret, service token) stay server-side: the secret-bearing SuprSend calls go
through this app's own API routes (`app/api/**`), which run in `lib/server/**`. The two **browser** SDKs
(inbox, template editor) do talk to SuprSend directly, but only with a **short-lived JWT** this app mints
for them — the secret never reaches the browser.

There are **four** surfaces. The **Used in the app** column says which feature each one powers:

| Surface | Host / package | Auth | Used in the app |
|---|---|---|---|
| **Node SDK** | `@suprsend/node-sdk` → `hub.suprsend.com` | Per-workspace **key + secret** (server-side) | Everything on the **Projects/Resources/Overview** screens: create the project tenant+object, add/remove members, set roles, post comments, add/complete tasks, start/pause a project — and **fire the workflow** behind each of those. Also reads the **Logs** screen. |
| **Management API** | `https://management-api.suprsend.com` | Account-wide **`Authorization: ServiceToken <token>`** | The **workspace list** (switcher) and the authoring screens: **Message Templates** (list/publish/delete) and **Preferences** (the admin's category defaults + channels). |
| **Hub REST (signed)** | `https://hub.suprsend.com` | **HMAC-SHA256** signed per request | The preference screens the SDK can't reach: **Project Settings** (tenant defaults) and **My / User Settings** (one person's opt-ins). |
| **React SDK** | `@suprsend/react`, `@suprsend/react-editor` | Short-lived **ES256 JWT** minted by this app | Two browser widgets: the **inbox bell** (`<Inbox>`) and the **embedded template editor** (`<TemplateEditor>` inside the Message Templates screen). |

#### Endpoints, by surface

So you can trace a request end to end. The concepts behind this mapping are in the guide
[Modelling customers in B2B](https://docs.suprsend.com/docs/modelling-customers-b2b); the full API
reference is at <https://docs.suprsend.com>.

- **Management API** — `https://management-api.suprsend.com/{version}/{WORKSPACE_KEY}/{resource}`. The
  customer's **workspace key is a path segment** (not the app's slug), and the version differs by resource:
  - Workspaces (v1): `GET v1/workspace/` — account-level, no workspace segment
  - Templates (v2): `GET/POST/DELETE v2/{ws}/template/…`, channel variants under `…/channel/{channel}/variant/…`
  - Workflows (v1): `GET/POST v1/{ws}/workflow/…`
  - Category defaults (v1): `GET/POST v1/{ws}/preference_category/`
  - Auth header: `Authorization: ServiceToken <SUPRSEND_SERVICE_TOKEN>`
- **Hub REST (signed)** — `https://hub.suprsend.com`
  - Tenant (project) prefs: `GET/PATCH /v1/tenant/{tenant}/category/` and `…/preference/category/{category}/`
  - Auth header: `Authorization: <workspaceKey>:<base64 HMAC-SHA256>` signed over `verb\ncontentMd5\ncontentType\nDate\npath`
  - Subscriber (user) prefs: `GET/PATCH hub/v2/subscriber/{distinct_id}/category/?tenant_id={tenant}`,
    authed with `Authorization: <publicApiKey>` + `x-ss-signature: <ES256 JWT>`
- **React SDK (browser)** — connects to SuprSend directly with an ES256 JWT minted here, 1-hour expiry:
  - Inbox JWT (`/api/subscriber-token`): claims `entity_type: subscriber`, scoped to the active `tenant_id`
  - Editor JWT (`/api/editor-token`): signed with the workspace's signing key (`kid = SIGNING_KEY_UID`)
- **Node SDK** — wraps `hub.suprsend.com`; you call methods (`users.list`, `objects.*`,
  `tenants.get/upsert`, `workflows.trigger`, `messages.list`), not raw URLs.

> **Taking these patterns into a real product?** Two routes are demo-simplified on purpose:
> [`/api/subscriber-token`](app/api/subscriber-token/route.ts) reads `distinct_id` from the query
> string — take it from your authenticated session instead — and
> [`/api/editor-token`](app/api/editor-token/route.ts) uses `entity_id: "*"` (every template); scope
> it down and gate the route to admins.

### Keys & env (one set of account keys + one set per customer)

| Env var | Scope | What it authorizes |
|---|---|---|
| `SUPRSEND_SERVICE_TOKEN` | Account-wide | The Management API, for **every** workspace. |
| `SUPRSEND_MGMNT_URL` | Account-wide | Management API host (default `management-api.suprsend.com`). |
| `SUPRSEND_HOST` | Account-wide | Hub host (default `hub.suprsend.com`). |
| `<PREFIX>_WORKSPACE_KEY` / `_SECRET` | Per customer | Node SDK + signed Hub REST for that workspace. A set Workspace Key is also what makes the workspace appear in the app. |
| `<PREFIX>_SIGNING_KEY_UID` / `_B64` | Per customer | Signs the JWT for the embedded **template editor**. |
| `NEXT_PUBLIC_<PREFIX>_PUBLIC_KEY` | Per customer | Browser React SDK (inbox). |

`<PREFIX>` is `SUPRSEND_` plus the workspace name: `SUPRSEND_ACME`, `SUPRSEND_GLOBEX`.
Secrets never reach the browser; `.env.local` and `keys.txt` are gitignored.

> A condensed screen-by-screen API index is in
> [`docs/architecture-apis-by-screen.md`](docs/architecture-apis-by-screen.md).

### What's in your account vs. what's in the repo

Every screen fetches live from SuprSend — workspaces, templates, workflows, preference categories, brand,
logs, projects, people, and role choices. The repo ships only the `suprsend/` asset files as a starting kit
(step 4 pushes them). Nothing else is hardcoded and there are no fallbacks: a workspace with no projects
shows an empty state, and anything you create in the dashboard that this repo has never heard of shows up
as is. To bring dashboard edits back into files, `npx suprsend template pull -w <workspace>` (same for
`workflow` / `category`); re-pushing a template overwrites dashboard edits, re-pushing a workflow is safe
(the files hold structure only — tunable values live on the preference category).

### Channels

The templates here are authored for **email** and the **in-app inbox** (two of them also carry Slack
content), and those are the channels the preference toggles surface.

There is no notion of a channel being "live" in the model. A channel delivers once its **vendor is
configured** in SuprSend — nothing about the model, the workflows, or this code changes per channel.
Configure a vendor for SMS, WhatsApp, push, or Slack and that channel starts working the same way; the
only thing to add is the template content for it.

---

## Part 3 — App walkthrough: every screen, what it does, what it calls

### Two switchers, always in the header

- **Workspace switcher** — picks the active **customer** from the connected workspaces. Everything below
  reloads against that customer's SuprSend workspace and keys.
- **Viewing as** — picks **who you are**: the Admin, or a specific person on a project. The app has no
  login; it gates each screen by the role of whoever you're viewing as.

### Roles, and who can do what

| Role | Scope | Can |
|---|---|---|
| **Admin** | The whole customer | See every project. Set the global category defaults, templates, brand. Read logs. Change any project's state, reassign its PM, manage its members and project-level notification settings. (No personal "My Settings" — the Admin isn't a project member.) |
| **Project Manager (PM)** | One project | Everything on *their* project: start/pause it, manage members + roles, edit the project's notification defaults, edit a member's settings, post comments, manage tasks. Plus their own "My Settings." |
| **Project Sponsor / Process Owner / Team Member** | One project | Participate: post comments, work tasks, view the project. Edit only their own "My Settings." Cannot change state, members, or project defaults. |

> The demo enforces this **in the UI** (controls are hidden/disabled by role) — there's no server-side
> auth, since "Viewing as" is a demo convenience, not a real login.

### Navigation map

| Top-nav area | Screen | Route | Who reaches it |
|---|---|---|---|
| **Manage** | Projects | `/project` | Admin sees all; a person sees only their own projects |
| **Manage** | Project detail (tabs) | `/project/[id]` | The project's members + Admin |
| **Administer** | Preferences | `/admin/preferences/defaults` | Admin |
| **Administer** | Message Templates | `/admin/templates` | Admin |
| **Administer** | Brand | `/admin/brand` | Admin |
| **Administer** | Logs | `/admin/executions` | Admin |
| **Workspace** | Resource Pool | `/workspace/resource-pool` | Admin |
| (header) | Inbox bell | — | A person — their own in-app inbox; not shown for the Admin view |

The app opens on **Manage → Projects** (`/project`). Customer + Viewing-as switchers live in the header.

The **+ Project** button (header) opens the add-project dialog → `/api/admin/create-project`.
The **Inbox bell** is the browser React SDK `<Inbox>`, authed by `/api/subscriber-token` (ES256 JWT,
scoped to the active project) — it shows the current person's notifications and is not part of the Admin view.

---

### Manage → Projects — `/project`

- **What it does:** lists the customer's projects. Admin sees all; a non-admin sees only the projects
  they belong to. Empty until the first project is created.
- **Who can do what:** **only the Admin** can change a project's state or reassign its PM **from this list**.
- **+ Project** creates a project in one call = **one tenant + one object + role subscriptions** (existing
  people are mapped onto it; no new users are created here).
- **Calls:**
  - List → `/api/people` → Node SDK `objects.list("project")` + per-project subscriptions/roles
  - Add → `/api/admin/create-project` → Node SDK (tenant upsert + object + role subscriptions)
  - Reassign PM → `/api/admin/project-members` PATCH → Node SDK `assignProjectRole` (fires `project-assigned`)
  - Start/pause → `/api/admin/project-state` (see Project detail → State)

### Manage → Project detail — `/project/[id]`

Open to the project's members (and Admin). What you can *do* depends on your role — see the **Who** column.

| Tab / control | What you can do | Who | SuprSend call |
|---|---|---|---|
| **Overview** | Post comments (with @mentions); add / complete tasks. | Any member | Comments → `/api/admin/project-comments` → Node SDK (fires `comment-added` to the whole project, or `tagged-on-project` to the mentioned person). Tasks → `/api/admin/project-tasks` → Node SDK (add fires `tasks-upcoming`; complete fires `task-completed` to the PM). |
| **Resources** | Add / remove people; set their roles. | Admin or PM | `/api/admin/project-members` → Node SDK `objects.get/create/delete_subscriptions` |
| **Notifications → Project Settings** | The project's notification defaults (applies to everyone on the project). | Admin or PM | `/api/admin/tenant-preferences` → **Hub REST, signed** (per-project category prefs + `blocked_channels`) |
| **Notifications → User Settings** | Edit *another* member's opt-ins for this project. | Admin or PM | `/api/user-preferences` → **Hub REST, subscriber-scoped** |
| **Notifications → My Settings** | Your *own* opt-ins for this project. | Any member except Admin | `/api/user-preferences` → **Hub REST, subscriber-scoped** |
| **State** (Start / Pause) | Flip the project to In-flight / Paused. | Admin or PM | `/api/admin/project-state` → Node SDK (state is a property on the object; fires `project-started` / `project-paused` to all members) |

Every notification these fire carries a `project_link` back to the project's page in this app, on
whatever host it runs.

### Administer → Preferences — `/admin/preferences/defaults`

- **What it does:** the **admin's account-level defaults** — for each notification type (category), is it on
  by default, and which channels are allowed. This is the baseline every project and person inherits.
- **Calls:** `/api/admin/preference-config` → **Management API** (workspace category defaults + channels);
  `/api/admin/notification-recipients` → **Management API** (which role each notification targets, and the
  role choices to pick from).

### Administer → Message Templates — `/admin/templates`

- **What it does:** the content of each notification, per channel (email subject/body, inbox title/body…).
  List, edit (in the embedded editor), delete.
- **Embedded editor** at `/admin/templates/[slug]` is SuprSend's own visual editor running in the browser.
- **Calls:**
  - List / delete → `/api/templates` → **Management API**
  - Editor → browser **React SDK** `<TemplateEditor>`; JWT from `/api/editor-token` (ES256, signing-key)

### Administer → Brand — `/admin/brand`

- **What it does:** the account-wide brand fallback (`{{$brand.*}}` — logo, colors) used when a project
  doesn't override it. The logo and primary colour also brand the customer in the workspace switcher.
- **Calls:** `/api/brand` → Node SDK `client.tenants.get/upsert("default")`.

### Administer → Logs — `/admin/executions`

- **What it does:** the live delivery log — every message SuprSend sent for this customer, with status.
  Resend any run.
- **Calls:** `/api/executions` → Node SDK `client.messages.list()` (run id = `idempotency_key`); resend →
  `/api/trigger` → Node SDK (`triggerWorkflow` / `trackEvent`).

### Workspace → Resource Pool — `/workspace/resource-pool`

- **What it does:** the customer's full people roster and which projects each person is on.
- **Calls:** `/api/people` (Node SDK objects + subscriptions) and `/api/admin/project-members`.

---

## Repository layout

```
app/admin      Administer surfaces (templates, preferences, brand, logs)
app/project    Manage surfaces (projects list + project detail)
app/workspace  resource pool
app/api        route handlers — where every secret-bearing SuprSend call is made
lib/server     server-only SuprSend access (Node SDK + Management API + signed Hub REST)
lib            shared helpers: workspace keys from the env, project-role rules, preference mapping
components     UI, grouped by surface
suprsend/      the reference asset kit — preference categories, templates, workflows,
               in the SuprSend CLI's file layout (see "What's in your account vs. what's in the repo")
scripts/       create-workspaces.mjs (workspaces + env placeholders) · push-assets.mjs (CLI wrapper)
```

## Scripts

| Command | Does |
|---|---|
| `npm run dev` | Dev server (`-- -p 3200` for the demo port) |
| `npm run build` / `start` | Production build / run |
| `npm run lint` / `typecheck` / `test` | ESLint / `tsc --noEmit` / Vitest |
| `npm run create-workspaces` | Create the Acme and Globex workspaces and write their env placeholders — add `-- --dry-run` to preview |
| `npm run push:assets` | Push the `suprsend/` assets (categories, templates, workflows) via the SuprSend CLI — add `-- --dry-run` to preview, `-- --draft` to stage without committing |

## License

See [LICENSE](LICENSE).
