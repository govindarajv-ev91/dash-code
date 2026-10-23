# EV91 SD wallet

Open **EV91 DB Data → EV91 SD** to read the live security-deposit wallet export. The page shows PublicRiderId, City, ClientName, ClientRiderId, TotalSd, PendingSd and FixedDeposit. Search and city/client filters update the totals and Excel download across every matching row, including rows beyond the visible page.

The source is `https://dashboard.ev91riderz.com/api/v1/security-deposit/export/wallet`. It returns an Excel workbook rather than JSON. The client validates its columns, rider IDs and numeric SD amounts before accepting it. A successful result is cached in memory for five minutes; **Refresh** bypasses that cache. The last successful data stays visible while refreshing and after refresh failures, with its load time and an error message.

This page reads the API without replacing uploaded `ev91_sd_data`. The existing Rider Payment Upload and SD & EV Rent workflows continue to use that database table.

## Hosting

The browser requests `/api/ev91-sd-wallet` on the dashboard origin because the upstream does not provide browser CORS headers.

- Vite development and preview use the middleware in `vite.config.js`.
- Vercel uses `api/ev91-sd-wallet.js`, a GET-only fixed-destination proxy with a 25-second upstream timeout and no response caching.
- AWS Amplify needs the `/api/ev91-sd-wallet` rule from `amplify-redirects.json`, placed above the SPA fallback. Importing this file into Amplify Hosting's redirects settings is separate from building the app. Its target is the wallet URL above and its status is `200` (rewrite).

If the route returns the HTML dashboard or a login page instead of Excel, the page reports a route/data error rather than displaying zero balances. No API key or database migration is required for the currently verified wallet endpoint.

Run `npm run test:ev91-sd` for proxy, parsing, filtering, pagination, download and refresh regression checks.
