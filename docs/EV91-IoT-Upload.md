# IoT Data Upload under EV91

Open **EV91 DB Data → IoT Data Upload**. Select the provider, download its
template or choose its existing Excel/CSV export, review the preview, then
click **Save IoT data**. The first worksheet is read; report headers after a
preamble are detected. Templates include the supplied provider column layouts.

Uploads write to the existing `public.iot_data` table. Both this page and the
existing **IoT Data** page read that history. New uploads preserve older dates. Use the From/To
date fields and Source filter to review historical data; the original rider,
client, city, KM totals, order counts, and Excel export remain available.

| Provider | Vehicle column | Date column | Daily distance column | Existing source value |
| --- | --- | --- | --- | --- |
| Opspod-ev91 | Object | Date | Total Distance | opspod_ev91 |
| Alt Mobility | reg_no | Total Distance Date | total_distance | alt_mobility |
| Recent_Details (Stridegreen) | Vehicle No | Date | Distance (km) | vehicle_day_report |
| vehicle_day_report (Motvolt) | Reg No | Report Date | Distance | Recent_Details |

The Stridegreen and Motvolt source values deliberately follow the existing
project's mapping to keep historical rows compatible.

Opspod also accepts the original **Daywise Distance** export without editing.
Keep the report title, `Month : MM-YYYY` or
`Duration: from DD-MM-YYYY ... to DD-MM-YYYY` line, and numbered day columns.
The parser finds `Object` regardless of optional `ID Name`, `Branch`, or
`Company` columns. For these reports it automatically fills **missing completed
vehicle/day records** through yesterday, calculated in `Asia/Kolkata`. For example,
if records through 8 October are saved and uploads resume on 11 October, the
report's columns `9` and `10` supply the two missing dates without a date selector.
All completed dates in the report are checked against fresh Opspod history after
vehicle lookup; existing records are skipped per canonical vehicle and date.
This also fills older gaps and partial uploads across the four separate files.
Today and future dates are excluded. With no existing history, all completed
report dates are imported. Daily KM comes from each day column; monthly
`Total Distance` is ignored. Preview lists new dates and the already saved count.
All completed dates covered by the metadata must have exactly one day column;
missing metadata, duplicate/missing columns, and durations crossing months reject
the file. Older-month reports can fill older gaps; a gap spanning two months
requires exports containing those months. Blank completed-day cells save zero,
following existing Opspod rules. Empty rows and
total footers are skipped. All four downloaded layouts work with Excel or CSV.
The six-column daily template remains supported with its explicit `Date`,
including historical dates.

Parsing, date handling, matching rules, and upload behavior were reused from
`C:\Users\user\Documents\Development code\IOT DATA Upload`.
Registration numbers, chassis numbers, motor IDs, and composite identifiers
are matched against the complete **EV91 Vehicles** inventory using the same
`/api/ev91-vehicles` API as that page. Inventory pages are fetched four at a time
and cached in memory for five minutes for faster repeat uploads. A failed or
incomplete inventory fetch stops file preparation and can be retried by choosing
the file again. Unmatched rows are identified in the preview and can be downloaded.
The API supplies current inventory rather than dated vehicle master snapshots.
`vehicle_master_id` stays null for API matches because EV91 IDs do not refer to
that Supabase table; registration, match status, and match type are still saved.

Opspod accepts additional files for an existing date and skips duplicate
vehicle/date records. The other three providers reject an entire file if any
of its dates already has data for that provider. A file is saved in one
database transaction through the existing `save_iot_upload` RPC. Retry uses the
same batch ID and exact payload.

Provider cards distinguish loading, no uploads, and unavailable history. They
refresh after saving, when the tab regains focus, and every minute while visible.
Failures retry automatically after 15 seconds and retain previously loaded
counts. If `iot_dashboard_last_uploads` fails or returns incomplete counts, the
client reads each provider's latest date separately and paginates all its rows
to compute unique vehicles, distinct saved file batches, and the upload time.
A failed provider does not clear healthy providers. The count is vehicles, not
riders; file counts describe batches that saved rows on the latest data date.
The optional SQL summary update in `sql/iot-upload/` uses indexed per-provider
lookups instead of scanning all historical dates.

Validation also follows the old project: negative finite distances become
zero; blank distances become zero for Opspod and Stridegreen. Other blank
distances, invalid dates, and nonnumeric/infinite distances reject the file.
Excel serial dates and the 1904 date system retain their original calendar day.

## Database compatibility

The configured database's existing `save_iot_upload` and
`iot_dashboard_last_uploads` endpoints were verified. Its live table already
contains all four source values. No production rows or schema were changed.
Copies of the original SQL setup files are in `sql/iot-upload/` for reference
or an installation missing those functions. They do not create a separate
EV91 IoT table.

## Verification

Run `npm run test:iot` for all four file formats, dates, vehicle lookup, shared
history reads, the transactional upload client, and report rendering.
Run `npm run test:iot:sql` against disposable local PostgreSQL for rollback,
history preservation, duplicate handling, retries, and concurrent uploads.
Run `npm run build` to verify the production bundle.
