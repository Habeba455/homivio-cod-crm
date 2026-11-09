# Provisioning demo users (Phase I-4A)

This procedure creates one admin and two agents for testing. **Do not run it until you approve creating demo accounts.** Nothing in the repository creates users automatically.

## Rules

- Passwords are chosen by you, stored in your password manager, and never written to this repository, a chat, a log, or a script.
- The service-role key is not needed. Use the Supabase Dashboard and the SQL Editor.
- Roles are set only in `public.profiles` by an operator. Never store a role in `user_metadata`. The app ignores it, but it must not be used.
- Use demo emails you control, for example `admin.demo@your-domain.example`.

## Step 1: Create three auth users

Supabase Dashboard → **Authentication → Users → Add user → Create new user** (repeat three times):

| Purpose | Email | Auto Confirm User |
|---|---|---|
| Admin | your chosen admin demo address | enabled |
| Agent 1 | your chosen agent demo address | enabled |
| Agent 2 | your chosen agent demo address | enabled |

Auto Confirm skips email verification for demo accounts only. Do not use it for real staff.

## Step 2: Copy the three user IDs

In the Users list, copy each user's **UID** (a UUID). A UUID is an identifier, not a secret, but keep it out of shared documents.

## Step 3: Create the profiles (SQL Editor, run as the database owner)

Replace the three placeholders with the UUIDs from Step 2, then run the statement once:

```sql
insert into public.profiles (id, role, display_name) values
  ('<ADMIN_UUID>', 'admin', 'Demo Admin'),
  ('<AGENT_1_UUID>', 'agent', 'Demo Agent One'),
  ('<AGENT_2_UUID>', 'agent', 'Demo Agent Two');
```

If an ID is wrong, the insert fails on the foreign key to `auth.users`. Nothing is partially written.

## Step 4: Verify without printing secrets

```sql
select p.display_name, p.role, p.is_active, u.email
from public.profiles as p
join auth.users as u on u.id = p.id
order by p.role, p.display_name;
```

Expect three rows: one admin and two agents, all active.

## Deactivating an account (instant revocation)

```sql
update public.profiles set is_active = false where id = '<UUID>';
```

The app reads the profile on every request, so access ends on that user's next request. RLS also stops returning rows, because the role helper checks `is_active`.

## Resetting a demo password

Dashboard → Authentication → Users → the user → **Send password recovery** or **Reset password**. Set a new password in your password manager. Never paste it into the repository or a chat.

## Notes

- The current database migrations already include `profiles`. This procedure does not change the schema.
- Do not give anyone the service-role key for this step.
