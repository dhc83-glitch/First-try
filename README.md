# Personal Task Auditor

A local app being developed into a repeatable personal assistant. It reads Notion directly, audits task data, and proposes a plan. Optional Gmail connections supply an email review queue. Refresh now makes supported routine Notion edits under the user’s updated authorization. There are no CSV uploads, external AI calls, or analytics. Requires **Node.js 24.5 or later**; there are no packages to install. See [PROJECT_GOAL.md](PROJECT_GOAL.md) for the intended outcome, operating rules, and remaining work. This version does not yet replace the user's complete morning assistant.

## One-button refresh

Email reading now defaults to the **last 14 days of current-INBOX messages**, not the entire mailbox history. The dashboard lets you choose 7, 14, or 30 days while catch-up is stopped. Gmail receives an absolute received-time cutoff, held fixed across the batches of one scan. Changing the window discards the old listing cursor and starts a scoped inventory; older cached emails are excluded from the active review queue. A resumed scan more than a day old starts a fresh inventory with recent cached bodies retained. No email is deleted or archived in Gmail. All current Central Tasks are still fetched independently of the email window, including tasks created long ago with upcoming deadlines. New tasks mentioned only in older email will not be discovered by this window.

Changing this local setting does not perform a Notion write. Stop the active job first, save the window, and click Refresh. Previously saved decisions, task records, and Gmail connections are preserved. Email history that is no longer in the active window may be pruned from the local message cache; it is not deleted from Gmail.

### Automatic routine updates and new information

The user changed the original per-edit approval rule: **Refresh now writes supported routine updates to Notion automatically.** The browser states this before the button is clicked. Loading the dashboard, the advanced audit, `/api/assistant/refresh`, and Notion-only reloads remain read-only. Only the server-owned Refresh job applies this policy after its inbox batches finish (or pause).

Refresh expires narrow, fully past class/lecture/soccer-pickup/game reminders and past fixed exam/quiz events as Canceled (not proof of attendance or a grade), reapplies verified remembered decisions, consolidates matching daily internship reminders, processes saved explicit updates, and rebuilds supported Home planning sections from the updated records. It aligns an already-checked Done checkbox with an active Status, and corrects narrow stale weekday/score-capture titles. It never interprets an overdue assignment, quiz, exam, grade check, application, or payment as completed from its date. Reminder closure does not assert attendance. No tasks are deleted; Due date and Commitment time remain as history. Active-only Notion views hide closed records; unfiltered views retain them.

Use **Tell your assistant something new** to save information before the next Refresh. Supported examples:

- `Completed "exact task title": result or reason`
- `Cancel "exact task title": reason`
- `Add: new task title`

This is a conservative parser, not general language understanding. A reported numeric grade/result can resolve a uniquely matching task. Questions, future intentions, negations, and ambiguous matches become saved exceptions. Exact quoted names are preferable. Later queued decisions for the same task supersede earlier queued ones. Additions use a persistent source key and title checks to prevent repeat creation. Personal decisions stay in ignored `.local` storage; none are hard-coded into public code. Information supplied in ChatGPT is **not automatically transferred** to this local app.

The daily internship goal uses one existing master page. Refresh cancels active duplicate template records, preserves completed-today state, and reopens the same master on the next New York day. It does not create another page each day or reconstruct missed days. Explicit cancellation stops that master. Separate missed-work and company-specific application tasks are excluded. It is a narrowly supported routine, not a universal recurring-task engine.

Every write saves intent, checks for intervening edits, and reads back the result. Uncertain writes remain exceptions and are not retried automatically. Home changes replace supported paragraphs and table rows across Do this next, this week’s priority, execution order, the seven-day schedule, open follow-ups, school results, reading, and weekend decisions. Every replacement retains its original content privately. Historical reference layouts, synced content, child pages, database views, and their filters are preserved. The API cannot edit Notion view filters. Saved sports listings are labeled as old snapshots rather than falsely refreshed. Newsletter snippets may use the collected inbox data, but no invented summaries or fixtures are generated. A Home “Your updates” or “Remembered decisions” callout can contain explicit user facts in “Topic — canceled/completed/known result. Details” form; those facts reconcile separate narrative references. These are user-controlled Notion records, not instructions taken from emails. No private facts are embedded in source code. The writes are not an atomic transaction; verified earlier changes remain when a later stage fails. Notion has no atomic compare-and-swap, so concurrent external edits still carry a race. Advanced review dialogs remain available for exceptions, but routine automation does not require them.

**Email interpretation remains unfinished.** Collecting recent messages does not determine which commitments they contain. While unreconciled messages remain, work-time proposals stay suggestions. The targeted sent/reply evidence path can complete supported follow-ups before Home is rebuilt, but it does not classify every collected message. The current conditional scheduling path only applies when all required source reads are complete and no unresolved update or email decisions remain. Existing future times are retained. The UI and Home summary state this limitation; the user should not be asked to review thousands of messages as the intended final workflow.

The Refresh button now starts a server-owned catch-up job and returns immediately. It continues through bounded Gmail batches without additional clicks. You may close the browser tab; keep the app's Terminal process running and the Mac awake. Reopening the page shows the current job. **Stop after this batch** stops safely at a batch boundary. A server restart does not restart network work unattended; click Refresh once to resume the saved cursors. While catch-up runs, Notion write/review endpoints are blocked so an in-progress read cannot overwrite approved changes or review decisions. Email bodies are displayed lazily in groups of 50 to keep large queues usable.

Inbox pagination now has durable per-account page cursors and pending-message IDs, rather than a 2,000-message ceiling. A batch reads up to four listing pages and 40 new message bodies per account; the job continues automatically while progress is possible. Finished or paused accounts are not repeatedly scanned during the same job. Rate limits or other source failures pause the affected account without discarding its records; a new click retries paused work. A new Refresh after completion inventories the current inbox again, reusing cached bodies. Gmail paging is not an atomic snapshot: newly arriving or moving messages may require the next refresh. The main inventory does not use Gmail incremental history or scan archived mail/attachments; targeted follow-up checks can inspect archived and Sent conversation context.

Click **Refresh my assistant**. On the first run it locates the original **Central Tasks** data source and remembers its ID; later runs reuse it. A configured `NOTION_DATABASE_ID` can select that original source instead. The Central Tasks profile verifies column types and fails visibly when required fields change. Other databases remain available through the advanced manual mapping workflow.

Each refresh checks Central Tasks and each connected Gmail account independently. It reports checked, failed, not-connected, or incomplete sources. A failed Notion read does not erase the last successful comparison baseline. A missing inbox is never treated as empty. Overall complete means required reads finished. The separate automatic-update results report verified writes and exceptions; it does not mean every email has been understood. Notion Calendar entries backed by Central Tasks are included. Google Calendar events shown in Notion Calendar and dates from other databases are not included; the app does not connect to calendar.notion.com as a separate calendar API.

The refresh compares additions and content changes with the prior successful read. Records that disappear are reported as no longer returned; they may have been deleted, moved, or become inaccessible. Nothing is deleted on that basis. Gmail items remain in the review queue until you choose **No task needed** or approve task creation. This review choice is local; it does not change Gmail.

The proposed seven-day work plan respects recorded fixed commitments, your date constraints, and a conservative 9:30 AM–10 PM New York work window. Waiting, unconfirmed, contradictory, oversized, or impossible-to-fit tasks are returned for a decision. It assumes 60 minutes without an effort estimate, does not split tasks, and does not account for unrecorded travel, meals, breaks, external calendar events, or email commitments not yet added to Notion. Treat it as a draft.

Approved suggestions update **Start**, **Finish by**, **Do date**, and **On calendar** together, preserving actual deadlines and fixed commitments. The app rereads the task before writing, invalidates the remaining suggestions after a write attempt, and reads back the result. A network-ambiguous write is marked for verification and is not automatically retried. Notion has no atomic compare-and-swap, so concurrent outside edits remain a limitation.

The `.local/assistant.json` record stores private task/email data, comparisons, review decisions, and the last 30 reads and 50 recent operations (plus older unverified operations) with owner-only file permissions. `.local/` is ignored by Git. Keep it private and back it up securely if needed; do not commit it. Atomic file replacement protects against partial files; malformed data stops the refresh rather than silently resetting memory. Run only one server process against a store. This is local single-user persistence, not a multi-process database or tamper-proof audit log.

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

Each refresh reads current **INBOX** messages, including read messages, following all pages through resumable batches. The main inventory excludes archived/sent mail, spam/trash, and attachments. Targeted follow-up checks separately search recent mail across folders (including Sent/archived), then read complete matching conversations; older messages can be included as context in those selected threads. Incomplete or paused scans are reported explicitly. Plain text is shown as data; HTML-only messages are marked as missing plain text. Bodies above 10,000 characters are marked shortened. Follow up in Gmail when full context or attachments matter. Message IDs cache immutable contents; this version does not implement incremental Gmail history synchronization.

Gmail reads share one paced queue across all three inboxes (at least 300 milliseconds between request starts). Google 403 rate-limit errors, HTTP 429, and server errors trigger bounded exponential backoff; Retry-After is honored. Ordinary permission errors are not retried as quota errors. Progress is checkpointed after each listing page, every 10 new reads, and at scan completion/interruption. Large first loads may take a long time, but the job advances without repeated clicks. A quota pause is not an expired connection; don't reconnect solely for rateLimitExceeded. Listing failures may retain stale email records, explicitly marked incomplete. These protections reduce avoidable requests; they cannot override Google quotas.

Emails are grouped by inbox area; List-Unsubscribe identifies newsletters. There is **no AI message interpretation** or automatic deadline extraction. The current manual email controls are an optional interim path; automatic contextual email triage is still unfinished. You may approve a new task after editing its title and actual deadline. The Gmail account/message source key is stored in Notion's Source field and checked before creation to prevent repeat imports. General email-to-task creation, changed-deadline extraction, semantic matching, and broad evidence reconciliation remain unfinished. Supported reply/attendance-confirmation tasks now use a narrow evidence path: a genuine SENT message from the connected account, an affirmative authored response, and a later positive direct acknowledgement from a recipient in the same thread. Quoted text, drafts, invitations alone, incomplete bodies, negation/cancellation, later conflicting requests, unrelated senders, and ambiguous task matches cannot close a task. Read-only searches cover up to 12 task candidates and 24 unique threads per account per refresh; truncated searches/failures are reported. The exact sent/reply identifiers and evidence excerpts are saved privately. Completing a confirmation never completes the future event itself. This deterministic rule set is deliberately limited and has not been live-verified against the Mac’s Gmail accounts. Explicit saved decisions and narrow reminder cleanup already run automatically. No email body is executed as an instruction. Notion API requests also share a paced queue in live use to avoid bursts while refreshing many Home blocks; each Home write records its pending block and verified progress.

## 1. Connect Notion

1. In Notion, create an internal integration for your workspace. Give it **Read content** permission. Enable **Update content** for approved schedule changes and **Insert content** for approved new tasks from email.
2. Open the task database in Notion and add your integration under **Connections**. Workspace membership alone does not grant the integration access to every page or database. Share only the databases you want it to access.
3. For a local computer, copy `.env.example` to `.env` and set `NOTION_TOKEN` to your integration token using your editor. `.env` is ignored by Git. Never put a token in browser code, a URL, a screenshot, or chat. In Codex cloud, supply `NOTION_TOKEN` securely in environment settings instead; no `.env` file is required there.
4. Optionally set `NOTION_DATABASE_ID` to prefill the database selector. Otherwise use **Find shared databases**, or paste a database URL/ID in the app. Choose just one database/data source for each audit. Ordinary pages are not task databases; a page containing a database needs that database shared with the integration.

The API version is pinned to `2025-09-03`, which distinguishes databases from their data sources. Databases with multiple data sources are selected through **Find shared databases**. The finder also checks accessible page-parent metadata to recover databases omitted by Notion's data-source search; it does not read page bodies. All query/search result pages are fetched. Linked views on dashboards are not original databases: open the original database from the view and share it with the integration if it is missing. HTTP 429 responses are retried with a bounded delay. Read-only requests (including POST search and data-source queries) retry temporary network timeouts and server failures up to three attempts, with 15-second attempt timeouts. Writes use 30-second timeouts and are never replayed after an ambiguous timeout or server failure. Source reads finishing does not mark the full job successful when automatic updates have exceptions; it reports needs attention. Node's environment proxy support is enabled for cloud proxy-backed credentials.

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

- `server.js` serves the app, validates requests, keeps the token server-side, and enforces local request protection and separates read endpoints, automatic Refresh policy, and advanced confirmed edits.
- `notion.js` sends authenticated HTTPS API requests, follows pagination, discovers databases, and normalizes properties.
- `audit.js` is independent of Notion. It receives tasks and returns issues without modifying them.
- `public/` contains the dashboard HTML, CSS, and browser JavaScript. Dynamic Notion text is rendered as text rather than HTML.
- `test/` exercises the rules and server with a mocked Notion service. No credentials are required and no real Notion writes occur during tests.

Codex is the coding agent that built and tests these files. The running app itself is ordinary JavaScript: the API reads/writes data, and deterministic rules produce the findings. The Refresh job applies deterministic automatic policies; there is no general AI agent interpreting your messages.

## Validate and troubleshoot

```sh
npm test
```

These tests validate the local workflow against mock API responses. They do **not** establish that your workspace credentials, schema, or permissions work. A live check requires configuring the token, sharing a database, loading its columns, and successfully auditing its tasks. Development readiness checks use read-only endpoints. The main Refresh button now writes automatically; do not run it against a real workspace merely to smoke-test setup.

- **401:** verify the configured integration token securely and restart the server.
- **403 or 404:** check integration capabilities and database Connections. In cloud, also allow `api.notion.com` in environment network settings.
- **Empty database search:** share the actual database with the integration; ordinary workspace pages are not returned by the data-source filter.
- **Wrong/missing flags:** check property mappings, completed/inactive status labels, discretionary category labels, timezone, and default duration.

Cloud setup saves reusable startup instructions separately from the running process. Review/save the environment draft and publish through environment settings when you want to reuse the prepared environment. Publishing and a fresh-task restore are separate from current-instance validation.
