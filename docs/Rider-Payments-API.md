# Rider Payments API

`GET /api/rider-payments/HYD-26-R000016`

Production (AWS Amplify):

```text
https://main.d2y6lleakorn3s.amplifyapp.com/api/rider-payments/HYD-26-R000016
```

The EV91 ID is a path parameter: `/api/rider-payments/:ev91_id`.
The older query format remains supported for existing callers.

Send the API key in a request header. Opening this URL in a browser address bar
does not send the required key.

```sh
curl 'https://main.d2y6lleakorn3s.amplifyapp.com/api/rider-payments/HYD-26-R000016' \
  -H 'x-api-key: YOUR_KEY'
```

## Required production setup

The Amplify app publishes static Vite files. Files in `api/` and Vite middleware
do not run there. Without the backend rewrite, this URL returns the dashboard
HTML with HTTP 200 instead of payment JSON. The production backend is the
`rider-payments` Supabase Edge Function, using the same tested handler as local
development. Vercel deployment is not required.

1. Run `npm run prepare:rider-payments` to regenerate the deployable function.
2. Sign in with `npx supabase login`, then deploy:

   ```sh
   npx supabase functions deploy rider-payments --project-ref arnxvnkednpzyzyfculx --use-api
   ```

3. In Supabase Dashboard > Edge Functions > Secrets, set
   `RIDER_PAYMENT_API_KEY` to the key from your local `.env.local`. If using a
   custom upstream MIS key, also set `EV91_MIS_API_KEY`. Supabase supplies
   `SUPABASE_URL` and `SUPABASE_ANON_KEY`. Setting a secret in Amplify alone
   does not configure this backend. JWT verification is disabled for this function
   in `supabase/config.toml`; the handler enforces the payment API key instead.
4. In AWS Amplify > this app > Hosting > Rewrites and redirects, add the following
   **above the SPA `/index.html` fallback**, or import `amplify-redirects.json`:

   ```json
   {
     "source": "/api/rider-payments/<*>",
     "target": "https://arnxvnkednpzyzyfculx.supabase.co/functions/v1/rider-payments/<*>",
     "status": "200",
     "condition": null
   }
   ```

   This file is a reference for the console rules; `npm run build` does not
   automatically apply it to Amplify.
5. Verify with the production curl command above. Expect JSON, never HTML.
   Without a key, expect JSON HTTP 401 once the backend secret is configured.
   Alternatively run `npm run check:rider-payments`; this reads your local key
   without printing it. To check local development, run
   `npm run check:rider-payments -- "http://localhost:5173/api/rider-payments/HYD-26-R000016"`.

For backend troubleshooting, call the function directly with the same header:
`https://arnxvnkednpzyzyfculx.supabase.co/functions/v1/rider-payments/HYD-26-R000016`.
If that works but Amplify returns HTML, check the Amplify rewrite and its order.

## Local development and response

Send the generated `RIDER_PAYMENT_API_KEY` using `x-api-key: YOUR_KEY` or
`Authorization: Bearer YOUR_KEY`. Keys in URLs are not accepted.

Generate a local key with `node scripts/create-rider-payment-api-key.mjs`.
This saves it in ignored `.env.local`. Set the same key in the Supabase backend
secrets for production; never prefix it with `VITE_`. Local Vite dev/preview
uses the existing Supabase and EV91 MIS environment configuration.

```sh
curl 'http://localhost:5173/api/rider-payments/HYD-26-R000016' \
  -H 'x-api-key: YOUR_KEY'
```

The required EV91 ID is matched exactly against EV91 overall status and client
mapping history. Its client rider IDs (including FE/numeric aliases) and direct
EV91 payment IDs are queried. Names are never used to match identities.

Only the current and previous **payment month** are included, using
Asia/Kolkata calendar time. For November 2026 this means October and November;
the window moves automatically, including across year boundaries. Week dates
do not override a row's payment month. Every matching row is returned; there is
no summing or latest-row-only selection. All database and upstream pages are
read; failures return an error instead of partial payment data.

```json
{
  "success": true,
  "ev91_id": "HYD-26-R000016",
  "timezone": "Asia/Kolkata",
  "months": ["2026-10", "2026-11"],
  "count": 1,
  "data": [{
    "id": "123",
    "ev91_id": "HYD-26-R000016",
    "rider_name": "Example Rider",
    "client_id": "00123456",
    "client_name": "Blinkit",
    "week": "4526",
    "month": "Nov-2026",
    "gross_payout": 5000,
    "cod_deduction": 100,
    "damage": 0,
    "traffic": 0,
    "ev_rent": 1000,
    "final_net_payout": 3900
  }]
}
```

No matches returns HTTP 200 with `count: 0` and `data: []`. If a payment uses the
EV91 ID directly and its client rider ID cannot be uniquely resolved,
`client_id` is `null`, rather than guessing. Other responses: 400 invalid/missing
ID, 401 invalid/missing API key, 405 unsupported method, 503 key not configured,
502 incomplete/unavailable upstream data. Responses are not cached.

The API key grants access to payments for any supplied EV91 ID. Keep it in the
calling application's backend; it is not a rider-specific login token.
