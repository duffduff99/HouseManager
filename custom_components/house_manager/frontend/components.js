// Small render helpers shared between pages.

import { html } from "./lit.js";
import { describeSchedule, fmtDate, relativeDay } from "./util.js";

/** One task with a checkbox. Used on the overview, tasks and asset pages. */
export function taskItem(app, model, task, { showAsset = true } = {}) {
  const open = task.enabled && task.status === "open";
  // "done" means completed this cycle; a task that has never appeared yet
  // has no checkbox, just the date it will next appear.
  const done = !open && Boolean(task.last_completed);
  const asset = model.assetsById[task.asset_id];
  let when = "";
  if (!task.enabled) when = html`· <span class="chip">Paused</span>`;
  else if (open && task.opened_at)
    when = html`· <span title=${fmtDate(task.opened_at)}>added ${relativeDay(task.opened_at)}</span>`;
  else if (done) when = html`· <span>done ${relativeDay(task.last_completed)}</span>`;
  if (!open && task.enabled && task.next_due)
    when = html`${when} · <span title=${fmtDate(task.next_due)}>next ${relativeDay(task.next_due)}</span>`;
  return html`
    <div class="item ${done ? "done" : ""}">
      ${open || done
        ? html`<input
            type="checkbox"
            .checked=${done}
            title=${done ? "Mark as not done" : "Mark as done"}
            @change=${() => app.toggleTask(task)}
          />`
        : html`<span class="placeholder" title="Not due yet">◷</span>`}
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
