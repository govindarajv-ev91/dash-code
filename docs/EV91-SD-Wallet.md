# EV91 SD wallet

Open **EV91 DB Data → EV91 SD** to read the live security-deposit wallet export. The page shows PublicRiderId, City, ClientName, ClientRiderId, TotalSd, PendingSd and FixedDeposit. Search and city/client filters update the totals and Excel download across every matching row, including rows beyond the visible page.

The source is `https://dashboard.ev91riderz.com/api/v1/security-deposit/export/wallet`. It returns an Excel workbook rather than JSON. The client validates its columns, rider IDs and numeric SD amounts before accepting it. A successful result is cached in memory for five minutes; **Refresh** bypasses that cache. The last successful data stays visible while refreshing and after refresh failures, with its load time and an error message.

The **SD & EV Rent** page also reads this wallet API for **EV91 TotalSd**, **EV91 PendingSd** and **EV91 FixedDeposit**, including its summary cards and Excel export. It matches wallets by ClientRiderId and PublicRiderId, including Overall/Client Mapping aliases. **Refresh EV91 SD** reloads these balances while retaining the last successful values. If the API fails before any successful load, the three columns show a dash and SD export stays disabled until balances load successfully; EV Rent remains available.

The Rider Payment Upload page still supports manual uploads to `ev91_sd_data`, but SD & EV Rent no longer reads that table for these wallet balances. Reading the API does not overwrite stored uploads.

## Hosting

The browser requests `/api/ev91-sd-wallet` on the dashboard origin because the upstream does not provide browser CORS headers.

- Vite development and preview use the middleware in `vite.config.js`.
- Vercel uses `api/ev91-sd-wallet.js`, a GET-only fixed-destination proxy with a 25-second upstream timeout and no response caching.
- AWS Amplify needs the `/api/ev91-sd-wallet` rule from `amplify-redirects.json`, placed above the SPA fallback. Importing this file into Amplify Hosting's redirects settings is separate from building the app. Its target is the wallet URL above and its status is `200` (rewrite).

If the route returns the HTML dashboard or a login page instead of Excel, the page reports a route/data error rather than displaying zero balances. No API key or database migration is required for the currently verified wallet endpoint.

Run `npm run test:ev91-sd` for proxy, parsing, filtering, pagination, download and refresh regression checks.
