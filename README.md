# Keystone × SuprSend: notifications reference app

A Next.js app that shows how a B2B product wires up SuprSend notifications. **Keystone** is a demo
project-management product. It covers an admin notification catalog, message templates, per-project and
per-person preferences, digests, branding, and an in-app inbox.

This repo is the code companion to the guide
**[Modelling customers in B2B](https://docs.suprsend.com/docs/modelling-customers-b2b)**. The guide explains
the concepts. This app shows them in code. Every screen makes real SuprSend API calls.

**What you'll set up.** Each Keystone customer is a SuprSend workspace. Setup creates two, **Acme** and
**Globex**, so you can see that workspaces are isolated. The repo ships no demo data: you add people in
SuprSend and create projects in the app.

> Next.js 16 (App Router) · React 19 · TypeScript · Tailwind v4 · shadcn/Radix UI.
> SDKs: `@suprsend/node-sdk`, `@suprsend/react`, `@suprsend/react-editor`.

**Contents**

1. [Getting started](#getting-started): set up and run the app
2. [Test it](#test-it): a click-through checklist
3. [How Keystone maps to SuprSend](#how-keystone-maps-to-suprsend)
4. [Which SuprSend API does what](#which-suprsend-api-does-what)
5. [Screens](#screens): what each one does and calls

---

## Getting started

**You need:** Node.js 20+ and a SuprSend account.

### 1. Install

```bash
npm install
```

### 2. Create the workspaces

Get an account service token from the SuprSend dashboard: **Account Settings → Service Tokens**.
Copy the env template and paste the token into `SUPRSEND_SERVICE_TOKEN`:

```bash
cp .env.example .env.local
```

Then create the two workspaces:

```bash
npm run create-workspaces
```

This creates **Acme** and **Globex** (or reuses them if they exist) and fills in each workspace's
Workspace Key in `.env.local`. It's safe to run again. Add `-- --dry-run` to preview without changing anything.

### 3. Paste the remaining keys

Each workspace needs four more values. No API returns them, so copy them from the dashboard: switch to the
workspace, then **Developers → API Keys**.

| Variable | Where to find it |
|---|---|
| `SUPRSEND_<WS>_WORKSPACE_SECRET` | **Workspace Key and Secret** (shown once) |
| `NEXT_PUBLIC_SUPRSEND_<WS>_PUBLIC_KEY` | **Public Keys**: the `SS.PUBK…` value |
| `SUPRSEND_<WS>_SIGNING_KEY_UID` | **Signing Keys**: the `signing_key_…` UID, not the `ws_signk_…` ID |
| `SUPRSEND_<WS>_SIGNING_KEY_B64` | **Signing Keys → Generate**: the Base64 value (shown once) |

`<WS>` is `ACME` or `GLOBEX`. The app shows every workspace whose keys are in `.env.local` and that exists
in your account.

### 4. Push the notification setup

The preference categories, templates, and workflows are files in `suprsend/`, in the layout
[SuprSend's CLI](https://docs.suprsend.com/reference/cli-intro) uses. Preview, then push to both workspaces:

```bash
npm run push:assets -- --dry-run
```

```bash
npm run push:assets
```

After this, SuprSend holds the live copy. Changes you make in the dashboard show up in the app.

> **Pushing again overwrites templates.** If you edited a template in the SuprSend editor, pull it first:
> `npx suprsend template pull -w acme`. Workflows are safe to push again: they read their tunable values
> (roles, cost threshold) from the preference categories.

### 5. Add people in SuprSend

The app never creates users. A project needs at least a Project Manager, so add a few people first.

In the dashboard, open **Acme → Users** and create 3–4 users. For each one, set:

- a **distinct ID**, e.g. `u_dana`
- an **email**
- a **`name`** property, e.g. `Dana Carter`. The app shows this; without it you'll see the distinct ID.

Email delivery needs an email vendor (**Vendors** in the dashboard). The in-app inbox works without one.

### 6. Run

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Continue with [Test it](#test-it).

### Deploying

The app runs anywhere Next.js runs, e.g. Vercel. It has no login. To share a demo, set `DEMO_PASSWORD`
on the deployment and every page and API route asks for that password (`proxy.ts`). A deployed demo reads
and writes your real SuprSend account.

---

## Test it

Run through this on a workspace with no projects. Each step lists what you should see.

| # | Do this | Expect |
|---|---|---|
| 1 | Open the app | **Projects** shows "No projects yet". The header says **Customer: Acme** and **Viewing as: Admin** |
| 2 | Open the **Customer** switcher | Acme and Globex, with names from SuprSend |
| 3 | Click **+ Project**, enter a name, pick a Project Manager and one Team Member, click **Create project** | The project page opens. The project is listed under **Projects** |
| 4 | Open the project's **Resources** tab | The Project Manager and Team Member are listed with their roles |
| 5 | In Resources, assign a **Process Owner**, then change the **Project Manager** to someone else | Both show their new roles. The previous PM is removed from the project |
| 6 | **Viewing as** → pick the new Project Manager, then open the bell | "You're now PM of *project name*" |
| 7 | Back as **Admin**, set the project state to **Paused** | People whose role the Project Paused category targets get a notification in their inbox |
| 8 | Set **Total cost** above the Budget Alert threshold | The Project Manager, Sponsor, and Process Owner get "Budget exceeded" |
| 9 | Add a task, then mark it **Completed** | The Project Manager gets "Task completed" |
| 10 | **Administer → Preferences**: add or remove a recipient role on a category | The change saves. Refresh and it's still there |
| 11 | **Administer → Logs** | Every notification from the steps above, with its status |
| 12 | **Viewing as** → pick a person who isn't on any project | **Projects** shows "No projects to list" |

**Known issue:** @-mention notifications (Tagged on a Project) are accepted by SuprSend but not delivered.
Their workflow condition checks the recipient's project role, which only exists when a notification is sent
to the whole project.

---

## How Keystone maps to SuprSend

Keystone is used by several **customers**. Each customer runs **projects**, and each project has **people**.

| In Keystone | In SuprSend | Why |
|---|---|---|
| **Customer**, e.g. Acme | **Workspace** | Full data isolation, separate API keys, separate brand |
| **Project** | A **tenant** and an **object**, created together | The tenant holds the project's brand and preferences. The object holds the team: each member is subscribed with a role, so one trigger reaches the whole project |
| **Notification type**, e.g. Project Started | **Preference category** | What a person switches on or off |
| **Notification** | **Workflow** | What sends it, filed under its category |
| **Person** | **User** (`distinct_id`) | Who receives it |
| **Admin's defaults** | **Workspace category defaults** | On/off and channels for each category, for everyone |
| **Project settings** | **Tenant preferences** | Overrides for one project |
| **A person's settings** | **User preferences** | One person's choices, for one project |

**A project is two SuprSend records.** **+ Project** creates a tenant (brand and preferences) and an object
of type `project` (the team) in one call. See `app/api/admin/create-project/route.ts`.

**Preferences resolve in three layers.** The more specific layer wins.

| Layer | Scope | Screen |
|---|---|---|
| Category default | The whole workspace | Administer → Preferences |
| Tenant default | One project | Project → Notifications → Project Settings |
| User preference | One person on one project | Project → Notifications → My Settings / User Settings |

A person has no setting that covers all their projects. Preferences are always read for one project.

### Roles

A role decides who receives a notification. It lives in three places:

| What | Where | Change it in |
|---|---|---|
| Which roles exist | The `role` choices on each preference category (`suprsend/preference_categories/categories.json`) | The file, or the SuprSend dashboard |
| A person's role on a project | Their subscription to the project object. One person can have different roles on different projects | The app: **+ Project** or **Resources** |
| Project rules: one required Project Manager, at most one Process Owner and one Sponsor | `lib/roles.ts` | Code |

Each workflow compares the recipient's project role (`$recipient.subscription.role`) with the roles its
category targets. Add a role choice to a category and it appears in the app's recipient pickers.

```
Keystone
└── Customer = Workspace            (Acme, Globex)
    └── Project = Tenant + Object   (brand and preferences + team)
        └── Person = User           (subscribed to the project object with a role)
```

SuprSend is building sub-tenants, which would let a customer be a tenant and its projects sub-tenants.
They aren't available yet, so the app uses the model above.

---

## Which SuprSend API does what

Secrets stay on the server. Calls that need a secret go through `app/api/**`. The two browser SDKs (inbox
and template editor) talk to SuprSend directly, with a short-lived token this app signs.

| Surface | Host / package | Auth | Used for |
|---|---|---|---|
| **Node SDK** | `@suprsend/node-sdk` → `hub.suprsend.com` | Workspace key + secret | Projects, members, roles, comments, tasks, project state, sending notifications, Logs |
| **Management API** | `management-api.suprsend.com` | `Authorization: ServiceToken <token>` | Workspace list, Message Templates, Preferences |
| **Hub REST (signed)** | `hub.suprsend.com` | HMAC-SHA256 signature per request | Project Settings and My / User Settings |
| **React SDK** | `@suprsend/react`, `@suprsend/react-editor` | ES256 token signed by this app | Inbox bell, template editor |

**Endpoints**

- **Management API**: `management-api.suprsend.com/{version}/{WORKSPACE_KEY}/{resource}`
  - Workspaces (v1): `GET v1/workspace/`, account-level
  - Templates (v2): `GET/POST/DELETE v2/{ws}/template/…`
  - Workflows (v1): `GET/POST v1/{ws}/workflow/…`
  - Category defaults (v1): `GET/POST v1/{ws}/preference_category/`
- **Hub REST (signed)**:
  - Project preferences: `GET/PATCH /v1/tenant/{tenant}/category/`
  - Signature: `Authorization: <workspaceKey>:<base64 HMAC-SHA256>` over `verb\ncontentMd5\ncontentType\nDate\npath`
  - User preferences: `GET/PATCH hub/v2/subscriber/{distinct_id}/category/?tenant_id={tenant}`, with
    `Authorization: <publicApiKey>` and `x-ss-signature: <ES256 token>`
- **React SDK**: tokens expire after 1 hour
  - Inbox (`/api/subscriber-token`): `entity_type: subscriber`, scoped to the active project
  - Editor (`/api/editor-token`): signed with the workspace signing key (`kid` = `SIGNING_KEY_UID`)

> **Using this in a real product?** Two routes are simplified for the demo.
> [`/api/subscriber-token`](app/api/subscriber-token/route.ts) takes `distinct_id` from the query string;
> take it from your logged-in session instead. [`/api/editor-token`](app/api/editor-token/route.ts) grants
> access to every template (`entity_id: "*"`); scope it and limit the route to admins.

### Environment variables

| Variable | Scope | Used for |
|---|---|---|
| `SUPRSEND_SERVICE_TOKEN` | Account | Management API for every workspace |
| `SUPRSEND_<WS>_WORKSPACE_KEY` / `_SECRET` | Workspace | Node SDK and signed Hub REST. A set key also makes the workspace appear in the app |
| `SUPRSEND_<WS>_SIGNING_KEY_UID` / `_B64` | Workspace | Signs inbox and editor tokens |
| `NEXT_PUBLIC_SUPRSEND_<WS>_PUBLIC_KEY` | Workspace | Inbox and user preferences |
| `DEMO_PASSWORD` | Deployment | Password for a shared demo. Leave empty locally |
| `SUPRSEND_MGMNT_URL` | Optional | Management API host (default `management-api.suprsend.com`) |
| `SUPRSEND_HOST` | Optional | Host for the signed preference calls (default `hub.suprsend.com`) |

`.env.local` is gitignored. A shorter screen-by-screen API list is in
[`docs/architecture-apis-by-screen.md`](docs/architecture-apis-by-screen.md).

### Repo vs. your account

The app reads everything from SuprSend: workspaces, projects, people, roles, templates, workflows,
categories, brand, and logs. Nothing is hardcoded. With no data, screens show an empty state.

The repo only ships the `suprsend/` files, which step 4 pushes. To copy dashboard edits back into the repo,
run `npx suprsend template pull -w <workspace>` (also `workflow` and `category`).

### Channels

Templates cover **email** and the **in-app inbox**. Two also have Slack content. A channel delivers once its
vendor is configured in SuprSend. Adding SMS, WhatsApp, or push needs a vendor and template content, not
code changes.

---

## Screens

The header has two switchers:

- **Customer**: the active workspace. Every screen reloads against it.
- **Viewing as**: who you are, the Admin or a person on a project. There is no login; screens follow the
  role of whoever you pick. This is enforced in the UI only.

| Role | Scope | Can |
|---|---|---|
| **Admin** | The whole workspace | See every project. Edit category defaults, templates, and brand. Read logs. Change any project's state, PM, members, and settings. No "My Settings" |
| **Project Manager** | Their project | Change state, members, roles, and project settings. Edit a member's settings. Comment and manage tasks |
| **Project Sponsor / Process Owner / Team Member** | Their project | Comment, work on tasks, edit their own settings |

| Nav | Screen | Route | Who |
|---|---|---|---|
| **Projects** | Projects list | `/project` | Admin sees all; others see their own |
| **Projects** | Project page | `/project/[id]` | Project members and Admin |
| **Workspace** | Resource Pool | `/workspace/resource-pool` | Anyone |
| **Administer** | Preferences | `/admin/preferences/defaults` | Admin |
| **Administer** | Message Templates | `/admin/templates` | Admin |
| **Administer** | Brand | `/admin/brand` | Admin |
| **Administer** | Logs | `/admin/executions` | Admin |
| Header | Inbox bell | — | A person on a project (not Admin) |

### Projects: `/project`

- Lists the workspace's projects. Empty until you create one.
- Only the Admin can change state or reassign the PM from this list.
- **+ Project** creates the tenant, the object, and the role subscriptions. It uses existing people only.
- Calls: `/api/people` (list), `/api/admin/create-project` (create), `/api/admin/project-members` PATCH
  (reassign PM, sends `project-assigned`), `/api/admin/project-state` (state).

### Project page: `/project/[id]`

| Tab / control | What you can do | Who | Calls |
|---|---|---|---|
| **Overview** | Comment (with @mentions), add and complete tasks | Any member | `/api/admin/project-comments` sends `comment-added`, or `tagged-on-project` for a mention. `/api/admin/project-tasks` sends `tasks-upcoming` on add, `task-completed` on complete |
| **Resources** | Add and remove people, set roles | Admin or PM | `/api/admin/project-members` → Node SDK object subscriptions |
| **Notifications → Project Settings** | The project's defaults | Admin or PM | `/api/admin/tenant-preferences` → Hub REST (signed) |
| **Notifications → User Settings** | Another member's choices | Admin or PM | `/api/user-preferences` → Hub REST |
| **Notifications → My Settings** | Your own choices | Members | `/api/user-preferences` → Hub REST |
| **State** | In-flight or Paused | Admin or PM | `/api/admin/project-state` sends `project-started` or `project-paused` |
| **Total cost** | Set the project's cost | Admin or PM | `/api/admin/project-cost` sends `budget-alert` |

Each notification includes `project_link`, a link to the project's page in this app.

### Administer → Preferences: `/admin/preferences/defaults`

The workspace defaults for each category: on or off, channels, recipient roles, digest, and conditions such
as the Budget Alert cost threshold. Calls `/api/admin/preference-config` and
`/api/admin/notification-recipients` (Management API).

### Administer → Message Templates: `/admin/templates`

Each notification's content per channel. List, edit in SuprSend's embedded editor, or delete. Calls
`/api/templates` (Management API) and `/api/editor-token`.

### Administer → Brand: `/admin/brand`

The workspace brand (`{{$brand.*}}`): logo, colours, links. Projects use it unless they override it. The
logo and colour also appear in the Customer switcher. Calls `/api/brand` → Node SDK `tenants.get/upsert("default")`.

### Administer → Logs: `/admin/executions`

Every message SuprSend sent for the active project, with status. Calls `/api/executions` → Node SDK
`messages.list()`.

### Workspace → Resource Pool: `/workspace/resource-pool`

Everyone in the workspace and how many projects each person is on. Calls `/api/people` and
`/api/admin/project-members`.

---

## Folder structure

```
app/
  admin/          Administer screens (preferences, templates, brand, logs)
  project/        Projects list and project page
  workspace/      Resource Pool
  gate/           Password page for a shared demo
  api/            Route handlers; the only place that calls SuprSend with a secret
components/       Client components, grouped by screen, plus shared UI
lib/
  server/         Server-only SuprSend access (Node SDK, Management API, signed Hub REST)
  roles.ts        Project-role rules (one Project Manager, single-holder roles)
  workspaces.ts   Finds workspaces from the keys in the env
scripts/          Workspace creation (create-workspaces.mjs) + asset push (push-assets.mjs)
suprsend/         Preference categories, templates and workflows in the SuprSend CLI layout
docs/             Screen-by-screen API list
proxy.ts          Password gate for a shared demo (DEMO_PASSWORD)
```

## Scripts

| Command | Does |
|---|---|
| `npm run dev` | Start the dev server |
| `npm run build` / `npm start` | Production build / run |
| `npm run lint` / `typecheck` / `test` | ESLint / TypeScript / Vitest |
| `npm run create-workspaces` | Create Acme and Globex and fill their Workspace Keys. `-- --dry-run` to preview |
| `npm run push:assets` | Push `suprsend/` to both workspaces. `-- --dry-run` to preview, `-- --draft` to save without publishing |

## Dry run or normal run

`--dry-run` shows what a command would do and changes nothing. Add it after `--`, e.g.
`npm run push:assets -- --dry-run`.

| Command | Dry run when | Normal run when |
|---|---|---|
| `npm run create-workspaces` | You're not sure whether Acme and Globex already exist, or what it will add to `.env.local` | First-time setup. Running it again is safe: it reuses existing workspaces and only adds missing lines |
| `npm run push:assets` | The workspaces are already set up or shared with others | First-time setup, or you want SuprSend to match the repo files |

**Pushing again overwrites templates.** Edits made in the SuprSend editor are replaced by the repo files.
Pull them first with `npx suprsend template pull -w acme`, then push. To stage changes without
publishing, use `-- --draft`.

**Rule of thumb:** fresh setup, run normally. Anything already set up, dry run first.

## License

See [LICENSE](LICENSE).
