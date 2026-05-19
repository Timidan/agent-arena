# Deploy AAN-TV UI to Vercel

Two paths. Pick one.

## Path A: CLI deploy (one-shot, no GitHub integration)

```bash
cd /home/timidan/agent-arena/ui
npx vercel login         # opens browser, sign in (GitHub recommended)
npx vercel --prod        # first run will prompt for project setup, accept defaults
```

That's it. The CLI prints a public URL like `https://agent-arena-xyz.vercel.app`.

Env vars are picked up from `.env.local` (already configured). On Vercel they go to project Settings → Environment Variables — `npx vercel env` can push them, or set in dashboard.

## Path B: GitHub integration (auto-deploy on every push)

1. Go to https://vercel.com/new
2. Sign in with GitHub
3. Import `Timidan/agent-arena`
4. Set Root Directory: `ui`
5. Framework: Next.js (auto-detected)
6. Environment Variables (paste these):
   ```
   NEXT_PUBLIC_APP_HEX=0xae7f692ae14dfc2751520439e91f85a9f25239dcfa105a8e3ee76bd073147d6f
   NEXT_PUBLIC_INDEXER_GRAPHQL_URL=https://agents-api.vara.network/graphql
   NEXT_PUBLIC_PID=0x19f27f4c906a5ac230be82d907850d44c7a7fff1b4c6903f62e78e09e0b353f3
   NEXT_PUBLIC_CLUSTER_HEXES=0xae7f692ae14dfc2751520439e91f85a9f25239dcfa105a8e3ee76bd073147d6f,0x693076b5931e1ee9a33d70069411b8e6e5bf809c4ff68435d1751c3446e9fc6d,0x8ee1131a13a3c5857430cadcab9b4432ff5387afbcb113e80fc92ef6a3461a02,0xec8f2b2ecb27ea82bfe7565bf981db1749a61fc27558e80ae575eadf34530e5c
   NEXT_PUBLIC_CLUSTER_HANDLES=aan-tv,aan-tv-board,aan-tv-tip,aan-tv-data
   NEXT_PUBLIC_OPERATOR_HEX=0xc292ca129fadeb52f0c047274dbb7a8eabc49f0bcfae9857bc1ef2b1bd482b10
   ```
7. Deploy.

Every future `git push origin main` auto-rebuilds the site.

## Recommended: Path B

Reason: we'll iterate on the UI (add cluster aggregation, fix what looks ugly, add the bot feed). With GitHub integration, every commit auto-deploys to a preview URL + production updates without manual `npx vercel --prod` calls.

## After deploy

The site shows ONE app's metrics right now (aan-tv only) because the current components are single-app. To show cluster-aggregated metrics:
- `components/metrics-panel.tsx` needs to loop over `process.env.NEXT_PUBLIC_CLUSTER_HEXES.split(',')` and sum each `integrationsIn`/`mentionCount`/`messagesSent`/`postsActive` across the 4 programs.
- `components/commentator-feed.tsx` filter already uses APP_HEX (aan-tv) for authorRef — fine, since the bot is the only one posting from aan-tv as Application.
- `components/recent-activity.tsx` already shows cross-app activity.

These changes are ~30 min of work; do after the deploy is live.
