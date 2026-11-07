# Implementation Plan

Phases are ordered by dependency. Each phase must meet its acceptance criteria before the next starts. Phase numbers use the `I-` prefix to distinguish them from the project workflow step (Phase 1, Step 3), which is this planning work.

Architecture reference: [architecture.md](./architecture.md).

---

## I-0 Foundation (complete)

- Next.js 16.4.5 App Router, React 19.3, TypeScript, Tailwind CSS 4, Turbopack.
- `cacheComponents` and `partialPrefetching` enabled.
- Initial commit `bee8209`, pushed to `origin/main`.

**Acceptance:** met. Starter app builds, typechecks, and lints.

---

## I-1 Tooling and configuration

**Goal:** Add the minimum dependencies and the configuration every later phase needs.

**Work**
- Add `zod`, `vitest`, `@supabase/supabase-js`, `@supabase/ssr`. Justify each in the commit message.
- Add scripts: `test`, `typecheck`.
- Add `src/lib/env.ts` (`server-only`) that validates environment variables with Zod.
- Add `.env.example` with placeholder names only.
- Add `CLAUDE.md` (already created in this step) and keep `AGENTS.md` unchanged.

**Install command** (requires registry access; run locally):
```
npm install zod@^4 @supabase/supabase-js @supabase/ssr server-only
npm install -D vitest
```
**Status:** blocked in the assistant sandbox. The npm registry returned a security-policy denial, and the container has no network. Not yet installed or verified.

**Acceptance**
- `npm run typecheck`, `npm run lint`, `npm run build`, and `npm test` all run and pass, with at least one real test that executes.
- Importing `src/lib/env.ts` from a Client Component fails the build.
- No `.env` file is committed.

**Depends on:** I-0

---

## I-2 Domain core (pure logic)

**Goal:** Implement the business rules as pure, fully tested functions.

**Work**
- `modules/orders/domain/status.ts`: statuses and events.
- `modules/orders/domain/transitions.ts`: `transition(status, event, context)` returning a new status or a typed rejection.
- `modules/call-attempts/domain/auto-cancel.ts`: threshold of 3 total unanswered attempts.
- `modules/repeat-customers/domain/phone.ts`: phone normalisation.
- `modules/repeat-customers/domain/risk.ts`: repeat-customer rule.
- `modules/analytics/domain/rates.ts`: rate arithmetic with empty-denominator handling.
- A shared JSON fixture of transitions for reuse in I-4.

**Acceptance**
- Every legal transition in the state machine has a test.
- Every illegal transition (including any event on Confirmed or Cancelled) is rejected with a test.
- The third unanswered attempt cancels; the second does not (boundary tests).
- Phone normalisation tests use the Moroccan vectors in architecture.md §8.5, including `00212`, the `0` trunk prefix, and rejection of non-Moroccan numbers.
- Rate calculation returns a defined result when the denominator is zero.
- The repeat-customer rule passes every positive and negative case in architecture.md §8.7.
- All domain files import nothing from `next`, `@supabase/*`, or `zod` runtime I/O.

**Depends on:** I-1 · **Open questions:** 2, 3, 6 (architecture.md §14). Defaults are recorded there.

---

## I-3 Database schema and RLS

**Goal:** Create the schema, row-level security, and append-only guards. No business logic yet.

**Work**
- `supabase/migrations/`: enums (`user_role`, `pipeline_status`, `call_outcome`), tables (`profiles`, `customers`, `orders`, `order_items`, `call_attempts`, `order_events`, `import_batches`) with the columns in architecture.md §8.3, indexes, check constraints, and unique keys. The key constraints are `source_order_id` unique, `total = subtotal + shipping_fee`, and `(source_status = 'new') = (pipeline_status IS NOT NULL)`.
- RLS enabled on every table; policies for admin and agent per architecture.md §7.4.
- Revoke direct `UPDATE` on `orders` from `authenticated`.
- Triggers rejecting `UPDATE` and `DELETE` on `call_attempts` and `order_events`.
- `profiles` auto-creation is **not** done with a trigger on `auth.users` for now; admins and the seed script create profiles explicitly.
- SQL integration tests: agent isolation, admin visibility, direct update denied, append-only enforced for the service role.

**Acceptance**
- Migrations apply cleanly to a fresh local Supabase instance.
- All SQL integration tests pass when executed (results reported only after they run).
- No table in the exposed schema lacks RLS.
- The CHECK constraint rejects a historical order that has a pipeline status, and an active order that does not.

**Depends on:** I-2. The source schema is verified (architecture.md §8.1), so there is no blocker.

---

## I-4 Transactional RPCs and authentication

**Goal:** Make every state change go through a single transaction, and resolve the signed-in user and role on the server.

**Work**
- SQL state function mirroring the domain transition table (authoritative source).
- RPCs: `log_call_attempt`, `confirm_order`, `cancel_order`, `assign_order`. Each takes `expected_version` and (for call logging) `idempotency_key`. Each returns a typed result or a named error code.
- Repeat-customer function returning only counts (refused, cancelled, delivered) for a `phone_e164`, excluding the current order (architecture.md §8.7).
- Fixture parity test: the TypeScript domain and the SQL state function agree on every fixture case.
- `src/lib/supabase/server.ts` (request-scoped client) and `proxy.ts` for session refresh and optimistic redirects.
- `modules/auth/session.ts`: `getCurrentUser()`, uncached and request-time, wrapped in React `cache()` for per-request deduplication only. Returns `null` when anonymous.
- `modules/auth/guards.ts`: `requireRole()`, `requireAdmin()`.
- Login page and sign-out action.
- Demo accounts via `scripts/seed-demo-users.ts` (service role, run locally).

**Acceptance**
- An RPC replayed with the same idempotency key returns the original result and writes no new rows (tested).
- A stale `expected_version` returns `conflict` and writes nothing (tested).
- The third unanswered attempt auto-cancels in the same transaction (tested).
- Two concurrent call logs on one order both count (tested).
- An anonymous request to a protected route redirects to login.
- Changing a role or `user_metadata` in the browser has no effect on access (tested).
- Each Server Action in this phase rejects a caller without the required role.

**Depends on:** I-3

---

## I-5 Order import (verified dataset)

**Goal:** Load the 50 verified sample orders reliably and repeatably, and keep the six historical records out of the workflow.

**Work**
- Zod schema for one source row, as in architecture.md §8.1.
- Money and phone checks, as in §8.1 and §8.5.
- `scripts/import-orders.ts` runs the flow in architecture.md §5.3: file checksum, whole-file validation, mapping (`new` → `New`, all others → NULL), and one transactional RPC, `import_source_orders`, callable only by the service role.
- Idempotency by file SHA-256 (`4a51cb27…`), by `source_order_id`, and by `source_payload_sha256`, so a changed re-export aborts the import.

**Acceptance** (each count is verified by an integration test against the real file)
- 50 orders. 44 have pipeline `New`; 6 have NULL pipeline. Source statuses are 44 `new`, 2 `delivered`, 2 `refused` and 2 `cancelled`.
- 44 customers (distinct phones) and 80 order items. Subtotal and total arithmetic holds for all 50 orders.
- 44 `imported` events, one per new order. Zero `call_attempts` and zero `order_events` for the 6 historical orders.
- Re-running with the same file writes nothing and reports "already imported".
- A file with one invalid row is rejected entirely, with no rows written.
- Changing one field of an existing order in a copy of the file aborts the import with a payload-hash conflict.
- The six historical orders reject any call attempt or status change with `not_in_pipeline`.

**Depends on:** I-4. The source schema is verified, so the import has no blocker.

## I-6 Order workflows (admin and agent UI)

**Goal:** Let admins assign and let agents work the queue, using only server-enforced paths.

**Work**
- Admin: order list with filters, assignment and reassignment (Server Action calling `assign_order`).
- Agent: queue of assigned orders only (`queries.ts` reads through RLS).
- Order detail: status, call attempt form (outcome, note, idempotency key), confirm and cancel actions, and the audit history timeline.
- Repeat-customer warning shown on the order detail when prior cancelled or refused orders exist. Shows counts only.
- Every form uses Zod validation on the server and returns field-level errors.
- Each read sits behind `<Suspense>`.

**Acceptance**
- An agent cannot open another agent's order by URL; the page returns not-found, not the record.
- An agent cannot reassign an order, even by calling the action directly (tested in I-4, re-verified here).
- Logging a call updates the status, the attempt list, and the audit history on screen after the action returns.
- A conflicting edit shows a reload prompt, not a silent overwrite.
- The repeat-customer warning matches every case in architecture.md §8.7: warnings for BRX-1009, 1018, 1035 and 1037; no warning for delivered-only history (BRX-1020, 1024); no warning for name-only matches. The warning never shows other orders' details.

**Depends on:** I-5

---

## I-7 Analytics

**Goal:** Overall and per-agent confirmation rates with a date filter.

**Work**
- Admin-only analytics page with a date range (Africa/Casablanca day boundaries converted to UTC). The denominator counts pipeline orders only; the six historical orders are excluded.
- Overall rate and per-agent rates computed from `order_events` (attribution as defined in architecture.md §14, item 4).
- Arithmetic in `modules/analytics/domain/rates.ts`; SQL aggregation in a function or query, validated against the domain for a sample.
- Not cached in v1 (architecture.md §7.7).

**Acceptance**
- Rate arithmetic tests pass, including zero denominators.
- For a seeded dataset, the page's numbers match a hand-calculated expected result stored in a test fixture.
- The six historical orders do not affect any rate.
- An agent requesting the analytics page or its action is rejected.
- Changing the date range changes the result, and the range is validated (start before end, maximum span).

**Depends on:** I-6

---

## I-8 Hardening, documentation, and deployment

**Goal:** Prepare the project for review and deployment, with approval gates.

**Work**
- Review the app against the Next.js data-security checklist (`node_modules/next/dist/docs/01-app/02-guides/data-security.md`, Auditing section).
- Confirm no service-role key is referenced from `src/`, no `NEXT_PUBLIC_` secret, and no `.env` committed.
- README: setup, local Supabase steps, seed and import commands, demo account names and roles, manual demo checklist, architecture link.
- Vercel project configured with the development Supabase project for previews. **Production deployment waits for explicit approval.**

**Acceptance**
- Every item in the data-security Auditing checklist is answered in the README or the PR description.
- `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build` pass, with results reported as executed.
- A fresh clone can follow the README to a running app with the demo data.
- Demo accounts work on the deployed preview.

**Depends on:** I-7

---

## Optional: I-9 Smart Operations Queue

Out of scope for this step and not planned in detail. It is listed only so the `smart-ops` module location is reserved. It requires explicit approval before any work begins, and it must not be started while I-1 to I-8 are incomplete.

---

## Approval gates

| Gate | Requires |
|---|---|
| Start any phase | Previous phase acceptance criteria met |
| Any Git commit | Explicit approval from the project owner |
| Any push | Explicit approval |
| Any production deployment | Explicit approval |
| Any new dependency beyond I-1 | A short justification in the commit or PR description |
