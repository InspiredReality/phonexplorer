# Bets

Standalone weekly parlay tracker — the same page as phonexplorer's `/bets`
route, extracted into its own small Vite + React app (no router, no MUI, no
other pages) so it can be deployed as its own permanent Vercel URL.

It talks to the same backend as the main phonexplorer app
(`https://phonexplorer-production.up.railway.app/api/bets`), via the rewrite
in `vercel.json` — so picks/status saved here and in the main app's `/bets`
page are the same data.

## Local dev

```
npm install
npm run dev
```

The dev server proxies `/api` to the production Railway backend (see
`vite.config.js`), so picks you enter locally are real and shared — there's
no separate dev backend.

## Deploying this as its own Vercel project

This folder is **not** the root of the `phonexplorer` repo, so when you
create the Vercel project:

1. In Vercel, "Add New Project" → import the `phonexplorer` GitHub repo (the
   same repo, not a new one).
2. Under **Root Directory**, set it to `bets-app`.
3. Framework Preset should auto-detect as **Vite** — leave the build
   command / output directory on their defaults (`npm run build`, `dist`).
4. Deploy. Vercel will assign a permanent `<something>.vercel.app` URL —
   that already works with the backend with zero extra config, since the
   backend's CORS allows any `*.vercel.app` origin.
5. **Only if** you later attach a custom domain (not a `*.vercel.app` one),
   that domain needs to be added to the backend's `ALLOWED_ORIGINS_RAW` env
   var on Railway, or CORS will block it. That's a Railway dashboard change
   — outside what this repo can configure on its own.

## Updating team logos

Logo files live in `public/team-logos/<team-id>.png`. Replace a file in
place (same filename) to swap in a better version — no code change needed.
