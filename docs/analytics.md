# Confirmation statistics (Phase I-7)

Admin-only page: `/admin/analytics`. The Analytics link appears in the header for admins only. Every query runs with the admin's session under RLS, and the page checks the admin area on the server. Agents are redirected away.

## Definitions

| Measure | Definition | Date used |
|---|---|---|
| Total orders | Every imported order, pipeline and historical | Current, all time |
| Active pipeline | Orders with `pipeline_status` New, Called or No Answer | Current, all time |
| New, Called, No answer | Orders currently in that pipeline status | Current, all time |
| Confirmed, Cancelled | Orders currently in that terminal status | Current, all time |
| Historical (excluded) | Orders with no pipeline status (delivered, refused or cancelled before import) | Current, all time |
| Confirmation rate | confirmed ÷ (confirmed + cancelled) | Terminal change recorded in the period |
| Agent rate | The same ratio, counting only terminal changes made by that agent | Terminal change recorded in the period |

### Denominator

The denominator is the number of pipeline orders whose terminal change happened in the period: confirmed plus cancelled. An auto-cancel after three unanswered calls counts as a cancellation. Historical orders never enter either count, because they never have a terminal change in the CRM. When the denominator is zero, the rate shows "—" and nothing is divided.

### Date field

The date is `order_events.created_at` for the event types `confirmed`, `cancelled` and `auto_cancelled`. These events are written in the same transaction as the status change. Each order can reach a terminal state only once, because `Confirmed` and `Cancelled` are terminal, so counting events counts orders.

### Attribution

The agent is the `actor_id` on that event: the user who made the terminal change. An auto-cancel is attributed to the agent who made the third unanswered call. Terminal changes made by an admin are counted in the overall rate and appear as "Recorded by admins". They are not assigned to any agent.

### Time zone and period

Dates are calendar days in Africa/Casablanca. A period starts at local midnight of its first day and ends at local midnight of the day after its last day, converted to UTC. The offset comes from the time-zone database for each date. A period may span at most 366 days. An invalid period shows an error and falls back to all time, so a typo never silently widens the report.

## Why counts are exact queries

The counts use PostgREST `count` queries, not row fetches. The default row limit would otherwise truncate large periods silently.

## Caching

Nothing is cached. The figures depend on the viewer and on data that changes with every call.

## Verification

- Pure arithmetic and period parsing: `src/modules/analytics/domain/*.test.ts`.
- End to end: compare the page with a hand count from the Orders page (see the checklist in the README).
