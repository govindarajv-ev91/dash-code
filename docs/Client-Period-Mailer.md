# EV91 Client Period Trend email and auto send

## Activate city contacts and automatic sending

1. Run **sql/create_city_mail_settings.sql** in Supabase SQL Editor. It requires the existing `dashboard_users` auth table. It creates `city_mail_contacts` (city, name, Mail ID, phone, CC), `client_period_mail_schedules` (city contact, weekday or daily, IST time, enabled status), and `client_period_mail_runs` (daily send claims and status). It is safe to rerun. Contacts and schedules are private to dashboard administrators; only the backend can write delivery logs.
2. Run **sql/create_client_period_mail_payment_page.sql** in Supabase SQL Editor. This installs the city-scoped payment query and indexes used by scheduled reports. It changes no payment data and only the service role can execute the query. Then sign in as an administrator. Open **Source List > City List**, add the city, name, Mail ID, phone and CC addresses. Separate multiple email addresses with commas. One contact record per city is supported. The dashboard canonicalizes city aliases.
3. Replace the entire Apps Script `Code.gs` with **scripts/client-period-mailer-appscript.gs**. Save, then deploy a new version of the existing web app to retain its `/exec` URL.
4. In Apps Script **Project Settings > Script Properties**, add `SUPABASE_URL` (the project's `https://...supabase.co` URL) and `SUPABASE_SERVICE_ROLE_KEY`. Keep this credential in Apps Script only; never use a `VITE_` variable for it. The public manual test endpoint still sends only to the fixed test recipient.
5. Run **setupClientPeriodAutoSend** once in the Apps Script editor and authorize it. This verifies the contact table and installs a one-minute trigger; setup itself sends no mail. **runClientPeriodSchedules** builds fresh reports from Supabase without a browser being open. Authorization belongs to the sending Google account.
6. Open **EV91 Client Period Trend > Auto send** at the top left. Select a city, weekday (or Every day), hour, minute and AM/PM. Save with **Enabled** checked. Each occurrence sends one combined Weekly and Monthly report to that city's To/CC recipients. Edit to pause a schedule. Refresh schedules to see the latest run status.

All times use **Asia/Kolkata (IST)**. Google triggers can run late, so delivery starts after the chosen time, rather than at an exact second. Delayed executions catch up only within the same IST day. A newly created or edited schedule with today's send time already past starts at the next eligible occurrence. Reports use the IST date when the scheduler runs. Multiple schedules for a city send separate emails; choose one unless multiple deliveries are intended.

The latest partial period remains in numeric tables and totals but is omitted from every row and Total sparkline. On 6 November 2026, sparklines omit **Nov 2026** and **Week 45 (02 Nov-08 Nov)**. A report with no completed periods shows "No completed periods".

Automatic emails include the existing dashboard company logo by default, bundled at email size. To override that image for scheduled emails, set `CLIENT_PERIOD_LOGO_DATA_URL` in Script Properties to a PNG/JPEG data URL under 50 KB. Manual previews still include the dashboard logo automatically.

The scheduler records a unique claim for each schedule and IST date before preparation. It never automatically retries the same occurrence, including failures and uncertain attempts. `sent` means Google accepted the mail. If a run remains `preparing` or `sending`, or is `uncertain`, inspect Apps Script Executions and the inbox before manually resending. A process interruption cannot safely prove acceptance. Failed preparation sends no incomplete data. Reports exceeding the four-minute preparation budget fail visibly. Reports over the 180 KB inline budget use a complete HTML attachment instead. Automatic quota counts every To/CC address separately from the five manual test attempts.

To stop all automation, run **stopClientPeriodAutoSend**. This removes only this mailer's scheduler trigger; schedules and logs remain in Supabase.

### Fix scheduled database error 400

The scheduled onboarding query now loads complete rows like the working manual preview. Optional ID and phone columns are not present in every onboarding upload schema; source lookup already handles absent fields. No database migration is needed for this fix.

Replace the entire `Code.gs` with the updated `scripts/client-period-mailer-appscript.gs`, save and deploy a new version of the existing web app. To retry today's failed preparation, run **retryFailedClientPeriodSchedules** in the Apps Script editor while the existing schedule is enabled and due on its matching IST weekday. Keep the original schedule and time. Changing a schedule's time alone does not clear today's run claim.

This editor-only function retries today's due `failed` runs, which failed before mail submission. It preserves the existing history record and never retries `sent`, `sending`, `preparing` or `uncertain` runs. Normal triggers still do not automatically retry failed occurrences. Refresh schedules to see the result. New database error messages identify the failing resource, error code and missing column where available without exposing raw row values.

### Payment query cancelled (57014) and old results before the new send time

`57014` means PostgreSQL cancelled the query; statement timeout is a common cause. Weekly scheduled reads now match the dashboard's `(period_start, id)` ordering and cursor so they can use the date index. Timed-out read pages shrink from 500 down to 100 without skipping data. A failure at minimum page size still prevents sending partial totals. If needed, run `sql/fix_client_period_mail_payment_indexes.sql` to restore the date/id and month/id indexes and refresh planner statistics.

Replace the complete generated Apps Script, save, and deploy a new version. After the chosen time is due, run `retryFailedClientPeriodSchedules` to retry today's preparation failure. Last run is historical: changing the schedule to 3:20 PM does not erase a failure recorded at an earlier time and does not prove a new attempt ran early. A failed daily claim also remains after a time edit; it needs the explicit retry function.

### Large city report HTML

Cell spacing and borders are now defined at table level to reduce repeated markup. Reports under the 180 KB inline-body budget remain in the email. Larger reports arrive in the same single email as a complete `.html` attachment, with every table, row, total and embedded sparkline. The email body explains that you should download and open the attachment in a browser. No separate inline chart attachments are sent for this fallback, since the HTML file contains its own images. The dashboard records that the full report was attached. A standalone report exceeding 8 MB still fails before submission. No report data is truncated.

For an existing failed oversized attempt, replace the complete Apps Script with the regenerated file, save and deploy a new version, then run `retryFailedClientPeriodSchedules` once when that schedule is due. The ordinary trigger does not retry today's previously failed claim automatically.

### Data preparation exceeded the execution budget

Install **sql/create_client_period_mail_payment_page.sql**, then replace the entire Apps Script with the regenerated file, save and deploy a new version. The new payment query restricts reads to the selected city's normalized aliases, rather than loading all cities before filtering. City/date/id and city/month/id indexes support the two report windows. Accounting-month payments without a week date remain included in monthly reports. Only the backend service role may execute this query; browser users cannot call it.

Onboarding reads discover available columns from one row and then load only the fields needed for source matching. Each scheduler tick prepares at most one due occurrence, so another city's work cannot consume the next city's time budget. Subsequent cities are handled on later ticks. The explicit retry function also handles at most one failed occurrence per execution; repeat only as needed for additional failed cities. Retry today's failed preparation with `retryFailedClientPeriodSchedules` after the schedule is due. No partial data is emailed if preparation still exceeds the budget.

Reference: [Google installable time-driven triggers](https://developers.google.com/apps-script/guides/triggers/installable#time-driven_triggers).

City reports support manual test mail and automatic city emails. Each email contains Weekly and Monthly reports with four tables each. Manage recipients through **Source List > City List** and schedules through **EV91 Client Period Trend > Auto send**.

## 1. Create the mail service once

1. Open https://script.google.com and create a **new Apps Script project**.
   Keep it separate from existing rider mailers.
2. Open `scripts/client-period-mailer-appscript.gs` in this repository.
   Copy the **entire file**, replace everything in `Code.gs`, and save.
3. Select **setupClientPeriodMailer** beside Run, then click **Run**. Authorize
   sending email with the Google account that should send these reports.
   This setup does not send a message.
4. No mail access key is required. The recipient is fixed and the service allows
   at most five test mail attempts per day (IST).
5. Click **Deploy > New deployment > Web app**.
   Choose **Execute as: Me**, **Who has access: Anyone**, then deploy.
   Copy the URL ending in `/exec`.

The public endpoint constructs its own HTML and ignores incoming recipient/CC/HTML
fields. Anyone who has the endpoint URL can submit reports to the fixed test
recipient, within the five-per-day limit. No passwords or keys are required.

## 2. Connect the dashboard

Add the web app URL in your ignored `.env.local`:

```dotenv
VITE_CLIENT_PERIOD_MAILER_SCRIPT_URL=https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec
```

Restart `npm run dev` after adding it. For production, add the same URL as an
environment variable in Amplify and rebuild the connected branch. The script
URL is public; only the fixed test recipient can receive reports.

This repository change has not been pushed or deployed automatically.

## 3. Preview and send the first test

1. Open **EV91 Client Period Trend** in the dashboard.
2. Find **City report email — manual test** below the page filters. Click its arrow or heading to expand the controls; click again to hide them. The panel starts collapsed and keeps your selections and preview when hidden.
3. Choose **Mail city**, for example **Bengaluru**. A city is mandatory.
4. Both **Weekly and Monthly** are always included in the same email. The existing dashboard company logo is included automatically. Optionally choose a different logo using **Replace logo** (PNG/JPEG, max 50 KB). The logo is embedded in the email; it does not need a public image URL.
5. Click **Preview email**. This fetches current payment data, onboarding source
   mappings and the active source list. It does **not** send mail.
6. Check all eight tables in the preview (four Weekly and four Monthly), the logo, city and date windows.
7. Click **Send test email** once. No key entry is required.
8. Wait for **Mail service accepted…**, then check the recipient's inbox/spam.
   Acceptance means MailApp accepted the submission; final inbox delivery is
   checked separately. No recipients other than the fixed test address are used.

Changing the city or logo clears the preview and requires preparing it again.
The mail includes all clients in its chosen city and uses its own date windows;
the page's date, client, table-selection and source-search filters do not limit
the email. For now, only one city is sent at a time.

## What goes into the HTML email

| Table | Included rows |
| --- | --- |
| Client payout revenue | All payments for the selected city, grouped by client; gross payout in INR |
| Client rider count | Active listed sources in that city, grouped by client |
| Source rider count | Active listed sources in that city, grouped by resolved source name |
| Source payout revenue | Every eligible payment from active listed sources in that city; gross payout in INR |

This matches the **visible page tables**. Inactive sources, unlisted sources and
sources active only in another city are excluded from the source tables and
client rider counts. Onboarding source mappings take precedence over the
payment's stored source, as on the page. Client revenue still covers all sources.
City aliases such as Bangalore/BLR/Bengaluru resolve to Bengaluru.

Weekly has up to **10 calendar weeks**, Monday–Sunday, including the current
partial week; it does not skip weeks with no payments to find older weeks.
Coverage never goes earlier than 30 March 2026. Example on 5 November 2026:
**31 August through 5 November 2026**. Future weekly dates are excluded.

Monthly has **all accounting months from March 2026 through today**. As in the
page's Monthly mode, March includes the **full accounting month**, even though
the date filter begins March 30. The current month is partial. Rider counts
deduplicate within each week/month using the page's identity rules. Total rider
columns sum period counts; they are not distinct riders across the full window.

## Troubleshooting

- **Mail service not connected:** set `VITE_CLIENT_PERIOD_MAILER_SCRIPT_URL`,
  restart Vite or rebuild Amplify, and confirm the URL ends with `/exec`.
- **Status/deployment error:** confirm the web app allows Anyone, executes as
  the authorized sending account, and uses the latest deployed script version.
- **Daily quota exhausted:** wait for the mail quota to recover. Do not keep
  clicking Send. Automatic scheduled failures are recorded and are not retried on the same day.
- **No data/source-read error:** the preview refuses to send an empty city
  report or continue after a required fetch fails. Refresh the sources/data.
- **Large HTML:** reports over the 180 KB inline budget arrive as a complete HTML attachment. Download and open it in a browser. No tables are truncated.
- **Unconfirmed delivery:** check Apps Script > Executions and the inbox before
  preparing another request. The client polls submission status, rather than
  treating an opaque cross-origin POST response as proof of success.

Repeated submissions of the same preview use the same request ID. The service
keeps a short-lived status record (up to six hours) to suppress accidental repeat
sends. This is best-effort protection because Apps Script cache can expire.

## Updating the script later

Develop report calculations/HTML in `src/lib/clientPeriodMailer.js` and Apps
Script service behavior in `scripts/client-period-mailer-runtime.gs`, then run:

```sh
npm run prepare:client-period-mailer
npm run test:client-period-mailer
```

Copy the complete regenerated `.gs` file back into Apps Script. Update the web
app deployment to a new version; keeping the existing deployment preserves its
URL. Shared date and report logic lives in `src/lib/clientPeriodTrendReports.js`
and is also used by the dashboard page.

References: [Apps Script web apps](https://developers.google.com/apps-script/guides/web),
[MailApp HTML email](https://developers.google.com/apps-script/reference/mail/mail-app).

## Updated email layout and existing deployments

The email contains Weekly and Monthly section buttons. Both sections remain visible;
these are jump links, not JavaScript tabs (some email apps do not support jump links).
Each section contains all four tables. Table rows sort by descending total, while
period columns stay chronological. The email uses the project's dark navy cards,
indigo buttons, cyan headings and light text. Value colors use the same shared
calculation as the dashboard: compare periods within each row, low red, middle
yellow, high green. Equal values are yellow; total rows and total columns stay
neutral. Cell backgrounds are not heatmap fills.

**Trend is the first column**, before Client/Source. Small cyan line sparklines
show completed periods from oldest to newest on a separate scale per row, excluding the current partial week/month and including flat
lines for equal values. Charts are generated locally as compact PNGs and embedded
as inline email attachments, so no external image/chart service is needed.
After Google accepts a submission, the preview and Send button close and the
panel shows **Done**, while the status-check control remains available. Failed
or unconfirmed submissions keep their preview for checking.

The existing `public/fleetpro-logo.png` is included automatically at email size.
An optional replacement PNG/JPEG stays in browser memory until the page is reloaded. The email service
embeds it as an inline attachment. The existing dashboard sidebar logo is unchanged.

For an existing Apps Script deployment, replace the entire Code.gs with the regenerated
**scripts/client-period-mailer-appscript.gs**, save, then choose **Deploy > Manage
deployments > Edit (pencil) > Version: New version > Deploy**. Keep the existing
URL. Old mail key properties are no longer used. The new dashboard sends a combined report that requires
this updated deployment. No schedule is installed and no mail is sent by updating it.

## Visible submission status

The panel shows sending/waiting progress and explicit Google acceptance or an
error. **Check email status** reads the same request without sending again.
Acceptance is not proof of inbox delivery; check inbox and spam. If no result is
available, inspect Apps Script **Executions** before preparing another email.
Status is retained for up to six hours in the script cache and may expire sooner.
The five-per-day test limit counts mail attempts, including uncertain submissions,
and resets at midnight IST. A failed request is not automatically sent again.
If an old deployment still asks for an access key, replace Code.gs and deploy
a **New version** of the existing deployment; saving code alone is insufficient.
