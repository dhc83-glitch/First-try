# Personal Task Auditor

A local app being developed into a repeatable personal assistant. It reads Notion directly, audits task data, and proposes a plan. Optional Gmail connections supply an email review queue. There are no CSV uploads, external AI calls, analytics, or automatic Notion edits. Requires **Node.js 24.5 or later**; there are no packages to install. See [PROJECT_GOAL.md](PROJECT_GOAL.md) for the intended outcome, operating rules, and remaining work. This version does not yet replace the user's complete morning assistant.

## One-button refresh

The Refresh button now starts a server-owned catch-up job and returns immediately. It continues through bounded Gmail batches without additional clicks. You may close the browser tab; keep the app's Terminal process running and the Mac awake. Reopening the page shows the current job. **Stop after this batch** stops safely at a batch boundary. A server restart does not restart network work unattended; click Refresh once to resume the saved cursors. While catch-up runs, Notion write/review endpoints are blocked so an in-progress read cannot overwrite approved changes or review decisions. Email bodies are displayed lazily in groups of 50 to keep large queues usable.

Inbox pagination now has durable per-account page cursors and pending-message IDs, rather than a 2,000-message ceiling. A batch reads up to four listing pages and 40 new message bodies per account; the job continues automatically while progress is possible. Finished or paused accounts are not repeatedly scanned during the same job. Rate limits or other source failures pause the affected account without discarding its records; a new click retries paused work. A new Refresh after completion inventories the current inbox again, reusing cached bodies. Gmail paging is not an atomic snapshot: newly arriving or moving messages may require the next refresh. This version still does not use Gmail incremental history, archived mail, or attachments.

Click **Refresh my assistant**. On the first run it locates the original **Central Tasks** data source and remembers its ID; later runs reuse it. A configured `NOTION_DATABASE_ID` can select that original source instead. The Central Tasks profile verifies column types and fails visibly when required fields change. Other databases remain available through the advanced manual mapping workflow.

Each refresh checks Central Tasks and each connected Gmail account independently. It reports checked, failed, not-connected, or incomplete sources. A failed Notion read does not erase the last successful comparison baseline. A missing inbox is never treated as empty. Overall complete means configured required reads finished, not that the app understands every message or has applied any changes. An external calendar connection is optional and not implemented; schedule occupancy is based on Central Tasks only.

The refresh compares additions and content changes with the prior successful read. Records that disappear are reported as no longer returned; they may have been deleted, moved, or become inaccessible. Nothing is deleted on that basis. Gmail items remain in the review queue until you choose **No task needed** or approve task creation. This review choice is local; it does not change Gmail.

The proposed seven-day work plan respects recorded fixed commitments, your date constraints, and a conservative 9:30 AM–10 PM New York work window. Waiting, unconfirmed, contradictory, oversized, or impossible-to-fit tasks are returned for a decision. It assumes 60 minutes without an effort estimate, does not split tasks, and does not account for unrecorded travel, meals, breaks, external calendar events, or email commitments not yet added to Notion. Treat it as a draft.

Approved suggestions update **Start**, **Finish by**, **Do date**, and **On calendar** together, preserving actual deadlines and fixed commitments. The app rereads the task before writing, invalidates the remaining suggestions after a write attempt, and reads back the result. A network-ambiguous write is marked for verification and is not automatically retried. Notion has no atomic compare-and-swap, so concurrent outside edits remain a limitation.

The `.local/assistant.json` record stores private task/email data, comparisons, review decisions, and the last 30 refreshes/50 operations with owner-only file permissions. `.local/` is ignored by Git. Keep it private and back it up securely if needed; do not commit it. Atomic file replacement protects against partial files; malformed data stops the refresh rather than silently resetting memory. Run only one server process against a store. This is local single-user persistence, not a multi-process database or tamper-proof audit log.

## Gmail setup (one time)

The app cannot inherit Gmail connections from ChatGPT. It uses Google's official OAuth sign-in and **gmail.readonly** permission. It never sends, deletes, archives, or marks emails as read.

1. On [Google Cloud Console](https://console.cloud.google.com/), select/create a project for this app.
2. In **APIs & Services → Library**, enable **Gmail API**.
3. In **Google Auth Platform** (or **OAuth consent screen**), configure the app's name and audience. For a personal testing app, add the three Gmail addresses as test users. School/workspace administrators may need to permit the app.
4. In **Clients** (or **Credentials → Create credentials → OAuth client ID**), create a **Desktop app** OAuth client. Desktop clients support a loopback redirect with PKCE. Do not use an API key or a service account.
5. Supply `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` privately in the server environment (or the ignored local `.env` on your computer). Do not paste client secrets into chat. Restart the server.
6. Run the app on your own computer and open it at `http://127.0.0.1:3000`. Expand **Connect your three Gmail accounts**, click **Connect Gmail** for each slot, and sign in to the intended account. Google returns to the same local app after consent. A cloud-onboarding loopback callback is not reachable from your browser; local installation is required for this version's sign-in flow.

Gmail OAuth is implemented and covered by mocks; live sign-in still requires these credentials and consent. Google testing-mode grants can expire after seven days for these scopes. Personal production use may require publishing/verifying the Google OAuth app; this local prototype does not complete Google verification. See [Google's installed-app OAuth documentation](https://developers.google.com/identity/protocols/oauth2/native-app).

OAuth refresh tokens are retained only in `.local/google/assistant.json` with owner-only permissions. They are not encrypted at rest, so protect the local machine/directory and don't share, commit, or publish snapshots containing this file. Revoke access through [Google account connections](https://myaccount.google.com/connections) to disconnect. Never print these files. Gmail tokens are separate from your Notion token.

Each refresh reads current **INBOX** messages, including read messages, following all pages through resumable batches. Archived/sent mail, spam/trash, and attachments are not scanned. Incomplete or paused scans are reported explicitly. Plain text is shown as data; HTML-only messages are marked as missing plain text. Bodies above 10,000 characters are marked shortened. Follow up in Gmail when full context or attachments matter. Message IDs cache immutable contents; this version does not implement incremental Gmail history synchronization.

Gmail reads share one paced queue across all three inboxes (at least 300 milliseconds between request starts). Google 403 rate-limit errors, HTTP 429, and server errors trigger bounded exponential backoff; Retry-After is honored. Ordinary permission errors are not retried as quota errors. Progress is checkpointed after each listing page, every 10 new reads, and at scan completion/interruption. Large first loads may take a long time, but the job advances without repeated clicks. A quota pause is not an expired connection; don't reconnect solely for rateLimitExceeded. Listing failures may retain stale email records, explicitly marked incomplete. These protections reduce avoidable requests; they cannot override Google quotas.

Emails are grouped by inbox area; List-Unsubscribe identifies newsletters. There is **no AI message interpretation** or automatic deadline extraction. Every item needs human review. You may approve a new task after editing its title and actual deadline. The Gmail account/message source key is stored in Notion's Source field and checked before creation to prevent repeat imports. Existing task updates, semantic matching, and retiring outdated tasks are future work. No email body is executed as an instruction.

## 1. Connect Notion

1. In Notion, create an internal integration for your workspace. Give it **Read content** permission. Enable **Update content** for approved schedule changes and **Insert content** for approved new tasks from email.
2. Open the task database in Notion and add your integration under **Connections**. Workspace membership alone does not grant the integration access to every page or database. Share only the databases you want it to access.
3. For a local computer, copy `.env.example` to `.env` and set `NOTION_TOKEN` to your integration token using your editor. `.env` is ignored by Git. Never put a token in browser code, a URL, a screenshot, or chat. In Codex cloud, supply `NOTION_TOKEN` securely in environment settings instead; no `.env` file is required there.
4. Optionally set `NOTION_DATABASE_ID` to prefill the database selector. Otherwise use **Find shared databases**, or paste a database URL/ID in the app. Choose just one database/data source for each audit. Ordinary pages are not task databases; a page containing a database needs that database shared with the integration.

The API version is pinned to `2025-09-03`, which distinguishes databases from their data sources. Databases with multiple data sources are selected through **Find shared databases**. The finder also checks accessible page-parent metadata to recover databases omitted by Notion's data-source search; it does not read page bodies. All query/search result pages are fetched. Linked views on dashboards are not original databases: open the original database from the view and share it with the integration if it is missing. HTTP 429 responses are retried with a bounded delay. Node's environment proxy support is enabled for cloud proxy-backed credentials.

## 2. Run locally

```sh
cd /path/to/First-try
npm start
```

On your own computer, open `http://127.0.0.1:3000` in your browser. The server binds only to loopback. Set `PORT` to choose another port. In cloud onboarding, the server can be tested with local HTTP requests; this workflow does not supply a public preview.

Click **Load columns**, check each mapping, then **Read live tasks & audit**. The app requires a title, status, and scheduled date property. Due date, category, priority, and notes can remain unmapped, but their values and relevant checks will then be unavailable. Notes means a rich-text database property; page-body blocks are not read in this version. Formula, rollup, and relation-based fields are not supported.

## 3. Understand the audit

- **Overdue:** an active task has a due timestamp before now, or a date-only due date before today in America/New_York. Today’s date-only tasks are not overdue yet.
- **Completed but scheduled:** a completed task still has a future schedule start. Configure completed status labels to match your database. Completed and inactive tasks are excluded from active conflict and duplicate checks.
- **Possible duplicate:** active titles match after punctuation/case normalization, or share at least 75% of their unique words (with at least three words in each title). This is a heuristic, not a semantic AI judgment; review before changing anything.
- **Blocked time:** any active scheduled interval overlaps Monday–Friday, 6:00–9:30 AM in New York. Daylight saving time is handled automatically.
- **Late discretionary work:** a task in one of your configurable discretionary categories overlaps 10:00 PM–midnight. The defaults are Personal, Optional, and Discretionary. Category matching is case insensitive; multi-select categories are supported. Adjust these labels to your database.
- **Overlap:** two active scheduled intervals intersect. Touching endpoints do not count. A start without an end is assumed to last 60 minutes, configurable in preferences.
- **Missing time / invalid schedule:** date-only schedules cannot support time conflict checks and are explicitly flagged. Invalid interval ends are also flagged.

Audit preferences and column mappings live in the current browser page; they are not saved across reloads. Click the audit button again to fetch current tasks. There is no background polling.

## 4. Choose each change

Each issue has **Review schedule change** and a link back to Notion when available. The dialog displays the current schedule and proposed change. You may clear the schedule or replace it with explicit ISO timestamps including timezone offsets, such as `2026-10-23T14:00:00-04:00`. New York uses `-04:00` during daylight saving time and `-05:00` during standard time.

Only **Confirm update in Notion** sends a write. Canceling performs no write. The server checks the task's last edit timestamp before patching and rejects changes if the task changed since the audit. Notion does not offer an atomic compare-and-swap here, so a small concurrent-edit race remains. Only the mapped schedule property is modified. Refreshing after an update fetches live data again. Duplicate deletion/merging and edits to status, notes, or other fields should be reviewed directly in Notion in this first version.

The advanced manual audit keeps its edit snapshot in memory. The assistant refresh persists records and Gmail authorization separately under the ignored `.local/` directory, as described above. The app uses a same-origin request token and rejects non-local Host headers. This is a local single-user app, not a multi-user hosted service.

## How the pieces fit together

```text
Browser dashboard → local Node server → Notion API
                           ↓
                     pure audit rules
                           ↓
Browser shows issues ← task data + findings
```

- `server.js` serves the app, validates requests, keeps the token server-side, and gates writes on confirmation.
- `notion.js` sends authenticated HTTPS API requests, follows pagination, discovers databases, and normalizes properties.
- `audit.js` is independent of Notion. It receives tasks and returns issues without modifying them.
- `public/` contains the dashboard HTML, CSS, and browser JavaScript. Dynamic Notion text is rendered as text rather than HTML.
- `test/` exercises the rules and server with a mocked Notion service. No credentials are required and no real Notion writes occur during tests.

Codex is the coding agent that built and tests these files. The running app itself is ordinary JavaScript: the API reads/writes data, and deterministic rules produce the findings. There is no autonomous agent scheduling or editing your tasks.

## Validate and troubleshoot

```sh
npm test
```

These tests validate the local workflow against mock API responses. They do **not** establish that your workspace credentials, schema, or permissions work. A live check requires configuring the token, sharing a database, loading its columns, and successfully auditing its tasks. Writes should be tested only after you review an intended change in the app.

- **401:** verify the configured integration token securely and restart the server.
- **403 or 404:** check integration capabilities and database Connections. In cloud, also allow `api.notion.com` in environment network settings.
- **Empty database search:** share the actual database with the integration; ordinary workspace pages are not returned by the data-source filter.
- **Wrong/missing flags:** check property mappings, completed/inactive status labels, discretionary category labels, timezone, and default duration.

Cloud setup saves reusable startup instructions separately from the running process. Review/save the environment draft and publish through environment settings when you want to reuse the prepared environment. Publishing and a fresh-task restore are separate from current-instance validation.
