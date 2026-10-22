# What this app is for

The user's goal is a dependable personal assistant with one Refresh button, replacing repeated morning ChatGPT prompts. It should check three Gmail inboxes (personal, school, professional), reconcile new and outdated information against Notion, show deadlines and a realistic schedule, and keep an understandable record of what happened. A task auditor alone does not satisfy this goal.

Explain progress and required user actions in everyday language, one step at a time, naming the website and controls. Do independent work before asking the user to troubleshoot. Never ask them to paste secrets in chat. Current Notion access has been verified against Central Tasks; do not ask them to recreate it without a new diagnosis.

## Current operating rules

- Notion writes need explicit approval for each change. The user has not authorized unattended additions, edits, archival, or deletion.
- Timezone: America/New_York, including daylight saving time.
- Monday–Friday 6:00–9:30 AM is protected. Fixed commitments, such as exams, should be reviewed as possible exceptions rather than moved automatically.
- Avoid discretionary work after 10 PM. Current suggestions use a conservative 9:30 AM–10 PM window for all work.
- Central Tasks has multiple date columns: actual Due date, intended Do date, Start/Finish by, Commitment time, and On calendar. Distinguish planning windows from deadlines. Check all supplied times and surface disagreements.
- ChatGPT Gmail connections do not supply this app with OAuth credentials. The app needs its own Google authorization for each account.

## Implemented and tested with fixtures

- Direct, paginated Notion access; recovery of sources omitted by search.
- Persistent refresh comparisons, source coverage, operation history, and guarded single-process writes.
- Multi-date task normalization, audit issues, next-seven-day deadlines, and provisional work-time suggestions.
- Gmail read-only OAuth/PKCE and three inbox slots, full current-INBOX pagination up to an explicit 2,000-message cap, reuse of previously read message bodies, and a review queue. The cap is a limitation, not successful full coverage.
- User-approved email-to-task creation with a persistent Gmail source key, duplicate check, and verification. No automatic semantic interpretation, deadline guessing, or email changes.
- User-approved schedule suggestions write Start, Finish by, Do date, and On calendar together, then read back the result.

## Remaining before it can replace the morning assistant

1. The user completed Google Desktop app setup on their Mac and connected all three accounts. A live full scan then failed in each inbox with Google HTTP 403 rateLimitExceeded. A shared paced request queue, bounded backoff, 40-new-message batches, and durable progress checkpoints have been implemented and fixture-tested; the updated reader still needs live validation on the Mac. Do not ask the user to recreate their OAuth client or reconnect accounts solely for rate-limit errors. Cloud runtime does not inherit the Mac's Google credentials or token files.
2. Define and implement contextual email triage and reconciliation: which items are actionable, which existing task each message changes, how updated deadlines supersede old ones, and what counts as evidence to retire a task. Current newsletter/account labeling and manual review are not this decision engine.
3. Add evidence-backed update/archive proposals, user-approved dispositions, and reversible corrections. Missing records or absent emails must never imply deletion. Existing code does not retire outdated Notion tasks.
4. Add durable incremental Gmail history/backfill for inboxes above the cap, optional attachment handling, appropriate source coverage, and long-run/end-to-end acceptance tests.
5. Decide how the user will run/access it routinely. The present app is local-only; a cloud onboarding process is not an accessible hosted deployment. Do not claim the user has a working click-to-refresh app on their own machine until installation/access is verified.
6. Validate a representative morning refresh with the user: new task, updated task, completed task, changed deadline, failed inbox, conflicts, and repeated refresh without duplicates. An AI classifier, if added, must treat email bodies as untrusted data, cite evidence, and leave uncertain decisions for review.

Never promise “without fault.” Make failures visible, keep reliable state, test concrete failure cases, and distinguish implemented, fixture-tested, live-tested, and planned capabilities.
