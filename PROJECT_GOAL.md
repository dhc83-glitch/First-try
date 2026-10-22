# What this app is for

The user's goal is a dependable personal assistant with one Refresh button, replacing repeated morning ChatGPT prompts. It should check three Gmail inboxes (personal, school, professional), reconcile new and outdated information against Notion, show deadlines and a realistic schedule, and keep an understandable record of what happened. A task auditor alone does not satisfy this goal.

Explain progress and required user actions in everyday language, one step at a time, naming the website and controls. Do independent work before asking the user to troubleshoot. Never ask them to paste secrets in chat. Current Notion access has been verified against Central Tasks; do not ask them to recreate it without a new diagnosis.

## Current operating rules

- Notion writes need explicit approval for each change. The user has not authorized unattended additions, edits, archival, or deletion.
- Timezone: America/New_York, including daylight saving time.
- Monday–Friday 6:00–9:30 AM is protected. Fixed commitments, such as exams, should be reviewed as possible exceptions rather than moved automatically.
- Avoid discretionary work after 10 PM. Current suggestions use a conservative 9:30 AM–10 PM window for all work.
- The user does not need old mailbox history. Default to the last 14 days of current-inbox email, with 7/14/30-day choices. Still read all current Notion tasks. The user stopped the long full-history scan; do not restart that scan when installing the next update.
- Central Tasks has multiple date columns: actual Due date, intended Do date, Start/Finish by, Commitment time, and On calendar. Distinguish planning windows from deadlines. Check all supplied times and surface disagreements.
- ChatGPT Gmail connections do not supply this app with OAuth credentials. The app needs its own Google authorization for each account.

## Implemented and tested with fixtures

- Direct, paginated Notion access; recovery of sources omitted by search.
- Persistent refresh comparisons, source coverage, operation history, and guarded single-process writes.
- Multi-date task normalization, audit issues, next-seven-day deadlines, and provisional work-time suggestions.
- Gmail read-only OAuth/PKCE and three inbox slots, durable pagination without the former 2,000-message cap, cached message bodies, and a review queue. Current inbox only; attachments and archived mail remain outside coverage.
- User-approved email-to-task creation with a persistent Gmail source key, duplicate check, and verification. No automatic semantic interpretation, deadline guessing, or email changes.
- User-approved schedule suggestions write Start, Finish by, Do date, and On calendar together, then read back the result.
- Cleanup review distinguishes past events/exams from unresolved assignments; approved completion/cancellation stores a decision, optional result note, and verified Notion state. No private user-specific cancellation facts are hard-coded in source.
- Daily internship-goal repeats are grouped for a reviewed keeper/cancellation batch. This is not yet a full recurring-routine engine.
- A reviewed Home update replaces only its dated callout and summary paragraph, with stale checks and verification.

## Remaining before it can replace the morning assistant

1. The user completed Google Desktop app setup on their Mac and connected all three accounts. The shared paced queue resolved the observed Google rate-limit failures; screenshots showed catch-up above 3,000 messages. The user has now stopped that scan because they do not need history that far back. Install the scoped recent-email update along with cleanup. Do not reconnect accounts solely for an old disconnected placeholder or rate-limit errors. Cloud runtime does not inherit the Mac's Google credentials or token files.
2. Define and implement contextual email triage and reconciliation: which items are actionable, which existing task each message changes, how updated deadlines supersede old ones, and what counts as evidence to retire a task. Current newsletter/account labeling and manual review are not this decision engine.
3. Validate the new user-approved cleanup and two-block Home summary update on the Mac after catch-up finishes. Contextual email-to-existing-task updates, broader semantic matching, subscription-state reconciliation, and convenient rollback remain unfinished. Missing records or absent emails must never imply deletion. The app can now close approved tasks, but does not automatically know what was told to ChatGPT.
4. Automatic background catch-up and durable pagination beyond 2,000 messages are implemented and fixture-tested. Validate this update on the Mac with the user's already-connected accounts. Gmail incremental history, optional attachment handling, and long-run acceptance tests remain future work.
5. Decide how the user will run/access it routinely. The present app is local-only; a cloud onboarding process is not an accessible hosted deployment. Do not claim the user has a working click-to-refresh app on their own machine until installation/access is verified.
6. Validate a representative morning refresh with the user: new task, updated task, completed task, changed deadline, failed inbox, conflicts, and repeated refresh without duplicates. An AI classifier, if added, must treat email bodies as untrusted data, cite evidence, and leave uncertain decisions for review.

Never promise “without fault.” Make failures visible, keep reliable state, test concrete failure cases, and distinguish implemented, fixture-tested, live-tested, and planned capabilities.
