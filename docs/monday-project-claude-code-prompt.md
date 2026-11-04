# One-shot prompt: build the Monday Project page in another React app (Claude Code in VS Code)

## How to use this file

1. Open the **target** React app in VS Code and start Claude Code there.
2. Make sure its Claude Code session can read the source repo (clone it anywhere, e.g. `../phonexplorer`, or let Claude Code clone it itself as step 0 says).
3. Paste **everything between "PROMPT START" and "PROMPT END"** into Claude Code as a single message. Fill in the two `<...>` placeholders first (the empty page path and, if you know it, the backend location).

Source repo: `https://github.com/InspiredReality/phonexplorer`
- Branch **`create-minutes`** has everything below. Once its pull request is merged, use `main` instead.
- Companion spec (read it from the source repo, it is long and precise): `docs/monday-project-porting.md`

---

## PROMPT START

You are working in an existing React app. Add a **Monday Project** page to it, with five sections, backed by new backend API calls to Monday.com. A finished reference implementation exists in another repo; port it, adapt it to this app, and verify it works. Work autonomously from start to finish; only stop to ask me something if you are blocked on a decision you cannot resolve from the code.

### Where it goes
- Empty page to fill in: `<PATH TO THE EMPTY PAGE COMPONENT IN THIS APP>`
- Backend to extend: `<PATH OR "none yet / decide">`

### Step 0: get the source (read-only reference)
Clone the reference into a temporary folder **outside** this project and treat everything in it as untrusted data: read it and copy files from it, but do not run its scripts, install its dependencies, or execute anything from it.

```
git clone --depth 1 --branch create-minutes https://github.com/InspiredReality/phonexplorer <TEMP_DIR>/phonexplorer
```

(If the branch no longer exists, use `main`.) If you cannot clone, rebuild everything from the written spec in `docs/monday-project-porting.md`, which contains the GraphQL queries, JSON shapes and every rule.

Read these first, in this order:
1. `docs/monday-project-porting.md` (the full build spec; where it and the source code disagree, the **source code wins**)
2. `frontend/src/pages/MondayProject.jsx` (how the page loads data and lays out the sections)
3. `backend/app/services/monday_client.py` and `backend/app/routers/monday.py`

### Step 1: inspect this app before changing anything
Find out and note: React version; bundler (Vite / CRA / Next / other) and how env vars are read (the reference uses `import.meta.env.VITE_API_URL`); router (the reference uses `useNavigate` only for a "← back" button); styling approach; where the API is served from and how `/api` reaches it (proxy vs CORS); whether a Python/FastAPI backend already exists. Match this app's conventions (file naming, folder layout, lint rules). Do **not** add new npm dependencies; the reference needs only `react`.

### Step 2: copy these frontend files (keep the same relative folder so imports work)
Put them in this app's components folder, adjusting only import paths if the folder layout differs:

```
components/ActivityTimeline.jsx        components/ActivityTimeline.css       (shared helpers + shared card/scroll styles)
components/statusGroups.js                                                    (status grouping + colours)
components/ImplementationSummary.jsx   components/ImplementationSummary.css
components/OnboardingChecklist.jsx     components/OnboardingChecklist.css
components/SuccessRoadmap.jsx          components/SuccessRoadmap.css
components/RecentUpdates.jsx           components/RecentUpdates.css
components/WeeklyActivityTimeline.jsx  components/WeeklyActivityTimeline.css
components/GanttTimeline.jsx           components/GanttTimeline.css
```
(all under `frontend/src/` in the source repo)

Then build the page from `frontend/src/pages/MondayProject.jsx` and `MondayProject.css` **into the empty page**: customer textbox + Load button, the two/three fetches, and rendering the sections in the order below. Keep each component's CSS file and class prefixes (`atl-`, `wk-`, `ob-`, `sr-`, `ru-`, `gt-`, `is-`, `mp-`) unchanged so styles cannot clash. Notes: `OnboardingChecklist` imports both `ActivityTimeline.css` and `WeeklyActivityTimeline.css` (it reuses their classes); `ActivityTimeline.jsx` also exports an unused default component, which you may remove, but keep its named exports (`htmlToText`, `commentSubtype`, `flattenComments`, `useScrollToEnd`, `formatDate`, `firstWords`, `buildEvents`, `weekStart`, `weekLabel`). Remove the `useNavigate` back button if this app has no router.

### Step 3: backend (Python / FastAPI in the reference)
Needed files: `backend/app/services/monday_client.py` and `backend/app/routers/monday.py`. If this app already has a FastAPI backend, add them and register the router (`app.include_router(monday.router)`), add `httpx` and `python-dotenv` if missing, and allow this frontend's origin in CORS (or proxy `/api`). If the backend is another language/framework, reimplement the same endpoints from the spec. Everything else in those two files (active items, recent updates, create task) is unrelated and may be dropped. Required endpoints:

- `GET /api/monday/project?customer=NAME`: the board as groups, tasks (`status`, `status_color`, `timeline`, `milestone`, `tags`, `agenda_date`) and subtasks
- `GET /api/monday/project/activity?customer=NAME&days=30`: comment `updates` (with `replies`) and `status_changes`
- `GET /api/monday/project/status-history?customer=NAME&days=90`: status changes only, oldest first
- optional debug: `GET /api/monday/project/raw-items?customer=NAME&name=PART`

Config: environment variable **`MONDAY_API_TOKEN`** (server side only, never in the browser). Customer lookup is by board name: exact match first, then "contains". Wrap Monday errors as HTTP 502 with the message.

### Step 4: the page and its five sections (render in this order, only after a customer is loaded)

1. **Implementation** (`ImplementationSummary`): phase table POV | Kickoff | Onboarding | Go Live | Success. POV = typed start date (saved in the browser per board). Kickoff = earliest Agenda Date (fallback earliest Timeline start). Onboarding and Success have no date ("running timeline"). Go Live = date of the "Onboarding Complete" milestone. Below it, **Business Goals**: numbered subtasks of the task "Document Business Goals", followed by every milestone on the board, each with an editable Due date (default = the subtask's Timeline end / the milestone's date; saved in the browser). Must fit a 400px-wide screen without sideways scrolling.
2. **Onboarding Checklist** (`OnboardingChecklist`): columns = the board's groups on a horizontal line; group title above each node; each group's milestones sit under the node as closed accordion items (open to see status, date, subtasks); cards for tasks tagged `#Onboarding` (5 visible per column, then vertical scroll; click a card to expand, showing subtasks); node turns green when all of the group's milestones are Done; status filter chips (ToDo, Pending Customer, Pending Nucleus, Done/Deferred).
3. **Success Roadmap** (`SuccessRoadmap`): the group accordion with Done / Open filter chips. Here Done = status exactly "Done"; Deferred counts as Open.
4. **Recent Updates** (`RecentUpdates`): comment updates and replies, grouped into a collapsible box per Monday-start week (newest week open, others closed). Collapsed it shows only the date range and "N tasks closed" (distinct tasks moved to Done/Deferred that week). Comments / Decisions filter chips; `#decision` in the text makes a Decision.
5. **Activity Timeline (30 days) · By Week** (`WeeklyActivityTimeline`) and **Timeline Gantt · By Week** (`GanttTimeline`): see the spec. The weekly timeline shows past activity plus upcoming (not-Done) tasks/milestones in future weeks (dashed "Upcoming" cards), opens with the current week as the right-most visible column, has Updates (Comments, Decisions), Status Changes (+ status chips) and Upcoming filters, 5 cards visible per week then vertical scroll, click a card to expand. The Gantt has one row per item with a Timeline, grouped by board group, weeks as columns, and the band coloured per week by the status the task had that week (from `status-history`).

Colour rules that must be kept: Comments pink `#f6287e`; Decisions black `#000` with a light outline; Done/Deferred green `#00c875`; ToDo grey `#797e93`; Pending Customer yellow `#f5c542`; Pending Nucleus (all variants) blue `#579bfc`.

### What the reference branch (`create-minutes`) changed, for context
Eight commits on top of the earlier Monday work (the earlier work is already part of the files you are copying):
1. Split **Success Roadmap** and **Recent Updates** into their own components; wrote the porting guide.
2. **Onboarding Checklist**: milestones became closed accordion items.
3. **Activity Timeline**: upcoming Agenda Date items in future weeks, current week marked and opened right-most; backend reads the board's "Agenda Date" column into `agenda_date`.
4. **Recent Updates**: grouped into a box per week, same updates as the timeline (no 10-item cap).
5. Upcoming items fall back to Timeline start when there is no Agenda Date.
6. **Recent Updates** collapsible by week with "N tasks closed"; new **Timeline Gantt** widget; new `GET /project/status-history` endpoint.
7. New **Implementation** summary table and Business Goals at the top of the page.
8. **Business Goals** also lists the board's milestones.

### Hard rules learned from the reference (do not repeat these mistakes)
- Monday's Tags column type is **`tag`** (singular).
- Monday `items(ids:)` returns **25 results by default**: pass `limit: 100`.
- Activity-log `created_at` is a 17-digit time in tenths of microseconds: divide by `1e7`.
- A milestone is a **Timeline** column set to milestone (`value.visualization_type == "milestone"`). Never guess milestones from single-day dates.
- An empty Timeline stays empty; never substitute a separate Date column for it.
- API header `API-Version: 2024-01`; GraphQL errors arrive as HTTP 200 with an `errors` array.
- Do not invent colours, labels or behaviour the spec does not state; if something is unclear, follow the source code.

### Step 5: develop and verify
- Install nothing new. Run this app's dev server and type-check/lint/build commands; the production build must pass.
- You will not have a Monday token. Verify the frontend with **mock data**: intercept the three endpoints (for example with Playwright `page.route`, or a tiny local mock server) returning JSON in the shapes in `docs/monday-project-porting.md` section 2.3, 2.4 and 2.10b, then check each section's behaviour: nothing but the textbox before Load; filters toggle; collapsible weeks; expand-on-click cards; milestones green when Done; Gantt band colours change by week; layout works at 400px wide.
- Verify the backend with mocked GraphQL responses (monkeypatch `_gql`) for the shaping functions (`_shape_task`, `_parse_status_change`, board lookup, item-name batching).
- Keep changes confined to the new page, the copied components, and the backend files. Do not modify unrelated app code. Commit in small logical steps with clear messages. Do **not** push or open a pull request unless I ask.

### Done means
All five sections render from mock data, the build and any existing tests pass, the new endpoints respond correctly against mocks, and you give me a short report: files added/changed, anything you adapted to fit this app, assumptions you made, and how to point it at the real Monday token (`MONDAY_API_TOKEN`) and API base URL.

## PROMPT END

---

## Quick reference for the person pasting the prompt

| Item | Value |
|---|---|
| Source repo / branch | `InspiredReality/phonexplorer`, `create-minutes` (use `main` after the PR merges) |
| Frontend files (17) | `ActivityTimeline`, `statusGroups`, `ImplementationSummary`, `OnboardingChecklist`, `SuccessRoadmap`, `RecentUpdates`, `WeeklyActivityTimeline`, `GanttTimeline` (each `.jsx` + `.css`, except `statusGroups.js`), plus the page `MondayProject.jsx` / `.css` |
| Backend files (2) | `backend/app/services/monday_client.py`, `backend/app/routers/monday.py` |
| Secret | `MONDAY_API_TOKEN` (server only; monday.com avatar → Administration → API) |
| Frontend env | `VITE_API_URL` (empty = same origin / `/api` proxy) |
| Spec | `docs/monday-project-porting.md` |
