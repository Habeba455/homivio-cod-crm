@AGENTS.md

# Homivio COD CRM: engineering guidelines for Claude Code

The Next.js 16 rules in `AGENTS.md` (imported above) remain authoritative for framework conventions. The rules below apply to this project. Architecture reference: `docs/architecture.md`. Phase plan: `docs/implementation-plan.md`.

## Next.js 16

- Read the relevant guide under `node_modules/next/dist/docs/` before writing code. Do not rely on memory of Next.js APIs.
- Keep `cacheComponents` and `partialPrefetching` enabled. Change either only with a documented reason and the owner's approval.

## Process

- Work incrementally, one phase from `docs/implementation-plan.md` at a time.
- Do not create Git commits without explicit approval.
- Do not push without explicit approval.
- Do not deploy without explicit approval.
- Do not claim tests or checks passed unless they were executed in the current session.

## Security

- Never trust client-provided roles, user IDs, or ownership. Resolve the session and role on the server in every Server Action, Route Handler, and Server Component query.
- Authorization is enforced on the server and in Postgres Row Level Security. UI checks are cosmetic.
- Never expose secrets. `SUPABASE_SERVICE_ROLE_KEY` and other server secrets must never use the `NEXT_PUBLIC_` prefix, never be imported from `src/`, and never be read in a request path. Do not commit `.env*` files.
- Mark data-access and privileged modules with `import 'server-only'`.
- Authorization is uncached and request-time. Session, role, and ownership are read on every request behind `<Suspense>`; React `cache()` may deduplicate within one request only. Never use `use cache` or `use cache: private` for session, role, or ownership data. Keep other user-specific data out of shared caches.

## Code quality

- Use strict TypeScript. Do not use `any` without a comment explaining why.
- Validate all external input with Zod at its entry point: forms, Server Actions, Route Handlers, and the JSON import.
- Preserve data integrity. State changes go through the transactional RPCs. Call attempts and order events are append-only.
- Write tests for critical business rules: state transitions, the three-unanswered-attempt auto-cancel, idempotency, role scoping, and rate calculations.
- Keep code and comments in English.
- Avoid unnecessary dependencies. Justify each new package in the commit or PR description.
- Do not create empty folders or placeholder implementations.
