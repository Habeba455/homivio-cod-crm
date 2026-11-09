# Distribution Center (bulk order assignment)

Admins assign many unassigned orders to active agents in one reviewed batch. There are three modes, all using the same review, confirm and write path.

## Modes

- **Manual**: the admin chooses the agent for each order, can select many rows and assign them to one agent, or leave rows unassigned.
- **Random**: each selected order gets a genuinely random active agent from the chosen set (`crypto.randomInt`). It is not round-robin and does not try to balance workload. Regenerate for a new draw; reviewed draws are reproducible in tests through an injected index.
- **Smart Balanced**: orders are taken oldest first and each goes to the agent with the lowest projected workload. Ties break by current workload, then display name, then agent id, so the same input always gives the same plan.

## Flow

1. **Select** orders (filters, select all matching across pages) and agents (active only).
2. **Review** (`reviewAssignmentAction`): the server classifies every order and builds the preview. Random and Balanced generate a plan on demand. Manual uses the admin's choices. Ineligible orders appear as skipped rows with a reason.
3. **Edit** (optional, Manual or after generating): change the agent per row or in bulk. The browser sends only the editor's choices; the server recomputes eligibility.
4. **Confirm** (`distributeOrdersAction`): the reviewed `plan` is submitted unchanged, with the `batchKey` and `mode`. The database writes exactly that mapping. It never regenerates a random or balanced plan.

A review goes stale if the mode, selection or agents change; edits after review are detected by comparing against the review basis. In either case the admin must review again.

## Rules

- Eligible orders are `New` with no assignee. Historical orders (null pipeline status), terminal orders (Confirmed, Cancelled), and orders already assigned are skipped, never overwritten.
- Inactive agents are rejected at review and again inside the database.
- Each assignment goes through the same `assign_order` version and state checks: the order version is checked, its row is locked, and an `assigned` event is written.
- Controlled reassignment is **not implemented**. Orders with an agent are reported as `already_assigned`.
- Limits: 2,000 orders and 100 agents per batch. The preview loads the first 2,000 eligible orders and says so when truncated.

## Security

- `distribute_orders` is `security definer` with `search_path = ''`. It checks `is_admin()` first (HV002).
- `anon` and `public` have no execute; `authenticated` has execute and the function rejects non-admins.
- `assignment_batches` is append-only (UPDATE, DELETE and TRUNCATE are blocked by HV010 triggers). Only admins can read it.
- The service role key is never used by the browser code.

## Concurrency and retries

- Rows are locked in `order_id` order, which avoids deadlocks. Each row's version is checked at write time.
- A per-review `batchKey` is reused on retries and double submits. A transaction-scoped advisory lock serialises them.
- A repeat with the same key and same plan returns the stored result (`replayed: true`) and writes nothing.
- Reusing a key with a different plan or mode is rejected (HV007).

## Audit and traceability

- `assignment_batches.actor_id` is the approving admin. Each row records mode, counts and per-order outcomes.
- Each written assignment creates an `order_events` row of type `assigned` with the actor, version, agent, batch id and mode in its payload.

## Result

The result shows assigned, skipped and failed counts, reasons for skipped orders, and whether the batch was a replay.

## Migrations

- `supabase/migrations/20261109110000_i8_01_bulk_distribution.sql` is **local only and not applied**. It needs explicit approval before it is applied to the remote database.
- `20261109100000_i7_01_rescue_repeat_counts.sql` (Rescue Center history) is also local only and not applied.
- Caution: `supabase db push` applies every pending migration together. Approve each migration deliberately.

## Tests

- Unit tests (Vitest): `src/modules/distribution/domain/*.test.ts` and `schemas.test.ts` cover balancing, unequal loads, random, reproducibility, manual handling, inactive agents, empty input, tie-breaking, duplicates, basis changes, and a 2,000-order run.
- SQL checks: `supabase/tests/i8_distribution_checks.sql` covers authorization, grants, batch counts, pre-assigned orders, version bumps, audit events, replay, key reuse, malformed input, limits, append-only batches, agent read denial, and the assignment mode.

## Mac testing

Run these on the Mac from the project root. Vitest and `next build` could not run on the development device.

```bash
npm install
npm run test            # Vitest: distribution, review, schemas, rescue
npm run typecheck
npx eslint src scripts next.config.ts
npm run build
```

Database checks, against a **local** Supabase only:

```bash
supabase start
supabase db reset       # applies local migrations to the local database only
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -v ON_ERROR_STOP=1 -f supabase/tests/i8_distribution_checks.sql
```

Do not run these against the remote project.

### Manual
1. Sign in as admin, open `/admin/distribution`, select 3 to 5 orders.
2. Choose **Manual**. In the preview, set different agents per row, then use bulk assign on a few selected rows.
3. Click **Review assignments**. Confirm the status column reads "Changed" for edited rows.
4. Tick the review checkbox and click **Distribute**. Expect the counts to match the preview.
5. Click Distribute again with the same page: you should see the replay notice and no duplicates.

### Random
1. Select 10 or more orders and two or more agents. Choose **Random**.
2. Click **Generate random mapping**. Click it again: the mapping changes, and the workload bars show it is not balanced.
3. Edit one row, click **Check my edits**. Confirm the stale or edited notices behave.
4. Confirm. Check that the written agents match the reviewed preview exactly.

### Smart Balanced
1. Select 10 or more orders and agents with different current loads. Choose **Smart Balanced**.
2. Generate the plan. Workload bars should show current, new, and projected load, with projected loads close to equal.
3. Confirm, then check that the agent with the highest starting load received the fewest new orders.

### Demo (local)
Use a local or staging project seeded with several agents and about 20 new orders. Run Manual, then Random, then Smart Balanced on separate groups of orders. Finish with the Rescue Center and Analytics to confirm they still load.
