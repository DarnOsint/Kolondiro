# Kolondiro — Restaurant Management OS

The all-in-one restaurant operating system for **Kolondiro**, built to run a
busy restaurant from the floor to the back office — POS, kitchen display,
accounting, reports, and thermal printing in one PWA.

## Features

- **Point of Sale (POS)** — fast order capture, cash sales, payments, tips,
  table/zone ordering, and thermal receipt printing.
- **Kitchen Display System (KDS)** — live kitchen, bar, and griller tickets;
  store requests; daily summaries.
- **Zone & Customer Menus** — QR-table cards open a station-specific digital
  menu for customers at the table.
- **Back Office** — staff management and PINs, network printer setup, QR table
  cards, and print-server downloads.
- **Management** — payroll, chiller/fridge stock, returned drinks, voids, staff
  performance, station sales, and shift summaries.
- **Accounting** — cash-up, returns, stock summaries, tips, waitron orders, and
  Z-report / accountant summaries with email delivery.
- **Reports** — rich day/period reports exported to CSV and XLSX.
- **PWA** — installs to the home screen and works with an offline seed.
- **Windows Network Print Server** — companion app (see
  `print-server/`) that lets browsers print thermal tickets to shared receipt
  printers on the local network.

## Tech Stack

- React 19 + TypeScript + Vite
- Tailwind CSS 4
- Supabase (auth + database + edge functions)
- Recharts, jspdf, xlsx, web-push, Resend
- Playwright (e2e) + Vitest (unit)

## Getting Started

```bash
npm install
npm run dev
```

Set the required environment variables (see `e2e/.env.example` and the API
functions in `api/`):

| Variable | Purpose |
|---|---|
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase anonymous key |
| `VITE_INTERNAL_API_SECRET` | Shared secret for internal API routes |
| `VITE_VAPID_PUBLIC_KEY` | Web-push public key |
| `SUPABASE_URL` | Server-side Supabase URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side service-role key |

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start the dev server |
| `npm run build` | Production build |
| `npm run lint` | ESLint (zero warnings policy) |
| `npm run typecheck` | TypeScript type check |
| `npm run test` | Unit tests (Vitest) |
| `npm run test:e2e` | End-to-end tests (Playwright) |

## Deployment

Deploys to **Vercel** as a static PWA with serverless API routes and scheduled
cron jobs (see `vercel.json`). Supabase handles the database, auth, and edge
functions.

> **Domain note:** While the app has no custom domain yet, web references use
> `kolondiro.vercel.app` and email-sender addresses use `kolondiro.com`. When a
> production domain is added, replace those placeholders (search for
> `kolondiro.vercel.app` and `kolondiro.com`).

## Windows Print Server

The POS can print to shared thermal printers via the bundled Windows print
server (`print-server/`). Builds and installers live in `print-server-dist/`.
Download links are available from the Back Office → Network Printers page.

## License

Private — internal use for Kolondiro.