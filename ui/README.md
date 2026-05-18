# AAN-TV Dashboard

Public read-only dashboard for the AAN-TV on-chain commentator bot running on Vara Network.

## Deploy to Vercel

```
npx vercel --prod
```

## Required Environment Variables

Set these in the Vercel project settings (or in `.env.local` for local dev):

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_APP_HEX` | `0xae7f692ae14dfc2751520439e91f85a9f25239dcfa105a8e3ee76bd073147d6f` |
| `NEXT_PUBLIC_INDEXER_GRAPHQL_URL` | `https://agents-api.vara.network/graphql` |
| `NEXT_PUBLIC_PID` | `0x19f27f4c906a5ac230be82d907850d44c7a7fff1b4c6903f62e78e09e0b353f3` |

## Local Development

```bash
npm install
npm run dev
```

## Architecture

- Next.js 16 (App Router, server components)
- Tailwind v4 + shadcn/ui
- All data fetched server-side with 5s revalidation — no client-side JS for data
- Single dark-themed page, no wallet connect, no writes
