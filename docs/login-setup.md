# FleetPro email and password login

<!-- The entry point now restores the Supabase session before loading the dashboard. -->
Signed-out users see the login form; successful login opens FleetPro. Sign out is
available under the account email in the sidebar and applies to this browser.
The existing Supabase client persists and refreshes sessions. There is no public
registration form, shared password, or administrator key in the login code.

## Enable accounts

1. In the Supabase project used by `VITE_SUPABASE_URL`, enable the Email provider.
2. For this internal dashboard, disable **Allow new users to sign up** in Auth
   settings. Otherwise people can register through the Auth API even without a
   registration form in this app.
3. Create each staff account with an email and password under Authentication >
   Users. Confirm the email when creating the account, or have the user complete
   email confirmation. Administrators currently handle password resets.
4. Keep `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` configured in the local
   and hosting build environments. Use only the browser-safe anon/publishable key.
5. Run `npm run dev` and sign in with a real staff account. Verify page refresh,
   reads, uploads, and sign out before deploying.

Reference: [Supabase password authentication](https://supabase.com/docs/guides/auth/passwords).

## Database access must be configured separately

This change gates the dashboard UI. It does **not** secure direct database or
HTTP API access. Several existing SQL scripts grant access specifically to
`anon`, and some functions/API routes also accept anonymous callers. When a
user signs in, Supabase database requests use the `authenticated` role, so
policies that only mention `anon` do not apply to them.

### Fix empty data after enabling sign-in

If General Overview shows zero orders/riders and empty database charts after
sign-in, run `sql/fix_dashboard_signed_in_reads.sql` in the Supabase SQL Editor
for the app's project, after `sql/create_dashboard_auth.sql`, then refresh the
dashboard. Enabling sign-in changes database requests from `anon` to
`authenticated`; an `anon`-only SELECT policy returns no rows to signed-in users.

The fix copies existing anonymous SELECT policies for the dashboard data tables
to registered dashboard accounts, preserving their row filters and restrictive
policies. It grants SELECT only, retains existing anonymous access and login
settings, and leaves upload/delete permissions to their existing policies. It is
safe to rerun, including after adding tables or changing their source policies.
Tables that already have policies for `public` or `authenticated` keep those
policies. Tables without existing anonymous table-level SELECT access are skipped.

Inspect the live project before deploying; repository scripts do not establish
which policies are currently installed. This read-only SQL lists relevant RLS
policies:

```sql
select schemaname, tablename, policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
order by tablename, policyname;
```

Provide the intended table privileges and RLS policies to approved
`authenticated` users. Keep existing row filters and operation restrictions;
do not add unrestricted write policies just to make login work. The IoT table
in particular uses its existing upload RPC rather than direct client writes.
Before revoking anonymous permissions, update server-side integrations that
currently use the anon key and require verified user tokens on protected HTTP
routes. Published Google Sheets remain accessible through their published URLs.
Do not consider this UI login a complete data-security migration.

All approved accounts currently see the same dashboard; admin/viewer roles and
per-user data permissions are not part of this change. Existing browser data
caches are shared across approved accounts on the same browser. Sign out
unmounts the dashboard, but does not erase previously downloaded data.

## Verification

`npm run test:auth` exercises the session gate, sign-in, session restoration,
remote sign-out, stale response races, failures, and password visibility using
mock Auth responses. It does not create users or change the live project.
