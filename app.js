(() => {
  "use strict";

  const core = window.DaylineCore;
  const storageKey = "dayline.state.v1";
  const $ = (selector) => document.querySelector(selector);
  const elements = {
    notice: $("#notice"),
    selectedDay: $("#selected-day"),
    timelineDate: $("#timeline-date"),
    timelineItems: $("#timeline-items"),
    timelineEmpty: $("#timeline-empty"),
    allDayEvents: $("#all-day-events"),
    taskList: $("#task-list"),
    tasksEmpty: $("#tasks-empty"),
    taskCount: $("#task-count"),
    timerTask: $("#timer-task"),
    timerClock: $("#timer-clock"),
    timerToggle: $("#timer-toggle"),
    timerLiveMark: $("#timer-live-mark"),
    importDialog: $("#import-dialog"),
    importDialogTitle: $("#import-dialog-title"),
    importDialogSummary: $("#import-dialog-summary"),
    importRecords: $("#import-records"),
    importIssues: $("#import-issues"),
    applyImport: $("#apply-import"),
    manualDialog: $("#manual-session-dialog"),
    manualTask: $("#manual-task"),
    manualStart: $("#manual-start"),
    manualEnd: $("#manual-end"),
    manualError: $("#manual-session-error"),
    aboutDialog: $("#about-dialog")
  };

  const fallbackTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  let storageWarning = false;
  let state = loadState();
  let selectedDate = localDateString(new Date());
  let selectedWeekStart = mondayOf(selectedDate);
  let pendingImport = null;

  if (!core) {
    elements.notice.hidden = false;
    elements.notice.textContent = "Dayline could not load. Keep index.html, styles.css, core.js, and app.js together in the same folder.";
    return;
  }

  function localDateString(date, timeZone = state?.preferences?.timeZone || fallbackTimeZone) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(date);
    const values = Object.fromEntries(parts.filter((part) => part.type !== "literal").map(({ type, value }) => [type, value]));
    return `${values.year}-${values.month}-${values.day}`;
  }

  function addDays(dateString, days) {
    const [year, month, day] = dateString.split("-").map(Number);
    return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
  }

  function mondayOf(dateString) {
    const [year, month, day] = dateString.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    const shift = (date.getUTCDay() + 6) % 7;
    return addDays(dateString, -shift);
  }

  function makeId(prefix = "item") {
    if (window.crypto?.randomUUID) return `${prefix}-${window.crypto.randomUUID()}`;
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function emptyState() {
    return {
      version: 1,
      events: [],
      tasks: [],
      sessions: [],
      activeTimer: null,
      preferences: { timeZone: fallbackTimeZone }
    };
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return emptyState();
      const value = JSON.parse(raw);
      return core.validateBackup({ format: "dayline-backup", version: 1, state: value });
    } catch (error) {
      storageWarning = true;
      return emptyState();
    }
  }

  function saveState() {
    try {
      localStorage.setItem(storageKey, JSON.stringify(state));
      storageWarning = false;
      return true;
    } catch {
      storageWarning = true;
      return false;
    }
  }

  function showNotice(message, tone = "warning") {
    elements.notice.textContent = message;
    elements.notice.dataset.tone = tone;
    elements.notice.hidden = false;
  }

  function clearNotice() {
    if (storageWarning) {
      showNotice("Your browser could not save this data. Dayline is still usable in this tab; download a backup before closing it.");
      return;
    }
    elements.notice.hidden = true;
  }

  function saveAndRender(message = "") {
    const saved = saveState();
    if (message && saved) showNotice(message, "success");
    else if (!saved) clearNotice();
    render();
  }

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function formatDate(dateString, options = { weekday: "long", month: "long", day: "numeric" }) {
    const date = new Date(`${dateString}T12:00:00.000Z`);
    return new Intl.DateTimeFormat(undefined, { ...options, timeZone: "UTC" }).format(date);
  }

  function formatTime(instant) {
    return new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
      timeZone: state.preferences.timeZone
    }).format(new Date(instant));
  }

  function formatMinutes(minutes) {
    if (!Number.isFinite(minutes) || minutes < 0) return "—";
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
  }

  function formatElapsed(milliseconds) {
    const seconds = Math.max(0, Math.floor(milliseconds / 1000));
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainder = seconds % 60;
    return hours > 0
      ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
      : `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
  }

  function intervalMinutes(items, dayStart, dayEnd) {
    return items.reduce((total, item) => {
      const start = Date.parse(item.start);
      const end = Date.parse(item.end);
      if (!Number.isFinite(start) || !Number.isFinite(end)) return total;
      const overlap = Math.max(0, Math.min(dayEnd, end) - Math.max(dayStart, start));
      return total + overlap;
    }, 0) / 60_000;
  }

  function createTimelineRow(time, title, meta, isSession = false) {
    const row = element("div", "timeline-row");
    const timeNode = element("time", "timeline-time", time);
    const event = element("div", `timeline-event${isSession ? " is-session" : ""}`);
    event.append(element("span", "timeline-event-title", title));
    event.append(element("span", "timeline-event-meta", meta));
    row.append(timeNode, event);
    return row;
  }

  function renderTimeline() {
    elements.timelineItems.replaceChildren();
    elements.allDayEvents.replaceChildren();
    const bounds = core.localDayBounds(selectedDate, state.preferences.timeZone);
    const dayEvents = state.events.filter((event) => core.eventOccursOnLocalDay(event, selectedDate, state.preferences.timeZone));
    const allDay = dayEvents.filter((event) => event.allDay);
    const timedEvents = dayEvents.filter((event) => !event.allDay);
    const daySessions = state.sessions.filter((session) => Date.parse(session.start) < bounds.end && Date.parse(session.end) > bounds.start);

    if (allDay.length) {
      elements.allDayEvents.hidden = false;
      elements.allDayEvents.append(element("p", "all-day-heading", "All day"));
      for (const event of allDay) elements.allDayEvents.append(element("div", "all-day-item", event.title));
    } else {
      elements.allDayEvents.hidden = true;
    }

    const entries = [
      ...timedEvents.map((event) => {
        const start = Math.max(Date.parse(event.start), bounds.start);
        const end = Math.min(Date.parse(event.end), bounds.end);
        const clippedStart = new Date(start).toISOString();
        const clippedEnd = new Date(end).toISOString();
        const continues = `${Date.parse(event.start) < bounds.start ? " · Continues from previous day" : ""}${Date.parse(event.end) > bounds.end ? " · Continues next day" : ""}`;
        return { start: clippedStart, title: event.title, meta: `${formatTime(clippedStart)} – ${formatTime(clippedEnd)} · Calendar${continues}` };
      }),
      ...daySessions.map((session) => {
        const task = state.tasks.find((candidate) => candidate.id === session.taskId);
        const start = new Date(Math.max(Date.parse(session.start), bounds.start));
        const end = new Date(Math.min(Date.parse(session.end), bounds.end));
        const clippedStart = start.toISOString();
        const clippedEnd = end.toISOString();
        const continues = `${Date.parse(session.start) < bounds.start ? " · Continues from previous day" : ""}${Date.parse(session.end) > bounds.end ? " · Continues next day" : ""}`;
        return {
          start: clippedStart,
          title: task?.title || "Focus session",
          meta: `${formatTime(clippedStart)} – ${formatTime(clippedEnd)} · Tracked ${formatMinutes(Math.max(1, Math.round((end - start) / 60_000)))}${continues}`,
          isSession: true
        };
      })
    ].sort((left, right) => left.start.localeCompare(right.start));

    for (const entry of entries) {
      elements.timelineItems.append(createTimelineRow(formatTime(entry.start), entry.title, entry.meta, entry.isSession));
    }
    const isEmpty = allDay.length === 0 && entries.length === 0;
    elements.timelineEmpty.hidden = !isEmpty;
    elements.timelineItems.hidden = entries.length === 0;
    elements.timelineDate.textContent = formatDate(selectedDate);

    const timedDayEvents = dayEvents.filter((event) => !event.allDay);
    const calendarMinutes = Math.round(intervalMinutes(timedDayEvents, bounds.start, bounds.end));
    const focusMinutes = Math.round(intervalMinutes(daySessions, bounds.start, bounds.end));
    const completed = state.tasks.filter((task) => task.status === "done" && task.completedAt && core.localDateForValue(task.completedAt, state.preferences.timeZone) === selectedDate).length;
    $("#day-calendar-time").textContent = formatMinutes(calendarMinutes);
    $("#day-focus-time").textContent = formatMinutes(focusMinutes);
    $("#day-tasks-done").textContent = String(completed);
  }

  function renderTasks() {
    elements.taskList.replaceChildren();
    const tasks = [...state.tasks].sort((a, b) => Number(a.status === "done") - Number(b.status === "done") || (a.dueDate || "9999").localeCompare(b.dueDate || "9999"));
    const incomplete = tasks.filter((task) => task.status !== "done").length;
    elements.taskCount.textContent = String(incomplete);
    elements.tasksEmpty.hidden = tasks.length > 0;
    for (const task of tasks) {
      const row = element("li", "task-row");
      const checkbox = element("input", "task-check");
      checkbox.type = "checkbox";
      checkbox.checked = task.status === "done";
      checkbox.dataset.taskId = task.id;
      checkbox.setAttribute("aria-label", `${checkbox.checked ? "Reopen" : "Complete"} task: ${task.title}`);
      const copy = element("span", "task-copy");
      copy.append(element("span", `task-title${checkbox.checked ? " is-done" : ""}`, task.title));
      const details = [];
      if (task.dueDate) details.push(`Due ${formatDate(task.dueDate, { month: "short", day: "numeric" })}`);
      if (Number.isFinite(task.estimateMinutes)) details.push(`${task.estimateMinutes} min estimate`);
      if (task.status === "done" && !task.completedAt) details.push("completion date unknown");
      if (details.length) copy.append(element("span", "task-meta", details.join(" · ")));
      const remove = element("button", "task-delete", "×");
      remove.type = "button";
      remove.dataset.deleteTaskId = task.id;
      remove.setAttribute("aria-label", `Delete task: ${task.title}`);
      row.append(checkbox, copy, remove);
      elements.taskList.append(row);
    }
  }

  function renderTimerOptions() {
    const previousTimerTask = elements.timerTask.value;
    const previousManualTask = elements.manualTask.value;
    for (const select of [elements.timerTask, elements.manualTask]) {
      const general = select.querySelector('option[value=""]');
      select.replaceChildren(general ?? element("option", "", "General focus"));
      select.firstElementChild.value = "";
      for (const task of state.tasks.filter((candidate) => candidate.status !== "done")) {
        const option = element("option", "", task.title);
        option.value = task.id;
        select.append(option);
      }
    }
    if ([...elements.timerTask.options].some((option) => option.value === previousTimerTask)) elements.timerTask.value = previousTimerTask;
    if ([...elements.manualTask.options].some((option) => option.value === previousManualTask)) elements.manualTask.value = previousManualTask;
  }

  function updateTimerDisplay() {
    const active = state.activeTimer;
    elements.timerLiveMark.hidden = !active;
    elements.timerToggle.classList.toggle("is-running", Boolean(active));
    elements.timerToggle.textContent = active ? "Stop and save session" : "Start focus";
    elements.timerClock.textContent = active ? formatElapsed(Date.now() - Date.parse(active.start)) : "00:00";
  }

  function renderWeek() {
    const weekEnd = addDays(selectedWeekStart, 6);
    const summary = core.buildWeekSummary(state, selectedWeekStart, state.preferences.timeZone);
    $("#week-label").textContent = `${formatDate(selectedWeekStart, { month: "short", day: "numeric" })} – ${formatDate(weekEnd, { month: "short", day: "numeric", year: "numeric" })}`;
    const estimated = summary.estimatedTasks
      ? `${formatMinutes(summary.estimatedTasks.estimatedMinutes)} / ${formatMinutes(summary.estimatedTasks.trackedMinutes)}`
      : "Not enough data";
    const metrics = [
      ["Calendar time", formatMinutes(summary.meetingMinutes)],
      ["Focus tracked", formatMinutes(summary.focusMinutes)],
      ["Tasks completed", String(summary.completedTasks)],
      ["Done, date unknown", String(summary.undatedCompletions)],
      ["Scheduled time without focus tracking", formatMinutes(summary.untrackedMinutes)],
      ["Estimate / tracked", estimated]
    ];
    const container = $("#week-metrics");
    container.replaceChildren();
    for (const [label, value] of metrics) {
      const card = element("div", "week-metric");
      card.append(element("span", "week-metric-label", label));
      card.append(element("strong", "week-metric-value", value));
      container.append(card);
    }
  }

  function render() {
    elements.selectedDay.value = selectedDate;
    $("#today-eyebrow").textContent = selectedDate === localDateString(new Date()) ? "YOUR DAY, IN FOCUS" : formatDate(selectedDate).toUpperCase();
    renderTimeline();
    renderTasks();
    renderTimerOptions();
    updateTimerDisplay();
    renderWeek();
    if (storageWarning) clearNotice();
  }

  function handleTaskCreate(event) {
    event.preventDefault();
    const titleInput = $("#new-task-title");
    const estimateInput = $("#new-task-estimate");
    const title = titleInput.value.trim();
    const estimateRaw = estimateInput.value.trim();
    if (!title) return;
    if (estimateRaw && (!/^\d+$/.test(estimateRaw) || Number(estimateRaw) < 0)) {
      showNotice("Estimate must be a nonnegative number of minutes.");
      return;
    }
    state.tasks.push({
      id: makeId("task"),
      title: title.slice(0, 200),
      dueDate: $("#new-task-due").value || null,
      estimateMinutes: estimateRaw ? Number(estimateRaw) : null,
      status: "todo",
      completedAt: null
    });
    titleInput.value = "";
    estimateInput.value = "";
    $("#new-task-due").value = "";
    saveAndRender("Task added.");
    titleInput.focus();
  }

  function handleTaskListClick(event) {
    const checkbox = event.target.closest("input[data-task-id]");
    const remove = event.target.closest("button[data-delete-task-id]");
    if (checkbox) {
      const task = state.tasks.find((candidate) => candidate.id === checkbox.dataset.taskId);
      if (!task) return;
      state.tasks = state.tasks.map((candidate) => candidate.id === task.id
        ? core.setTaskStatus(candidate, checkbox.checked ? "done" : "todo", localDateString(new Date()))
        : candidate);
      saveAndRender(checkbox.checked ? "Task marked complete." : "Task reopened.");
    } else if (remove) {
      state.tasks = state.tasks.filter((task) => task.id !== remove.dataset.deleteTaskId);
      saveAndRender("Task removed.");
    }
  }

  function toggleTimer() {
    if (!state.activeTimer) {
      state.activeTimer = {
        taskId: elements.timerTask.value || null,
        start: new Date().toISOString()
      };
      saveAndRender("Focus timer started.");
      return;
    }

    const end = new Date();
    const start = new Date(state.activeTimer.start);
    if (end > start) {
      state.sessions.push({
        id: makeId("session"),
        taskId: state.activeTimer.taskId,
        start: start.toISOString(),
        end: end.toISOString()
      });
    }
    state.activeTimer = null;
    saveAndRender("Focus session saved.");
  }

  function localInputToIso(value) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return null;
    return date.toISOString();
  }

  function saveManualSession(event) {
    event.preventDefault();
    const start = localInputToIso(elements.manualStart.value);
    const end = localInputToIso(elements.manualEnd.value);
    if (!start || !end || Date.parse(end) <= Date.parse(start)) {
      elements.manualError.textContent = "End time must be after start time.";
      elements.manualError.hidden = false;
      return;
    }
    state.sessions.push({
      id: makeId("session"),
      taskId: elements.manualTask.value || null,
      start,
      end
    });
    elements.manualDialog.close();
    elements.manualStart.value = "";
    elements.manualEnd.value = "";
    elements.manualError.hidden = true;
    saveAndRender("Past focus session added.");
  }

  function setImportPreview(kind, result) {
    pendingImport = { kind, records: result.events ?? result.tasks ?? [], issues: result.issues ?? [] };
    const names = kind === "calendar" ? "calendar events" : "tasks";
    $("#import-kind-label").textContent = kind === "calendar" ? "CALENDAR IMPORT" : "TASK IMPORT";
    elements.importDialogTitle.textContent = `Review ${names} before adding`;
    elements.importDialogSummary.textContent = `${pendingImport.records.length} valid ${names} found. ${pendingImport.issues.length} item${pendingImport.issues.length === 1 ? "" : "s"} need attention.`;
    elements.importRecords.replaceChildren();
    for (const record of pendingImport.records.slice(0, 12)) {
      let description;
      if (kind === "calendar") {
        description = record.allDay
          ? `${record.title} · All day · ${record.start}–${record.end}`
          : `${record.title} · ${formatTime(record.start)}–${formatTime(record.end)} · ${localDateString(new Date(record.start), state.preferences.timeZone)}`;
      } else {
        const details = [record.status === "done" ? "Done" : "To do", record.dueDate ? `Due ${record.dueDate}` : "", Number.isFinite(record.estimateMinutes) ? `${record.estimateMinutes} min` : ""].filter(Boolean);
        description = `${record.title} · ${details.join(" · ")}`;
      }
      elements.importRecords.append(element("li", "", description));
    }
    if (pendingImport.records.length > 12) {
      elements.importRecords.append(element("li", "", `${pendingImport.records.length - 12} more valid records.`));
    }
    elements.importIssues.replaceChildren();
    for (const issue of pendingImport.issues.slice(0, 12)) {
      elements.importIssues.append(element("li", "", issue.message));
    }
    if (pendingImport.issues.length > 12) {
      elements.importIssues.append(element("li", "", `${pendingImport.issues.length - 12} more warnings.`));
    }
    elements.applyImport.disabled = pendingImport.records.length === 0;
    elements.applyImport.textContent = `Add ${pendingImport.records.length} valid ${names}`;
    elements.importDialog.showModal();
  }

  async function readImportFile(file, kind) {
    try {
      const text = await file.text();
      const result = kind === "calendar"
        ? core.parseIcsCalendar(text, state.preferences.timeZone)
        : core.parseTaskCsv(text);
      if (kind === "calendar") {
        const known = new Set(state.events.map((event) => event.id));
        const duplicates = result.events.filter((event) => known.has(event.id)).length;
        result.events = result.events.filter((event) => !known.has(event.id));
        if (duplicates) result.issues.push({ message: `${duplicates} event${duplicates === 1 ? " is" : "s are"} already in Dayline.` });
      }
      setImportPreview(kind, result);
    } catch {
      showNotice(`Could not read that ${kind === "calendar" ? "calendar" : "task"} file. Try exporting it again and re-importing.`);
    }
  }

  function applyImport() {
    if (!pendingImport || pendingImport.records.length === 0) return;
    if (pendingImport.kind === "calendar") {
      state.events.push(...pendingImport.records);
    } else {
      state.tasks.push(...pendingImport.records.map((task) => ({ ...task, id: makeId("task") })));
    }
    const count = pendingImport.records.length;
    const kind = pendingImport.kind;
    pendingImport = null;
    elements.importDialog.close();
    saveAndRender(`Added ${count} ${kind === "calendar" ? "calendar events" : "tasks"}.`);
  }

  function downloadFile(content, fileName, type) {
    const blob = content instanceof Blob ? content : new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const anchor = element("a");
    anchor.href = url;
    anchor.download = fileName;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportBackup() {
    downloadFile(core.exportBackup(state), `dayline-backup-${localDateString(new Date())}.json`, "application/json");
    showNotice("Backup downloaded. It contains your imported calendar and task titles, so store it somewhere private.", "success");
  }

  function exportWeekReport() {
    const summary = core.buildWeekSummary(state, selectedWeekStart, state.preferences.timeZone);
    const weekEnd = addDays(selectedWeekStart, 6);
    const report = core.createShareableHtml({
      ...summary,
      weekLabel: `${formatDate(selectedWeekStart, { month: "short", day: "numeric" })} – ${formatDate(weekEnd, { month: "short", day: "numeric", year: "numeric" })}`
    });
    downloadFile(report, `dayline-weekly-recap-${selectedWeekStart}.html`, "text/html;charset=utf-8");
    showNotice("Shareable recap downloaded. It contains weekly totals only, without event or task names.", "success");
  }

  async function restoreBackup(file) {
    try {
      if (file.size > 25 * 1024 * 1024) throw new Error("Backup file is larger than 25 MB.");
      const parsed = JSON.parse(await file.text());
      const restored = core.validateBackup(parsed);
      const accepted = window.confirm(`Replace this browser's Dayline data with the backup? It contains ${restored.events.length} calendar events, ${restored.tasks.length} tasks, and ${restored.sessions.length} focus sessions.`);
      if (!accepted) return;
      state = restored;
      selectedDate = localDateString(new Date());
      selectedWeekStart = mondayOf(selectedDate);
      saveAndRender("Backup restored.");
    } catch (error) {
      showNotice(`Backup was not restored: ${error.message || "the file could not be read."}`);
    }
  }

  function bindEvents() {
    $("#previous-day").addEventListener("click", () => { selectedDate = addDays(selectedDate, -1); render(); });
    $("#next-day").addEventListener("click", () => { selectedDate = addDays(selectedDate, 1); render(); });
    elements.selectedDay.addEventListener("change", () => { if (elements.selectedDay.value) selectedDate = elements.selectedDay.value; render(); });
    $("#task-form").addEventListener("submit", handleTaskCreate);
    elements.taskList.addEventListener("click", handleTaskListClick);
    elements.timerToggle.addEventListener("click", toggleTimer);
    $("#calendar-import-button").addEventListener("click", () => $("#calendar-file").click());
    $("#tasks-import-button").addEventListener("click", () => $("#tasks-file").click());
    $("#calendar-file").addEventListener("change", (event) => {
      const file = event.target.files?.[0];
      if (file) void readImportFile(file, "calendar");
      event.target.value = "";
    });
    $("#tasks-file").addEventListener("change", (event) => {
      const file = event.target.files?.[0];
      if (file) void readImportFile(file, "tasks");
      event.target.value = "";
    });
    $("#cancel-import").addEventListener("click", () => { pendingImport = null; elements.importDialog.close(); });
    elements.applyImport.addEventListener("click", applyImport);
    $("#manual-session-button").addEventListener("click", () => {
      elements.manualError.hidden = true;
      elements.manualDialog.showModal();
    });
    $("#cancel-manual-session").addEventListener("click", () => elements.manualDialog.close());
    $("#manual-session-form").addEventListener("submit", saveManualSession);
    $("#previous-week").addEventListener("click", () => { selectedWeekStart = addDays(selectedWeekStart, -7); renderWeek(); });
    $("#next-week").addEventListener("click", () => { selectedWeekStart = addDays(selectedWeekStart, 7); renderWeek(); });
    $("#share-week-button").addEventListener("click", exportWeekReport);
    $("#backup-export-button").addEventListener("click", exportBackup);
    $("#backup-import-button").addEventListener("click", () => $("#backup-file").click());
    $("#backup-file").addEventListener("change", (event) => {
      const file = event.target.files?.[0];
      if (file) void restoreBackup(file);
      event.target.value = "";
    });
    $("#about-button").addEventListener("click", () => elements.aboutDialog.showModal());
    $("#close-about").addEventListener("click", () => elements.aboutDialog.close());
  }

  bindEvents();
  render();
  window.setInterval(updateTimerDisplay, 1000);
})();
