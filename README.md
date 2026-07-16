# Keystone × SuprSend — notifications reference app

A Next.js app showing how **Keystone** (a demo project-management product) wires up **SuprSend** for its
notifications: an admin notification catalog, message templates, per-project and per-person preferences,
digests, multi-brand, and an in-app inbox. Two demo companies — **Acme** and **Globex** — each run their
projects on it.

Every screen is backed by real SuprSend API calls, so you can trace exactly *what each screen does* and
*which SuprSend call it makes*.

> Next.js 16 (App Router) · React 19 · TypeScript (strict) · Tailwind v4 · shadcn/Radix UI.
> SDKs: `@suprsend/node-sdk`, `@suprsend/react`, `@suprsend/react-editor`.

This README has three parts. Read them in order:

1. **[Architecture](#part-1--architecture-how-keystone-maps-to-suprsend)** — how Keystone concepts map onto SuprSend concepts.
2. **[The SuprSend integration](#part-2--the-suprsend-integration-which-api-does-what)** — the actual APIs, hosts, and auth used.
3. **[App walkthrough](#part-3--app-walkthrough-every-screen-what-it-does-what-it-calls)** — each screen, what you can do there, and what it calls.

---

## Setup

Prerequisites: **Node.js 20+** and a **SuprSend account**.

```bash
# 1 — Install
npm install

# 2 — Create your env file (it already has every blank line to fill)
cp .env.example .env.local

# 3 — Make sure two workspaces exist in SuprSend, named "Acme" and "Globex".
#     New account? Create them in the dashboard ("Add workspace"), OR create them
#     via API (put your service token in .env.local first, then):
#         node --env-file=.env.local scripts/provision.mjs workspaces

# 4 — Fill in .env.local. Every value comes from the SuprSend dashboard:
#       SUPRSEND_SERVICE_TOKEN   → Account Settings → Service Tokens
#       per workspace            → switch to it → Developers → API Keys (5 values each)
#     Each line in .env.local has a comment above it saying exactly what to paste. SAVE the file.

# 5 — Provision each workspace: tenants, users, objects, categories, templates, workflows
node --env-file=.env.local scripts/provision.mjs

# 6 — Run
npm run dev                    # http://localhost:3000
```

Step 5 is required — the app *reads* its tenants / categories / workflows from SuprSend and does **not**
create them on startup; an unprovisioned workspace renders empty states.

> **Why every credential is pasted (no auto-creation):** the Management API's key-creation endpoints return
> values that don't map cleanly to what the app needs — the REST "API Key" is *not* the SDK's Workspace
> Key + Secret, and a signing key's `id` (`ws_signk_…`) is *not* the editor JWT's `kid`, which must be the
> **UID** (`signing_key_…`). Copying the exact dashboard values into `.env.local` avoids every one of those
> pitfalls.

---

## Part 1 — Architecture: how Keystone maps to SuprSend

Keystone is a project-management product used by multiple **customers**; each customer runs **projects**,
and each project has **people**. Each customer is its own SuprSend **workspace**. The whole integration is
this mapping:

| In Keystone (what the user sees) | In SuprSend (what we create) | Why |
|---|---|---|
| **Customer** — e.g. Acme, Globex | **Workspace** | One workspace per customer = full data isolation, its own API keys, its own brand. |
| **Project** | **Tenant** *and* **Object**, created together | The **Tenant** holds the project's brand + per-project preferences. The **Object** holds the team roster — each member is subscribed to it with a role, so one trigger can notify everyone on the project. |
| **Notification type** — “Project Started”, “Task Completed”… | A **workflow**, filed under a **preference category** | The workflow is what sends the notification. Its category is the on/off switch a person controls; related notification types can share one category. |
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

**Switching context (top of the app):**
- The **Workspace switcher** changes the **customer** (= which SuprSend workspace, and therefore which keys).
- **Viewing as** impersonates a **person** (or the Admin). Screens are scoped to whoever you're viewing as.

```
Keystone (product)
└── Customer = Workspace            (Acme, Globex)
    └── Project = Tenant + Object   (brand/prefs + team roster)
        └── Person = User           (subscribed to the project object, with a role)
```

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
| **Management API** | `https://management-api.suprsend.com` | Account-wide **`Authorization: ServiceToken <token>`** | The authoring screens: **Message Templates** (list/publish/delete) and **Preferences** (the admin's category defaults + channels). |
| **Hub REST (signed)** | `https://hub.suprsend.com` | **HMAC-SHA256** signed per request | The preference screens the SDK can't reach: **Project Settings** (tenant defaults) and **My / User Settings** (one person's opt-ins). |
| **React SDK** | `@suprsend/react`, `@suprsend/react-editor` | Short-lived **ES256 JWT** minted by this app | Two browser widgets: the **inbox bell** (`<Inbox>`) and the **embedded template editor** (`<TemplateEditor>` inside the Message Templates screen). |

#### Endpoints, by surface

So you can trace a request end to end. SuprSend's own reference is at <https://docs.suprsend.com>.

- **Management API** — `https://management-api.suprsend.com/{version}/{WORKSPACE_KEY}/{resource}`. The
  customer's **workspace key is a path segment** (not the app's slug), and the version differs by resource:
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
- **Node SDK** — wraps `hub.suprsend.com`; you call methods (`users.upsert`, `objects.*`,
  `tenants.get/upsert`, `workflows.trigger`, `messages.list`), not raw URLs.

### Keys & env (one set of account keys + one set per customer)

| Env var | Scope | What it authorizes |
|---|---|---|
| `SUPRSEND_SERVICE_TOKEN` | Account-wide | The Management API, for **every** workspace. |
| `SUPRSEND_MGMNT_URL` | Account-wide | Management API host (default `management-api.suprsend.com`). |
| `SUPRSEND_HOST` | Account-wide | Hub host (default `hub.suprsend.com`). |
| `<PREFIX>_WORKSPACE_KEY` / `_SECRET` | Per customer | Node SDK + signed Hub REST for that workspace. |
| `<PREFIX>_SIGNING_KEY_UID` / `_B64` | Per customer | Signs the JWT for the embedded **template editor**. |
| `NEXT_PUBLIC_<PREFIX>_PUBLIC_KEY` / `_WORKSPACE_KEY` | Per customer | Browser React SDK (inbox). |
| `<PREFIX>_SLACK_WEBHOOK` | Per customer (optional) | Legacy Slack webhook. **Unused** — Slack delivery was removed (see Channels below). |

`<PREFIX>` is derived from the customer slug: `acme` → `SUPRSEND_ACME`.
Secrets never reach the browser; `.env.local` and `keys.txt` are gitignored.

> A condensed screen-by-screen API index is in
> [`docs/architecture-apis-by-screen.md`](docs/architecture-apis-by-screen.md).

### Channels

Two channels appear throughout the app (templates, workflows, preference toggles):

| Channel | Status |
|---|---|
| **Email** | Live — actually delivered. |
| **In-app Inbox** | Live — the bell in the header, powered by the browser React SDK. |

---

## Part 3 — App walkthrough: every screen, what it does, what it calls

### Two switchers, always in the header

- **Workspace switcher** — picks the active **customer** (Acme / Globex). Everything below reloads
  against that customer's SuprSend workspace and keys.
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
  they belong to.
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
| **Resources** | Add / remove people; set their roles. | Admin or PM | `/api/admin/project-members` → Node SDK `objects.get/create/delete_subscriptions`, `users.upsert` |
| **Notifications → Project Settings** | The project's notification defaults (applies to everyone on the project). | Admin or PM | `/api/admin/tenant-preferences` → **Hub REST, signed** (per-project category prefs + `blocked_channels`) |
| **Notifications → User Settings** | Edit *another* member's opt-ins for this project. | Admin or PM | `/api/user-preferences` → **Hub REST, subscriber-scoped** |
| **Notifications → My Settings** | Your *own* opt-ins for this project. | Any member except Admin | `/api/user-preferences` → **Hub REST, subscriber-scoped** |
| **State** (Start / Pause) | Flip the project to In-flight / Paused. | Admin or PM | `/api/admin/project-state` → Node SDK (state is a property on the object; fires `project-started` / `project-paused` to all members) |

### Administer → Preferences — `/admin/preferences/defaults`

- **What it does:** the **admin's account-level defaults** — for each notification type (category), is it on
  by default, and which channels are allowed. This is the baseline every project and person inherits.
- **Calls:** `/api/admin/preference-config` → **Management API** (workspace category defaults + channels);
  `/api/admin/notification-recipients` → **Management API** (which role each notification targets).

### Administer → Message Templates — `/admin/templates`

- **What it does:** the content of each notification, per channel (email subject/body, inbox title/body…).
  List, edit (in the embedded editor), delete.
- **Embedded editor** at `/admin/templates/[slug]` is SuprSend's own visual editor running in the browser.
- **Calls:**
  - List / delete → `/api/templates` → **Management API**
  - Editor → browser **React SDK** `<TemplateEditor>`; JWT from `/api/editor-token` (ES256, signing-key)

### Administer → Brand — `/admin/brand`

- **What it does:** the account-wide brand fallback (`{{$brand.*}}` — logo, colors) used when a project
  doesn't override it.
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
app/admin     Administer surfaces (templates, preferences, brand, logs)
app/project   Manage surfaces (projects list + project detail)
app/workspace resource pool
app/api       route handlers — where every secret-bearing SuprSend call is made
lib/server    server-only SuprSend access (Node SDK + Management API + signed Hub REST)
lib           registries: workspaces (customers), tenants (projects), people, notifications
components     UI, grouped by surface
```

## Scripts

| Command | Does |
|---|---|
| `npm run dev` | Dev server (`-- -p 3200` for the demo port) |
| `npm run build` / `start` | Production build / run |
| `npm run lint` / `typecheck` / `test` | ESLint / `tsc --noEmit` / Vitest |

Provisioning a fresh customer (tenants, users, objects, categories, templates, workflows):
`node --env-file=.env.local scripts/provision.mjs`.

## License

See [LICENSE](LICENSE).
