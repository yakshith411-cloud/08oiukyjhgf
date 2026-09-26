const SAMPLE_TITLE = "Product launch · weekly sync";
const SAMPLE_TRANSCRIPT = `Maya: We have three weeks until launch, and the onboarding flow is the biggest risk.\nJordan: I will share the revised onboarding screens with the team by Friday.\nMaya: Great. We agreed to keep the first release focused on account setup and the welcome checklist.\nLeo: I can review the event tracking plan and send any gaps to Maya by next Tuesday.\nMaya: Let's also confirm the launch email with the support team before we lock the date.\nJordan: I will draft the launch email and share it with support on Thursday.\nMaya: Decision: we will move the launch readiness review to the 18th so support has time to prepare.\nLeo: I will schedule a thirty-minute readiness review with support and engineering by Monday.\nMaya: Sounds good. We need one final pass on mobile before the review.`;

const state = {
  meetings: [],
  activeId: null,
  activeTab: "overview",
  detailRequest: 0,
  sortNewest: true,
  view: "meetings",
  providerConfigured: false,
  assistantConfigured: false,
  assistantMessages: [],
  assistantBusy: false,
  toastTimer: null,
  token: localStorage.getItem("meetflow_auth_token") || "",
  currentUser: null,
  analyticsRange: 12,
  analyticsData: null,
  teamMembers: [],
  calendarDate: new Date(),
  neonStatus: null,
  bossMeetings: [],
  upcomingBossMeeting: null,
};
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (state.token) {
    headers["Authorization"] = `Bearer ${state.token}`;
  }
  const response = await fetch(path, { ...options, headers });
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    if (path.startsWith("/api/assistant/") && response.status === 404) {
      throw new Error("This Meetflow server is out of date. Restart the latest version with start.bat, then open the new address it prints.");
    }
    throw new Error("Meetflow received an unexpected server response. Restart the app and try again.");
  }
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error("Meetflow received an unreadable server response. Restart the app and try again.");
  }
  if (!response.ok) throw new Error(data.error || data.message || "Something went wrong.");
  return data;
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => toast.classList.remove("show"), 2600);
}

function dateLabel(iso) {
  const date = new Date(iso);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return "Today";
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
}

function taskDueLabel(task) {
  if (!task.due_date) return task.due;
  const date = new Date(`${task.due_date}T00:00:00`);
  return `${task.due} · ${new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date)}`;
}

function updateOverview() {
  const openTasks = state.meetings.flatMap((meeting) => meeting.tasks || []).filter((task) => !task.completed);
  const dueSoon = openTasks.filter((task) => task.due !== "Unscheduled");
  $("#stat-meetings").textContent = String(state.meetings.length).padStart(2, "0");
  $("#stat-actions").textContent = String(openTasks.length).padStart(2, "0");
  $("#meeting-count").textContent = state.meetings.length;
  $("#action-count").textContent = openTasks.length;
  $("#clear-all").disabled = state.meetings.length === 0;
  $("#stat-focus").textContent = dueSoon.length ? `${dueSoon.length} action${dueSoon.length === 1 ? "" : "s"} with a due date.` : openTasks.length ? `${openTasks.length} next step${openTasks.length === 1 ? "" : "s"} to own.` : "A clearer next step.";
  renderDeadlinePanel();
  updateReminderPermissionButton();
}

function localDateStart(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function deadlineTasks() {
  const today = localDateStart();
  return state.meetings.flatMap((meeting) => (meeting.tasks || []).map((task) => ({ ...task, meetingId: meeting.id, meetingTitle: meeting.title })))
    .filter((task) => {
      if (task.completed || !task.due_date) return false;
      const dueDate = new Date(`${task.due_date}T00:00:00`);
      if (Number.isNaN(dueDate.getTime())) return false;
      const daysLeft = Math.round((localDateStart(dueDate) - today) / 86400000);
      return daysLeft >= 0 && daysLeft <= 2;
    })
    .sort((first, second) => first.due_date.localeCompare(second.due_date));
}

function isDeadlineReminderDue(task, today = localDateStart()) {
  if (task.completed || !task.due_date || task.reminder_sent_for === task.due_date) return false;
  const dueDate = new Date(`${task.due_date}T00:00:00`);
  if (Number.isNaN(dueDate.getTime())) return false;
  const daysLeft = Math.round((localDateStart(dueDate) - localDateStart(today)) / 86400000);
  return daysLeft >= 0 && daysLeft <= 2;
}

function renderDeadlinePanel() {
  const panel = $("#deadline-panel");
  const tasks = deadlineTasks();
  panel.hidden = tasks.length === 0;
  if (!tasks.length) { panel.innerHTML = ""; return; }
  const items = tasks.map((task) => {
    const daysLeft = Math.round((localDateStart(new Date(`${task.due_date}T00:00:00`)) - localDateStart()) / 86400000);
    const when = daysLeft === 0 ? "Due today" : daysLeft === 1 ? "Due tomorrow" : "Due in 2 days";
    const dueDate = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(`${task.due_date}T00:00:00`));
    return `<li><span><b>${escapeHtml(task.title)}</b><small>${escapeHtml(task.owner)} · ${escapeHtml(task.meetingTitle)}</small></span><time>${when} · ${dueDate}</time></li>`;
  }).join("");
  const notificationText = typeof Notification === "undefined" ? "In-app reminders while Meetflow is open." : Notification.permission === "granted" ? "Browser deadline reminders are enabled." : "Enable browser notifications for desktop alerts while Meetflow is open.";
  panel.innerHTML = `<div class="deadline-panel-head"><div><div class="eyebrow muted-eyebrow">UPCOMING DEADLINES</div><h2>${tasks.length} action${tasks.length === 1 ? "" : "s"} due soon</h2></div><span class="deadline-note">${notificationText}</span></div><ul class="deadline-list">${items}</ul>`;
}

function updateReminderPermissionButton() {
  const button = $("#reminder-permission");
  if (typeof Notification === "undefined") {
    button.disabled = true;
    button.title = "Browser notifications are not supported here";
    button.setAttribute("aria-label", "Browser notifications are not supported");
    return;
  }
  button.disabled = Notification.permission === "denied";
  button.classList.toggle("connected", Notification.permission === "granted");
  button.title = Notification.permission === "granted" ? "Deadline reminders enabled" : Notification.permission === "denied" ? "Allow notifications in browser settings" : "Enable reminders 2 days before deadlines";
  button.setAttribute("aria-label", button.title);
}

async function enableDeadlineNotifications() {
  if (typeof Notification === "undefined") return showToast("This browser does not support desktop notifications. In-app reminders still appear here.");
  if (Notification.permission === "denied") return showToast("Notifications are blocked in browser settings. In-app reminders remain available.");
  const permission = await Notification.requestPermission();
  updateReminderPermissionButton();
  renderDeadlinePanel();
  if (permission === "granted") {
    showToast("Deadline reminders enabled.");
    await checkDeadlineReminders();
  } else {
    showToast("In-app reminders remain available when a deadline is close.");
  }
}

async function checkDeadlineReminders() {
  if (state.reminderCheckPromise) return state.reminderCheckPromise;
  state.reminderCheckPromise = (async () => {
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    const today = localDateStart();
    for (const meeting of state.meetings) {
      for (const task of meeting.tasks || []) {
        if (!task.due_date || task.reminder_sent_for === task.due_date) continue;
        const dueDate = new Date(`${task.due_date}T00:00:00`);
        if (Number.isNaN(dueDate.getTime())) continue;
        const reminderDate = new Date(dueDate);
        reminderDate.setDate(reminderDate.getDate() - 2);
        if (today < reminderDate || today > dueDate) continue;
        if (task.completed) continue;
        const daysLeft = Math.round((localDateStart(dueDate) - today) / 86400000);
        const when = daysLeft === 0 ? "due today" : daysLeft === 1 ? "due tomorrow" : "due in 2 days";
        try {
          new Notification(`Meeting action ${when}`, {
            body: `${task.title} · ${meeting.title}`,
            tag: `meetflow-${meeting.id}-${task.id}-${task.due_date}`,
          });
          await api(`/api/meetings/${meeting.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ taskId: task.id, reminderSentFor: task.due_date }),
          });
          task.reminder_sent_for = task.due_date;
        } catch (error) {
          showToast(`Could not save reminder status: ${error.message}`);
        }
      }
    }
  })();
  try { await state.reminderCheckPromise; }
  finally { state.reminderCheckPromise = null; }
}

function renderMeetings() {
  const query = $("#meeting-search").value.trim().toLowerCase();
  const meetings = state.meetings.filter((meeting) => `${meeting.title} ${meeting.summary}`.toLowerCase().includes(query));
  if (!state.sortNewest) meetings.reverse();
  $("#recent-count").textContent = meetings.length;
  $("#meeting-list").innerHTML = meetings.map((meeting) => {
    const open = (meeting.tasks || []).filter((task) => !task.completed).length;
    const source = meeting.source === "audio" ? "AssemblyAI · cloud" : meeting.source === "sample" ? "Sample" : "Notes";
    return `<article class="meeting-row" data-meeting-id="${escapeHtml(meeting.id)}" tabindex="0" role="button" aria-label="Open ${escapeHtml(meeting.title)}"><span class="meeting-file">≋</span><span class="meeting-meta"><span class="meeting-title">${escapeHtml(meeting.title)}</span><span class="meeting-subtitle">${escapeHtml(meeting.summary)}</span></span><span class="meeting-tags"><span class="tag">${open} open action${open === 1 ? "" : "s"}</span><span class="tag neutral">${source}</span></span><time class="meeting-date">${dateLabel(meeting.createdAt)}</time><span class="row-arrow">›</span></article>`;
  }).join("");
  $("#empty-state").hidden = meetings.length > 0;
  $$(".meeting-row").forEach((row) => {
    row.addEventListener("click", () => openMeeting(row.dataset.meetingId));
    row.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openMeeting(row.dataset.meetingId); } });
  });
}

function renderTimeline(meeting) {
  const timeline = $("#timeline");
  if (!timeline) return;
  timeline.dataset.meetingId = meeting?.id || "";
  if (!meeting || !meeting.events?.length) {
    timeline.innerHTML = `<div class="timeline-empty"><span class="timeline-icon">✳</span><b>Ready when you are</b><span>Upload a recording or try a sample to see the steps unfold.</span></div>`;
    return;
  }
  timeline.innerHTML = meeting.events.map((event) => `<div class="timeline-item"><span class="timeline-marker ${event.status === "processing" ? "processing" : ""}">${event.status === "processing" ? "·" : "✓"}</span><div class="timeline-text">${escapeHtml(event.label)}<small>${escapeHtml(event.detail)}</small><time class="timeline-time">${new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(event.time))}</time></div></div>`).join("");
}

function formatAssistantMarkdown(text) {
  if (!text) return "";
  const lines = text.split("\n");
  const htmlLines = [];
  let inList = false;

  for (let rawLine of lines) {
    let line = escapeHtml(rawLine);
    line = line.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    line = line.replace(/\*([^\*]+?)\*/g, "<em>$1</em>");

    if (line.startsWith("### ")) {
      if (inList) { htmlLines.push("</ul>"); inList = false; }
      htmlLines.push(`<h4 style="margin:8px 0 4px; font-size:12px; font-weight:600; color:#1e2926;">${line.slice(4)}</h4>`);
      continue;
    }

    if (line.startsWith("&gt; ")) {
      if (inList) { htmlLines.push("</ul>"); inList = false; }
      htmlLines.push(`<blockquote style="margin:4px 0 6px; padding:6px 10px; background:#f4f7f4; border-left:3px solid #6b9e7d; font-size:11px; border-radius:3px; color:#2c3e35;">${line.slice(5)}</blockquote>`);
      continue;
    }

    if (/^(?:•|-|\*)\s+/.test(line)) {
      if (!inList) { htmlLines.push(`<ul style="margin:4px 0 8px; padding-left:18px;">`); inList = true; }
      const content = line.replace(/^(?:•|-|\*)\s+/, "");
      htmlLines.push(`<li style="margin-bottom:4px; line-height:1.5;">${content}</li>`);
      continue;
    }

    if (/^\d+\.\s+/.test(line)) {
      if (inList) { htmlLines.push("</ul>"); inList = false; }
      const content = line.replace(/^\d+\.\s+/, "");
      htmlLines.push(`<div style="margin-bottom:5px; line-height:1.5;"><strong>${line.match(/^\d+\./)[0]}</strong> ${content}</div>`);
      continue;
    }

    if (inList) {
      htmlLines.push("</ul>");
      inList = false;
    }

    if (line.trim() === "") {
      htmlLines.push("<div style='height:4px;'></div>");
    } else {
      htmlLines.push(`<p style="margin:2px 0 4px; line-height:1.55;">${line}</p>`);
    }
  }

  if (inList) htmlLines.push("</ul>");
  return htmlLines.join("");
}

function renderMeetingChatMessages(meeting) {
  const container = $("#meeting-chat-messages");
  if (!container) return;
  state.meetingChats = state.meetingChats || {};
  if (!state.meetingChats[meeting.id] || !state.meetingChats[meeting.id].length) {
    state.meetingChats[meeting.id] = [
      {
        role: "assistant",
        content: `### 👋 Meeting Intelligence Chatbot\nI'm ready to answer any questions about **${meeting.title}**.\n\nPick a quick suggestion above, or ask me about:\n• Executive summary & discussion takeaways\n• Decisions and agreements\n• Action items, assignees, and deadlines\n• Specific topics or keyword searches across the full transcript`,
      }
    ];
  }
  const messages = state.meetingChats[meeting.id];
  container.innerHTML = messages.map((m) => {
    const isUser = m.role === "user";
    const isError = m.role === "error";
    const sender = isUser ? "You" : isError ? "Error" : "Meetflow AI";
    const body = isUser ? `<p style="margin:0; line-height:1.5;">${escapeHtml(m.content)}</p>` : formatAssistantMarkdown(m.content);
    return `
      <article class="meeting-chat-message ${m.role}">
        <span class="meeting-chat-role">${sender}</span>
        <div class="meeting-chat-body">${body}</div>
      </article>
    `;
  }).join("");
  container.scrollTop = container.scrollHeight;
}

function setupMeetingChat(meeting) {
  renderMeetingChatMessages(meeting);

  const chips = $$(".meeting-chat-chip");
  chips.forEach((chip) => {
    chip.addEventListener("click", () => {
      askMeetingChat(meeting, chip.dataset.query);
    });
  });

  const form = $("#meeting-chat-form");
  const input = $("#meeting-chat-input");
  if (form && input) {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      askMeetingChat(meeting, input.value);
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        askMeetingChat(meeting, input.value);
      }
    });
    input.focus();
  }
}

async function askMeetingChat(meeting, query) {
  const text = String(query || "").trim();
  if (!text || state.meetingChatBusy) return;
  const input = $("#meeting-chat-input");
  if (input) input.value = "";
  const sendBtn = $("#meeting-chat-send");
  if (sendBtn) sendBtn.disabled = true;

  state.meetingChats = state.meetingChats || {};
  state.meetingChats[meeting.id] = state.meetingChats[meeting.id] || [];
  state.meetingChats[meeting.id].push({ role: "user", content: text });
  state.meetingChatBusy = true;
  renderMeetingChatMessages(meeting);

  try {
    const history = state.meetingChats[meeting.id].slice(0, -1).slice(-8);
    const result = await api(`/api/meetings/${encodeURIComponent(meeting.id)}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: text, history }),
    });
    state.meetingChats[meeting.id].push({ role: "assistant", content: result.answer });
  } catch (error) {
    state.meetingChats[meeting.id].push({ role: "error", content: error.message || "Failed to get an answer." });
  } finally {
    state.meetingChatBusy = false;
    if (sendBtn) sendBtn.disabled = false;
    renderMeetingChatMessages(meeting);
    if (input) input.focus();
  }
}

function renderMeetingDetail(meeting) {
  const panel = $("#detail-panel");
  if (!meeting) { panel.hidden = true; return; }
  panel.hidden = false;
  panel.dataset.meetingId = meeting.id;
  const done = (meeting.tasks || []).filter((task) => task.completed).length;
  panel.innerHTML = `<header class="detail-header"><div><div class="eyebrow muted-eyebrow">PROJECT BRIEF · ${escapeHtml(dateLabel(meeting.createdAt).toUpperCase())}</div><h2>${escapeHtml(meeting.title)}</h2><p>${escapeHtml(meeting.source === "audio" ? "AssemblyAI cloud transcription" : meeting.source === "sample" ? "Sample meeting" : "Notes transcript")} · ${meeting.tasks.length} action items</p></div><div class="detail-actions"><button class="button button-light" id="rename-meeting" title="Rename meeting">✎ <span>Rename</span></button><button class="button button-light" id="export-document" title="Download project brief">↓ <span>Export</span></button><button class="button button-light button-danger" id="delete-meeting" title="Delete meeting" aria-label="Delete meeting">⌫</button></div></header>
  <nav class="detail-tabs" aria-label="Meeting details"><button class="detail-tab ${state.activeTab === "overview" ? "active" : ""}" data-tab="overview">Overview</button><button class="detail-tab ${state.activeTab === "chat" ? "active" : ""}" data-tab="chat">💬 Ask AI</button><button class="detail-tab ${state.activeTab === "transcript" ? "active" : ""}" data-tab="transcript">Transcript</button><button class="detail-tab ${state.activeTab === "document" ? "active" : ""}" data-tab="document">Project document</button></nav><div class="detail-content" id="detail-content">${detailTabContent(meeting)}</div>`;
  $$(".detail-tab").forEach((tab) => tab.addEventListener("click", () => { state.activeTab = tab.dataset.tab; renderMeetingDetail(meeting); }));
  $("#rename-meeting").addEventListener("click", renameMeeting);
  $("#export-document").addEventListener("click", () => exportDocument(meeting));
  $("#delete-meeting").addEventListener("click", () => deleteMeeting(meeting));
  if (state.activeTab === "overview") $$(".task-check").forEach((button) => button.addEventListener("click", () => toggleTask(meeting, button.dataset.taskId)));
  if (state.activeTab === "chat") setupMeetingChat(meeting);
  if (state.activeTab === "transcript") $("#reanalyze-button").addEventListener("click", () => reanalyze(meeting));
  if (state.activeTab === "document") $("#copy-document").addEventListener("click", () => copyDocument(meeting));
}

function detailTabContent(meeting) {
  if (state.activeTab === "chat") {
    return `
      <div class="meeting-chat-panel">
        <div class="meeting-chat-header">
          <div>
            <div class="eyebrow muted-eyebrow">MEETING INTELLIGENCE CHATBOT</div>
            <h3 style="margin:2px 0 0; font-family:var(--serif); font-size:18px; font-weight:400;">Ask about ${escapeHtml(meeting.title)}</h3>
          </div>
          <span class="tag" style="background:#eaf2eb; color:#2e644b;">● AI Ready</span>
        </div>
        <div class="meeting-chat-chips">
          <button type="button" class="meeting-chat-chip" data-query="Summarize the key points of this meeting">📋 Summarize overview</button>
          <button type="button" class="meeting-chat-chip" data-query="What are our action items and tasks?">✅ Action items</button>
          <button type="button" class="meeting-chat-chip" data-query="What decisions were made?">🎯 Key decisions</button>
          <button type="button" class="meeting-chat-chip" data-query="What deadlines were mentioned?">⏰ Deadlines & dates</button>
          <button type="button" class="meeting-chat-chip" data-query="Who participated in the meeting?">👥 Who participated?</button>
        </div>
        <div class="meeting-chat-messages" id="meeting-chat-messages" role="log" aria-live="polite"></div>
        <form id="meeting-chat-form" class="meeting-chat-form">
          <div class="meeting-chat-input-bar">
            <textarea id="meeting-chat-input" class="dialog-textarea meeting-chat-input" rows="2" placeholder="Ask anything about this meeting's decisions, tasks, or discussion… (Press Enter to send)" required maxlength="2000"></textarea>
            <button class="button button-dark meeting-chat-send" id="meeting-chat-send" type="submit">Ask <span>↗</span></button>
          </div>
        </form>
      </div>
    `;
  }
  if (state.activeTab === "transcript") return `<label class="field-label" for="transcript-editor">EDIT TRANSCRIPT</label><textarea class="transcript-area" id="transcript-editor">${escapeHtml(meeting.transcript)}</textarea><div class="transcript-actions"><span class="muted-eyebrow">Re-run extraction after editing</span><button class="button button-dark" id="reanalyze-button">Update project brief <span>↗</span></button></div>`;
  if (state.activeTab === "document") return `<div class="transcript-actions" style="margin:0 0 10px"><span class="muted-eyebrow">EDITABLE PROJECT DOCUMENT</span><button class="button button-light" id="copy-document">Copy brief</button></div><div class="project-document">${escapeHtml(buildDocument(meeting))}</div>`;
  const summaryBlock = meeting.summary ? `<div class="summary-callout" style="margin-bottom:14px;"><div class="eyebrow muted-eyebrow" style="margin-bottom:6px;">EXECUTIVE SUMMARY</div><p style="margin:0; font-size:12px; line-height:1.6; color:#2c3e35;">${escapeHtml(meeting.summary)}</p></div>` : "";
  const points = (meeting.main_points || []).map((point) => `<li class="main-point" style="margin-bottom:6px; line-height:1.5;">${escapeHtml(point.text)}</li>`).join("") || `<li class="main-point empty-point">No discussion points identified.</li>`;
  const decisionsHtml = (meeting.decisions || []).length ? (meeting.decisions || []).map((d) => `<div class="decision-item">✓ ${escapeHtml(d)}</div>`).join("") : `<div style="font-size:10px; color:#8a948e; padding:6px 0;">No explicit decisions detected.</div>`;
  const tasksHtml = (meeting.tasks || []).length ? (meeting.tasks || []).map((t) => `<div class="task-item ${t.completed ? 'completed' : ''}"><button class="task-check ${t.completed ? 'done' : ''}" data-task-id="${escapeHtml(t.id)}">${t.completed ? '✓' : ''}</button><div class="task-title">${escapeHtml(t.title)}<div class="task-sub">${escapeHtml(t.owner)}${t.due ? ' · Due ' + escapeHtml(t.due) : ''}</div></div></div>`).join("") : `<div style="font-size:10px; color:#8a948e; padding:6px 0;">No action items detected.</div>`;
  return `
    ${summaryBlock}
    <section class="summary-callout" style="background:#f7f9f6; margin-bottom:18px;">
      <div class="eyebrow muted-eyebrow" style="margin-bottom:8px;">KEY DISCUSSION TAKEAWAYS</div>
      <ol class="main-points" style="margin:0; padding-left:18px;">${points}</ol>
    </section>
    <div class="detail-columns">
      <div>
        <div class="eyebrow muted-eyebrow" style="margin-bottom:8px;">DECISIONS (${(meeting.decisions || []).length})</div>
        <div class="decisions-list">${decisionsHtml}</div>
      </div>
      <div>
        <div class="eyebrow muted-eyebrow" style="margin-bottom:8px;">ACTION ITEMS (${(meeting.tasks || []).length})</div>
        <div class="tasks-list">${tasksHtml}</div>
      </div>
    </div>
  `;
}

function markdownEvidence(evidence) {
  const lines = String(evidence || "No source evidence recorded.").split("\n");
  if (lines.length > 5) {
    return lines.slice(0, 4).map((line) => `  > ${line}`).join("\n") + "\n  > [...]";
  }
  return lines.map((line) => `  > ${line}`).join("\n");
}

function buildDocument(meeting) {
  const happened = (meeting.main_points || []).length ? meeting.main_points.map((point) => `- **${point.text}**\n  - Why included: ${point.reason}\n  - Rank score: ${point.score} (ordering aid, not a confidence estimate).\n  - Source excerpt:\n${markdownEvidence(point.evidence)}`).join("\n") : "- No discussion points identified; review the transcript.";
  const decisions = meeting.decisions.length ? meeting.decisions.map((decision, index) => {
    const audit = (meeting.decision_audit || []).find((item) => item.statement === decision);
    return `- **D${String(index + 1).padStart(2, "0")}: ${decision}**\n  - Rule: ${audit?.rule || "Legacy decision cue match; re-analyze to see full rationale."}${audit ? ` (${audit.matched_cue})` : ""}\n  - Why included: ${audit?.reason || "Audit details were not stored for this older record."}\n  - Evidence:\n${markdownEvidence(audit?.evidence || decision)}`;
  }).join("\n") : "- No explicit decisions detected.";
  const tasks = meeting.tasks.length ? meeting.tasks.map((task) => `- [${task.completed ? "x" : " "}] **${task.title}**\n  - Owner: ${task.owner}${task.audit?.owner_reason ? ` — ${task.audit.owner_reason}` : ""}\n  - Due: ${taskDueLabel(task)}${task.audit?.due_reason ? ` — ${task.audit.due_reason}` : ""}\n  - Rule: ${task.audit?.rule || "Legacy action cue match; re-analyze to see full rationale."}; matched cues: ${(task.audit?.matched_cues || []).join(", ") || "not recorded"}.\n  - Evidence:\n${markdownEvidence(task.audit?.source || task.evidence || task.title)}`).join("\n") : "- No action items detected.";
  const questions = (meeting.open_questions || []).map((item) => `- ${item.text}\n  - Why flagged: ${item.reason}\n  - Evidence:\n${markdownEvidence(item.evidence)}`).join("\n") || "- No explicit open questions detected.";
  const risks = (meeting.risks || []).map((item) => `- ${item.text}\n  - Why flagged: ${item.reason}\n  - Evidence:\n${markdownEvidence(item.evidence)}`).join("\n") || "- No risk cues detected; this does not mean there are no risks.";
  const methods = meeting.analysis_method || {};
  return `# ${meeting.title}\n\n> Project documentation · ${dateLabel(meeting.createdAt)} · Source: ${meeting.source}\n\n## Summary\n${meeting.summary || "No summary points identified."}\n\n## What happened\n${happened}\n\n## Decisions\n${decisions}\n\n## To-dos\n${tasks}\n\n## Open questions and risks\n### Open questions\n${questions}\n\n### Risks and concerns\n${risks}\n\n## Audit method and limitations\n- Summary: ${methods.summary || "Legacy summary; re-analyze the transcript to generate ranked, evidence-linked main points."}\n- Decisions: ${methods.decisions || "Decision details were not stored for this older record."}\n- Actions and ownership: ${methods.tasks || "Action details were not stored for this older record."}\n- Open items: ${methods.open_items || "Open-item details were not stored for this older record."}\n- Rank scores order extracted points; they are not confidence or truth scores.\n- Speaker labels distinguish voices; they do not identify real people by name.\n- All extracted statements are review suggestions, not verified facts.\n\n## Full transcript\n\n${meeting.transcript}`;
}

function exportDocument(meeting) {
  const blob = new Blob([buildDocument(meeting)], { type: "text/markdown;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${meeting.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "meeting"}-brief.md`;
  document.body.append(link);
  link.click();
  setTimeout(() => { URL.revokeObjectURL(link.href); link.remove(); }, 1000);
  showToast("Project brief downloaded.");
}

async function copyDocument(meeting) {
  await navigator.clipboard.writeText(buildDocument(meeting));
  showToast("Project brief copied to clipboard.");
}

async function loadMeetings() {
  state.meetings = await api("/api/meetings");
  updateOverview();
  renderMeetings();
  renderAllActions();
  renderTimeline(state.meetings.find((meeting) => meeting.id === state.activeId) || state.meetings[0]);
  await checkDeadlineReminders();
}

async function loadProviderStatus() {
  const status = await api("/api/status");
  state.providerConfigured = status.configured;
  state.assistantConfigured = status.assistantConfigured;
  $("#provider-label").textContent = status.configured ? "AssemblyAI ready" : "AssemblyAI not configured";
  $("#provider-status").classList.toggle("connected", status.configured);
  $("#provider-status").title = status.configured ? "AssemblyAI configured on the server" : "AssemblyAI key is not configured on the server";

  const isSupabase = status.supabaseConfigured;
  const isNeon = status.neonConfigured;
  const dbText = status.dbProvider || (isSupabase ? "Supabase PostgreSQL" : isNeon ? "Neon PostgreSQL" : "Local Database");
  const dbPill = $("#topbar-db-pill");
  if (dbPill) {
    dbPill.classList.toggle("connected", true);
    $("#topbar-db-label").textContent = dbText;
    dbPill.title = `Database Provider: ${dbText}`;
  }
  const sideDbTitle = $("#sidebar-db-title");
  if (sideDbTitle) sideDbTitle.textContent = dbText;
  const sideDbSub = $("#sidebar-db-sub");
  if (sideDbSub) sideDbSub.textContent = isSupabase ? "Supabase Cloud" : isNeon ? "Neon Serverless" : "SQLite fallback";
  const sideDbBlock = $("#sidebar-db-status");
  if (sideDbBlock) sideDbBlock.querySelector(".status-dot")?.classList.toggle("connected", true);
}

function renderAssistantMessages() {
  const container = $("#assistant-messages");
  if (!state.assistantMessages.length) {
    container.innerHTML = `<div class="assistant-welcome"><b>What came up in your meetings?</b><span>Ask about decisions, owners, follow-ups, or dates.</span><div class="assistant-suggestions"><button class="assistant-suggestion" type="button">What deadlines are coming up?</button><button class="assistant-suggestion" type="button">Summarize my latest meeting</button></div></div>`;
    container.querySelectorAll(".assistant-suggestion").forEach((button) => button.addEventListener("click", () => askAssistant(button.textContent)));
    return;
  }
  container.innerHTML = state.assistantMessages.map((message) => {
    const isUser = message.role === "user";
    const body = isUser ? `<p>${escapeHtml(message.content)}</p>` : formatAssistantMarkdown(message.content);
    return `<article class="assistant-message ${message.role}"><span>${isUser ? "You" : message.role === "error" ? "Couldn't answer" : "Meetflow"}</span><div class="assistant-content">${body}</div></article>`;
  }).join("");
  container.scrollTop = container.scrollHeight;
}

async function showAssistantDialog() {
  await loadProviderStatus();
  $("#assistant-setup").hidden = state.assistantConfigured;
  $("#assistant-chat").hidden = !state.assistantConfigured;
  renderAssistantMessages();
  $("#assistant-dialog").showModal();
  $(state.assistantConfigured ? "#assistant-question" : "#assistant-key").focus();
}

async function askAssistant(question) {
  const input = $("#assistant-question");
  const cleanedQuestion = String(question || "").trim();
  if (!cleanedQuestion || state.assistantBusy) return;
  input.value = "";
  state.assistantMessages.push({ role: "user", content: cleanedQuestion });
  state.assistantBusy = true;
  $("#assistant-send").disabled = true;
  renderAssistantMessages();
  const history = state.assistantMessages.slice(0, -1).slice(-10);
  try {
    const result = await api("/api/assistant/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: cleanedQuestion, history }),
    });
    state.assistantMessages.push({ role: "assistant", content: result.answer });
  } catch (error) {
    state.assistantMessages.push({ role: "error", content: error.message });
  } finally {
    state.assistantBusy = false;
    $("#assistant-send").disabled = false;
    renderAssistantMessages();
    input.focus();
  }
}

async function openMeeting(meetingId) {
  const requestId = ++state.detailRequest;
  state.activeId = meetingId;
  try {
    const meeting = await api(`/api/meetings/${encodeURIComponent(meetingId)}`);
    if (requestId !== state.detailRequest || state.activeId !== meetingId) return;
    const index = state.meetings.findIndex((item) => item.id === meetingId);
    if (index === -1) state.meetings.unshift(meeting);
    else state.meetings[index] = meeting;
    state.activeTab = "overview";
    updateOverview();
    renderMeetings();
    renderAllActions();
    renderMeetingDetail(meeting);
    renderTimeline(meeting);
    $("#detail-panel").scrollIntoView({ behavior: "smooth", block: "nearest" });
  } catch (error) {
    if (requestId !== state.detailRequest) return;
    state.activeId = null;
    await loadMeetings();
    showToast(`Meeting could not be opened: ${error.message}`);
  }
}

async function createSample() {
  try {
    const meeting = await api("/api/meetings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: SAMPLE_TITLE, transcript: SAMPLE_TRANSCRIPT, source: "sample" }) });
    await loadMeetings();
    openMeeting(meeting.id);
    showToast("Sample brief created. Review the decisions and owners.");
  } catch (error) { showToast(error.message); }
}

function showDialog() {
  $("#meeting-dialog").showModal();
  $("#notes-title").focus();
}

async function renameMeeting() {
  const meeting = state.meetings.find((item) => item.id === state.activeId);
  if (!meeting) return;
  const title = window.prompt("Rename this meeting", meeting.title);
  if (title === null || !title.trim()) return;
  await api(`/api/meetings/${meeting.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title }) });
  await loadMeetings();
  renderMeetingDetail(state.meetings.find((item) => item.id === meeting.id));
  showToast("Meeting renamed.");
}

async function deleteMeeting(meeting) {
  if (!window.confirm(`Delete “${meeting.title}” and its project brief? This cannot be undone.`)) return;
  try {
    await api(`/api/meetings/${meeting.id}`, { method: "DELETE" });
    state.detailRequest++;
    state.activeId = null;
    state.activeTab = "overview";
    await loadMeetings();
    $("#detail-panel").hidden = true;
    showToast("Meeting and project brief deleted.");
  } catch (error) { showToast(error.message); }
}

async function removeAction(meetingId, taskId) {
  const meeting = state.meetings.find((item) => item.id === meetingId);
  const task = meeting?.tasks.find((item) => item.id === taskId);
  if (!meeting || !task) return;
  if (!window.confirm(`Remove “${task.title}” from “${meeting.title}”? The meeting transcript will be kept.`)) return;
  try {
    await api(`/api/meetings/${meetingId}/tasks/${taskId}`, { method: "DELETE" });
    await loadMeetings();
    const updated = state.meetings.find((item) => item.id === meetingId);
    if (state.activeId === meetingId && updated) renderMeetingDetail(updated);
    showToast("Action removed. The source meeting was kept.");
  } catch (error) { showToast(error.message); }
}

async function clearAllMeetings() {
  const count = state.meetings.length;
  if (!count) return;
  const message = `Permanently remove all ${count} saved meetings, transcripts, actions, and project documents? This cannot be undone. Source audio files are not stored by Meetflow.`;
  if (!window.confirm(message)) return;
  try {
    const result = await api("/api/meetings", { method: "DELETE" });
    state.detailRequest++;
    state.activeId = null;
    state.activeTab = "overview";
    await loadMeetings();
    $("#detail-panel").hidden = true;
    renderTimeline(null);
    showToast(`Cleared ${result.cleared} saved meeting${result.cleared === 1 ? "" : "s"}.`);
  } catch (error) { showToast(error.message); }
}

async function toggleTask(meeting, taskId, actionButton = null) {
  const task = meeting.tasks.find((item) => item.id === taskId);
  const completing = !task.completed;
  const row = completing ? actionButton?.closest(".all-action-row") : null;
  const exitAnimation = row ? new Promise((resolve) => {
    const finish = () => { clearTimeout(fallback); resolve(); };
    const fallback = setTimeout(finish, 400);
    row.addEventListener("transitionend", (event) => { if (event.propertyName === "transform") finish(); });
    row.classList.add("completing");
  }) : Promise.resolve();
  try {
    await Promise.all([
      api(`/api/meetings/${meeting.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ taskId, completed: completing }) }),
      exitAnimation,
    ]);
    await loadMeetings();
    const updated = state.meetings.find((item) => item.id === meeting.id);
    if (state.view !== "actions") renderMeetingDetail(updated);
    showToast(completing ? "Action completed." : "Action reopened.");
  } catch (error) {
    row?.classList.remove("completing");
    showToast(error.message);
  }
}

async function reanalyze(meeting) {
  try {
    const updated = await api(`/api/meetings/${meeting.id}/analyze`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ transcript: $("#transcript-editor").value }) });
    await loadMeetings();
    renderMeetingDetail(state.meetings.find((item) => item.id === updated.id));
    showToast("Project brief updated from the transcript.");
  } catch (error) { showToast(error.message); }
}

function renderAllActions() {
  const list = $("#all-actions");
  const previousPositions = new Map([...list.children].map((row) => [row.dataset.taskId, row.getBoundingClientRect().top]));
  const items = state.meetings.flatMap((meeting) => meeting.tasks.map((task) => ({ ...task, meetingId: meeting.id, meetingTitle: meeting.title }))).filter((task) => !task.completed);
  $("#my-actions-count").textContent = items.length;
  list.innerHTML = items.map((task) => `<div class="all-action-row" data-task-id="${escapeHtml(task.id)}"><button class="task-check" data-meeting-id="${escapeHtml(task.meetingId)}" data-task-id="${escapeHtml(task.id)}" aria-label="Complete action"></button><span class="task-title">${escapeHtml(task.title)}<span class="task-sub">${escapeHtml(task.owner)}</span></span><span class="all-action-meeting">${escapeHtml(task.meetingTitle)}</span><span class="task-due">${escapeHtml(taskDueLabel(task))}</span><span class="all-action-meeting">Open</span><button class="action-remove" data-meeting-id="${escapeHtml(task.meetingId)}" data-task-id="${escapeHtml(task.id)}" aria-label="Remove action" title="Remove action">⌫</button></div>`).join("");
  $$("#all-actions .all-action-row").forEach((row) => {
    const previousTop = previousPositions.get(row.dataset.taskId);
    if (previousTop === undefined) return;
    const offset = previousTop - row.getBoundingClientRect().top;
    if (Math.abs(offset) > 1) row.animate([{ transform: `translateY(${offset}px)` }, { transform: "translateY(0)" }], { duration: 260, easing: "ease-out" });
  });
  $("#actions-empty").hidden = items.length > 0;
  $$("#all-actions .task-check").forEach((button) => button.addEventListener("click", async () => {
    const meeting = state.meetings.find((item) => item.id === button.dataset.meetingId);
    await toggleTask(meeting, button.dataset.taskId, button);
  }));
  $$("#all-actions .action-remove").forEach((button) => button.addEventListener("click", () => removeAction(button.dataset.meetingId, button.dataset.taskId)));
}

function switchView(view) {
  state.view = view;
  const isMeetings = view === "meetings";
  const isBoss = view === "boss";
  const isActions = view === "actions";
  const isAnalytics = view === "analytics";
  const isTeam = view === "team";
  const isCalendar = view === "calendar";
  const isSettings = view === "settings";

  $("#meetings-view").hidden = !isMeetings;
  $("#actions-view").hidden = !isActions;
  $("#upload-panel").hidden = !isMeetings;
  const bossView = $("#boss-view");
  if (bossView) bossView.hidden = !isBoss;
  const analyticsView = $("#analytics-view");
  if (analyticsView) analyticsView.hidden = !isAnalytics;
  const teamView = $("#team-view");
  if (teamView) teamView.hidden = !isTeam;
  const calendarView = $("#calendar-view");
  if (calendarView) calendarView.hidden = !isCalendar;
  const settingsView = $("#settings-view");
  if (settingsView) settingsView.hidden = !isSettings;

  $("#detail-panel").hidden = !isMeetings || !state.activeId;

  if (isBoss) {
    if (window.location.pathname !== "/boss" && window.location.hash !== "#boss") {
      try { history.pushState(null, "", "/boss"); } catch {}
    }
  } else if (window.location.pathname === "/boss") {
    try { history.pushState(null, "", "/#app"); } catch {}
  }

  if (isMeetings) {
    $("#page-title").textContent = "Your meetings.";
    $("#page-subtitle").textContent = "Recordings, notes, decisions, and actions in one place.";
    $("#crumb-page").textContent = "Meetings";
    loadBossBanner();
  } else if (isBoss) {
    $("#page-title").textContent = "Executive Portal & Meet Links.";
    $("#page-subtitle").textContent = "Schedule company meetings, generate Google Meet links, and broadcast agendas to employees.";
    $("#crumb-page").textContent = "Boss Portal";
    loadBossMeetings();
  } else if (isActions) {
    $("#page-title").textContent = "Your open actions.";
    $("#page-subtitle").textContent = "Follow-ups and deadlines from your saved meetings.";
    $("#crumb-page").textContent = "My actions";
    renderAllActions();
  } else if (isAnalytics) {
    $("#page-title").textContent = "Monthly Attendance.";
    $("#page-subtitle").textContent = "Track your meeting participation, frequency, and time spent across months.";
    $("#crumb-page").textContent = "Monthly Analytics";
    loadMonthlyAnalytics(state.analyticsRange);
  } else if (isTeam) {
    $("#page-title").textContent = "Team Directory.";
    $("#page-subtitle").textContent = "Connect with colleagues, track attendance badges, and view roles.";
    $("#crumb-page").textContent = "Team Directory";
    loadTeamDirectory();
  } else if (isCalendar) {
    $("#page-title").textContent = "Meeting Schedule & Calendar.";
    $("#page-subtitle").textContent = "Monthly calendar view of your attended meetings and upcoming reviews.";
    $("#crumb-page").textContent = "Calendar";
    renderCalendar();
  } else if (isSettings) {
    $("#page-title").textContent = "Settings & Database.";
    $("#page-subtitle").textContent = "Configure Supabase PostgreSQL, view connection details, and manage profile.";
    $("#crumb-page").textContent = "Settings & DB";
    loadSupabaseSettings();
  }

  $$(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.view === view));
}
window.switchView = switchView;

/* =========================================================
   Monthly Attendance Analytics & Chart
   ========================================================= */
async function loadMonthlyAnalytics(range = 12) {
  state.analyticsRange = range;
  $$("#analytics-range-controls .filter-chip").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.range === String(range));
  });

  const wrap = $("#chart-canvas-wrap");
  if (!wrap) return;
  wrap.innerHTML = `<div class="chart-loading" style="padding:40px; text-align:center; color:#728277;">Loading attendance data…</div>`;

  try {
    const data = await api(`/api/analytics/monthly?range=${range}`);
    state.analyticsData = data;

    $("#analytics-total-meetings").textContent = data.totalMeetings;
    $("#analytics-avg-monthly").textContent = Number(data.avgMonthly).toFixed(1);
    $("#analytics-total-hours").textContent = `${Number(data.totalHours).toFixed(1)}h`;
    $("#analytics-total-tasks").textContent = data.totalTasks;

    renderMonthlyChart(data);
    renderRecentAttendance(data.recentMeetings || []);
  } catch (err) {
    wrap.innerHTML = `<div class="empty-state-sm" style="color:#a12b2b;">Failed to load analytics: ${escapeHtml(err.message)}</div>`;
  }
}

function renderMonthlyChart(data) {
  const wrap = $("#chart-canvas-wrap");
  if (!wrap) return;
  const months = data.months || [];
  if (!months.length) {
    wrap.innerHTML = `<div class="empty-state-sm">No attendance records in this period.</div>`;
    return;
  }

  const width = 740;
  const height = 270;
  const paddingLeft = 45;
  const paddingRight = 30;
  const paddingTop = 30;
  const paddingBottom = 40;

  const chartW = width - paddingLeft - paddingRight;
  const chartH = height - paddingTop - paddingBottom;

  const maxVal = Math.max(...months.map((m) => m.count), 1);
  const niceMax = Math.max(Math.ceil((maxVal * 1.25) / 5) * 5, 5);

  const barCount = months.length;
  const slotW = chartW / barCount;
  const barW = Math.min(Math.max(slotW * 0.55, 16), 44);

  let gridSvg = "";
  const steps = 4;
  for (let i = 0; i <= steps; i++) {
    const val = Math.round((niceMax / steps) * i);
    const y = paddingTop + chartH - (val / niceMax) * chartH;
    gridSvg += `
      <line class="chart-axis-line" x1="${paddingLeft}" y1="${y}" x2="${width - paddingRight}" y2="${y}" />
      <text class="chart-axis-text" x="${paddingLeft - 8}" y="${y + 3}" text-anchor="end">${val}</text>
    `;
  }

  const avgY = paddingTop + chartH - (data.avgMonthly / niceMax) * chartH;
  const avgLineSvg = `
    <line class="chart-avg-line" x1="${paddingLeft}" y1="${avgY}" x2="${width - paddingRight}" y2="${avgY}" />
    <text x="${width - paddingRight + 4}" y="${avgY + 3}" fill="#e58835" font-size="9" font-weight="600" text-anchor="start">Avg ${data.avgMonthly}</text>
  `;

  let barsSvg = "";
  months.forEach((m, idx) => {
    const cx = paddingLeft + idx * slotW + slotW / 2;
    const x = cx - barW / 2;
    const barH = (m.count / niceMax) * chartH;
    const y = paddingTop + chartH - barH;

    barsSvg += `
      <g class="chart-bar-group" data-label="${escapeHtml(m.label)}" data-count="${m.count}" data-hours="${m.hours}" data-tasks="${m.tasks}">
        <rect class="chart-bar-rect" x="${x}" y="${y}" width="${barW}" height="${Math.max(barH, 2)}" rx="4" ry="4" />
        <text class="chart-bar-label" x="${cx}" y="${y - 6}">${m.count > 0 ? m.count : ""}</text>
        <text class="chart-axis-text" x="${cx}" y="${height - paddingBottom + 18}" text-anchor="middle">${escapeHtml(m.label)}</text>
      </g>
    `;
  });

  wrap.innerHTML = `
    <svg class="chart-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet">
      ${gridSvg}
      ${avgLineSvg}
      ${barsSvg}
    </svg>
    <div class="chart-tooltip" id="chart-tooltip"></div>
  `;

  const tooltip = $("#chart-tooltip");
  wrap.querySelectorAll(".chart-bar-group").forEach((group) => {
    group.addEventListener("mouseenter", () => {
      const rect = group.querySelector("rect").getBoundingClientRect();
      const wrapRect = wrap.getBoundingClientRect();
      const label = group.dataset.label;
      const count = group.dataset.count;
      const hours = group.dataset.hours;
      const tasks = group.dataset.tasks;

      tooltip.innerHTML = `
        <strong>${label}</strong><br>
        Meetings attended: <b>${count}</b><br>
        Meeting time: <b>${hours} hrs</b><br>
        Action items: <b>${tasks}</b>
      `;
      tooltip.style.left = `${rect.left - wrapRect.left + rect.width / 2}px`;
      tooltip.style.top = `${rect.top - wrapRect.top - 8}px`;
      tooltip.classList.add("visible");
    });
    group.addEventListener("mouseleave", () => {
      tooltip.classList.remove("visible");
    });
  });
}

function renderRecentAttendance(recent) {
  const container = $("#analytics-recent-list");
  if (!container) return;
  if (!recent || !recent.length) {
    container.innerHTML = `<div class="empty-state-sm">No meetings recorded recently.</div>`;
    return;
  }
  container.innerHTML = recent.map((item) => {
    const dt = new Date(item.attended_at);
    const dateFormatted = isNaN(dt.getTime()) ? item.attended_at : new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(dt);
    return `
      <div class="attendance-row">
        <div class="attendance-row-left">
          <span style="font-size:16px;">📅</span>
          <div>
            <div class="attendance-row-title">${escapeHtml(item.meeting_title)}</div>
            <div class="attendance-row-meta">${dateFormatted} · ${item.duration_minutes || 45} mins</div>
          </div>
        </div>
        <div class="attendance-row-badge">
          Attended · ${item.tasks_count || 0} action${item.tasks_count === 1 ? "" : "s"}
        </div>
      </div>
    `;
  }).join("");
}

/* =========================================================
   Team Directory
   ========================================================= */
async function loadTeamDirectory() {
  try {
    const list = await api("/api/employees");
    state.teamMembers = list;
    renderTeamGrid();
  } catch (err) {
    showToast(err.message);
  }
}

function renderTeamGrid() {
  const query = $("#team-search")?.value.trim().toLowerCase() || "";
  const members = (state.teamMembers || []).filter((m) =>
    `${m.name} ${m.email} ${m.role} ${m.department}`.toLowerCase().includes(query)
  );
  const countEl = $("#team-count");
  if (countEl) countEl.textContent = members.length;
  const grid = $("#team-grid");
  if (!grid) return;
  if (!members.length) {
    grid.innerHTML = `<div class="empty-state-sm" style="grid-column: 1/-1;">No team members found matching "${escapeHtml(query)}".</div>`;
    return;
  }
  grid.innerHTML = members.map((m) => {
    const initials = m.name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase() || "MF";
    return `
      <article class="team-card">
        <div class="team-card-head">
          <div class="team-avatar">${initials}</div>
          <div class="team-card-info">
            <h4 class="team-name">${escapeHtml(m.name)}</h4>
            <p class="team-role">${escapeHtml(m.role || "Team Member")}</p>
            <span class="team-dept">${escapeHtml(m.department || "General")}</span>
          </div>
        </div>
        <div class="team-meta">
          <span style="color:#728277; font-size:10px;">${escapeHtml(m.email)}</span>
          <span class="team-badge">${m.meetings_attended || 0} attended</span>
        </div>
      </article>
    `;
  }).join("");
}

/* =========================================================
   Calendar View
   ========================================================= */
function renderCalendar() {
  const monthTitle = $("#calendar-month-title");
  const grid = $("#calendar-grid");
  if (!monthTitle || !grid) return;

  const current = state.calendarDate || new Date();
  const year = current.getFullYear();
  const month = current.getMonth();

  const monthName = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(current);
  monthTitle.textContent = `${monthName}`;

  const firstDay = new Date(year, month, 1).getDay();
  const startOffset = (firstDay + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();

  const today = new Date();
  let cellsHtml = "";

  for (let i = startOffset - 1; i >= 0; i--) {
    const dayNum = daysInPrevMonth - i;
    cellsHtml += `<div class="calendar-day-cell cell-other-month"><span class="calendar-day-num">${dayNum}</span></div>`;
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const isToday = today.getFullYear() === year && today.getMonth() === month && today.getDate() === d;
    const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

    const dayMeetings = state.meetings.filter((m) => m.createdAt && m.createdAt.startsWith(dateStr));
    const dayBossMeetings = (state.bossMeetings || []).filter((bm) => bm.scheduled_at && bm.scheduled_at.startsWith(dateStr));
    const dayTasks = state.meetings.flatMap((m) => (m.tasks || []).map((t) => ({ ...t, meetingId: m.id }))).filter((t) => t.due_date === dateStr);

    let pillsHtml = "";
    dayBossMeetings.forEach((bm) => {
      pillsHtml += `<div class="calendar-event-pill boss-event" data-meet-link="${escapeHtml(bm.meet_link)}" style="background:#eef6f1; border-color:#245e43; color:#184c34; font-weight:600;" title="Executive Meet: ${escapeHtml(bm.title)}">👑 ${escapeHtml(bm.title)}</div>`;
    });
    dayMeetings.forEach((m) => {
      pillsHtml += `<div class="calendar-event-pill" data-meeting-id="${escapeHtml(m.id)}" title="${escapeHtml(m.title)}">${escapeHtml(m.title)}</div>`;
    });
    dayTasks.forEach((t) => {
      pillsHtml += `<div class="calendar-event-pill sample-event" data-meeting-id="${escapeHtml(t.meetingId)}" title="Due: ${escapeHtml(t.title)}">✓ ${escapeHtml(t.title)}</div>`;
    });

    if (!dayMeetings.length && !dayBossMeetings.length && !dayTasks.length && (d === 8 || d === 15 || d === 22)) {
      pillsHtml += `<div class="calendar-event-pill sample-event">Team Sync (10:00 AM)</div>`;
    }

    cellsHtml += `
      <div class="calendar-day-cell ${isToday ? "cell-today" : ""}">
        <span class="calendar-day-num">${d}</span>
        ${pillsHtml}
      </div>
    `;
  }

  const totalCells = startOffset + daysInMonth;
  const remaining = (7 - (totalCells % 7)) % 7;
  for (let d = 1; d <= remaining; d++) {
    cellsHtml += `<div class="calendar-day-cell cell-other-month"><span class="calendar-day-num">${d}</span></div>`;
  }

  grid.innerHTML = cellsHtml;

  grid.querySelectorAll(".calendar-event-pill[data-meeting-id]").forEach((pill) => {
    pill.addEventListener("click", () => {
      switchView("meetings");
      openMeeting(pill.dataset.meetingId);
    });
  });
  grid.querySelectorAll(".calendar-event-pill[data-meet-link]").forEach((pill) => {
    pill.addEventListener("click", () => {
      window.open(pill.dataset.meetLink, "_blank", "noopener,noreferrer");
    });
  });
}

/* =========================================================
   Boss / Executive Portal & Google Meet Scheduling
   ========================================================= */
async function loadBossMeetings() {
  try {
    const meetings = await api("/api/boss/meetings");
    state.bossMeetings = meetings;
    renderBossMeetings(meetings);
  } catch (err) {
    showToast(err.message);
  }
}

function renderBossMeetings(meetings = []) {
  const countEl = $("#boss-meetings-count");
  if (countEl) countEl.textContent = meetings.length;
  const listEl = $("#boss-meetings-list");
  if (!listEl) return;

  if (!meetings.length) {
    listEl.innerHTML = `
      <div class="empty-state" style="padding:28px 16px; text-align:center;">
        <span style="font-size:24px; display:block; margin-bottom:6px;">👑</span>
        <b>No meetings scheduled yet.</b>
        <span style="font-size:12px; color:#728277; display:block; margin-top:4px;">Use the broadcast form on the left to schedule your first meeting and post a Google Meet link.</span>
      </div>
    `;
    return;
  }

  listEl.innerHTML = meetings.map((m) => {
    let dateStr = m.scheduled_at;
    try {
      const d = new Date(m.scheduled_at);
      dateStr = new Intl.DateTimeFormat(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit"
      }).format(d);
    } catch {}

    const isCompleted = m.status === "completed";
    const statusClass = isCompleted ? "status-badge-completed" : "status-badge-scheduled";
    const statusLabel = isCompleted ? "Completed" : "Scheduled";

    return `
      <div class="scheduled-meet-item" data-id="${escapeHtml(m.id)}">
        <div class="scheduled-meet-head">
          <div>
            <div class="scheduled-meet-title">${escapeHtml(m.title)}</div>
            <div class="scheduled-meet-time">
              <span>📅 ${dateStr}</span>
              <span>·</span>
              <span>⏱ ${m.duration_minutes || 45} mins</span>
            </div>
          </div>
          <div class="scheduled-meet-badges">
            <span class="dept-badge">${escapeHtml(m.department || "All Departments")}</span>
            <span class="${statusClass}">${statusLabel}</span>
          </div>
        </div>

        ${m.agenda ? `<div class="scheduled-meet-agenda">${escapeHtml(m.agenda)}</div>` : ""}

        <div class="scheduled-meet-footer">
          <a class="meet-link-btn" href="${escapeHtml(m.meet_link)}" target="_blank" rel="noopener noreferrer">
            <span class="meet-icon-dot"></span>
            <span>Join Google Meet ↗</span>
          </a>

          <div class="meet-item-actions">
            <button class="button button-outline copy-link-btn" data-link="${escapeHtml(m.meet_link)}" style="height:30px; font-size:11px; padding:0 10px;" type="button">Copy Link</button>
            ${!isCompleted ? `<button class="button button-outline complete-meeting-btn" data-id="${escapeHtml(m.id)}" style="height:30px; font-size:11px; padding:0 10px;" type="button">✓ Complete</button>` : ""}
            <button class="action-remove delete-meeting-btn" data-id="${escapeHtml(m.id)}" title="Delete meeting" type="button">✕</button>
          </div>
        </div>
      </div>
    `;
  }).join("");

  listEl.querySelectorAll(".copy-link-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      navigator.clipboard.writeText(btn.dataset.link);
      showToast("Google Meet link copied to clipboard!");
    });
  });

  listEl.querySelectorAll(".complete-meeting-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        await api(`/api/boss/meetings/${btn.dataset.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "completed" })
        });
        showToast("Meeting marked as completed.");
        await loadBossMeetings();
        await loadBossBanner();
      } catch (err) {
        showToast(err.message);
      }
    });
  });

  listEl.querySelectorAll(".delete-meeting-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("Are you sure you want to remove this scheduled meeting?")) return;
      try {
        await api(`/api/boss/meetings/${btn.dataset.id}`, { method: "DELETE" });
        showToast("Scheduled meeting removed.");
        await loadBossMeetings();
        await loadBossBanner();
      } catch (err) {
        showToast(err.message);
      }
    });
  });
}

async function handleBossScheduleSubmit(e) {
  e.preventDefault();
  const title = $("#boss-meeting-title").value.trim();
  const dateInput = $("#boss-meeting-date").value;
  const duration = parseInt($("#boss-meeting-duration").value, 10) || 45;
  const dept = $("#boss-meeting-dept").value;
  const meetLink = $("#boss-meet-link").value.trim();
  const agenda = $("#boss-meeting-agenda").value.trim();
  const submitBtn = $("#boss-submit-btn");

  if (!title) return showToast("Please enter a meeting title.");
  if (!dateInput) return showToast("Please select a date and time.");
  if (!meetLink) return showToast("Please enter or generate a Google Meet link.");

  submitBtn.disabled = true;
  submitBtn.textContent = "Broadcasting meeting…";

  try {
    const scheduledAt = new Date(dateInput).toISOString();
    await api("/api/boss/meetings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        scheduled_at: scheduledAt,
        duration_minutes: duration,
        department: dept,
        meet_link: meetLink,
        agenda
      })
    });
    showToast("Meeting scheduled and Google Meet link broadcast!");
    $("#boss-schedule-form").reset();
    setDefaultMeetingDate();
    await loadBossMeetings();
    await loadBossBanner();
  } catch (err) {
    showToast(err.message);
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = "<span>Broadcast & Post Meeting</span> ↗";
  }
}

function generateRandomMeetLink() {
  const chars = "abcdefghijklmnopqrstuvwxyz";
  const r = (n) => Array.from({ length: n }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  const code = `${r(3)}-${r(4)}-${r(3)}`;
  const link = `https://meet.google.com/${code}`;
  const input = $("#boss-meet-link");
  if (input) {
    input.value = link;
    showToast(`Google Meet link generated: ${code}`);
  }
  return link;
}

function setDefaultMeetingDate() {
  const dateInput = $("#boss-meeting-date");
  if (dateInput && !dateInput.value) {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(10, 0, 0, 0);
    const pad = (n) => String(n).padStart(2, "0");
    dateInput.value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
}

async function loadBossBanner() {
  const banner = $("#boss-live-banner");
  if (!banner) return;
  try {
    const res = await api("/api/boss/upcoming");
    const meet = res.upcoming;
    state.upcomingBossMeeting = meet;
    if (meet) {
      banner.hidden = false;
      let dateFormatted = meet.scheduled_at;
      try {
        const d = new Date(meet.scheduled_at);
        dateFormatted = new Intl.DateTimeFormat(undefined, {
          weekday: "short",
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit"
        }).format(d);
      } catch {}
      $("#banner-meeting-title").textContent = meet.title;
      $("#banner-meeting-meta").textContent = `${dateFormatted} (${meet.duration_minutes || 45} mins) · ${meet.department || "Company-wide"}`;
      const btn = $("#banner-meet-btn");
      if (btn) btn.href = meet.meet_link;
    } else {
      banner.hidden = true;
    }
  } catch {
    banner.hidden = true;
  }
}

/* =========================================================
   Settings & Supabase Database Configuration
   ========================================================= */
async function loadSupabaseSettings() {
  try {
    const res = await api("/api/settings/supabase");
    state.supabaseStatus = res;
    const badge = $("#settings-supabase-status-badge") || $("#settings-neon-status-badge");
    const badgeText = $("#settings-supabase-status-text") || $("#settings-neon-status-text");
    const providerVal = $("#settings-db-provider");

    if (badge && badgeText) {
      if (res.provider && res.provider.includes("Supabase")) {
        badgeText.textContent = "Connected to Supabase PostgreSQL";
        badge.style.background = "#edf8f0";
        badge.style.color = "#1d5b35";
        badge.style.borderColor = "#b7dfc3";
      } else {
        badgeText.textContent = "Using Local SQLite Database";
        badge.style.background = "#f4f7f4";
        badge.style.color = "#55665b";
        badge.style.borderColor = "#c9d8cc";
      }
    }
    if (providerVal) providerVal.textContent = res.provider || "Local Database";

    const input = $("#supabase-db-url-input") || $("#neon-url-input");
    if (input && res.databaseUrl) input.value = res.databaseUrl;
    const sbUrlInput = $("#supabase-url-input");
    if (sbUrlInput && res.supabaseUrl) sbUrlInput.value = res.supabaseUrl;
  } catch (err) {
    showToast(err.message);
  }
}
const loadNeonSettings = loadSupabaseSettings;

async function saveSupabaseSettings(e) {
  if (e) e.preventDefault();
  const input = $("#supabase-db-url-input") || $("#neon-url-input");
  const databaseUrl = input ? input.value.trim() : "";
  const sbUrlInput = $("#supabase-url-input");
  const supabaseUrl = sbUrlInput ? sbUrlInput.value.trim() : "";
  const sbKeyInput = $("#supabase-key-input");
  const supabaseKey = sbKeyInput ? sbKeyInput.value.trim() : "";
  const testResult = $("#supabase-test-result") || $("#neon-test-result");
  const saveBtn = $("#save-supabase-btn") || $("#save-neon-btn");

  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.textContent = "Connecting to Supabase…";
  }
  if (testResult) {
    testResult.className = "db-test-result";
    testResult.style.display = "none";
  }

  try {
    const res = await api("/api/settings/supabase", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ databaseUrl, supabaseUrl, supabaseKey }),
    });
    if (testResult) {
      testResult.className = "db-test-result success";
      testResult.textContent = res.message;
      testResult.style.display = "block";
    }
    showToast("Connected to Supabase PostgreSQL!");
    await loadSupabaseSettings();
    await loadProviderStatus();
  } catch (err) {
    if (testResult) {
      testResult.className = "db-test-result error";
      testResult.textContent = err.message;
      testResult.style.display = "block";
    }
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = "Save & Connect Supabase";
    }
  }
}
const saveNeonSettings = saveSupabaseSettings;

/* =========================================================
   Authentication & Employee Profile
   ========================================================= */
async function initAuth() {
  try {
    const res = await api("/api/auth/me");
    state.currentUser = res.user || res.employee || res;
    updateUserUI();
  } catch (err) {
    console.warn("Auth check:", err);
  }
}

function updateUserUI() {
  const user = state.currentUser || { name: "Alex Morgan", role: "Product Marketing Lead", email: "alex@meetflow.ai", department: "Marketing & Strategy" };
  const initials = user.name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase() || "MF";

  const sideAvatar = $("#sidebar-user-avatar");
  if (sideAvatar) sideAvatar.textContent = initials;
  const sideName = $("#sidebar-user-name");
  if (sideName) sideName.textContent = user.name;
  const sideRole = $("#sidebar-user-role");
  if (sideRole) sideRole.textContent = user.role || user.department || "Employee";

  const authHeaderBtn = $("#auth-header-btn");
  if (authHeaderBtn) {
    authHeaderBtn.textContent = state.token ? `${user.name.split(" ")[0]}` : "Sign in";
  }

  const setAvatar = $("#settings-user-avatar");
  if (setAvatar) setAvatar.textContent = initials;
  const setName = $("#settings-user-name");
  if (setName) setName.textContent = user.name;
  const setRole = $("#settings-user-role");
  if (setRole) setRole.textContent = user.role || "Employee";
  const setEmail = $("#settings-user-email");
  if (setEmail) setEmail.textContent = user.email || "—";
  const setDept = $("#settings-user-dept");
  if (setDept) setDept.textContent = user.department || "General";
}

function openAuthDialog(tab = "signin") {
  const dialog = $("#auth-dialog");
  if (!dialog) return;
  switchAuthTab(tab);
  $("#signin-feedback").textContent = "";
  $("#reg-feedback").textContent = "";
  dialog.showModal();
}

function switchAuthTab(tab) {
  const isSignIn = tab === "signin";
  $("#auth-tab-signin")?.classList.toggle("active", isSignIn);
  $("#auth-tab-register")?.classList.toggle("active", !isSignIn);
  const signinForm = $("#signin-form");
  const regForm = $("#register-form");
  if (signinForm) signinForm.hidden = !isSignIn;
  if (regForm) regForm.hidden = isSignIn;
}

async function handleSignIn(e) {
  e.preventDefault();
  const feedback = $("#signin-feedback");
  const email = $("#signin-email").value.trim();
  const password = $("#signin-password").value;
  feedback.textContent = "Signing in…";
  feedback.style.color = "#245e43";
  try {
    const res = await api("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    state.token = res.token;
    state.currentUser = res.employee;
    localStorage.setItem("meetflow_auth_token", res.token);
    updateUserUI();
    $("#auth-dialog").close();
    showToast(`Welcome back, ${res.employee.name}!`);
    if (state.view === "analytics") loadMonthlyAnalytics(state.analyticsRange);
  } catch (err) {
    feedback.textContent = err.message;
    feedback.style.color = "#a12b2b";
  }
}

async function handleRegister(e) {
  e.preventDefault();
  const feedback = $("#reg-feedback");
  const name = $("#reg-name").value.trim();
  const email = $("#reg-email").value.trim();
  const department = $("#reg-dept").value.trim();
  const role = $("#reg-role").value.trim();
  const password = $("#reg-password").value;
  feedback.textContent = "Registering…";
  feedback.style.color = "#245e43";
  try {
    const res = await api("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, department, role, password }),
    });
    state.token = res.token;
    state.currentUser = res.employee;
    localStorage.setItem("meetflow_auth_token", res.token);
    updateUserUI();
    $("#auth-dialog").close();
    showToast(`Account registered for ${res.employee.name}!`);
    if (state.view === "analytics") loadMonthlyAnalytics(state.analyticsRange);
    if (state.view === "team") loadTeamDirectory();
  } catch (err) {
    feedback.textContent = err.message;
    feedback.style.color = "#a12b2b";
  }
}

async function handleLogout() {
  if (state.token) {
    try {
      await api("/api/auth/logout", { method: "POST" });
    } catch {}
  }
  state.token = "";
  localStorage.removeItem("meetflow_auth_token");
  showToast("Signed out.");
  await initAuth();
  if (state.view === "analytics") loadMonthlyAnalytics(state.analyticsRange);
}

state.selectedAudioFile = null;

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

function selectAudioFile(file) {
  if (!file) return;
  state.selectedAudioFile = file;
  $("#selected-file-name").textContent = file.name;
  $("#selected-file-size").textContent = formatFileSize(file.size);
  $("#selected-file-panel").style.display = "flex";
  $("#selected-file-panel").hidden = false;
  $("#dropzone").style.display = "none";
}

function clearSelectedAudioFile() {
  state.selectedAudioFile = null;
  $("#audio-input").value = "";
  $("#selected-file-panel").style.display = "none";
  $("#selected-file-panel").hidden = true;
  $("#dropzone").style.display = "flex";
}

async function uploadAudio(file) {
  if (!file) return;
  if (file.size > 250 * 1024 * 1024) return showToast("Choose an audio file smaller than 250 MB.");
  const progress = $("#upload-progress");
  progress.hidden = false;
  $("#progress-title").textContent = `Transcribing ${file.name}`;
  $("#progress-message").textContent = "Uploading audio securely to AssemblyAI…";
  $("#dropzone").setAttribute("aria-busy", "true");
  const generateBtn = $("#generate-button");
  if (generateBtn) generateBtn.disabled = true;
  try {
    const form = new FormData();
    form.append("audio", file);
    const started = await api("/api/transcribe", { method: "POST", headers: { "X-Meeting-Title": file.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ") }, body: form });
    renderTimeline({ events: [{ label: "Audio uploaded", detail: "Sent securely to AssemblyAI.", status: "complete", time: new Date().toISOString() }, { label: "Transcribing audio", detail: "Fast cloud transcription with speaker labels.", status: "processing", time: new Date().toISOString() }] });
    let finished = false;
    while (!finished) {
      await new Promise((resolve) => setTimeout(resolve, 1300));
      const job = await api(`/api/jobs/${started.jobId}`);
      $("#progress-message").textContent = job.message;
      if (job.status === "complete") {
        finished = true;
        progress.hidden = true;
        $("#dropzone").removeAttribute("aria-busy");
        if (generateBtn) generateBtn.disabled = false;
        clearSelectedAudioFile();
        await loadMeetings();
        openMeeting(job.meetingId);
        showToast("Your AssemblyAI transcript and project brief are ready.");
      } else if (job.status === "error") {
        finished = true;
        progress.hidden = true;
        $("#dropzone").removeAttribute("aria-busy");
        if (generateBtn) generateBtn.disabled = false;
        showToast(job.message);
      }
    }
  } catch (error) {
    progress.hidden = true;
    $("#dropzone").removeAttribute("aria-busy");
    if (generateBtn) generateBtn.disabled = false;
    showToast(error.message);
  }
}

$("#assistant-open").addEventListener("click", () => showAssistantDialog().catch((error) => showToast(error.message)));
$("#assistant-close").addEventListener("click", () => $("#assistant-dialog").close());
$("#assistant-key-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = $("#assistant-connect");
  const apiKey = $("#assistant-key").value.trim();
  $("#assistant-key").value = "";
  button.disabled = true;
  button.textContent = "Connecting…";
  $("#assistant-key-error").textContent = "";
  try {
    await api("/api/assistant/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey }),
    });
    $("#assistant-key-form").reset();
    state.assistantConfigured = true;
    $("#assistant-setup").hidden = true;
    $("#assistant-chat").hidden = false;
    $("#assistant-question").focus();
    state.assistantMessages = [];
    renderAssistantMessages();
    showToast("Groq key verified and connected for this app session.");
  } catch (error) {
    $("#assistant-key-error").textContent = error.message;
    state.assistantConfigured = false;
  } finally {
    button.disabled = false;
    button.textContent = "Connect";
  }
});
$("#assistant-chat-form").addEventListener("submit", (event) => {
  event.preventDefault();
  askAssistant($("#assistant-question").value);
});
$("#assistant-disconnect").addEventListener("click", () => {
  state.assistantConfigured = false;
  $("#assistant-key").value = "";
  $("#assistant-chat").hidden = true;
  $("#assistant-setup").hidden = false;
  $("#assistant-key").focus();
});

$("#notes-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = $("#generate-button");
  button.disabled = true;
  button.textContent = "Building brief…";
  try {
    const meeting = await api("/api/meetings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: $("#notes-title").value, transcript: $("#notes-transcript").value }) });
    $("#meeting-dialog").close();
    $("#notes-form").reset();
    await loadMeetings();
    switchView("meetings");
    openMeeting(meeting.id);
    showToast("Project brief created from your notes.");
  } catch (error) { showToast(error.message); }
  finally { button.disabled = false; button.innerHTML = "Generate brief <span>↗</span>"; }
});

$("#browse-button").addEventListener("click", (event) => { event.stopPropagation(); $("#audio-input").click(); });
$("#dropzone").addEventListener("click", (event) => { if (!event.target.closest("button")) $("#audio-input").click(); });
$("#dropzone").addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); $("#audio-input").click(); } });
$("#audio-input").addEventListener("change", (event) => {
  if (event.target.files && event.target.files[0]) selectAudioFile(event.target.files[0]);
});
$("#dropzone").addEventListener("dragover", (event) => { event.preventDefault(); $("#dropzone").classList.add("dragging"); });
$("#dropzone").addEventListener("dragleave", () => $("#dropzone").classList.remove("dragging"));
$("#dropzone").addEventListener("drop", (event) => {
  event.preventDefault();
  $("#dropzone").classList.remove("dragging");
  if (event.dataTransfer.files && event.dataTransfer.files[0]) selectAudioFile(event.dataTransfer.files[0]);
});
const generateBtn = $("#generate-button");
if (generateBtn) generateBtn.addEventListener("click", () => {
  if (state.selectedAudioFile) uploadAudio(state.selectedAudioFile);
});
const clearFileBtn = $("#clear-selected-file");
if (clearFileBtn) clearFileBtn.addEventListener("click", clearSelectedAudioFile);
$("#sample-button").addEventListener("click", createSample);
$("#empty-sample").addEventListener("click", createSample);
$("#provider-status").addEventListener("click", () => showToast("AssemblyAI is configured on the server. No browser key is required."));
$("#reminder-permission").addEventListener("click", enableDeadlineNotifications);
$("#notes-entry-button").addEventListener("click", showDialog);
$("#clear-all").addEventListener("click", clearAllMeetings);
$("#meeting-search").addEventListener("input", renderMeetings);
$("#sort-button").addEventListener("click", () => { state.sortNewest = !state.sortNewest; $("#sort-button").innerHTML = `${state.sortNewest ? "Newest" : "Oldest"} <span>⌄</span>`; renderMeetings(); });
$("#search-button").addEventListener("click", () => { switchView("meetings"); $("#meeting-search").focus(); });
$$(".nav-item").forEach((item) => {
  item.addEventListener("click", () => switchView(item.dataset.view));
});

// Analytics controls
$$("#analytics-range-controls .filter-chip").forEach((btn) => {
  btn.addEventListener("click", () => loadMonthlyAnalytics(Number(btn.dataset.range)));
});

// Team directory search
$("#team-search")?.addEventListener("input", renderTeamGrid);

// Calendar controls
$("#cal-prev-btn")?.addEventListener("click", () => {
  state.calendarDate.setMonth(state.calendarDate.getMonth() - 1);
  renderCalendar();
});
$("#cal-next-btn")?.addEventListener("click", () => {
  state.calendarDate.setMonth(state.calendarDate.getMonth() + 1);
  renderCalendar();
});
$("#cal-today-btn")?.addEventListener("click", () => {
  state.calendarDate = new Date();
  renderCalendar();
});

// Supabase DB settings controls
$("#supabase-config-form")?.addEventListener("submit", saveSupabaseSettings);
$("#neon-config-form")?.addEventListener("submit", saveSupabaseSettings);
$("#save-supabase-btn")?.addEventListener("click", saveSupabaseSettings);
$("#test-supabase-btn")?.addEventListener("click", saveSupabaseSettings);
$("#save-neon-btn")?.addEventListener("click", saveSupabaseSettings);
$("#test-neon-btn")?.addEventListener("click", saveSupabaseSettings);
$("#toggle-supabase-db-visibility")?.addEventListener("click", () => {
  const inp = $("#supabase-db-url-input") || $("#neon-url-input");
  if (inp) inp.type = inp.type === "password" ? "text" : "password";
});
$("#toggle-neon-visibility")?.addEventListener("click", () => {
  const inp = $("#neon-url-input") || $("#supabase-db-url-input");
  if (inp) inp.type = inp.type === "password" ? "text" : "password";
});
$("#topbar-db-pill")?.addEventListener("click", () => switchView("settings"));
$("#sidebar-db-status")?.addEventListener("click", () => switchView("settings"));

// Auth & profile triggers
$("#sidebar-user-block")?.addEventListener("click", () => switchView("settings"));
$("#sidebar-auth-trigger")?.addEventListener("click", (e) => {
  e.stopPropagation();
  openAuthDialog(state.token ? "signin" : "signin");
});
$("#auth-header-btn")?.addEventListener("click", () => {
  if (state.token) {
    switchView("settings");
  } else {
    openAuthDialog("signin");
  }
});
$("#auth-close")?.addEventListener("click", () => $("#auth-dialog")?.close());
$("#auth-tab-signin")?.addEventListener("click", () => switchAuthTab("signin"));
$("#auth-tab-register")?.addEventListener("click", () => switchAuthTab("register"));
$("#signin-form")?.addEventListener("submit", handleSignIn);
$("#register-form")?.addEventListener("submit", handleRegister);
$("#logout-btn")?.addEventListener("click", handleLogout);
$("#switch-account-btn")?.addEventListener("click", () => openAuthDialog("signin"));

// Boss Portal controls
$("#boss-schedule-form")?.addEventListener("submit", handleBossScheduleSubmit);
$("#generate-meet-link-btn")?.addEventListener("click", generateRandomMeetLink);

// Check direct /boss or #boss entry
function checkInitialRoute() {
  const path = window.location.pathname.toLowerCase();
  const hash = window.location.hash.toLowerCase();
  if (path === "/boss" || path.startsWith("/boss/") || hash === "#boss") {
    const landing = document.querySelector("#landing-page");
    const appShell = document.querySelector(".app-shell");
    if (landing) landing.hidden = true;
    if (appShell) appShell.hidden = false;
    document.body.classList.remove("landing-mode");
    switchView("boss");
  }
}

// App Initialization
initAuth().catch(console.error);
loadMeetings().catch((error) => showToast(error.message));
loadProviderStatus().catch((error) => showToast(error.message));
loadBossBanner().catch(console.error);
setDefaultMeetingDate();
checkInitialRoute();
window.addEventListener("popstate", checkInitialRoute);
window.addEventListener("hashchange", checkInitialRoute);
document.addEventListener("visibilitychange", () => { if (!document.hidden) checkDeadlineReminders(); });
setInterval(() => checkDeadlineReminders().catch((error) => showToast(error.message)), 60000);