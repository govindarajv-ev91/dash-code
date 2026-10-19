# Source list

Run [sql/create_source_master.sql](../sql/create_source_master.sql) in the Supabase SQL Editor as the project owner before using the updated pages. It creates `public.source_master` and seeds the 41 supplied city/source pairs. Rerunning it preserves later edits, deleted rows and inactive sources.

Open **EV91 DB Data → Source List** in the sidebar to view all active and inactive sources. Sign in with a dashboard administrator account to add, edit, activate, deactivate or remove entries. Search and city/status filters help find entries. Removal asks for confirmation and preserves historical data and exports.

Each row has **Active** and **Inactive** buttons in the Status column. The highlighted button shows the current status; administrators can click the other button to change it. For viewers, both buttons stay visible but disabled. The **All / Active / Inactive** filter buttons above the table only change which entries you see.

If you ran the earlier version of the SQL, rerun `sql/create_source_master.sql` to enable administrator writes. It preserves your existing source list. Dashboard authentication must be set up first (`sql/create_dashboard_auth.sql`); the script keeps the table read-only if authentication is not yet installed.

If clicking **Active / Inactive** produces a permissions or “No source was changed” error, run [sql/fix_source_master_status_permissions.sql](../sql/fix_source_master_status_permissions.sql) in Supabase SQL Editor as the project owner. Then refresh Source List and retry while signed in as an administrator. The repair restores status-update grants and checks the administrator role independently of profile-table read policies. It preserves all data and does not promote any account. An account whose `dashboard_users.role` is `user` still cannot make changes; an expired session requires signing in again.

You can also manage this table in Supabase **Table Editor → source_master**:

| Action | Change |
| --- | --- |
| Add a source | Insert `city` and `source_name`; leave `is_active` true. |
| Hide a source | Set `is_active` to false. |
| Restore a source | Set `is_active` to true. |
| Remove a source | Delete its source_master row. Historical reports remain stored. |

For example, in SQL Editor:

```sql
insert into public.source_master (city, source_name)
values ('Bangalore', 'New source_FR_BLR');

update public.source_master
set is_active = false
where id = 1; -- Use the ID of the source you want to hide.
```

Use **Refresh** on Source Wise Data or **Refresh sources** on EV91 Client Period Trend after changing the table. Returning focus to the browser also reloads it.

Only active city/source pairs appear on these two pages. Source Wise Data filters both tabs, its source dropdown and summary cards. EV91 Client Period Trend filters all four tables and their totals in weekly and monthly modes. A listed source without report data does not create an empty row. Matching ignores source casing and whitespace and accepts existing city aliases such as Bangalore/Bengaluru and Mysore/Mysuru; punctuation and spelling must match.

Excel exports contain every source, including inactive, deleted, unknown and unlisted sources, within the selected date, city and client filters. Source searches and the Source Wise Data source dropdown affect the page only. Export summaries and raw details both retain hidden sources.

If the source table cannot load, the pages show a setup/refresh message and no source-filtered report data; exports remain available. An empty table intentionally hides all sources on these pages. Other dashboard pages, uploads and historical records are unaffected. Database policies enforce administrator-only source changes; anonymous visitors and regular users have read access.
