import test from "node:test";
import assert from "node:assert/strict";
import "../core.js";
const { buildWeekSummary, createShareableHtml, eventOccursOnLocalDay, exportBackup, localDateForValue, parseIcsCalendar, parseTaskCsv, validateBackup } = globalThis.DaylineCore ?? {};

test("core API attaches a browser global for direct offline launch", () => {
  assert.equal(typeof globalThis.DaylineCore?.parseTaskCsv, "function");
});

test("CSV import keeps quoted titles and reports invalid rows", () => {
  const csv = [
    "title,due_date,estimate_minutes,status,completed_date",
    '"Ship, small",2026-10-22,45,done,2026-10-21',
    "Broken,not-a-date,-4,maybe,"
  ].join("\n");

  const result = parseTaskCsv(csv);

  assert.equal(result.tasks.length, 1);
  assert.equal(result.tasks[0].title, "Ship, small");
  assert.equal(result.tasks[0].estimateMinutes, 45);
  assert.equal(result.tasks[0].completedAt, "2026-10-21");
  assert.equal(result.issues.length, 1);
  assert.equal(result.issues[0].row, 3);
});

test("ICS import reads UTC, IANA TZID, and all-day events and skips recurrence", () => {
  const ics = [
    "BEGIN:VCALENDAR",
    "BEGIN:VEVENT",
    "UID:utc-1",
    "SUMMARY:Planning",
    "DTSTART:20261022T080000Z",
    "DTEND:20261022T090000Z",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:zone-1",
    "SUMMARY:Bangkok sync",
    "DTSTART;TZID=Asia/Bangkok:20261022T080000",
    "DTEND;TZID=Asia/Bangkok:20261022T083000",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:all-day-1",
    "SUMMARY:Day off",
    "DTSTART;VALUE=DATE:20261023",
    "DTEND;VALUE=DATE:20261024",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:recurring-1",
    "SUMMARY:Daily standup",
    "DTSTART:20261022T090000Z",
    "DTEND:20261022T091500Z",
    "RRULE:FREQ=DAILY",
    "END:VEVENT",
    "END:VCALENDAR"
  ].join("\r\n");

  const result = parseIcsCalendar(ics, "Asia/Bangkok");

  assert.equal(result.events.length, 3);
  assert.equal(result.events[0].start, "2026-10-22T08:00:00.000Z");
  assert.equal(result.events[1].start, "2026-10-22T01:00:00.000Z");
  assert.equal(result.events[2].allDay, true);
  assert.match(result.issues[0].message, /recurr/i);
});

test("ICS import reports and skips duplicate event UIDs", () => {
  const ics = [
    "BEGIN:VCALENDAR",
    "BEGIN:VEVENT", "UID:same", "SUMMARY:First", "DTSTART:20261022T080000Z", "DTEND:20261022T090000Z", "END:VEVENT",
    "BEGIN:VEVENT", "UID:same", "SUMMARY:Duplicate", "DTSTART:20261022T100000Z", "DTEND:20261022T110000Z", "END:VEVENT",
    "END:VCALENDAR"
  ].join("\r\n");
  const result = parseIcsCalendar(ics, "UTC");

  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].title, "First");
  assert.match(result.issues[0].message, /duplicate/i);
});

test("date-only completions retain their written day and overnight events appear on each intersecting day", () => {
  assert.equal(localDateForValue("2026-10-22", "America/Los_Angeles"), "2026-10-22");
  assert.equal(localDateForValue("2026-10-22T06:30:00.000Z", "America/Los_Angeles"), "2026-10-21");
  const overnight = { allDay: false, start: "2026-10-22T23:00:00.000Z", end: "2026-10-23T01:00:00.000Z" };
  assert.equal(eventOccursOnLocalDay(overnight, "2026-10-23", "UTC"), true);
  assert.equal(eventOccursOnLocalDay(overnight, "2026-10-24", "UTC"), false);
  const springForwardDay = globalThis.DaylineCore.localDayBounds("2026-03-08", "America/New_York");
  assert.equal((springForwardDay.end - springForwardDay.start) / 3_600_000, 23);
  const midnightTransitionDay = globalThis.DaylineCore.localDayBounds("2018-11-04", "America/Sao_Paulo");
  assert.equal((midnightTransitionDay.end - midnightTransitionDay.start) / 3_600_000, 23);
});

test("week summary clips crossing sessions and events and separates undated completions", () => {
  const summary = buildWeekSummary({
    events: [
      { title: "Monday meeting", start: "2026-10-19T02:00:00.000Z", end: "2026-10-19T03:00:00.000Z", allDay: false },
      { title: "Sunday to Monday", start: "2026-10-18T16:30:00.000Z", end: "2026-10-18T17:30:00.000Z", allDay: false },
      { title: "Day off", start: "2026-10-22T00:00:00.000Z", end: "2026-10-23T00:00:00.000Z", allDay: true }
    ],
    sessions: [
      { start: "2026-10-19T06:00:00.000Z", end: "2026-10-19T06:45:00.000Z" },
      { start: "2026-10-18T16:30:00.000Z", end: "2026-10-18T17:30:00.000Z" }
    ],
    tasks: [
      { status: "done", completedAt: "2026-10-20", estimateMinutes: 30 },
      { status: "done", completedAt: "2026-10-18", estimateMinutes: 60 },
      { status: "done", completedAt: null, estimateMinutes: 15 }
    ]
  }, "2026-10-19", "Asia/Bangkok");

  assert.equal(summary.meetingMinutes, 90);
  assert.equal(summary.focusMinutes, 75);
  assert.equal(summary.completedTasks, 1);
  assert.equal(summary.undatedCompletions, 1);
});

test("week summary handles a DST transition and clips the local week boundary", () => {
  const summary = buildWeekSummary({
    events: [{ start: "2026-03-08T03:30:00.000Z", end: "2026-03-08T04:30:00.000Z", allDay: false }],
    sessions: [{ start: "2026-03-09T03:30:00.000Z", end: "2026-03-09T04:30:00.000Z" }],
    tasks: []
  }, "2026-03-02", "America/New_York");

  assert.equal(summary.meetingMinutes, 60);
  assert.equal(summary.focusMinutes, 30);
});

test("marking a task done records its date and reopening clears it", async () => {
  const core = globalThis.DaylineCore;
  assert.equal(typeof core.setTaskStatus, "function");

  const done = core.setTaskStatus({ status: "todo", completedAt: null }, "done", "2026-10-22");
  assert.deepEqual(done, { status: "done", completedAt: "2026-10-22" });
  assert.deepEqual(core.setTaskStatus(done, "todo", "2026-10-23"), { status: "todo", completedAt: null });
});

test("shareable report contains aggregate figures without private record titles", () => {
  const html = createShareableHtml({
    weekLabel: "Oct 19–25, 2026",
    meetingMinutes: 90,
    focusMinutes: 75,
    completedTasks: 1,
    undatedCompletions: 1,
    untrackedMinutes: 0,
    estimatedTasks: null
  });

  assert.match(html, /1\.5 h/);
  assert.match(html, /1\.3 h/);
  assert.doesNotMatch(html, /<script|https?:\/\//i);
  assert.doesNotMatch(html, /Planning|Bangkok sync|Day off/);
});

test("backup validation returns a normalized copy and rejects malformed data", () => {
  const state = {
    version: 1,
    events: [{ id: "e1", title: "Private meeting", start: "2026-10-22T08:00:00.000Z", end: "2026-10-22T09:00:00.000Z", allDay: false, timeZone: "Asia/Bangkok" }],
    tasks: [],
    sessions: [],
    activeTimer: null,
    preferences: { timeZone: "Asia/Bangkok" }
  };
  const source = { format: "dayline-backup", version: 1, exportedAt: "2026-10-22T00:00:00.000Z", state };
  const restored = validateBackup(source);

  assert.deepEqual(restored, state);
  assert.notEqual(restored, state);
  assert.notEqual(restored.events, state.events);
  assert.throws(() => validateBackup({ ...source, version: 99 }), /version/i);
  assert.throws(() => validateBackup({ ...source, state: { ...state, tasks: "not an array" } }), /tasks/i);
  assert.throws(() => validateBackup({ ...source, state: { ...state, preferences: { timeZone: "Invalid/Zone" } } }), /time zone/i);
});

test("backup export is a versioned JSON Blob that can be restored", async () => {
  const state = { version: 1, events: [], tasks: [], sessions: [], activeTimer: null, preferences: { timeZone: "UTC" } };
  const blob = exportBackup(state, "2026-10-22T00:00:00.000Z");
  const document = JSON.parse(await blob.text());

  assert.equal(blob.type, "application/json");
  assert.equal(document.format, "dayline-backup");
  assert.equal(document.version, 1);
  assert.deepEqual(validateBackup(document), state);
});

test("share report safely escapes labels and contains aggregate summary values only", () => {
  const html = createShareableHtml({
    weekLabel: '<img src=x onerror="alert(1)">',
    meetingMinutes: 30,
    focusMinutes: 0,
    completedTasks: 0,
    undatedCompletions: 0,
    untrackedMinutes: 30,
    estimatedTasks: { estimatedMinutes: 15, trackedMinutes: 0 },
    events: [{ title: "private event" }],
    tasks: [{ title: "private task" }]
  });

  assert.doesNotMatch(html, /<img|private event|private task|<script|https?:\/\//i);
  assert.match(html, /&lt;img/);
  assert.match(html, /0\.5 h/);
});
