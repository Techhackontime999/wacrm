# wacrm — CRM Template for WhatsApp

> Self-hostable CRM template for WhatsApp® — shared inbox, contacts,
> sales pipelines, broadcasts, no-code automations, and a visual flow
> builder. Fork it, brand it, host it.

[![Deploy on Hostinger](https://img.shields.io/badge/Deploy_on-Hostinger-673DE6?style=for-the-badge&logo=hostinger&logoColor=white)](https://www.hostinger.com/web-apps-hosting)

[![License: MIT](https://img.shields.io/badge/License-MIT-violet.svg)](./LICENSE)
[![CI](https://github.com/Techhackontime999/wacrm/actions/workflows/ci.yml/badge.svg)](https://github.com/Techhackontime999/wacrm/actions/workflows/ci.yml)
[![Next.js 16](https://img.shields.io/badge/Next.js-16-black?logo=nextdotjs)](https://nextjs.org)
[![Supabase](https://img.shields.io/badge/Supabase-Postgres%20%2B%20Auth-3ecf8e?logo=supabase)](https://supabase.com)
[![Stars](https://img.shields.io/github/stars/Techhackontime999/wacrm?style=social)](https://github.com/Techhackontime999/wacrm/stargazers)

The marketing site and self-host docs live in a separate repo:
[Techhackontime999/wacrm-site](https://github.com/Techhackontime999/wacrm-site)
([crm-neural-aurora.vercel.app](https://crm-neural-aurora.vercel.app)). This repo is the product —
clone or fork it to run your own CRM.

---

## What you get out of the box

- **Shared inbox** on the official WhatsApp Business API — multiple
  agents working one number, per-conversation assignment, status,
  reactions, and message templates.
- **Contacts + tags + custom fields + notes** — CSV import ready,
  deduplication, full-text search.
- **Sales pipelines** (Kanban) with drag-and-drop deal management,
  multi-stage pipelines, deals linked to conversations.
- **Broadcasts** with Meta-approved templates, delivery + read
  tracking, per-recipient variable substitution.
- **No-code automations** — 7 trigger types (inbound message, keyword
  match, new contact, conversation assigned, tag added, time-based),
  11 action types (send message/template, tags, assign, create deal,
  wait, condition, webhook, close conversation). Visual builder.
- **Visual flow builder** (Beta) — drag-and-drop canvas for complex
  multi-step flows with branching, scheduling, and execution logs.
- **AI Automation** (Beta) — Telegram-like chat interface that
  controls the entire CRM via natural language. Powered by
  OpenAI-compatible LLMs with automatic fallback to regex parsing.
- **Real-time dashboard** — response times, daily volume, pipeline
  value, cross-module activity feed, per-agent stats.
- **Admin panel** — user management, approval workflow for new
  sign-ups, role-based access (admin/agent).
- **Account management** — email, password, avatar, WhatsApp config,
  global sign-out.

## Why fork this?

This is a **template**, not a product. Forking means you get:

- **Full ownership** — your code, your Supabase project, your domain,
  your data. No SaaS lock-in, no seat pricing, no trust dance.
- **Full customisation** — add the fields your team needs, remove the
  modules you don't, redesign anything. The stack is boring on
  purpose (Next.js + Supabase + Tailwind) so the learning curve is
  short.
- **Zero ops to start** — Hostinger Managed Node.js deploys a fork in
  a few clicks. No Docker, no Kubernetes, no infra team needed.
- **Real security primitives** — token encryption (AES-256-GCM), RLS
  on every table, HMAC-verified webhooks, CSP rate limiting, CI
  typecheck + build on every PR.

Not a framework. Not an SDK. A concrete, working CRM you can stand up
in an afternoon and make yours.

## Quick start

```bash
# Fork on GitHub first: https://github.com/Techhackontime999/wacrm → Fork
git clone https://github.com/<your-username>/wacrm.git
cd wacrm
npm install
cp .env.local.example .env.local   # fill in Supabase + Meta creds
npm run dev
```

Open <http://localhost:3000>. You'll be redirected to `/login` (or
`/dashboard` if already signed in).

### Environment variables

| Variable | Required | Description |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Supabase anonymous (client) key |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Service-role key (bypasses RLS for backend ops) |
| `ENCRYPTION_KEY` | Yes | 64-char hex for AES-256-GCM token encryption |
| `META_APP_SECRET` | Yes | Meta app secret for webhook HMAC verification |
| `NEXT_PUBLIC_SITE_URL` | Recommended | Canonical deployment URL |
| `AUTOMATION_CRON_SECRET` | Optional | Secret for automation cron endpoint |
| `AI_API_BASE` | Optional | OpenAI-compatible API base URL |
| `AI_API_KEY` | Optional | API key for AI provider |
| `AI_MODEL` | Optional | Model name (default: `gpt-4o-mini`) |

## Project structure

```
src/
├── app/
│   ├── (auth)/              # Login, signup, forgot-password
│   ├── (dashboard)/         # Main app — inbox, contacts, pipelines, etc.
│   │   ├── admin/users/     # Admin user management
│   │   ├── ai-automation/   # AI chat interface (Beta)
│   │   ├── automations/     # No-code automation engine
│   │   ├── broadcasts/      # WhatsApp broadcast campaigns
│   │   ├── contacts/        # Contact management
│   │   ├── dashboard/       # Overview / stats
│   │   ├── flows/           # Visual flow builder (Beta)
│   │   ├── inbox/           # Shared WhatsApp inbox
│   │   ├── pipelines/       # Sales pipelines / deals (Kanban)
│   │   └── settings/        # Account & WhatsApp config
│   ├── api/                 # 21 route handlers
│   │   ├── admin/users/     # User CRUD + approval
│   │   ├── ai-automation/   # LLM-powered CRM NL interface
│   │   ├── automations/     # Automation CRUD + engine + cron
│   │   ├── flows/           # Flow CRUD + engine + cron
│   │   └── whatsapp/        # Webhook, send, react, media, templates, broadcast
│   └── approval-pending/    # Post-signup approval gate
├── components/
│   ├── ai-automation/       # Telegram-style chatbox UI
│   ├── automations/         # Builder, triggers, steps
│   ├── broadcasts/          # Campaign composer, recipient list
│   ├── contacts/            # Table, import, detail panel
│   ├── dashboard/           # Metric cards, charts
│   ├── flows/               # Visual flow canvas
│   ├── inbox/               # Conversation list, message thread, contact sidebar
│   ├── layout/              # Sidebar, shell
│   ├── pipelines/           # Kanban board, deal cards
│   ├── settings/            # Form sections
│   └── ui/                  # 22 shadcn-inspired primitives
├── hooks/                   # use-auth, use-realtime, use-unread, etc.
├── lib/
│   ├── ai/                  # Provider, tool definitions, types
│   ├── automations/         # Engine, validation, admin client
│   ├── dashboard/           # Queries, types, date tools
│   ├── flows/               # Flow engine, fallback, validation
│   ├── whatsapp/            # Meta API client, encryption, webhook utils
│   └── supabase/            # Client + server Supabase helpers
└── types/                   # Full TypeScript interfaces
```

### Supabase migrations (14)

| Migration | Purpose |
|---|---|
| `001_initial_schema` | Core: profiles, contacts, tags, conversations, messages, pipelines, deals, broadcasts |
| `002_pipelines_enhancements` | Pipeline stage colors, deal assignments |
| `003_broadcast_recipient_wamid` | WhatsApp message IDs on recipients |
| `004_contact_delete_set_null` | ON DELETE SET NULL for deal/broadcast contacts |
| `005_broadcast_counts_incremental` | Incremental broadcast counters |
| `006_automations` | Automation engine tables |
| `007_automations_increment_counter` | Auto-increment execution counter |
| `008_profile_avatars_storage` | Storage bucket for avatars |
| `009_message_actions` | Interactive message reply support |
| `010_flows` | Visual flow engine tables |
| `011_profile_beta_features` | Beta features flag on profiles |
| `012_flows_increment_counter` | Flow execution counter |
| `013_admin_approval` | Admin approval workflow for sign-ups |
| `014_fix_admin_rls_recursion` | Fix infinite recursion in admin RLS policies |

## Architecture

- **Multi-tenant** — every row is scoped by `user_id` via Supabase RLS.
  The automation engine and webhook handler use a service-role client
  (`supabaseAdmin()`) to operate across all tenants.
- **WhatsApp integration** — inbound messages arrive via Meta Cloud API
  webhook (HMAC-verified), outbound messages go through the same API.
  Access tokens are encrypted at rest (AES-256-GCM). Media is proxied
  through the app to avoid exposing Meta URLs to the browser.
- **AI Automation** — an OpenAI-compatible function-calling loop turns
  natural language into structured CRM operations. 37 tool definitions
  cover every module. Falls back to regex parsing when no API key is
  configured, so the chatbox works without any AI provider.
- **Real-time** — Supabase Realtime subscriptions power inbox unread
  counts and conversation list updates across open tabs.
- **Automation engine** — a rule-based scheduler runs on message
  events (via webhook triggers), cron-driven timers (Wait steps),
  and manual triggers. Supports conditional branching, nested
  execution, and per-step error logging.
- **Visual flows** — a drag-and-drop canvas built on `@dnd-kit`,
  backed by its own execution engine with scheduling, fallback
  branches, and execution run history.

## Stack

- **App** — Next.js 16 (App Router), React 19, TypeScript, Tailwind v4.
- **Data** — Supabase (Postgres + Auth + Storage + RLS + Realtime).
- **WhatsApp** — Meta Cloud API (official WhatsApp Business API).
- **UI** — shadcn/ui primitives, lucide-react icons, sonner toasts,
  `@dnd-kit` for drag-and-drop.
- **AI** — OpenAI-compatible API (OpenAI, OpenRouter, Groq, Together,
  etc.) via function calling.
- **Testing** — Vitest.
- **Linting** — ESLint + Prettier.

## Documentation

Full self-host documentation — Supabase migrations, WhatsApp Business
API config, and production deploy — lives at
**[wacrm.tech/docs](https://wacrm.tech/docs)**
(source: [Techhackontime999/wacrm-site](https://github.com/Techhackontime999/wacrm-site)).

Key pages:
- [Getting started](https://wacrm.tech/docs/getting-started)
- [Supabase setup](https://wacrm.tech/docs/supabase-setup)
- [WhatsApp setup](https://wacrm.tech/docs/whatsapp-setup)
- [Environment variables](https://wacrm.tech/docs/environment-variables)
- [Deploy on Hostinger](https://wacrm.tech/docs/deployment-hostinger)
- [Architecture](https://wacrm.tech/docs/architecture)
- [Troubleshooting](https://wacrm.tech/docs/troubleshooting)

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start development server |
| `npm run build` | Production build |
| `npm run start` | Start production server |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript check (`tsc --noEmit`) |
| `npm run format` | Prettier write |
| `npm run format:check` | Prettier check |
| `npm test` | Vitest run |
| `npm run test:watch` | Vitest watch mode |

## Contributing

This is a template, not a collaborative product — the expected flow is
fork → customise → deploy, **not** upstream contribution. Bug reports
and security issues are welcome; feature PRs often belong in your fork
rather than here. Details in
[`CONTRIBUTING.md`](./CONTRIBUTING.md) and
[`.github/SECURITY.md`](./.github/SECURITY.md).

## License

[MIT](./LICENSE). Fork it, brand it, host it.
