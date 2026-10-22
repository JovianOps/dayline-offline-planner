# Dayline

**A calmer picture of your week.** Dayline is a private, offline planner that puts scheduled time beside the focus sessions you choose to track. It does not monitor your apps, screen, or keyboard, and it never sends your data anywhere.

## Start

1. Download or copy this folder to your computer.
2. Open `index.html` in a modern browser. No server, account, install, or internet connection is required.
3. Import a calendar `.ics` file or task `.csv`, then review the preview before adding anything.
4. Track a focus session with the timer, or add one manually.
5. Use the week controls to view a different week's totals.

Keep `index.html`, `styles.css`, `core.js`, and `app.js` together. Dayline uses browser storage on that device and browser profile. Clearing browser data or switching browsers can remove your local data, so download a backup periodically.

## Imports

Calendar import accepts `.ics` files with single-instance events, UTC or floating times, IANA `TZID` values, and all-day dates. Recurring events and unsupported or malformed records are listed as skipped in the preview. Recurrence expansion is not supported yet.

Task import accepts UTF-8 CSV with a header row. The `title` column is required; other columns are optional:

```csv
title,due_date,estimate_minutes,status,completed_date
Prepare release,2026-10-25,60,todo,
Read,2026-10-20,30,done,2026-10-19
```

Dates use `YYYY-MM-DD`; status is `todo` or `done`. A completed task without `completed_date` remains visible as a completion with unknown date and is not assigned to a week.

Both importers show accepted records and issues before changing local data. Import does not contact the calendar or task provider.

## Weekly recap and privacy

The weekly view separates scheduled calendar minutes from focus time you explicitly recorded. It also shows dated and undated task completions, scheduled time without focus overlap, and estimates when that comparison is available. Scheduled time is not proof of attendance; tracked focus is not a productivity score.

**Export shareable recap** creates a self-contained HTML file with aggregate weekly totals. It omits event titles, task titles, notes, attendees, locations, and imported records. Open the file locally or share it as you choose.

**Download my data** creates a JSON backup with your imported titles and local records. Treat it as private. **Restore backup** validates the file and asks before replacing the current data. Backups can include an active timer start time.

Dayline does not collect SSH keys, passwords, browsing history, documents, or credentials. It has no network requests, remote fonts, analytics, or third-party scripts.

## Limitations

- Data is stored in local browser storage, not synchronized between devices.
- Calendar recurrence is skipped and reported.
- CSV import has a deliberately small supported schema; provider-specific task fields are ignored.
- The shareable recap is intentionally aggregate-only. Review your backup before moving or sharing it because it includes private titles.

## Development

Requires Node.js 20 or newer for the built-in test runner. There are no runtime dependencies.

```sh
npm test
node --check core.js
node --check app.js
```
