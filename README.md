# Getting Started with Create React App

This project was bootstrapped with [Create React App](https://github.com/facebook/create-react-app).

## Available Scripts

In the project directory, you can run:

### `npm start`

Runs the app in the development mode.\
Open [http://localhost:3000](http://localhost:3000) to view it in your browser.

The page will reload when you make changes.\
You may also see any lint errors in the console.

### `npm test`

Launches the test runner in the interactive watch mode.\
See the section about [running tests](https://facebook.github.io/create-react-app/docs/running-tests) for more information.

### `npm run build`

Builds the app for production to the `build` folder.\
It correctly bundles React in production mode and optimizes the build for the best performance.

The build is minified and the filenames include the hashes.\
Your app is ready to be deployed!

See the section about [deployment](https://facebook.github.io/create-react-app/docs/deployment) for more information.

### `npm run eject`

**Note: this is a one-way operation. Once you `eject`, you can't go back!**

If you aren't satisfied with the build tool and configuration choices, you can `eject` at any time. This command will remove the single build dependency from your project.

Instead, it will copy all the configuration files and the transitive dependencies (webpack, Babel, ESLint, etc) right into your project so you have full control over them. All of the commands except `eject` will still work, but they will point to the copied scripts so you can tweak them. At this point you're on your own.

You don't have to ever use `eject`. The curated feature set is suitable for small and middle deployments, and you shouldn't feel obligated to use this feature. However we understand that this tool wouldn't be useful if you couldn't customize it when you are ready for it.

## Learn More

You can learn more in the [Create React App documentation](https://facebook.github.io/create-react-app/docs/getting-started).

To learn React, check out the [React documentation](https://reactjs.org/).

### Code Splitting

This section has moved here: [https://facebook.github.io/create-react-app/docs/code-splitting](https://facebook.github.io/create-react-app/docs/code-splitting)

### Analyzing the Bundle Size

This section has moved here: [https://facebook.github.io/create-react-app/docs/analyzing-the-bundle-size](https://facebook.github.io/create-react-app/docs/analyzing-the-bundle-size)

### Making a Progressive Web App

This section has moved here: [https://facebook.github.io/create-react-app/docs/making-a-progressive-web-app](https://facebook.github.io/create-react-app/docs/making-a-progressive-web-app)

### Advanced Configuration

This section has moved here: [https://facebook.github.io/create-react-app/docs/advanced-configuration](https://facebook.github.io/create-react-app/docs/advanced-configuration)

### Deployment

This section has moved here: [https://facebook.github.io/create-react-app/docs/deployment](https://facebook.github.io/create-react-app/docs/deployment)

### `npm run build` fails to minify

This section has moved here: [https://facebook.github.io/create-react-app/docs/troubleshooting#npm-run-build-fails-to-minify](https://facebook.github.io/create-react-app/docs/troubleshooting#npm-run-build-fails-to-minify)

---

## NBA points model (backend)

Backend for the UBettors NBA points projections. FastAPI + async SQLAlchemy/Postgres like the rest of `backend/`; tables are prefixed `nba_` and created at startup by `create_all`. Code: `backend/app/routers/nba.py` (API), `services/nba_model.py` (pure model engine), `services/nba_ingest.py` (scraper), `services/nba_seed.py` (CSV seed).

### The model

```
adj  = opp_allowed_per_game[pos] - league_avg_allowed_per_game[pos]
pred = w_avg * player_avg + w_adj * adj
```

- `v1_75_25`: `w_avg=1.0, w_adj=0.25` (`player_avg + 0.25*adj`). `v1_literal`: `w_avg=0.75, w_adj=0.25`. Both are seeded at startup.
- `pos` is the player's **fixed** G/F/C from `nba_players` (PG/SG→G, SF/PF→F, C→C). A player with no position is *unassigned*: listed by `GET /players?unassigned=true`, excluded from the position tables and never predicted until `PUT /players/:team/:player`.
- Stats use final games only, and a prediction/backtest for a game uses only games dated **before** that game's date.
- Formulas are rows (`params` JSON). Variables live in a registry in `nba_model.py` (`player_avg`, `pos_defense_adj`, `last_n_form`, `home_away`); add one by writing a function and registering it, then list it in a formula's `params.variables`. Formulas lock once a prediction is graded; change them by `POST /formulas` with `copy_from`.

### API (base path `/api/nba`)

Reads are open (like `/api/nfl`); writes (`POST`/`PUT`, including `/predict`, `/backtest`, `/ingest/run`) need `Authorization: Bearer $ADMIN_TOKEN`, the same convention as `/api/bets` admin routes. Errors are FastAPI's `{"detail": "..."}`; success bodies are the bare JSON from the contract (no envelope). UBettors should call writes from its server side (the token must not reach browsers).

| Method | Path | Notes |
|---|---|---|
| GET | `/games?from=&to=&status=` | `{id,date,home,away,home_score,away_score,status}`; status `scheduled\|pending_review\|final` |
| GET | `/games/:id/box` | `{team,player,pos,points,started,listed_pos}` (`pos` = fixed pos, `listed_pos` = raw label) |
| GET | `/teams/allowed?asof=` | `asof` inclusive; final games only |
| GET | `/players?team=&unassigned=true` | |
| PUT | `/players/:team/:player` | `{pos}` |
| GET / POST | `/formulas` | POST `{name,description,params,copy_from?}`; id = slug of name; 409 if name exists |
| GET | `/games/:id/lineup-candidates` | players with ≥1 prior game; `pos` is `null` if unassigned; `default_starter` = top 5 by starts in the team's last 5 games |
| POST | `/predict` | `{game_id,formula_ids,players:[{team,player,is_starter?}]}`; 422 if any player is unassigned/no games, 409 once the game has started |
| GET | `/predictions?game_id=&formula_id=&from=&to=` | |
| GET | `/accuracy?formula_ids=a,b&from=&to=&group_by=none\|pos\|team\|week` | rows `{formula_id,group,metrics,dnp}` + `baseline_avg` rows; `group` is `"all"` when ungrouped |
| POST | `/backtest` | `{formula_ids,from?,to?,min_team_gp?,group_by?}`; read-only |
| POST | `/ingest/run` | `{date?}`; no date = yesterday + today (US Eastern) |

`error = predicted - actual`; `bias` is the mean of that. `within3/within5` are fractions 0..1. DNPs are excluded from metrics and reported as `dnp`.

Example:

```
POST /api/nba/predict
{"game_id":"20261030BOSDET","formula_ids":["v1_75_25"],"players":[{"team":"BOS","player":"Tatum"}]}
→ [{"id":1,"game_id":"20261030BOSDET","game_date":"2026-10-30","team":"BOS","opp":"DET","player":"Tatum",
    "pos":"F","formula_id":"v1_75_25","player_avg":28.0,"adj":1.2,"predicted":28.3,"actual":null,
    "error":null,"is_starter":true,"locked":false,"created_at":"2026-10-30T15:00:00Z"}]
```

Game ids are `YYYYMMDD` + away code + home code (`20261020BOSDET`). Teams are 3-letter codes everywhere (names in CSVs are normalised).

### Ingestion and scheduling

`POST /api/nba/ingest/run` ingests one date's games from landofbasketball.com: daily page → box scores, skipping DNPs, checking each team's player points against its totals row (a mismatch is reported and the game stays `pending_review`, not `final`). Pages are cached in `nba_page_cache`, requests are spaced 1.5s, robots.txt is honoured, and a 403/429/robots block is surfaced as a 502 and never worked around. Settled games are skipped on re-runs, so it is idempotent. New names that don't match a player/alias are created **unassigned** and returned as `unknown_players`; add name variants to `nba_player_aliases`.

This repo deploys to Railway, not Vercel, so there is no Vercel Cron. Either set `NBA_INGEST_ENABLED=true` (an in-process loop runs yesterday+today every `NBA_INGEST_INTERVAL_HOURS`, default 24) or point any scheduler (e.g. a Railway cron service) at `curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" https://<api>/api/nba/ingest/run`.

Seed from CSV (idempotent; never overwrites an edited position):

```
cd backend && python -m app.services.nba_seed path/to/nba_box_scores_2026-27.csv
```

The CSV has no starter column, so the seed assumes the first five rows per team per game are starters (or reads an optional `Started` column).

### Tests

```
cd backend && pip install pytest aiosqlite && python -m pytest tests
```

`tests/test_nba_model.py` covers the engine and metrics; `tests/test_nba_api.py` runs the API and ingestion (with a mocked site) on SQLite. The reference-number test (league avg G 52.4 / F 43.0 / C 19.1, Celtics/Bulls projections) is skipped until `backend/tests/data/nba_box_scores_2026-27.csv` is present.
