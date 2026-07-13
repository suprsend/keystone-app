# API / SDK map — by screen & feature (live only)

Only screens reachable in the live app nav, backed by a real API. Off-nav, in-memory, stubbed, and UI-only features are excluded.

**Surfaces:** Node SDK = `@suprsend/node-sdk` (data + firing) · Mgmt API = `management-api.suprsend.com` (config/authoring) · Hub REST = `hub.suprsend.com` (preferences, signed) · React SDK = `@suprsend/react` / `react-editor` (browser, JWT-authed) · OpenAI = `gpt-4o` (AI authoring).

App runs against **prod** SuprSend.

---

## Administer

### Preferences (workspace defaults) — `/admin/preferences/defaults`
`workspace-defaults-client.tsx`
- `/api/admin/preference-config` → **Mgmt API** (workspace category defaults + channels)
- `/api/admin/notification-recipients` → **Mgmt API** (`recip:<role>` workflow tags — app convention, not SuprSend-native)

### Message Templates — `/admin/templates`
`templates-client.tsx`
- `/api/templates` GET/POST/DELETE → **Mgmt API** (list / publish / delete)
- `/api/templates` POST `mode:generate|edit` → **OpenAI** (AI template generation)

### Template editor (embedded) — `/admin/templates/[slug]`
`editor-mount.tsx`
- Browser **React SDK** `@suprsend/react-editor` (`TemplateEditor`)
- `/api/editor-token` → ES256 JWT (signed with `jsonwebtoken`) authorizing the editor

### Brand — `/admin/brand`
`brand-settings-client.tsx`
- `/api/brand` → **Node SDK** `client.tenants.get/upsert("default")` (account-wide `{{$brand.*}}` fallback)

### Logs — `/admin/executions`
`executions-client.tsx`
- `/api/executions` → **Node SDK** `client.messages.list()` (run id = `idempotency_key`)
- resend → `/api/trigger` → **Node SDK** (`triggerWorkflow` / `trackEvent`)

### Dashboard — `/admin/dashboard`
Static KPI tiles + funnel chart. No API.

---

## Account

### Account → Notifications — `/account/notifications`
`account-nav.tsx` + `user-channel-settings.tsx`
- `/api/admin/preference-config` → **Mgmt API** (category list + allowed options)

---

## Manage (Projects)

### Projects list — `/project`
`projects-list-client.tsx`
- `/api/people` → **Node SDK** (`objects.list("project")` + per-tenant subscriptions/roles)
- PM reassign → `/api/admin/project-members` PATCH → **Node SDK** (`assignProjectRole`, fires `project-assigned`)

### Project detail — `/project/[id]`
Tabs: Overview · Resources · Notifications

- **Resources** (`project-resources.tsx`) → `/api/admin/project-members` GET/POST/PATCH/DELETE → **Node SDK** (`objects.get_subscriptions` / `create`/`delete_subscriptions`, `users.upsert`)
- **State control** (`project-state-control.tsx`) → `/api/admin/project-state` → **Node SDK** (state = property on project object; fires `project-started` / `project-paused` via `triggerObjectWorkflow`)
- **Overview** (`project-overview.tsx`):
  - comments → `/api/admin/project-comments` → **Node SDK** (comments as object array prop; fires `comment-added` object fan-out, or `tagged-on-project` to the @mentioned person)
  - tasks → `/api/admin/project-tasks` → **Node SDK** (tasks as object array prop; add fires `tasks-upcoming` event via `trackEvent`; complete fires `task-completed` to PM + `TASK_CLOSED` signal)
- **Notifications tab**:
  - Project Settings (`tenant-defaults-client.tsx`) → `/api/admin/tenant-preferences` → **Hub REST**, HMAC-SHA256 signed (per-tenant category prefs, `blocked_channels`) + `/api/admin/notification-recipients` → **Mgmt API**
  - Per-member / My Settings (`preference-center.tsx`) → `/api/user-preferences` → **Hub REST**, subscriber-scoped (`publicApiKey` + `x-ss-signature`) + `/api/category-roles` → **Mgmt API** (which roles each category targets)

---

## Shared chrome (all screens)

- **Global provider** (`providers.tsx`) → `/api/users` → **Node SDK** `listUsers` (app-wide people load)
- **Viewing-as** (`viewing-as.tsx`) → `/api/people` → **Node SDK** (customer-scoped people, grouped by project)
- **Inbox bell** (`inbox-bell-mount.tsx`) → browser **React SDK** `@suprsend/react` (`<Inbox>`); `/api/subscriber-token` → ES256 JWT (tenant-scoped)

---

## One-off (not a screen)

- **Provisioning** — `scripts/provision.mjs` → **Node SDK** (tenants/users/objects/categories) + **Mgmt API** (templates/workflows)
</content>
</invoke>
