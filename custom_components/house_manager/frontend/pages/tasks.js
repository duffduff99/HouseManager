// Tasks page: every task with filters, plus a history of completed/missed tasks.

import { LitElement, html, css } from "../lit.js";
import { sharedStyles } from "../styles.js";
import { opt } from "../components.js";
import { define, describeSchedule, fmtDate, fmtDateTime, relativeDay } from "../util.js";

class TasksPage extends LitElement {
  static properties = {
    app: { attribute: false },
    model: { attribute: false },
    _view: { state: true },
    _status: { state: true },
    _search: { state: true },
    _asset: { state: true },
    _assignee: { state: true },
  };

  constructor() {
    super();
    this._view = "tasks";
    this._status = "open";
    this._search = "";
    this._asset = "";
    this._assignee = "";
  }

  _matchesCommon(assetId, text) {
    if (this._asset === "none" && assetId) return false;
    if (this._asset && this._asset !== "none" && assetId !== this._asset) return false;
    if (this._search && !text.toLowerCase().includes(this._search.toLowerCase())) return false;
    return true;
  }

  _filteredTasks() {
    const { model } = this;
    return model.tasks
      .filter((t) => {
        if (this._status === "open" && !(t.enabled && t.status === "open")) return false;
        if (this._status === "waiting" && !(t.enabled && t.status !== "open" && t.next_due)) return false;
        if (this._status === "finished" && !(t.schedule.type === "once" && t.status === "done")) return false;
        if (this._status === "paused" && t.enabled) return false;
        if (this._assignee && t.assignee !== this._assignee) return false;
        const text = `${t.title} ${t.notes || ""} ${model.assetName(t.asset_id)}`;
        return this._matchesCommon(t.asset_id, text);
      })
      .sort((a, b) => a.title.localeCompare(b.title));
  }

  _filteredHistory() {
    return [...this.model.history]
      .filter((h) => {
        if (this._assignee && h.user_id !== this._assignee) return false;
        if (this._status === "completed" && h.result !== "completed") return false;
        if (this._status === "missed" && h.result !== "missed") return false;
        return this._matchesCommon(h.asset_id, `${h.title} ${this.model.assetName(h.asset_id)}`);
      })
      .sort((a, b) => b.date.localeCompare(a.date));
  }

  _setView(view) {
    this._view = view;
    this._status = view === "tasks" ? "open" : "all";
  }

  render() {
    const { app, model } = this;
    return html`
      <div class="page">
        <div class="card">
          <div class="row header">
            <div class="segmented">
              <button class=${this._view === "tasks" ? "primary" : ""} @click=${() => this._setView("tasks")}>
                Tasks
              </button>
              <button class=${this._view === "history" ? "primary" : ""} @click=${() => this._setView("history")}>
                History
              </button>
            </div>
            <span class="spacer"></span>
            <button class="primary" @click=${() => app.openTask(null)}>+ New task</button>
          </div>

          <div class="filters">
            <input
              type="search"
              placeholder="Search…"
              .value=${this._search}
              @input=${(e) => (this._search = e.target.value)}
            />
            <select .value=${this._status} @change=${(e) => (this._status = e.target.value)}>
              ${this._view === "tasks"
                ? html`
                    <option value="open">To do</option>
                    <option value="waiting">Scheduled (not due yet)</option>
                    <option value="finished">Finished one-time tasks</option>
                    <option value="paused">Paused</option>
                    <option value="all">All tasks</option>
                  `
                : html`
                    <option value="all">Completed and missed</option>
                    <option value="completed">Completed</option>
                    <option value="missed">Missed</option>
                  `}
            </select>
            <select .value=${this._asset} @change=${(e) => (this._asset = e.target.value)}>
              <option value="">Any asset</option>
              <option value="none">Not linked to an asset</option>
              ${model.activeAssets.map((a) => opt(a.id, a.name, this._asset))}
            </select>
            ${model.users.length > 1
              ? html`<select .value=${this._assignee} @change=${(e) => (this._assignee = e.target.value)}>
                  <option value="">${this._view === "tasks" ? "Anyone" : "Done by anyone"}</option>
                  ${model.users.map((u) => opt(u.id, u.name, this._assignee))}
                </select>`
              : ""}
          </div>

          ${this._view === "tasks" ? this._renderTasks() : this._renderHistory()}
        </div>
      </div>
    `;
  }

  _renderTasks() {
    const { app, model } = this;
    const tasks = this._filteredTasks();
    if (!tasks.length) return html`<div class="empty">No tasks match.</div>`;
    return html`
      <div class="table-wrap">
        <table>
          <tr>
            <th></th>
            <th>Task</th>
            <th>Asset</th>
            <th>Schedule</th>
            <th class="wide-only">Next appears</th>
            <th class="wide-only">Last done</th>
            ${model.users.length > 1 ? html`<th>Assignee</th>` : ""}
          </tr>
          ${tasks.map(
            (t) => html`
              <tr class="clickable" @click=${() => app.openTask(t)}>
                <td @click=${(e) => e.stopPropagation()}>
                  ${t.enabled
                    ? html`<input
                        type="checkbox"
                        .checked=${t.status !== "open"}
                        .disabled=${t.status !== "open" && !t.last_completed}
                        title=${t.status === "open" ? "Mark as done" : "Mark as not done"}
                        @change=${() => app.toggleTask(t)}
                      />`
                    : html`<span class="chip">Paused</span>`}
                </td>
                <td>
                  ${t.title}
                  ${t.status === "open" && t.enabled ? html` <span class="chip warn">To do</span>` : ""}
                </td>
                <td>
                  ${t.asset_id
                    ? html`<span
                        class="link"
                        @click=${(e) => {
                          e.stopPropagation();
                          app.navigate(`/assets/${t.asset_id}`);
                        }}
                        >${model.assetName(t.asset_id)}</span
                      >`
                    : html`<span class="muted">—</span>`}
                </td>
                <td class="muted">${describeSchedule(t.schedule)}</td>
                <td class="muted wide-only" title=${fmtDateTime(t.next_due)}>
                  ${t.enabled && t.next_due ? relativeDay(t.next_due) : "—"}
                </td>
                <td class="muted wide-only">${t.last_completed ? fmtDate(t.last_completed) : "—"}</td>
                ${model.users.length > 1 ? html`<td class="muted">${model.userName(t.assignee)}</td>` : ""}
              </tr>
            `
          )}
        </table>
      </div>
    `;
  }

  _renderHistory() {
    const { app, model } = this;
    const history = this._filteredHistory();
    if (!history.length) return html`<div class="empty">No history yet (shows the last ~13 months).</div>`;
    return html`
      <div class="table-wrap">
        <table>
          <tr>
            <th>Date</th>
            <th>Task</th>
            <th>Asset</th>
            <th>Result</th>
            <th>By</th>
          </tr>
          ${history.map(
            (h) => html`
              <tr>
                <td class="muted">${fmtDateTime(h.date)}</td>
                <td>${h.title}</td>
                <td>
                  ${h.asset_id && model.assetsById[h.asset_id]
                    ? html`<span class="link" @click=${() => app.navigate(`/assets/${h.asset_id}`)}
                        >${model.assetName(h.asset_id)}</span
                      >`
                    : html`<span class="muted">—</span>`}
                </td>
                <td>
                  ${h.result === "completed"
                    ? html`<span class="chip ok">Completed</span>`
                    : html`<span class="chip">Missed</span>`}
                </td>
                <td class="muted">${model.userName(h.user_id)}</td>
              </tr>
            `
          )}
        </table>
      </div>
    `;
  }

  static styles = [
    sharedStyles,
    css`
      .header {
        margin-bottom: 12px;
      }
      .segmented button {
        border-radius: 0;
      }
      .segmented button:first-child {
        border-radius: 8px 0 0 8px;
      }
      .segmented button:last-child {
        border-radius: 0 8px 8px 0;
        margin-left: -1px;
      }
    `,
  ];
}

define("hm-tasks-page", TasksPage);
