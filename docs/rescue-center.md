# Smart COD Rescue Center

Deterministic, explainable prioritisation of active pipeline orders. It uses fixed business rules, not machine learning, prediction, or any external AI service.

## Scope

- Active orders only: pipeline status `New`, `No Answer`, or `Called`.
- Historical orders (null pipeline status) and finished orders (`Confirmed`, `Cancelled`) are never ranked.
- Agents see only orders assigned to them. Admins see the full queue at `/admin/rescue`.
- Scores are recomputed on every page load from current data. Nothing is cached or stored.

## Points

| Signal | Condition | Points |
| --- | --- | --- |
| Automatic cancellation risk | 2 unanswered calls (one more cancels the order) | +70 |
| One unanswered call | 1 unanswered call | +20 |
| Not contacted | Status `New`, no attempts | +30 |
| Waiting for first contact | Not contacted, at least 24 h since creation | +20 |
| Waiting a long time | Not contacted, at least 72 h since creation | +15 |
| Stale contact | Not `Called`, last attempt at least 24 h ago | +10 |
| Customer answered | Status `Called` | +25 |
| Customer history | Earlier refused or cancelled orders for the same customer (counts only) | +15 |

Notes with 0 points: history unavailable, outside calling hours, and data issues.

## Levels

- Urgent: score 70 or more
- High: 40 to 69
- Normal: 20 to 39
- Low: under 20

## Recommended action (first match wins)

1. 2 unanswered calls: last-chance call
2. `Called`: confirm or cancel
3. Never contacted: first call
4. 1 unanswered call: retry call
5. Last attempt at least 24 h ago: follow-up call
6. Otherwise: review order

## Ordering

Score (highest first), then unanswered count (highest first), then creation time (oldest first), then order reference. The order is deterministic.

## Time rules

- Scoring uses elapsed hours between instants, which does not depend on time zone. Future timestamps (clock skew) count as zero hours.
- Calling window: 09:00 to 20:00 in Africa/Casablanca. This is an operational assumption. Outside it, a 0-point note suggests calling later. It does not change the score.

## Data issues

Missing or inconsistent data is reported, never guessed. These cases mark the order for a data check (0-point note) and the summary counts them:
- unparseable creation date or attempt time
- invalid unanswered count, or count of 3 or more
- status `New` with unanswered calls
- unanswered calls with no recorded attempt

## Customer history and migration i7_01

Agents cannot read other orders for the same customer under RLS, so history comes from a batched, counts-only function `public.rescue_repeat_counts(uuid[])`. It returns counts only for orders the caller can already see, and it uses the same refused and cancelled classification as `repeat_customer_summary`.

- File: `supabase/migrations/20261109100000_i7_01_rescue_repeat_counts.sql`
- Status: written, **not applied to the remote database**.
- Until it is applied, the queue shows "Customer history is unavailable" and does not count history as zero. The order detail page shows the same unavailable message.
- Input is capped at 500 order ids (error HV007 above that). Duplicate and null ids are ignored.
- Applying it requires explicit approval. It adds one function and one grant to `authenticated`. It does not change existing tables, policies, or grants.

## Limits

- At most 500 active orders are loaded, oldest first. If more exist, the queue says so.
- Call attempts are read in chunks of 100 orders, with at most 1000 rows per chunk. If a chunk hits the cap, the queue says call history may be incomplete. Orders with missing call history are then flagged for a data check.

## Verification

- Pure rules and ordering: `src/modules/rescue/domain/priority.test.ts` and `queue.test.ts`.
- Run on a Mac: `npm test` and `npm run typecheck`.
- Browser check: sign in as an agent and confirm the queue shows only that agent's orders. Sign in as an admin and confirm `/admin/rescue` shows all orders.
