# Porting the Monday Project Board into another React app

This guide has two parts:

1. **File list**: exactly what to copy from this repo (a quick port).
2. **Build spec**: everything an AI agent needs to rebuild the four sections, the project-board step,
   and the backend API calls from scratch, in an existing React app with an empty page.

The finished page: a **Customer name** textbox. On "Load" it finds that customer's Monday board and shows four sections:

| # | Section | Component | Data it needs |
|---|---|---|---|
| 1 | **Onboarding Checklist** | `OnboardingChecklist` | `groups` from `/api/monday/project` |
| 2 | **Success Roadmap** | `SuccessRoadmap` | `groups` from `/api/monday/project` |
| 3 | **Recent Updates** | `RecentUpdates` | `updates` from `/api/monday/project/activity` |
| 4 | **Activity Timeline (30 days) · By Week** | `WeeklyActivityTimeline` | `updates` + `status_changes` from `/api/monday/project/activity` |

---

## Part 1: Exact files to transfer

### Frontend (React 18/19, Vite; no extra npm packages beyond `react`)

Copy these into the target app (keep them in the same folder so the relative imports work):

```
frontend/src/components/OnboardingChecklist.jsx
frontend/src/components/OnboardingChecklist.css
frontend/src/components/SuccessRoadmap.jsx
frontend/src/components/SuccessRoadmap.css
frontend/src/components/RecentUpdates.jsx
frontend/src/components/RecentUpdates.css
frontend/src/components/WeeklyActivityTimeline.jsx
frontend/src/components/WeeklyActivityTimeline.css
frontend/src/components/ActivityTimeline.jsx      <- shared helpers (see note)
frontend/src/components/ActivityTimeline.css      <- shared card/scroll styles
frontend/src/components/statusGroups.js           <- shared status grouping + colours
```

Plus the page that wires them together, which you adapt into the empty page:

```
frontend/src/pages/MondayProject.jsx              <- data loading + layout (adapt to the target page)
frontend/src/pages/MondayProject.css              <- page-level styles only (header, search box, layout)
```

Notes:
- `ActivityTimeline.jsx` also exports a default component (the original unfiltered timeline). It is **not used**; the
  named exports are what the other components import: `htmlToText`, `flattenComments`, `commentSubtype`,
  `useScrollToEnd`, `formatDate`, `firstWords`, `buildEvents`. You may delete the default component if you want.
- `OnboardingChecklist.jsx` imports **both** `ActivityTimeline.css` and `WeeklyActivityTimeline.css` because it reuses
  their `atl-*` and `wk-*` classes. Don't drop either stylesheet.
- `SuccessRoadmap` has no dependencies (own CSS, `sr-` prefix). `RecentUpdates` depends on `ActivityTimeline.jsx`
  (`flattenComments`) and `statusGroups.js` (`DECISION_COLOR`), own CSS (`ru-` prefix).
- Do **not** copy `MondayPage.jsx`; the `/monday` page is a different, older page that this doesn't use.
- `MondayProject.jsx` imports `useNavigate` (react-router-dom) only for the "← back" button. Remove that if the target
  app doesn't use React Router.
- `import.meta.env.VITE_API_URL` is the API base URL (empty = same origin). Keep it if the target uses Vite; otherwise
  swap for the target's env mechanism.

### Backend (Python, FastAPI)

Needed (copy or merge):

```
backend/app/services/monday_client.py     <- Monday GraphQL client (async, httpx)
backend/app/routers/monday.py             <- REST endpoints under /api/monday/...
```

and register the router in the app: `app.include_router(monday.router)` (see `backend/app/main.py`), with CORS allowing the
frontend origin (or proxy `/api` through the frontend host, as `vercel.json` does).

Python packages: `fastapi`, `uvicorn`, `httpx`, `python-dotenv` (versions in `backend/requirements.txt`).

Environment variable: **`MONDAY_API_TOKEN`** (monday.com avatar > Administration > API > personal API token). The token
must be able to read the customer boards. It stays on the server; never send it to the browser.

Minimum subset inside the two backend files (everything else in them is unrelated and can be dropped):

- `monday_client.py`: the GraphQL constants `BOARDS_QUERY`, `BOARD_PROJECT_QUERY`, `NEXT_PROJECT_ITEMS_QUERY`,
  `ACTIVITY_LOGS_QUERY`, `BOARD_UPDATES_QUERY`, `ITEM_NAMES_QUERY`, `USERS_QUERY`, `_PROJECT_COLUMN_FIELDS`; the class
  `MondayClient` with `_gql`, `find_board_by_customer`, `get_project_board`, `get_board_activity`,
  `_board_status_changes`, `_fetch_item_meta`; and helpers `_shape_task`, `_is_milestone_value`, `_activity_ts`,
  `_parse_status_change`, `_parse_dt`.
- `routers/monday.py`: `_client()`, `GET /project`, `GET /project/activity`, and (optional, debugging)
  `GET /project/raw-items`.

---

## Part 2: Build spec for an AI agent

### 2.0 Overall order of work

1. Backend: add the Monday client + the two endpoints (section 2.2-2.4). Test with `curl`.
2. Frontend: add `statusGroups.js` and `ActivityTimeline.jsx` helpers (2.6), then the four components (2.7-2.10).
3. Page: the customer step and data loading (2.5), render the four components.
4. Verify with the checklist in 2.11.

Visual design: dark theme (page `#111`, cards `#1a1a2e` / `#181820`, text `#e8e8ee`), system font, mobile-first (works at
~400px wide), rounded cards. All colours are explicit hex values in the CSS/JS; there are no CSS variables to inherit.

### 2.1 Monday API basics

- Endpoint: `POST https://api.monday.com/v2`, headers `Authorization: <token>`, `Content-Type: application/json`,
  **`API-Version: 2024-01`**. Body `{ "query": "...", "variables": {...} }`.
- Monday returns HTTP 200 with an `errors` array on GraphQL failures, so check `body["errors"]` and raise.
- Wrap Monday failures in `HTTP 502` with the message (`"Monday API error: ..."`) so the UI can show what went wrong.
  An unhandled exception otherwise becomes a bare 500 with no detail.
- Rate limiting: sleep ~50ms between paged calls.

### 2.2 Finding the customer's board

`BOARDS_QUERY` lists boards (paged, 100 per page):

```graphql
query GetBoards($limit: Int!, $page: Int!) {
  boards(limit: $limit, page: $page) {
    id
    name
  }
}
```

`find_board_by_customer(customer)`: lowercase/strip, prefer an exact name match, otherwise the first board whose name
*contains* the text ("pennymac" finds "PennyMac"). Return `None` if no match, which the endpoint turns into 404.

### 2.3 `GET /api/monday/project?customer=NAME` (groups -> tasks -> subtasks)

Query 1, board + groups + first page of items (with subitems). Variables: `boardId: [ID!]`, `limit: 100`.

```graphql
query GetBoardProject($boardId: [ID!]!, $limit: Int!) {
  boards(ids: $boardId) {
    id
    name
    groups { id title color }
    items_page(limit: $limit) {
      cursor
      items {
        id
        name
        group { id }
        column_values {
      id
      type
      text
      value
      ... on StatusValue   { label label_style { color } }
      ... on TimelineValue { from to }
      ... on DateValue     { date }
}
        subitems {
          id
          name
          column_values {
      id
      type
      text
      value
      ... on StatusValue   { label label_style { color } }
      ... on TimelineValue { from to }
      ... on DateValue     { date }
}
        }
      }
    }
  }
}
```

Further pages (while `cursor` is non-null) use `next_items_page`:

```graphql
query NextProjectItems($limit: Int!, $cursor: String!) {
  next_items_page(limit: $limit, cursor: $cursor) {
    cursor
    items {
      id
      name
      group { id }
      column_values {
      id
      type
      text
      value
      ... on StatusValue   { label label_style { color } }
      ... on TimelineValue { from to }
      ... on DateValue     { date }
}
      subitems {
        id
        name
        column_values {
      id
      type
      text
      value
      ... on StatusValue   { label label_style { color } }
      ... on TimelineValue { from to }
      ... on DateValue     { date }
}
      }
    }
  }
}
```

Build the response by creating one entry per board group (in board order), then placing each item into its group by
`item.group.id`. Each item becomes a "task" via `_shape_task`; its `subitems` become `subtasks` (same shape).

**Response shape**

```json
{
  "board": { "id": "123", "name": "Eversource" },
  "groups": [
    {
      "id": "topics", "title": "Assess: Questionnaire", "color": "#579bfc",
      "tasks": [
        {
          "id": "1", "name": "Document Business Goals",
          "status": "Pending Customer", "status_color": "#fdbc64",
          "timeline": { "from": "2026-10-10", "to": "2026-10-15" },
          "milestone": false,
          "tags": ["Onboarding"],
          "subtasks": [ /* same fields as a task, minus nesting */ ]
        }
      ]
    }
  ]
}
```

**`_shape_task` rules (important, learned the hard way)**

- **Status**: first column of type `status` (Monday also calls it `color`). `status` = `label` (fall back to `text`);
  `status_color` = `label_style.color`.
- **Timeline**: only columns of type `timeline` (or `timerange`) fill `timeline` = `{from, to}`. An **empty timeline stays
  `null`** (Monday shows "-"). Do **not** substitute a separate Date column when a Timeline column exists (an item with
  an empty Timeline but a stray Date would otherwise look dated and be mistaken for a milestone). Only if the item has no
  Timeline column at all may a plain `date` column be used.
- **Milestone**: Monday's diamond. It is a Timeline column set to display as a milestone. Read the column's `value`
  (a JSON string such as `{"from":"2026-10-15","to":"2026-10-15","visualization_type":"milestone"}`) and set
  `milestone = true` only when `visualization_type == "milestone"`. **Never guess milestones from single-day dates**;
  an earlier attempt did and mislabelled normal tasks.
- **Tags**: the Tags column's type is **`tag`** (singular; also accept `tags`). Use the column's `text` (comma-separated
  names, shown in Monday as `#Onboarding`); strip whitespace and a leading `#`. Put the names in `tags`.

### 2.4 `GET /api/monday/project/activity?customer=NAME&days=30`

Returns the board's comment updates and status changes. Response:

```json
{
  "board": { "id": "123", "name": "Eversource" },
  "days": 30,
  "updates": [
    {
      "id": "u1", "body": "<p>html body</p>", "created_at": "2026-10-07T10:55:00Z",
      "item_id": "5", "_item_name": "Manually edit asset_info", "_board": { "id": "123", "name": "Eversource" },
      "creator": { "id": "1", "name": "David Page", "email": "..." },
      "replies": [ { "id": "r1", "body": "<p>...</p>", "created_at": "...", "creator": { "name": "..." } } ]
    }
  ],
  "status_changes": [
    {
      "id": "a1", "timestamp": "2026-10-09T08:53:20+00:00", "item_id": "5", "item_name": "Task",
      "board": { "id": "123", "name": "Eversource" }, "column": "Status",
      "from_status": "TODO", "to_status": "Done", "user": "Sam"
    }
  ]
}
```

**Updates** come from the board:

```graphql
query GetBoardUpdates($boardId: [ID!]!, $limit: Int!) {
  boards(ids: $boardId) {
    updates(limit: $limit) {
      id
      body
      created_at
      item_id
      creator { id name email }
      replies { id body created_at creator { id name email } }
    }
  }
}
```

- Board-level `updates` has **no server-side date filter**, so fetch `limit: 100` and drop anything older than `days`
  client-side (compare `created_at`).
- `_item_name` is looked up from `item_id` with `ITEM_NAMES_QUERY`:

```graphql
query GetItemNames($ids: [ID!]!) {
  items(ids: $ids, limit: 100) {
    id
    name
    board { id name }
  }
}
```

  Gotcha: `items(ids)` returns **25 results by default**, so always pass `limit: 100` and batch at most 50 ids. If a
  batch query fails, retry the ids one by one so one bad id can't blank the others. A missing name displays as "—".

**Status changes** come from each board's Activity log:

```graphql
query GetActivityLogs($boardId: [ID!]!, $from: ISO8601DateTime!, $to: ISO8601DateTime!, $limit: Int!, $page: Int!) {
  boards(ids: $boardId) {
    id
    name
    activity_logs(from: $from, to: $to, limit: $limit, page: $page) {
      id
      event
      data
      created_at
      user_id
    }
  }
}
```

with `from`/`to` as ISO8601 timestamps for the last `days` days (page through while a page returns the full 100;
cap at ~5 pages). Keep only entries where `event == "update_column_value"` and the parsed `data` JSON has
`column_type` of `color` or `status`.

Parse `data` (a JSON string):

| Output | Source |
|---|---|
| `item_id` / `item_name` | `data.pulse_id` / `data.pulse_name` |
| `column` | `data.column_title` (default "Status") |
| `from_status` | `data.previous_value.label.text` |
| `to_status` | `data.value.label.text` |
| `user` | `user_id` mapped through the `USERS_QUERY` name list |
| `timestamp` | `created_at` (see below) |

```graphql
query GetUsers { users { id name } }
```

**Timestamp gotcha**: Activity-log `created_at` is a 17-digit Unix time in tenths of microseconds
(e.g. `17600000000000000`). Divide by `1e7` to get seconds. (Treat values `<= 1e14` as already seconds.)

A board whose activity log can't be read is skipped (log a warning), not fatal.

### 2.5 The page: customer step and data loading

State: `customer` (text), `project`, `loading`, `error`, `activity`, `loadingA`, `errorA`.

1. A text input (placeholder "Customer name") and a **Load** button inside a `<form>`; Load is disabled while loading or empty.
2. On submit: clear `error` and `activity`, call `GET /api/monday/project?customer=<encoded>`.
   - Success: store `project`, then **separately** call `GET /api/monday/project/activity?customer=<encoded>&days=30`
     (not awaited, so the first sections appear immediately and the timeline shows its own "Loading...").
   - Failure: show the error text (`detail` from the JSON body, else `status statusText`).
3. Header title: `project.board.name`, or "Monday Project" before loading.
4. Until a project is loaded, show a hint ("Enter a customer name to load their Monday project board."). **The four
   sections must not render before a customer is loaded.**
5. After load, render in this order:

```jsx
<OnboardingChecklist groups={project.groups} />
<SuccessRoadmap groups={project.groups} />
{activity?.updates?.length > 0 && <RecentUpdates updates={activity.updates} />}
<WeeklyActivityTimeline
  updates={activity?.updates} changes={activity?.status_changes}
  loading={loadingA} error={errorA} onRetry={() => loadActivity(customer.trim())}
  title="Activity Timeline (30 days) · By Week"
  emptyText="No updates or status changes on this board in the last 30 days." />
```

Layout: single centered column, `max-width: 900px`, 14px gap, 18px side padding.

### 2.6 Shared logic

**`statusGroups.js`**: folds raw Monday statuses into filter groups.

| Raw status (case-insensitive) | Group | Colour |
|---|---|---|
| `Done`, `Deferred` | `Done/Deferred` | green `#00c875` |
| `TODO`, `To Do` | `ToDo` | grey `#797e93` |
| starts with `Pending Nucleus` | `Pending Nucleus` | default blue `#579bfc` |
| `Pending Customer` | `Pending Customer` | yellow `#f5c542` |
| anything else | its own name | default blue |

Fixed chip order: `ToDo`, `Pending Customer`, `Pending Nucleus`, `Done/Deferred` (then any other statuses found, alphabetical).
Exports `GREEN`, `DECISION_COLOR` (black `#000000`), `STATUS_ORDER`, `statusGroup`, `statusColor`, `orderedStatusGroups(counts)`.

**`ActivityTimeline.jsx` helpers**

- `htmlToText(html)`: `<br>`, `</p>`, `</li>` become newlines, other tags are stripped, HTML entities decoded (`&amp;` becomes `&`) by assigning the
  stripped text to a detached `<textarea>`'s `innerHTML` and reading `.value`; empty result becomes `"(empty)"`.
- `commentSubtype(text)`: `"decision"` if the text matches `/#decision\b/i`, else `"comment"`.
- `flattenComments(updates)`: returns flat entries for every update **and every reply** (replies inherit the parent's `_item_name`):
  `{ key, time, item, who, text, isReply, subtype }`.
- `buildEvents(updates, changes)`: merges comments (`kind: "update"`, with `subtype`) and status changes
  (`kind: "status"`, `status` = `to_status`, `text` = `"FROM → TO"`) into one list, oldest first. Reply authors are shown as `"Name · reply"`.
- `formatDate(iso)`: short local date+time (`Oct 7, 10:55 AM`). `firstWords(text, 8)`: first 8 words plus `…`.
- `useScrollToEnd(ref, dep)`: effect that sets `ref.current.scrollLeft = scrollWidth` whenever `dep` changes.

**Colours used across sections**: Comments pink `#f6287e`; Decisions black `#000` with a light outline (1px white at ~45-70%
alpha) so they stay visible on dark backgrounds; Done/Deferred green `#00c875`. Decisions and Done must remain visually distinct.

### 2.7 Component: `OnboardingChecklist({ groups })`

A card titled **Onboarding Checklist** with a count badge (number of onboarding cards). Reuses `atl-card`, `atl-header`,
`atl-scroll`, `wk-timeline`, `wk-col`, `wk-node`, `wk-label`, `wk-stack`, `wk-card` classes from the shared CSS.

Rules:
- **Columns = the board's groups**, left to right in board order. A horizontal line runs through a node per column; the
  **group title** (in the group's colour, wraps to 2 lines) is above the node.
- **Cards** are tasks whose `tags` include `Onboarding` (case-insensitive) and that are not milestones. **Subtasks of a tagged
  task come along** and are shown when the card is opened.
- **Milestones**: tasks with `milestone: true` (any group, **tagged or not**). They sit directly under the node, above the cards, as small
  rows with a diamond, name and date.
- **Node colour**: green (`#00c875`) when the group has milestones and *all* are Done (status `done`, case-insensitive); otherwise grey `#8b8ba7`. The
  node's colour reflects all of the group's milestones even while a filter hides some of them.
- Only groups that have at least one milestone or card get a column. If nothing is tagged: "No items tagged #Onboarding on this board."
- **Cards**: top border + dot in the task's own Monday `status_color`; show date (`Oct 10 - 15`, or `Oct 15` for one day, `No date`), the name
  (2 lines), status pill, and a subtask count badge. **Click** (or Enter/Space) toggles expanded: full name and the subtask list with their status pills.
- **5 cards visible per column, then the column scrolls vertically**; the whole row also scrolls horizontally. (Fixed card height 104px,
  `max-height: 5 * 104 + 4 * 8` px on the stack.)
- **Filter chips** (above the board): `ToDo`, `Pending Customer`, `Pending Nucleus`, `Done/Deferred` (+ others present), each with a count of
  cards + milestones. Clicking a chip hides/shows items with that status group (cards and milestones). All on by default.

### 2.8 Component: `SuccessRoadmap({ groups })`

A section titled **Success Roadmap** (small uppercase heading, no card) with two white-outlined filter chips, **Done** and **Open**, each with a count, then one accordion per group.

- **Done = status exactly `Done` (case-insensitive). Everything else, including Deferred, is Open.** (Unlike the other sections, which merge Done/Deferred.)
- Chips toggle visibility of Done / Open tasks (both on by default). Top-level tasks are filtered; their subtasks stay attached.
- **Group accordion** (collapsed by default): left border + title in the group colour, caret, and a badge `done/total` computed from *all* the group's tasks
  (not the filtered ones). Open: rows of `name | subtask-count badge | status pill | timeline pill`. A task with subtasks is itself expandable; subtasks
  appear indented below. Empty group: "No tasks in this group."; all filtered out: "No tasks match the filter."
- Status pill: Monday `status_color` background, white text. Timeline pill: `Oct 10 - 15` / `Oct 31 - Nov 04` / `Nov 13`; `—` when empty.
- On narrow screens (<= 600px) hide the timeline pill.

### 2.9 Component: `RecentUpdates({ updates })`

A card titled **Recent Updates** with two filter chips:
- **Comments** (pink `#f6287e`), **Decisions** (black with outline). Each shows a count (of all entries, not just visible), clicking hides/shows that subtype.
- Entries = `flattenComments(updates)`: updates **and replies**, newest first, **after filtering, take the first 10**.
- Each entry: bold task name (+ a black "Decision" badge for decisions), `Author · date` on the right (replies read `Author · reply · date`), then the text
  (`white-space: pre-wrap`). Replies are indented with a pink left bar.
- If everything is filtered out: "Everything is filtered out."

### 2.10 Component: `WeeklyActivityTimeline({ updates, changes, loading, error, errorChanges, onRetry, title, emptyText })`

A card with a count badge and a refresh button (`onRetry`), states for loading / error, then a **two-column filter area** and the timeline.

**Filters (2 columns)**
- Column 1: white-outlined **Updates** chip (turns all updates off/on), and under it **Comments** (pink) and **Decisions** (black) chips with counts.
  The sub-chips are disabled while Updates is off.
- Column 2: white-outlined **Status Changes** chip (all status changes off/on), and under it one chip per status group (see 2.6 for order/colours) with counts, wrapping
  onto new rows only when width runs out. Sub-chips disabled while Status Changes is off. Chips are click-to-hide toggles; off = grey outline + hollow dot.
- If every event is filtered out: "Everything is filtered out. Click a filter above to show it again."

**Timeline**
- Events = `buildEvents(...)`, grouped into **calendar weeks starting Monday**, oldest week on the left, newest on the right. Weeks between the first and last event
  are all shown (empty ones say "No activity").
- Each week is a column: label `Sep 14 – Sep 20`, a node on the horizontal line, then that week's events **stacked vertically** (oldest on top) as cards.
- **Cards**: top border + dot coloured by type: Comment pink; Decision black; Status change by the *new* status group colour. Contents: dot, timestamp, a "Decision" badge if applicable, task name,
  text (comments show the first 8 words; status changes `FROM → TO`), author (`Name · reply` for replies).
  **5 cards visible per column then vertical scroll**, plus horizontal scroll across weeks. Fixed card height 104px; text clamped to 2 lines.
- **Click** (or Enter/Space) a card to expand it to the full text.
- **Scroll position**: on load and when filters change, scroll horizontally to the far right so the newest week/today is visible (`useScrollToEnd`).

### 2.11 Verification checklist

1. `GET /api/monday/project?customer=<name>` returns 8-ish groups with tasks; tasks have `tags`, `milestone`, `status_color`; unknown customer returns 404 with a message.
2. `GET /api/monday/project/activity?customer=<name>` returns `updates` (with `replies` and `_item_name` filled, not "—") and `status_changes`.
3. Page: nothing but the textbox before Load; after Load all four sections appear, updates/timeline fill in a moment later.
4. Onboarding: only `#Onboarding`-tagged cards; milestones under nodes; node turns green when all the group's milestones are Done; status chips filter.
5. Success Roadmap: Deferred is counted under Open.
6. Recent Updates: replies appear as their own entries; `#decision` items get the black badge; filters work.
7. Timeline: weekly columns, replies present, Decisions black vs Done green distinct, scrolled to the right on open, click expands a card.
8. Layout usable at 400px wide.

Test the frontend without a Monday token by intercepting the two endpoints with mock JSON in the shapes above (e.g. Playwright `page.route`).

### 2.12 Known assumptions and debugging

- `#Onboarding` is a **Tags column** (type `tag`); the component matches the tag name "Onboarding". If your board stores it differently, adapt `hasTag` in `OnboardingChecklist.jsx`
  and the `tag` branch of `_shape_task`.
- Milestones rely on the Timeline column's `visualization_type == "milestone"`. To inspect what Monday returns for an item, use
  `GET /api/monday/project/raw-items?customer=<name>&name=<part of item name>` (raw `column_values` including `value`).
- Customer lookup is by **board name**. If boards aren't named after customers, change `find_board_by_customer`.
- Monday personal tokens are secrets: set `MONDAY_API_TOKEN` as a server environment variable only.
