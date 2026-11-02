// Small render helpers shared between pages.

import { html } from "./lit.js";
import { describeSchedule, fmtDate, relativeDay } from "./util.js";

/** One task with a checkbox. Used on the overview, tasks and asset pages. */
/** How the task stands: "open", "completed", "skipped", "waiting" or "paused". */
export function taskState(task) {
  if (!task.enabled) return "paused";
  if (task.status === "open") return "open";
  // Tasks saved before Skip existed have no last_result.
  const result = task.last_result ?? (task.last_completed ? "completed" : null);
  return result || "waiting";
}

/** Chip for a history entry result. */
export function resultChip(result) {
  if (result === "completed") return html`<span class="chip ok">Completed</span>`;
  if (result === "skipped") return html`<span class="chip skip">Skipped</span>`;
  return html`<span class="chip">Missed</span>`;
}

/** One task with a checkbox. Used on the overview and asset pages. */
export function taskItem(app, model, task, { showAsset = true } = {}) {
  const state = taskState(task);
  const asset = model.assetsById[task.asset_id];
  let when = "";
  if (state === "paused") when = html`· <span class="chip">Paused</span>`;
  else if (state === "open" && task.opened_at)
    when = html`· <span title=${fmtDate(task.opened_at)}>added ${relativeDay(task.opened_at)}</span>`;
  else if (state === "completed")
    when = html`· <span>done ${relativeDay(task.last_completed)}</span>`;
  else if (state === "skipped")
    when = html`· <span class="chip skip">Skipped</span>
      <span class="link" @click=${() => app.call("task/reopen", { item_id: task.id })}>undo</span>`;
  if (state !== "open" && state !== "paused" && task.next_due)
    when = html`${when} · <span title=${fmtDate(task.next_due)}>next ${relativeDay(task.next_due)}</span>`;

  let control;
  if (state === "open" || state === "completed") {
    control = html`<input
      type="checkbox"
      .checked=${state === "completed"}
      title=${state === "completed" ? "Mark as not done" : "Mark as done"}
      @change=${() => app.toggleTask(task)}
    />`;
  } else {
    control = html`<span class="placeholder" title=${state === "skipped" ? "Skipped" : "Not due yet"}
      >${state === "skipped" ? "↷" : "◷"}</span
    >`;
  }

  return html`
    <div class="item ${state === "completed" ? "done" : ""}">
      ${control}
      <div class="body">
        <div class="title link" @click=${() => app.openTask(task)}>${task.title}</div>
        <div class="muted small row">
          ${showAsset && asset
            ? html`<span class="link" @click=${() => app.navigate(`/assets/${asset.id}`)}>${asset.name}</span> ·`
            : ""}
          <span>${describeSchedule(task.schedule)}</span>
          ${when}
          ${task.assignee ? html`· <span class="chip">${model.userName(task.assignee)}</span>` : ""}
        </div>
      </div>
      ${state === "open"
        ? html`<button class="flat skip-btn" title="Not this time" @click=${() => app.skipTask(task)}>Skip</button>`
        : ""}
    </div>
  `;
}

/**
 * <option> that is selected when value === current. Use this for options
 * rendered from a list: Lit sets <select .value> before list options exist.
 */
export function opt(value, label, current) {
  return html`<option value=${value} ?selected=${value === (current ?? "")}>${label}</option>`;
}
