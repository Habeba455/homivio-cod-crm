# Supabase database (Phase I-3)

Status: written and reviewed, **not applied** to any database. Nothing here has been executed against Postgres yet.

## Tables

| Table | Purpose | Writes |
|---|---|---|
| `profiles` | One row per `auth.users` id, with `role` (`admin` or `agent`) and `is_active`. | Operator only |
| `customers` | One row per normalised phone (`+212…`). Holds the display name from the first import. | Import RPC |
| `import_batches` | One row per source file, keyed by SHA-256. Prevents re-importing the same file. | Import RPC |
| `orders` | One row per source order. Keeps `source_status` (file value) apart from `pipeline_status` (CRM). Holds `version` for concurrency. | RPCs only |
| `order_items` | Line items from the source file. | Import RPC |
| `source_records` | Raw source object, including customer name and address. Admins only. | Import RPC |
| `call_attempts` | One row per answered or unanswered call. Unique `idempotency_key`. Append-only. | `log_call_attempt` |
| `order_notes` | Free-text agent notes. Append-only. | `add_order_note` |
| `order_events` | Audit trail of status and assignment changes. Append-only. | RPCs and import |

Historical orders (`delivered`, `refused`, `cancelled`) have `pipeline_status` NULL, no assignee, no attempts and no workflow events. A CHECK constraint enforces this.

## Security model

- RLS is enabled on every table. It is not forced, so the RPC owner can read what it protects.
- Clients have SELECT only, and only where a policy allows it. There is no client INSERT, UPDATE or DELETE.
- Admins see everything. Agents see only orders assigned to them, plus the customers and child rows of those orders.
- State changes go through `security definer` RPCs. Each RPC checks `auth.uid()` and role itself, and sets `search_path = ''`.
- Assignment is admin-only, so agents cannot assign orders to themselves.
- `call_attempts`, `order_notes`, `order_events`, `import_batches` and `source_records` reject UPDATE, DELETE and TRUNCATE in a trigger, for every role.
- Import (`import_source_orders`) can be called only with the service-role key, from an operator script. The key never reaches client code.
- The repeat-customer summary returns two counts. It never returns other orders or identifiers.

## Files, in apply order

1. `20261108100000_i3_01_enums_profiles_helpers.sql`
2. `20261108100100_i3_02_orders_schema.sql`
3. `20261108100200_i3_03_audit_tables.sql`
4. `20261108100300_i3_04_state_machine.sql`
5. `20261108100400_i3_05_rls_policies.sql`
6. `20261108100500_i3_06_state_rpcs.sql`
7. `20261108100600_i3_07_note_and_repeat_rpcs.sql`
8. `20261108100700_i3_08_import_rpc.sql`
9. `20261108100800_i3_09_grants.sql`
10. `20261108100900_i3_10_truncate_guards.sql` (adds TRUNCATE guards to profiles, customers, orders and order_items)

Test script: `tests/i3_database_checks.sql`. Run it only against a local database. It ends with ROLLBACK.

## Applying (after your review; not yet done)

Option A, Supabase CLI against a local stack first:
1. `supabase start`
2. `supabase db reset` applies everything in `supabase/migrations/` in order.
3. Run `supabase/tests/i3_database_checks.sql` with `psql` against the local database URL that `supabase status` prints.

Option B, SQL Editor on the remote project, after the local run passes: paste each migration file in the order above, one at a time, and check for errors before the next. Do not run the test script against the remote project.

Option A is required before any remote apply.
