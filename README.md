# Homivio COD CRM

A cash-on-delivery order CRM for Homivio, built with Next.js (App Router), Supabase (Postgres with Row Level Security) and Tailwind CSS.

Agents work their own queue of orders and record calls. Admins assign orders, watch analytics and manage distribution.

**Live demo:** https://homivio-cod-crm.vercel.app

## Demo accounts

| Role  | Email                  |
| ----- | ---------------------- |
| Admin | admin@homivio.test     |
| Agent | agent1@homivio.test    |
| Agent | agent2@homivio.test    |

Passwords are shared privately and are not stored in this repository.

> The demo database contains sample customer data. Do not share it or use it for anything other than reviewing the product.

## Features

- **Admin:** Overview, Orders (search, status and city filters, assign and reassign), Analytics, Distribution Center (bulk assignment with a reviewed plan), Rescue Queue.
- **Agent:** My Queue ranked by priority, record calls (answered or no answer), confirm or refuse orders.
- **Workflow rules:** three unanswered calls cancel an order automatically. Every change is recorded as an append-only event.
- **Repeat-customer warnings** based on the customer's earlier orders.

## Tech stack

- Next.js 16 (App Router, Server Actions, Cache Components)
- React 19, TypeScript (strict)
- Supabase: Postgres, Auth, Row Level Security and RPC functions
- Zod for validation, Tailwind CSS 4
- Vitest for unit tests, ESLint

## Getting started

Requirements: Node.js 20 or newer, and a Supabase project.

```bash
npm install
cp .env.example .env.local   # then fill in the values
npm run dev
```

Open http://localhost:3000.

### Environment variables

| Variable | Used by | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | app | Project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | app | Publishable key. Safe in the browser because RLS protects the data. |
| `SUPABASE_SECRET_KEY` | operator scripts only | Never set on Vercel and never prefixed with `NEXT_PUBLIC_`. |
| `SAMPLE_ORDERS_PATH` | optional tests | Path to `sample_orders.json` for the dataset test. |

## Database

Migrations live in `supabase/migrations` and must be applied in filename order. Key rules:

- Audit tables (`order_events`, `call_attempts`, `order_notes`, `import_batches`, `source_records`, `assignment_batches`) are append-only. UPDATE, DELETE and TRUNCATE are blocked for every role.
- Orders can't be deleted. Their status is changed through RPC functions that check the order version.
- Roles are stored in `public.profiles`, never in user metadata.

See `docs/demo-users.md` for how to create the demo accounts.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the development server |
| `npm run build` | Production build |
| `npm run typecheck` | TypeScript check without emitting files |
| `npx eslint src` | Lint the source |
| `npm run test` | Unit tests (Vitest) |

## Project layout
