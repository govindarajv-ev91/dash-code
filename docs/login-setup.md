# FleetPro login and administration setup

The app now includes email/password login, user creation/deletion, and an
admin-only setting to enable or disable dashboard login. Installation requires
the SQL tables below. User creation/deletion also requires the `dashboard-admin`
Supabase Edge Function; changing the sign-in setting uses an admin-checked SQL
function and works without deploying that Edge Function. The
browser's public Supabase key cannot create Auth users or deploy database tables.

## 1. Create the tables

Open the same Supabase project used by `VITE_SUPABASE_URL`. In **SQL Editor**,
run the complete contents of [create_dashboard_auth.sql](../sql/create_dashboard_auth.sql).
It creates:

| Table | Purpose |
| --- | --- |
| `public.dashboard_users` | Account ID, email, name, and `admin`/`user` role |
| `public.dashboard_settings` | One global `login_enabled` setting, initially `true` |

Passwords are managed by Supabase's existing `auth.users` system. There is no
public password column. A trigger creates a profile when an email account is
created; deleting its Auth account removes the profile. Existing email users are
backfilled as ordinary users. SQL is safe to rerun and preserves the login setting
and existing roles. An unavailable setting requires login rather than granting
public access.

In **Authentication**, enable the Email provider and disable **Allow new users to
sign up** for this internal dashboard. Admin creation through the server-side
Admin API works without public registration. New accounts created in the admin
page are ordinary users; user metadata cannot grant admin rights.

## 2. Add the requested administrator

In **Authentication > Users > Add user > Create new user**, enter:

- Email: `admin@ev91riderz.com`
- Password: `000000` (six zeroes, as requested)
- Enable **Auto Confirm User**.

Then run [set_dashboard_admin.sql](../sql/set_dashboard_admin.sql) in SQL Editor.
This assigns the admin role to that confirmed Auth account. If the email already
exists, use the existing account and set its password through Supabase's account
management instead of creating a duplicate. The project's password-strength
policy must permit the requested password; if it rejects it, use a permitted
password.

Alternatively, create the account and role with the owner-only bootstrap script
from the project folder:

```powershell
$dashboardServiceKey = Read-Host 'Supabase service_role key' -AsSecureString
$env:SUPABASE_SERVICE_ROLE_KEY = [System.Net.NetworkCredential]::new('', $dashboardServiceKey).Password
$env:DASHBOARD_ADMIN_PASSWORD = '000000'
npm.cmd run setup:admin
Remove-Item Env:SUPABASE_SERVICE_ROLE_KEY
Remove-Item Env:DASHBOARD_ADMIN_PASSWORD
```

The script uses the existing local `VITE_SUPABASE_URL`, checks the SQL setup,
and creates `admin@ev91riderz.com`. Rerunning promotes an existing account but
preserves its password. The service key is never needed in the React app; do
not name it with a `VITE_` prefix or commit it to source control.

## 3. Deploy the admin service

User creation/deletion requires this deployment even if the table SQL and login
toggle already work. SQL Editor does not install Edge Functions.
From the project folder, authenticate the Supabase CLI and deploy:

```powershell
npx.cmd --yes supabase login
npm.cmd run deploy:admin
npm.cmd run check:admin
```

The deploy script derives the project reference from `VITE_SUPABASE_URL` so the
service is deployed to the same project as the app. It uses API bundling, which
does not require Docker. For a custom Supabase hostname, set
`SUPABASE_PROJECT_REF` in the terminal. CLI deployment requires a Supabase
account with access to the project; signing into the dashboard app as an admin
is separate from signing into the Supabase CLI. Do not paste access tokens into
chat or put them in frontend environment variables.
The hosted function uses Supabase's built-in `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY` environment variables. It verifies each Bearer token
with Supabase Auth, then checks the caller's database role. The config disables
the older gateway JWT check so current signing keys work; the function performs
its own verification before all list/create/delete/settings operations.

The browser invokes this function directly, so it works with Vite, Firebase
Hosting, Amplify, and Vercel without needing a separate hosting API route.
No website or Edge Function is deployed by editing the repository files.

## 4. Use the admin page

If CLI login or installation is unavailable, deploy through the Supabase Dashboard:

1. Run `npm.cmd run prepare:admin` to generate
   [dashboard-admin-editor.ts](../supabase/dashboard-admin-editor.ts) from the tested source.
2. Open **Edge Functions > Deploy a new function > Via Editor** in your Supabase project.
3. Name the function exactly `dashboard-admin`. Replace the editor's default
   code with the entire generated file and choose **Deploy function**.
4. Set the function's **Verify JWT** option **OFF**, matching `supabase/config.toml`.
   The handler still validates the caller with Supabase Auth and requires its
   database admin role on every request; this allows current Auth signing keys.
5. Run `npm.cmd run check:admin` and refresh User management in the app. The check
   verifies browser preflight, CORS headers on error responses, and rejection of
   unsigned requests; it never creates or deletes an account.

For this app's configured project, open
[Edge Functions in arnxvnkednpzyzyfculx](https://supabase.com/dashboard/project/arnxvnkednpzyzyfculx/functions).
The deployed endpoint must be
`https://arnxvnkednpzyzyfculx.supabase.co/functions/v1/dashboard-admin`.
The editor filename is `dashboard-admin-editor.ts`, but the deployed function
name must be **dashboard-admin**. Saving the file locally or deploying to a
different project does not install the service at this endpoint.

Reference: [Supabase's dashboard deployment guide](https://supabase.com/docs/guides/functions/quickstart-dashboard).

### Open administration

Run `npm.cmd run dev`, then open `http://localhost:5173/#admin`. On your hosted
site, append `/#admin` to its URL. Sign in as the administrator.

- **Create user:** enter a name, email, and initial password. The server creates
  a confirmed Auth account and the database trigger creates its profile.
- **Delete user:** choose Delete and confirm. This permanently removes the Auth
  account and profile. You cannot delete yourself or administrator accounts.
- **Disable login:** confirm public access. Visitors open the dashboard directly.
- **Enable login:** visitors must sign in again.
- **IoT Data Upload:** signed-in administrators open the upload page directly.
  Ordinary users and public visitors still see the existing upload password prompt.

The admin page always requires an administrator login, including while dashboard
login is disabled. The public dashboard sidebar provides **Admin sign in**, and
signed-in admins have **Administration** and **Sign-in settings** links. The
admin page opens on the **Sign-in settings** tab; **User management** contains
account creation and deletion. Existing browser tabs check
the setting and their account every 15 seconds and when the window regains focus.

If you already installed the original tables, run
[create_dashboard_login_toggle.sql](../sql/create_dashboard_login_toggle.sql)
once in SQL Editor to install the new admin-only save function. Reload the app,
open `/#admin`, and use **Disable login** / **Enable login** in the
**Sign-in settings** tab. New installations include this function in the main
table SQL already.

## Database access and existing integrations

This setting controls access to the dashboard UI. Existing fleet database
policies, published Google Sheets, and HTTP API endpoints retain their existing
access rules. The SQL here protects the new account/setting tables: anonymous
callers can read only the login boolean through an RPC, authenticated users can
read only their own profile, and account administration writes go through the
verified server function. The sign-in setting is saved by the
`set_dashboard_login_enabled` RPC, which checks the caller's stored admin role
on every write. Neither path grants direct table writes to client users.

Several existing fleet SQL scripts allow only the `anon` role. Signed-in
Supabase requests use `authenticated`; those existing policies may need equivalent
approved-user permissions before dashboard data and uploads work after login.
Inspect the live policies rather than assuming repository scripts are installed:

```sql
select schemaname, tablename, policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
order by tablename, policyname;
```

Keep existing row filters and operation restrictions. IoT writes use their existing
upload RPC. Do not replace that restriction with unrestricted table writes.
Disabling login intentionally exposes the dashboard and its available tools;
database rules still apply. Securing direct APIs or changing fleet RLS is a
separate migration and must account for server integrations using anonymous keys.
The new user role distinguishes administrators from ordinary users; it does not
add per-city or per-rider permissions. Browser data caches remain shared across
accounts on the same browser. Deletion prevents future Auth logins, and the UI
detects a missing account profile; previously issued JWTs may remain valid until
expiry for other existing APIs whose rules do not check that profile.

## Verification and troubleshooting

Run `npm.cmd run test:auth`, `npm.cmd run build`, and
`npm.cmd run test:full-data:bundle`. Tests use mock Auth and database responses;
they do not create accounts or change the live project.

- **Login settings unavailable:** run the table SQL in the project used by the app.
- **Account unavailable:** check that `dashboard_users` contains the Auth user ID.
- **Administrator access required:** run the admin-role SQL for the confirmed admin.
- **User management not installed:** run `npx.cmd --yes supabase login`, then
  `npm.cmd run deploy:admin` and `npm.cmd run check:admin`. Reload User management.
- **Admin session rejected:** sign out/in; if it continues, redeploy the function
  using the project config and check its Auth settings.
- **Cannot reach user management:** run `npm.cmd run check:admin`. A missing
  function returns HTTP 404 for the browser's OPTIONS preflight; browsers report
  this as a connection failure. Deploy **dashboard-admin** in the project shown
  by the check. If the check instead reports CORS or preflight permissions, paste
  the entire regenerated editor file and redeploy, including the OPTIONS handler
  and headers on all responses. To check a specific hosted website origin, set
  `$env:DASHBOARD_BROWSER_ORIGIN = 'https://your-dashboard.example'` before the check.
- **Password rejected:** check the project password policy.

References: [Supabase Auth account creation](https://supabase.com/docs/reference/javascript/auth-admin-createuser),
[Edge Function authentication](https://supabase.com/docs/guides/functions/auth), and
[Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security).
