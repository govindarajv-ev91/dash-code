# Source list

Run [sql/create_source_master.sql](../sql/create_source_master.sql) in the Supabase SQL Editor as the project owner before using the updated pages. It creates `public.source_master` and seeds the 41 supplied city/source pairs. Rerunning it preserves later edits, deleted rows and inactive sources.

Open **Supply → Source List** in the sidebar to view all active and inactive sources. Sign in with a dashboard administrator account to add, edit, activate, deactivate or remove entries. Search and city/status filters help find entries. Removal asks for confirmation and preserves historical data and exports.

Each row has **Active** and **Inactive** buttons in the Status column. The highlighted button shows the current status; administrators can click the other button to change it. For viewers, both buttons stay visible but disabled. The **All / Active / Inactive** filter buttons above the table only change which entries you see.

If you ran the earlier version of the SQL, rerun `sql/create_source_master.sql` to enable administrator writes. It preserves your existing source list. Dashboard authentication must be set up first (`sql/create_dashboard_auth.sql`); the script keeps the table read-only if authentication is not yet installed.

If **Add source**, **Edit**, **Remove**, or **Active / Inactive** reports missing database permissions, run [sql/fix_source_master_permissions.sql](../sql/fix_source_master_permissions.sql) in Supabase **SQL Editor** as the project owner. Then refresh Source List and retry as a signed-in administrator. This repairs table write grants, the ID-sequence grant, and administrator policies without changing source rows or historical data. It is safe to rerun and does not promote users.

The error means the database role used by your signed-in session lacks the required table or sequence grant. This can happen when the source table was installed with the older read-only setup, or before `dashboard_users` existed. The status-only repair below grants only `UPDATE (is_active)`; it does **not** restore the `INSERT` permission needed for **Add source**, or full edit/delete permissions. Changing the frontend or redeploying alone cannot apply these database grants. If the full repair reports that `dashboard_users` is missing, run `sql/create_dashboard_auth.sql` first and rerun the repair; if `source_master` is missing, run `sql/create_source_master.sql` after the authentication setup.

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

Only active city/source pairs appear in Source Wise Data and the rider/source tables in EV91 Client Period Trend. Source Wise Data filters both tabs, its source dropdown and summary cards. EV91 Client Period Trend's first gross payout revenue table includes every payment within the selected dates, city and client, regardless of source status. Its client rider count and both source tables continue to use active listed sources in weekly and monthly modes. Monthly payments follow their uploaded accounting month, including payments whose week starts in the previous month. A listed source without report data does not create an empty row. Matching ignores source casing and whitespace and accepts existing city aliases such as Bangalore/Bengaluru and Mysore/Mysuru; punctuation and spelling must match.

Excel exports contain every source, including inactive, deleted, unknown and unlisted sources, within the selected date, city and client filters. Source searches and the Source Wise Data source dropdown affect the page only. Export summaries and raw details both retain hidden sources.

**Download Excel** on Source Wise Data always creates one workbook containing both **Source by Client** and **Source Total**, regardless of the open tab. Both sheets follow the selected dates, city, client and latest-data switch. The workbook also retains **Raw Orders**, **Active Summary**, and, when the switch is enabled, **Client Active Windows**. Active Summary follows Source Total, counting a rider once per source/city across clients.

The entire **Active Rider Count (last 4 days)** column has a yellow fill in both report sheets, including its header, data cells and unused rows. Other columns and supporting sheets keep their existing fills.

Source Wise Data assigns one reporting **City** per rider/client using the latest date with positive completed orders within **From / To**. This same city is used in the page, both summary sheets, Raw Orders, city filters and source-status lookup. A rider with an older Chennai order followed by Mumbai orders is reported under Mumbai throughout that selected range, rather than counted in both cities. Zero-order rows and dates after **To** cannot move the rider. For conflicting cities on the latest working date, the city with more orders on that date wins; equal totals use city-name order. City aliases are combined before choosing. Without a valid working city, each row retains its uploaded city.

**Raw Orders** includes **Uploaded City** to retain each order's original city alongside the reporting City. Uploaded records are not modified. Earnings and MF rates continue to use Uploaded City, so regrouping a rider does not change their order totals or commercial amounts. For historical ranges, later working dates outside the range do not change the reported city.

Source Wise Data Excel exports include **Source Status** immediately after **City** in the **Source by Client** / **Source Total** and **Raw Orders** sheets. A city/source pair matching an active Source List entry is **Active**; inactive, deleted, unknown or unmatched pairs are **In Active**. Matching uses the same city aliases and source casing/whitespace rules as the page, so Bangalore and Bengaluru match. The status belongs to the source in that city, independently of rider activity counts. The **Active Summary** sheet contains rider activity totals and has no source-level status. Source Wise Data exports wait for the source list to load successfully so a failed lookup cannot incorrectly label every source inactive.

Source Wise Data has a **Use latest available data per client** switch, enabled by default whenever the page opens. When enabled, active and 0-order rider counts use the four calendar days before each client's latest uploaded order date, capped at the selected **To** date or yesterday, whichever is earlier. For example, if other clients are uploaded through the 28th and Amazon only through the 23rd, Amazon uses the 19th–22nd. Zero-delivery uploads also establish the client's latest date. Disabling the switch restores the common four-day window before **To** (also capped at yesterday).

The switch applies to **By Client**, **Source Total**, summary cards and Excel exports. **Active window end** and **Active window dates** show the dates used; Source Total combines client windows and counts a rider once per source/city, even when they worked for multiple clients. Enabled exports also include a **Client Active Windows** sheet and an explanation in **Active Summary**. Order totals, earnings, unique-rider populations and raw orders continue to follow the selected **From / To** range. Four days before **From** are loaded for activity calculations, including across month boundaries, without adding those orders to the selected-range totals. A source/client without report data in the selected range still does not create an empty row.

The **Client** filter remains visible in both **By Client** and **Source Total**, and its selection is retained when switching views. Source Total rolls up only the selected client's data, or all clients when **All** is selected. The selection also applies to summary cards and every Excel sheet, including raw orders and client activity windows.

Returning focus refreshes sources in the background while retaining the last successful list, so reports stay visible until the refresh completes. If the source table cannot load, the pages show a setup/refresh message and no source-filtered report data; client gross payout revenue and EV91 Client Period Trend exports remain available. Source Wise Data exports require a successful source-list refresh to determine source status. An empty table intentionally hides all source-filtered data. Other dashboard pages, uploads and historical records are unaffected. Database policies enforce administrator-only source changes; anonymous visitors and regular users have read access.
