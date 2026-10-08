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
