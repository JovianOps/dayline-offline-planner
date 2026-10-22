(function attachDaylineCore(root) {
const DAY_MS = 24 * 60 * 60 * 1000;

function validDateOnly(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? "")) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function dateParts(date) {
  const [year, month, day] = date.split("-").map(Number);
  return { year, month, day };
}

function addDateDays(value, days) {
  const { year, month, day } = dateParts(value);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function isValidTimeZone(timeZone) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(0);
    return true;
  } catch {
    return false;
  }
}

function partsInTimeZone(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  return Object.fromEntries(parts.filter((part) => part.type !== "literal").map(({ type, value }) => [type, Number(value)]));
}

function localDateTimeToUtc(year, month, day, hour, minute, second, timeZone) {
  if (!isValidTimeZone(timeZone)) throw new Error(`Unsupported time zone: ${timeZone}`);

  const desired = { year, month, day, hour, minute, second };
  const desiredAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  let candidate = desiredAsUtc;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const local = partsInTimeZone(new Date(candidate), timeZone);
    const observedAsUtc = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second);
    const adjusted = desiredAsUtc - (observedAsUtc - candidate);
    if (adjusted === candidate) break;
    candidate = adjusted;
  }

  const actual = partsInTimeZone(new Date(candidate), timeZone);
  if (Object.keys(desired).some((key) => actual[key] !== desired[key])) {
    throw new Error(`Local time does not exist in ${timeZone}`);
  }
  return new Date(candidate).toISOString();
}

function localDateOf(instant, timeZone) {
  const parts = partsInTimeZone(new Date(instant), timeZone);
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function localDateForValue(value, timeZone) {
  if (validDateOnly(value)) return value;
  if (!Number.isFinite(Date.parse(value))) throw new Error("Invalid date value");
  return localDateOf(value, timeZone);
}

function localDayBounds(date, timeZone) {
  if (!validDateOnly(date)) throw new Error("Invalid local date");
  const { year, month, day } = dateParts(date);
  const next = dateParts(addDateDays(date, 1));
  return {
    start: firstInstantOfLocalDate(date, timeZone),
    end: firstInstantOfLocalDate(`${String(next.year).padStart(4, "0")}-${String(next.month).padStart(2, "0")}-${String(next.day).padStart(2, "0")}`, timeZone)
  };
}

function firstInstantOfLocalDate(date, timeZone) {
  const { year, month, day } = dateParts(date);
  try {
    return Date.parse(localDateTimeToUtc(year, month, day, 0, 0, 0, timeZone));
  } catch (error) {
    if (!isValidTimeZone(timeZone)) throw error;
  }
  for (let minute = 1; minute < 24 * 60; minute += 1) {
    const hour = Math.floor(minute / 60);
    const minuteOfHour = minute % 60;
    try {
      return Date.parse(localDateTimeToUtc(year, month, day, hour, minuteOfHour, 0, timeZone));
    } catch {
      // The local clock may skip the beginning of this date.
    }
  }
  const nextDate = addDateDays(date, 1);
  return firstInstantOfLocalDate(nextDate, timeZone);
}

function eventOccursOnLocalDay(event, date, timeZone) {
  if (event.allDay) return event.start <= date && event.end > date;
  const bounds = localDayBounds(date, timeZone);
  const start = Date.parse(event.start);
  const end = Date.parse(event.end);
  return Number.isFinite(start) && Number.isFinite(end) && start < bounds.end && end > bounds.start;
}

function parseIcsDate(value, params, fallbackTimeZone) {
  if (params.VALUE?.toUpperCase() === "DATE" || /^\d{8}$/.test(value)) {
    const date = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
    if (!validDateOnly(date)) throw new Error("Invalid all-day date");
    return { value: date, allDay: true };
  }

  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/.exec(value);
  if (!match) throw new Error("Unsupported date-time format");
  const [, y, m, d, h, min, sec = "00", utc] = match;
  const parts = [y, m, d, h, min, sec].map(Number);
  const [year, month, day, hour, minute, second] = parts;
  if (hour > 23 || minute > 59 || second > 59 || !validDateOnly(`${y}-${m}-${d}`)) throw new Error("Invalid date-time");

  if (utc) return { value: new Date(Date.UTC(year, month - 1, day, hour, minute, second)).toISOString(), allDay: false };
  const timeZone = (params.TZID ?? fallbackTimeZone).replace(/^"|"$/g, "");
  return { value: localDateTimeToUtc(year, month, day, hour, minute, second, timeZone), allDay: false };
}

function unfoldIcsLines(text) {
  return String(text).replace(/^\uFEFF/, "").replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
}

function unescapeIcsText(value) {
  return value.replace(/\\[nN]/g, "\n").replace(/\\([\\,;])/g, "$1");
}

function parseIcsProperty(line) {
  const separator = line.indexOf(":");
  if (separator < 0) return null;
  const [name, ...rawParams] = line.slice(0, separator).split(";");
  const params = {};
  for (const raw of rawParams) {
    const equals = raw.indexOf("=");
    if (equals < 0) continue;
    params[raw.slice(0, equals).toUpperCase()] = raw.slice(equals + 1).replace(/^"|"$/g, "");
  }
  return { name: name.toUpperCase(), params, value: line.slice(separator + 1) };
}

function parseIcsCalendar(text, timeZone = "UTC") {
  const events = [];
  const issues = [];
  const eventIds = new Set();
  let current = null;
  let eventNumber = 0;

  for (const line of unfoldIcsLines(text)) {
    const trimmed = line.trimEnd();
    if (trimmed.toUpperCase() === "BEGIN:VEVENT") {
      current = { properties: {}, recurring: false };
      eventNumber += 1;
      continue;
    }
    if (!current) continue;
    if (trimmed.toUpperCase() === "END:VEVENT") {
      const uid = current.properties.UID?.value || `event-${eventNumber}`;
      if (current.recurring) {
        issues.push({ event: uid, message: "Recurring events are not imported in this version." });
        current = null;
        continue;
      }

      try {
        const title = unescapeIcsText(current.properties.SUMMARY?.value ?? "Untitled event").trim().slice(0, 240) || "Untitled event";
        const startProp = current.properties.DTSTART;
        const endProp = current.properties.DTEND;
        if (!startProp || !endProp) throw new Error("Event needs both DTSTART and DTEND");
        const start = parseIcsDate(startProp.value, startProp.params, timeZone);
        const end = parseIcsDate(endProp.value, endProp.params, timeZone);
        if (start.allDay !== end.allDay) throw new Error("Start and end must use the same date type");
        if (start.value >= end.value) throw new Error("Event end must be after its start");
        if (eventIds.has(uid)) {
          issues.push({ event: uid, message: "Duplicate event UID was skipped." });
          current = null;
          continue;
        }
        eventIds.add(uid);
        events.push({
          id: uid,
          title,
          start: start.value,
          end: end.value,
          allDay: start.allDay,
          timeZone: startProp.params.TZID ?? timeZone
        });
      } catch (error) {
        issues.push({ event: uid, message: error.message });
      }
      current = null;
      continue;
    }

    const property = parseIcsProperty(trimmed);
    if (!property) continue;
    if (["RRULE", "RDATE", "EXDATE"].includes(property.name)) current.recurring = true;
    current.properties[property.name] = property;
  }

  if (current) issues.push({ event: `event-${eventNumber}`, message: "Calendar ended before this event was complete." });
  return { events, issues };
}

function parseCsvRows(text) {
  const rows = [];
  let fields = [];
  let field = "";
  let quoted = false;
  let malformed = false;
  let rowNumber = 1;

  const finishField = () => {
    fields.push(field);
    field = "";
  };
  const finishRow = () => {
    finishField();
    if (fields.some((value) => value.trim() !== "")) rows.push({ row: rowNumber, fields, malformed });
    fields = [];
    malformed = false;
    rowNumber += 1;
  };

  const source = String(text).replace(/^\uFEFF/, "");
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      if (field.length > 0) malformed = true;
      quoted = true;
    } else if (char === ",") {
      finishField();
    } else if (char === "\n") {
      if (field.endsWith("\r")) field = field.slice(0, -1);
      finishRow();
    } else {
      field += char;
    }
  }
  if (quoted) malformed = true;
  if (field !== "" || fields.length > 0 || malformed) finishRow();
  return rows;
}

function parseTaskCsv(text) {
  const rows = parseCsvRows(text);
  if (rows.length === 0) return { tasks: [], issues: [{ row: 1, message: "CSV is empty." }] };

  const headers = rows[0].fields.map((value) => value.trim().toLowerCase());
  const titleIndex = headers.indexOf("title");
  if (titleIndex < 0) return { tasks: [], issues: [{ row: 1, message: "CSV needs a title column." }] };

  const tasks = [];
  const issues = [];
  const indexes = Object.fromEntries(["due_date", "estimate_minutes", "status", "completed_date"].map((key) => [key, headers.indexOf(key)]));

  for (const row of rows.slice(1)) {
    const get = (index) => index < 0 ? "" : (row.fields[index] ?? "").trim();
    const title = get(titleIndex);
    const problem = (message) => issues.push({ row: row.row, message });
    if (row.malformed) {
      problem("Malformed CSV quoting.");
      continue;
    }
    if (!title) {
      problem("Task title is required.");
      continue;
    }
    if (title.length > 200) {
      problem("Task titles must be 200 characters or fewer.");
      continue;
    }

    const dueDate = get(indexes.due_date);
    const estimateRaw = get(indexes.estimate_minutes);
    const statusRaw = get(indexes.status).toLowerCase();
    const completedAt = get(indexes.completed_date);
    const status = statusRaw || "todo";
    if (dueDate && !validDateOnly(dueDate)) {
      problem("Due date must be a real ISO date (YYYY-MM-DD).");
      continue;
    }
    if (estimateRaw && (!/^\d+$/.test(estimateRaw) || !Number.isSafeInteger(Number(estimateRaw)))) {
      problem("Estimate must be a nonnegative whole number of minutes.");
      continue;
    }
    if (!["todo", "done"].includes(status)) {
      problem("Status must be todo or done.");
      continue;
    }
    if (completedAt && (!validDateOnly(completedAt) || status !== "done")) {
      problem("Completed date must be a real ISO date and status must be done.");
      continue;
    }

    tasks.push({
      title,
      dueDate: dueDate || null,
      estimateMinutes: estimateRaw ? Number(estimateRaw) : null,
      status,
      completedAt: completedAt || null
    });
  }

  return { tasks, issues };
}

function setTaskStatus(task, status, completedAt) {
  if (!["todo", "done"].includes(status)) throw new Error("Task status must be todo or done.");
  if (status === "done" && !validDateOnly(completedAt)) throw new Error("Completed tasks need a valid completion date.");
  return { ...task, status, completedAt: status === "done" ? completedAt : null };
}

function mergeIntervals(intervals) {
  const sorted = intervals.filter(([start, end]) => end > start).sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const interval of sorted) {
    const previous = merged.at(-1);
    if (!previous || interval[0] > previous[1]) merged.push([...interval]);
    else previous[1] = Math.max(previous[1], interval[1]);
  }
  return merged;
}

function clippedIntervals(items, startBound, endBound, skipAllDay = false) {
  const intervals = [];
  for (const item of items) {
    if (skipAllDay && item.allDay) continue;
    const start = Date.parse(item.start);
    const end = Date.parse(item.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    const clippedStart = Math.max(start, startBound);
    const clippedEnd = Math.min(end, endBound);
    if (clippedEnd > clippedStart) intervals.push([clippedStart, clippedEnd]);
  }
  return intervals;
}

function totalMinutes(intervals) {
  return Math.round(intervals.reduce((sum, [start, end]) => sum + end - start, 0) / 60_000);
}

function overlapMinutes(left, right) {
  let total = 0;
  for (const [leftStart, leftEnd] of left) {
    for (const [rightStart, rightEnd] of right) {
      total += Math.max(0, Math.min(leftEnd, rightEnd) - Math.max(leftStart, rightStart));
    }
  }
  return Math.round(total / 60_000);
}

function buildWeekSummary({ events = [], tasks = [], sessions = [] }, weekStart, timeZone = "UTC") {
  if (!validDateOnly(weekStart)) throw new Error("Week start must be an ISO date.");
  if (!isValidTimeZone(timeZone)) throw new Error(`Unsupported time zone: ${timeZone}`);
  const startParts = dateParts(weekStart);
  const nextWeek = addDateDays(weekStart, 7);
  const endParts = dateParts(nextWeek);
  const startBound = Date.parse(localDateTimeToUtc(startParts.year, startParts.month, startParts.day, 0, 0, 0, timeZone));
  const endBound = Date.parse(localDateTimeToUtc(endParts.year, endParts.month, endParts.day, 0, 0, 0, timeZone));

  const calendarIntervals = mergeIntervals(clippedIntervals(events, startBound, endBound, true));
  const focusIntervals = mergeIntervals(clippedIntervals(sessions, startBound, endBound));
  const completedTasks = tasks.filter((task) => {
    if (task.status !== "done" || !task.completedAt) return false;
    const completedDate = validDateOnly(task.completedAt) ? task.completedAt : localDateOf(task.completedAt, timeZone);
    return completedDate >= weekStart && completedDate < nextWeek;
  }).length;
  const undatedCompletions = tasks.filter((task) => task.status === "done" && !task.completedAt).length;

  const estimatedTasks = tasks.filter((task) =>
    Number.isFinite(task.estimateMinutes) && task.estimateMinutes >= 0 && task.dueDate >= weekStart && task.dueDate < nextWeek
  );
  const estimatedTaskIds = new Set(estimatedTasks.map((task) => task.id).filter(Boolean));
  const trackedEstimateSessions = sessions.filter((session) => estimatedTaskIds.has(session.taskId));
  const estimatedComparison = estimatedTasks.length === 0 ? null : {
    taskCount: estimatedTasks.length,
    estimatedMinutes: estimatedTasks.reduce((sum, task) => sum + task.estimateMinutes, 0),
    trackedMinutes: totalMinutes(mergeIntervals(clippedIntervals(trackedEstimateSessions, startBound, endBound)))
  };

  const calendarMinutes = totalMinutes(calendarIntervals);
  const focusMinutes = totalMinutes(focusIntervals);
  return {
    weekStart,
    weekEnd: addDateDays(weekStart, 6),
    meetingMinutes: calendarMinutes,
    focusMinutes,
    completedTasks,
    undatedCompletions,
    untrackedMinutes: Math.max(0, calendarMinutes - overlapMinutes(calendarIntervals, focusIntervals)),
    estimatedTasks: estimatedComparison
  };
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function hoursLabel(minutes) {
  if (!Number.isFinite(minutes) || minutes < 0) return "—";
  const hours = minutes / 60;
  return `${hours.toFixed(hours % 1 === 0 ? 0 : 1)} h`;
}

function createShareableHtml(summary) {
  const values = {
    weekLabel: escapeHtml(summary.weekLabel ?? `${summary.weekStart ?? ""} – ${summary.weekEnd ?? ""}`),
    meeting: hoursLabel(summary.meetingMinutes),
    focus: hoursLabel(summary.focusMinutes),
    completed: Number.isSafeInteger(summary.completedTasks) && summary.completedTasks >= 0 ? summary.completedTasks : "—",
    undated: Number.isSafeInteger(summary.undatedCompletions) && summary.undatedCompletions >= 0 ? summary.undatedCompletions : "—",
    untracked: hoursLabel(summary.untrackedMinutes)
  };
  const estimate = summary.estimatedTasks && Number.isFinite(summary.estimatedTasks.estimatedMinutes)
    ? `${hoursLabel(summary.estimatedTasks.estimatedMinutes)} estimated · ${hoursLabel(summary.estimatedTasks.trackedMinutes)} tracked`
    : "Not enough task estimate data";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Dayline weekly recap</title>
  <style>
    :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, sans-serif; color: #182233; background: #f4f2ed; }
    body { max-width: 840px; margin: 0 auto; padding: 48px 24px; }
    header { margin-bottom: 32px; }
    .brand { color: #5c6bc0; font-size: 12px; font-weight: 800; letter-spacing: .18em; text-transform: uppercase; }
    h1 { margin: 10px 0 4px; font-size: clamp(28px, 6vw, 44px); letter-spacing: -.04em; }
    .week { color: #687286; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 12px; }
    article { padding: 20px; border: 1px solid #e0e3e8; border-radius: 16px; background: white; }
    article span { color: #687286; font-size: 13px; }
    article strong { display: block; margin-top: 8px; font-size: 28px; letter-spacing: -.03em; }
    footer { margin-top: 26px; color: #687286; font-size: 13px; line-height: 1.6; }
  </style>
</head>
<body>
  <header><div class="brand">Dayline · weekly recap</div><h1>A week, in focus.</h1><div class="week">${values.weekLabel}</div></header>
  <main class="grid">
    <article><span>Calendar time</span><strong>${values.meeting}</strong></article>
    <article><span>Tracked focus</span><strong>${values.focus}</strong></article>
    <article><span>Tasks completed</span><strong>${values.completed}</strong></article>
    <article><span>Completed, date unknown</span><strong>${values.undated}</strong></article>
    <article><span>Calendar time without focus tracking</span><strong>${values.untracked}</strong></article>
    <article><span>Estimated vs tracked task time</span><strong>${escapeHtml(estimate)}</strong></article>
  </main>
  <footer>Calendar time describes scheduled events, not attendance. Focus time reflects sessions deliberately recorded in Dayline. No event or task names are included in this recap.</footer>
</body>
</html>`;
}

function exportBackup(state, exportedAt = new Date().toISOString()) {
  return new Blob([JSON.stringify({
    format: "dayline-backup",
    version: 1,
    exportedAt,
    state
  }, null, 2)], { type: "application/json" });
}

function validateBackup(value) {
  const fail = (message) => { throw new Error(`Invalid backup: ${message}`); };
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("expected a JSON object.");
  if (value.format !== "dayline-backup" || value.version !== 1) fail("unsupported format or version.");
  const state = value.state;
  if (!state || typeof state !== "object" || Array.isArray(state) || state.version !== 1) fail("unsupported state version.");
  for (const key of ["events", "tasks", "sessions"]) {
    if (!Array.isArray(state[key])) fail(`${key} must be an array.`);
  }
  const timeZone = state.preferences?.timeZone;
  if (typeof timeZone !== "string" || !timeZone) fail("time zone is missing.");
  try { new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date()); }
  catch { fail("time zone is invalid."); }

  const validInstant = (value) => typeof value === "string" && Number.isFinite(Date.parse(value));
  const validText = (value, max) => typeof value === "string" && value.trim().length > 0 && value.length <= max;
  const ids = new Set();
  const uniqueId = (id, label) => {
    if (!validText(id, 300) || ids.has(id)) fail(`${label} has a missing or duplicate id.`);
    ids.add(id);
  };
  const events = state.events.map((event) => {
    if (!event || typeof event !== "object" || Array.isArray(event)) fail("event record is malformed.");
    uniqueId(event.id, "event");
    if (!validText(event.title, 240) || !validInstant(event.start) || !validInstant(event.end) || Date.parse(event.end) <= Date.parse(event.start) || typeof event.allDay !== "boolean") fail("event fields are invalid.");
    return { id: event.id, title: event.title, start: event.start, end: event.end, allDay: event.allDay, timeZone: typeof event.timeZone === "string" ? event.timeZone : timeZone };
  });
  const tasks = state.tasks.map((task) => {
    if (!task || typeof task !== "object" || Array.isArray(task)) fail("task record is malformed.");
    uniqueId(task.id, "task");
    if (!validText(task.title, 200) || !["todo", "done"].includes(task.status)) fail("task fields are invalid.");
    if (task.dueDate !== null && task.dueDate !== undefined && !validDateOnly(task.dueDate)) fail("task due date is invalid.");
    if (task.estimateMinutes !== null && task.estimateMinutes !== undefined && (!Number.isFinite(task.estimateMinutes) || task.estimateMinutes < 0)) fail("task estimate is invalid.");
    if (task.completedAt !== null && task.completedAt !== undefined && !validDateOnly(task.completedAt)) fail("task completion date is invalid.");
    return { id: task.id, title: task.title, dueDate: task.dueDate ?? null, estimateMinutes: task.estimateMinutes ?? null, status: task.status, completedAt: task.completedAt ?? null };
  });
  const sessions = state.sessions.map((session) => {
    if (!session || typeof session !== "object" || Array.isArray(session)) fail("session record is malformed.");
    uniqueId(session.id, "session");
    if (!validInstant(session.start) || !validInstant(session.end) || Date.parse(session.end) <= Date.parse(session.start)) fail("session times are invalid.");
    return { id: session.id, taskId: session.taskId ?? null, start: session.start, end: session.end };
  });
  let activeTimer = null;
  if (state.activeTimer !== null && state.activeTimer !== undefined) {
    const timer = state.activeTimer;
    if (!timer || typeof timer !== "object" || !validInstant(timer.start)) fail("active timer is malformed.");
    activeTimer = { taskId: timer.taskId ?? null, start: timer.start };
  }
  return { version: 1, events, tasks, sessions, activeTimer, preferences: { timeZone } };
}

root.DaylineCore = Object.freeze({
  parseIcsCalendar,
  parseTaskCsv,
  localDateForValue,
  localDayBounds,
  eventOccursOnLocalDay,
  setTaskStatus,
  buildWeekSummary,
  createShareableHtml,
  exportBackup,
  validateBackup
});
})(globalThis);

