# Refresh integration audit — findings before the 1.1 repair

Scope: the published organizer/Home-planner source currently checked out in this workspace. This is a code audit and mocked reproduction, not inspection of the Mac's running process or private `.local` records. No application behavior was changed by this audit.

## Root cause

The application has no single reconciled planning snapshot consumed by all outputs. Refresh orchestrates task reads, inbox collection, a limited policy engine, repeated task rereads, and selected Notion block rewrites. The browser, Notion prose, Notion database views, and local organizer remain separate projections with different rules and ownership.

## Confirmed findings

1. **Different priority engines.** `public/planning.js:dailyPriorities` favors due-today work before category priority and checks conflicts/capacity. `daily-planner.js:planDailyPlanner` and `home-content.js:planHomeContent` independently favor priority first. A mocked identical input put a Normal task due today first in the browser and an undated High task first in Notion.
2. **Corrections are not a unified event stream.** The app's `saveUpdate` reads explicit local-form submissions, not ChatGPT conversations. Home facts are collected and applied to prose after eligible tasks are selected; they are not reconciled into the task array passed to the separate daily planner. A mocked Home completion fact left the same task in the next-actions list. A correction needs to reach the shared task record, not only a narrative paragraph.
3. **Internal rereads overwrite outer-run evidence.** `applyAutomatic` invokes `refresh({taskOnly:true})` repeatedly. Every invocation replaces `latest`, advances `baseline`, and appends history. A mocked new task was reported as added by the outer read and disappeared from the changes list on the internal reread. At the end the code reinstates earlier source coverage/status onto the later report, mixing read generations without per-source timestamps.
4. **Notion publishes one block at a time.** `approveHome` writes and verifies sequentially, with date/header changes potentially preceding weekly rows. A simulated later write failure left a new date alongside old later content. The operation correctly records uncertainty and blocks automatic retry, but the visible page has no all-or-nothing publish or per-section generation indicator. This is a possible explanation for the observed mixed week, not proof of which Mac request failed.
5. **Many sections are outside the refresh contract.** Sports code preserves and relabels old listings; there is no sports-fetching stage. Other source databases (groceries, subscriptions, contacts, application tracker), external calendars, and archived child pages are not generally reconciled. Native Notion views are independent of the block renderer; its public-API integration does not manage their filters. The previous direct repair used a separate connector to change the calendar view.
6. **Local organizer is deliberately separate.** `organizer.js` stores local items/history/completions. `Assistant.refresh` builds the task plan from Central Tasks only; `previewHome` receives the task report, not organizer items. Local completion cannot update an equivalent Notion task without a shared identity and explicit synchronization policy. This was a feature integration gap in the organizer batch.
7. **Collection is not interpretation.** The email queue plus narrow correspondence proofs do not perform general semantic reconciliation of changed deadlines, completion, task identity, or obsolete obligations. An old High task remains eligible until its record changes. Old planning dates alone cannot justify completion or cancellation.
8. **Tests validate components, not cross-output agreement.** Existing tests cover individual renderers and guarded writes. They do not enforce common priority ordering, correction propagation across all outputs, complete source coverage, or a coherent generation after partial publication. The four diagnostic reproductions demonstrate these missing invariants; they are not fixes or a passing acceptance test for the intended assistant.

## Required repair, in dependency order

- Define ownership and identity: stable task IDs, supported sources, linked organizer records, and a durable correction ledger with provenance.
- Reconcile corrections and verified source evidence before deriving plans. Ambiguous matches stay unresolved; unrelated tasks must not be canceled merely because dates are old.
- Give each user Refresh one run ID, a comparison baseline retained across internal reads, per-source read timestamps/statuses, and one final reconciled snapshot.
- Derive browser priorities, Notion next actions, execution order, deadline lists, and schedule rows from shared selectors over that snapshot. Date-only commitments and intended work dates must remain distinct from actual deadlines.
- Define a publication/verification contract for every managed section. Publish the overall date/freshness marker after section verification; partial or stale outputs need visible section status and an explicit recovery path, without blindly replaying uncertain writes.
- Add real source adapters for sports and other supported domains; list missing adapters on the Refresh page instead of implying coverage. View-filter management needs the supported connector or separate setup, not unsupported public-API calls.
- Add acceptance tests that start with source changes and follow a complete Refresh through every output, including corrections, rollover, provider failure, interrupted publication, and repeat runs without duplicates.

This audit establishes why the features diverge. It does not claim the architectural repair is implemented, installed, or live-tested.

Implementation follow-up: the README section “Unified Refresh and browser updates (1.1)” documents the repaired boundaries, supported adapters, tests, and remaining limitations. The findings above describe the pre-repair audit, not the current implementation.
