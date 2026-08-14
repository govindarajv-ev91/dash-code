# Full Data page — what it is and why we built it

This note is for the team (ops, city leads, finance, leadership). It is not a technical guide.

---

## Why this page exists

Before Full Data, the same daily picture lived in many places:

- Deploy and return on one screen
- Orders on another
- Payments / earning on another
- Vehicle KM on another

To answer a simple question — *“How did this city or client do yesterday, and how is the month looking?”* — someone had to open several reports, copy numbers, and paste them into Excel.

**Full Data was built so that work happens in one place.**

It is the month sheet for the whole operation: supply, orders, money, and EV kilometres — **day by day**, with a **month total**, for **all cities and clients** or for one filter.

That is why it sits in the app: so daily review, WhatsApp sharing, and Excel download all use the **same numbers**, not a private spreadsheet.

---

## What you see

The page looks like a wide table.

| Left side | Middle | Right side |
|-----------|--------|------------|
| **List** — the name of each line (Deployee Count, Total Order, Rent, Total KM, and so on) | **Total** — sum for the selected month (and filters) | **One column per date** — 01-AUG, 02-AUG, … through **today** |

Rows are grouped in two blocks:

1. **Supply** — people, vehicles, orders, and money  
2. **Ev** — kilometres and how many vehicles fell in each KM band (0–30, 31–50, … 121+)

You can scroll right to see later dates. List and Total stay on the left so you do not lose the row name.

**Today’s column** is shown on the screen (slightly highlighted) so you can check live numbers. It may still be incomplete during the day.

---

## What each block means (in simple words)

### Supply

| Line | Meaning |
|------|--------|
| **Deployee Count** | How many vehicles were deployed that day |
| **Return Count** | How many vehicles came back that day |
| **Rider Count** | Riders active that day |
| **EV / Non-EV rider & order** | Split of riders and orders by vehicle type |
| **Total Order** | Orders delivered (from the order upload) |
| **0 order Rider count** | Riders on a vehicle who had no orders in the recent window |
| **Total Earing** | Order money = orders × the client’s per-order rate |
| **MF Amount** | Margin on that earning (client %; BB is 6% in Bengaluru, Chennai, Hyderabad, Mumbai) |
| **Rent** | On-road EV vehicles × ₹230 per vehicle per day |
| **Total Revnue** | Earning + MF + Rent |

Tap **Rates** on the page to see the client-wise order rate and MF %.

### Ev

| Line | Meaning |
|------|--------|
| **Total KM** | Kilometres from IoT for that day |
| **Deployee KM / Return KM** | KM on vehicles that were deployed / returned |
| **KM > 0 Count** | Vehicles that actually moved (more than 0 KM) |
| **0 TO 30 KM … 121 KM +** | How many vehicles sat in each distance band |
| **Deployee / Return** bands | Same bands, only for deploy or return vehicles |

---

## How to use it day to day

1. Open **Full Data**.
2. Pick the **Month**.
3. Optionally pick a **City** and/or **Client** (or leave **All**).
4. Read **Total** for the month picture, and the date columns for the daily picture.
5. Use **Refresh** if new orders, fleet, or IoT data was just uploaded.

Typical uses:

- Morning ops huddle: yesterday vs the last few days  
- City vs city, or client vs client, without a new Excel  
- Spot a drop in orders, a spike in returns, or vehicles stuck in low KM  
- Finance / commercial: earning, MF, rent, and revenue on the same grid  

---

## Share and Export — important difference

| Button | What it does |
|--------|----------------|
| **Export** | Excel of what you see on the page (including **today**) |
| **Share WhatsApp** | Picture of the table for WhatsApp |

**Share is through yesterday only.**  
Today is left off the picture, and Totals in that picture are recalculated without today.

That is on purpose:

- The **screen** is for live checking (including today).  
- The **shared report** is the closed day, so the group chat is not mixing half-day numbers with a full month.

The share image includes **every date through yesterday** (it is not a crop of the screen), so the last day is not cut off.

---

## Where the numbers come from (plain language)

Full Data does not ask you to type a new sheet. It **joins what the app already has**:

- **Order upload** → orders, EV vs non-EV, earning  
- **Fleet / EV91 deploy–return** → deployee, return, rider, on-road for rent  
- **IoT** → kilometres and KM bands  

If a source is missing or late (for example IoT not uploaded yet), that day’s KM lines can look empty even when orders are present. Upload the missing file and tap **Refresh**.

---

## What Full Data is not

- It is **not** a replacement for rider-level payment history or SD / rent collections. Those stay on their own pages.  
- It is **not** a live GPS map. KM is from the IoT upload for that day.  
- **Today** on the screen can still change until the day is closed. Treat **yesterday** as the number you share.

---

## One-line summary

**Full Data is the single month dashboard we built so the team can see supply, orders, money, and EV KM by day — check today on the page, and share yesterday’s close on WhatsApp or Excel without building a separate sheet.**
