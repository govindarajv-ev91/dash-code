# EV91 FL Pending

Open **EV91 DB Data → FL Pending**, immediately below **Onboarding Pending**.

The report reads all order upload history and groups Client IDs within each city/client. Numeric and FE-prefixed IDs are combined. Riders who worked for multiple city/client combinations have separate rows so each group's orders reconcile.

- **Client ID not in onboarding:** no matching ID in `rider_onboarding`.
- **Source name missing:** an onboarding ID exists but `source_name` is empty or a placeholder such as N/A, null or Unknown.
- **FL Complete:** onboarding has the Client ID and a source name. Select this status or All riders to review completed records.

Source matching uses onboarding ID fields (`rider_id_details`, `rider_id`, `worker_code`, `client_rider_id`, `merge`). Name-only or phone-only matches do not clear an absent Client ID. Sources from EV91 do not clear FL Pending. EV91 Client Mapping History and Rider Details provide EV91 IDs and contact details.

The last column in the Excel rider sheet, **Source / Referred By**, shows `referredById` from EV91 Rider Details, matched to the exported EV91 ID. It stays blank when no matching value is available and does not change FL status.

Order Start Date is the first day with net positive orders. LWD is the latest such day. Zero-order rows and fully reversed order days do not extend either date. Aging is calendar days since Order Start Date; Days Since LWD is calendar days since LWD. Total Orders sums order counts, including corrections, through the report date. Dates remain empty for riders with no positive order days.

City, client, status and search filters apply to both the rider list and the city/client summary. **Export Excel** includes every filtered row (across all pages) in the **FL Pending** sheet and its **City Client Summary**. Refresh reloads orders, onboarding, mapping and rider details. Failed onboarding reads show an error instead of classifying a partially loaded list as pending.
