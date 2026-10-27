# What this app is for

The user's goal is a dependable personal assistant with one Refresh button, replacing repeated morning ChatGPT prompts. It should check three Gmail inboxes (personal, school, professional), reconcile new and outdated information against Notion, show deadlines and a realistic schedule, and keep an understandable record of what happened. A task auditor alone does not satisfy this goal.

Explain progress and required user actions in everyday language, one step at a time, naming the website and controls. Do independent work before asking the user to troubleshoot. Never ask them to paste secrets in chat. Current Notion access has been verified against Central Tasks; do not ask them to recreate it without a new diagnosis.

## Current operating rules

- Updated user authorization: one Refresh should apply routine Notion updates automatically, with new information provided separately. Earlier individual approval requirements are superseded for supported routine policy. Do not delete records or silently retry uncertain writes. Report exceptions rather than asking for routine approvals.
- Timezone: America/New_York, including daylight saving time.
- Monday–Friday 6:00–9:30 AM is protected. Fixed commitments, such as exams, should be reviewed as possible exceptions rather than moved automatically.
- Avoid discretionary work after 10 PM. Current suggestions use a conservative 9:30 AM–10 PM window for all work.
- The user does not need old mailbox history. Default to the last 14 days of current-inbox email, with 7/14/30-day choices. Still read all current Notion tasks. The user stopped the long full-history scan; do not restart that scan when installing the next update.
- Central Tasks has multiple date columns: actual Due date, intended Do date, Start/Finish by, Commitment time, and On calendar. Distinguish planning windows from deadlines. Check all supplied times and surface disagreements.
- ChatGPT Gmail connections do not supply this app with OAuth credentials. The app needs its own Google authorization for each account.

## Implemented and tested with fixtures

- Bills/subscriptions/renewals discovery view groups active matching tasks by actual deadline (today/overdue, next 30 New York dates, undated, later), shows next actions, and offers an editable capture shortcut. No bank connection or inferred payment status; recurring local reminders are now implemented separately in the personal organizer.

- Saved-data daily briefing shows due/overdue deadlines, today’s recorded schedule, and Waiting tasks; searchable task lookup includes active and closed records. New York date/search fixtures and mocked Chromium checks pass. The user reports the earlier dashboard working on the Mac; installation of the subsequent organizer batch remains unverified. The full HTTP suite passes with local test ports enabled.

- Direct, paginated Notion access; recovery of sources omitted by search.
- Persistent refresh comparisons, source coverage, operation history, and guarded single-process writes.
- Multi-date task normalization, audit issues, next-seven-day deadlines, and provisional work-time suggestions.
- Gmail read-only OAuth/PKCE and three inbox slots, durable pagination without the former 2,000-message cap, cached message bodies, and a review queue. Current inbox only; attachments and archived mail remain outside coverage.
- User-approved email-to-task creation with a persistent Gmail source key, duplicate check, and verification. No automatic semantic interpretation, deadline guessing, or email changes.
- User-approved schedule suggestions write Start, Finish by, Do date, and On calendar together, then read back the result.
- Cleanup review distinguishes past events/exams from unresolved assignments; approved completion/cancellation stores a decision, optional result note, and verified Notion state. No private user-specific cancellation facts are hard-coded in source.
- Refresh consolidates the exact daily internship template into one master, preserves completion today, and reuses that page the next New York day. This is not a universal recurring-routine engine.
- Refresh now rebuilds supported Home paragraphs and table rows from the updated Central Tasks snapshot: priorities, execution order, weekly schedule, open follow-ups, results, reading, and weekend decisions. Explicit user facts in a Home updates callout reconcile separate narrative references. Archived layouts, child pages/databases and view filters stay intact; missing outside sources are reported.
- Targeted Gmail searches include Sent/archived context for reply/confirmation tasks. Only unambiguous SENT-plus-direct-acknowledgement evidence closes a task; the future event stays active. Private evidence identifiers/excerpts support inspection. General email classification and deadline reconciliation are still unfinished.
- Central Tasks dates shown in calendar.notion.com are already included; Google calendars and other databases displayed there are outside coverage.
- Refresh processes explicit saved local updates, reapplies remembered decisions, and closes narrow past event reminders. Ambiguous notes and uncertain writes are durable exceptions. Questions/negations/future plans do not authorize closing tasks.
- Automatic work-time application is deferred while collected emails remain unreconciled. Raw-read coverage is not semantic completeness.

## Approved ten-feature improvement batch

The user reports that the earlier dashboard update is installed on the Mac and Refresh looks better. The following ten-feature batch is a subsequent development update, not a verified Mac installation.

Implemented together: weekly review; a bounded daily priority list; local follow-up tracking; local daily/weekly/monthly/yearly reminders; appointment-preparation checklists; location-grouped errands; structured queued Notion capture; a concise refresh digest; guarded verified task restoration and latest local organizer undo; mobile/accessibility improvements and session-preserved views. Local organizer records remain separate from Notion. Reminder notifications, automated outreach, bank payments, and calendar bookings are not implemented. Existing general email interpretation work remains unfinished.

Validation includes recurrence/date boundaries, request idempotency, stale organizer revisions, structured Notion field verification, priority capacity, evidence-based completion summaries, and restore safety/uncertainty. Local Chromium checks exercise capture, draft/search preservation, recurrence, preparation checklists, errands, follow-ups, both restore flows, preference restoration, and a 390-pixel layout against mocked sources. The prior Node test crashes were caused by sandbox denial of local listening ports; the full suite passes when local test ports are enabled. No live Notion writes or Mac installation were performed for this batch.

## Remaining before it can replace the morning assistant

1. The user completed Google Desktop app setup on their Mac and connected all three accounts. The shared paced queue resolved the observed Google rate-limit failures; screenshots showed catch-up above 3,000 messages. The user has now stopped that scan because they do not need history that far back. Install the scoped recent-email update along with cleanup. Do not reconnect accounts solely for an old disconnected placeholder or rate-limit errors. Cloud runtime does not inherit the Mac's Google credentials or token files.
2. Define and implement contextual email triage and reconciliation: which items are actionable, which existing task each message changes, how updated deadlines supersede old ones, and what counts as evidence to retire a task. Current newsletter/account labeling and manual review are not this decision engine.
3. Validate the new automatic cleanup, saved-update input, reusable daily master, and rebuilt Home sections on the Mac using the code updater. Mocked tests establish automatic behavior. A live repair updated and verified 41 Home blocks/rows across the current planning sections; a fresh renderer pass found zero remaining managed differences. Related reported confirmations/cancellations were reconciled in source records, with originals and verified progress saved privately. The Mac’s Gmail-driven confirmation checker has not been verified against live Gmail. Other source integrations and view-filter control remain incomplete. Contextual email-to-existing-task updates, broader semantic matching, subscription-state reconciliation, and convenient rollback remain unfinished. Missing records or absent emails must never imply deletion. The app can now apply explicit locally saved decisions, but does not automatically know what was told to ChatGPT.
4. Automatic background catch-up and durable pagination beyond 2,000 messages are implemented and fixture-tested. Validate this update on the Mac with the user's already-connected accounts. Gmail incremental history, optional attachment handling, and long-run acceptance tests remain future work.
5. Decide how the user will run/access it routinely. The present app is local-only; a cloud onboarding process is not an accessible hosted deployment. Do not claim the user has a working click-to-refresh app on their own machine until installation/access is verified.
6. Validate a representative morning refresh with the user: new task, updated task, completed task, changed deadline, failed inbox, conflicts, and repeated refresh without duplicates. An AI classifier, if added, must treat email bodies as untrusted data, cite evidence, and leave uncertain decisions for review.

Never promise “without fault.” Make failures visible, keep reliable state, test concrete failure cases, and distinguish implemented, fixture-tested, live-tested, and planned capabilities.


## Daily planner layout update

Refresh can now install and maintain a compact briefing in the dated Home callout: next three actionable tasks, today’s commitments and deadlines, and toggles for actual weekly deadlines, waiting work, decisions, and source details. Existing detailed sections and historical layouts are preserved. The installer records intent, verifies created blocks, reuses them on repeat refresh, and blocks uncertain installs rather than creating duplicates. This redesign is fixture-tested; Mac installation and visual verification remain pending. It does not add general email interpretation or new source integrations.


## Refresh integration and updater repair

Implemented shared action selectors, Home corrections before planning and verified reconciliation, one-run comparisons across internal reads/inbox batches, source timestamps, local organizer planning and optional task-ID completion links, a sports fixture adapter, freshness markers written last, and explicit interrupted-publication inspection. Added a supervised updater with staged hashed downloads, backups, restart, automatic startup rollback and an optional manual rollback. A one-time Mac double-click bootstrap installer enables future browser updates; no typed Terminal commands are needed for that flow. These changes do not complete general email interpretation, external-calendar integration or provider verification. See README for installation, trust and coverage boundaries. Mac installation is not remotely verified.
