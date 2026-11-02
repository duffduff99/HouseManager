// Schedule page: every task and when it next appears, for keeping the list tidy.

import { LitElement, html, css } from "../lit.js";
import { sharedStyles } from "../styles.js";
import { opt, taskState } from "../components.js";
import { define, describeSchedule, fmtDate, fmtDateTime, relativeDay } from "../util.js";

const FREQUENCY_ORDER = [
  "Daily",
  "Weekly",
  "Monthly",
  "Quarterly",
  "Every few months",
  "Yearly / specific dates",
  "Custom (cron)",
  "One time",
];

function frequency(schedule) {
  switch (schedule.type) {
    case "daily":
      return "Daily";
    case "weekly":
      return "Weekly";
    case "monthly":
      if (schedule.interval === 1) return "Monthly";
      if (schedule.interval === 3) return "Quarterly";
      return "Every few months";
    case "yearly":
      return "Yearly / specific dates";
    case "cron":
      return "Custom (cron)";
    default:
      return "One time";
  }
}

const DAY = 86400000;

/** Group name when grouping by "next appears". Also returns a sort rank. */
function whenGroup(task) {
  const state = taskState(task);
  if (state === "paused") return [9, "Paused"];
  if (state === "open") return [0, "On the to-do list now"];
  if (!task.next_due) return [8, "No upcoming date (finished one-time tasks)"];
  const days = (new Date(task.next_due) - Date.now()) / DAY;
  if (days <= 7) return [1, "Next 7 days"];
  if (days <= 31) return [2, "Next 30 days"];
  if (days <= 92) return [3, "Next 3 months"];
  return [4, "Later"];
}

class SchedulePage extends LitElement {
  static properties = {
    app: { attribute: false },
    model: { attribute: false },
    _groupBy: { state: true },
    _search: { state: true },
    _showFinished: { state: true },
  };

  constructor() {
    super();
    this._groupBy = "when";
    this._search = "";
    this._showFinished = false;
  }

  _groups() {
    const { model } = this;
    const search = this._search.toLowerCase();
    const tasks = model.tasks.filter((t) => {
      if (!this._showFinished && t.schedule.type === "once" && t.status === "done") return false;
      if (search) {
        const text = `${t.title} ${t.notes || ""} ${model.assetName(t.asset_id)}`.toLowerCase();
        if (!text.includes(search)) return false;
      }
      return true;
    });

    const groups = new Map();
    for (const task of tasks) {
      let rank;
      let name;
      if (this._groupBy === "when") [rank, name] = whenGroup(task);
      else if (this._groupBy === "frequency") {
        name = frequency(task.schedule);
        rank = FREQUENCY_ORDER.indexOf(name);
      } else {
        name = model.assetName(task.asset_id) || "Not linked to an asset";
        rank = task.asset_id ? 0 : 1;
      }
      if (!groups.has(name)) groups.set(name, { name, rank, tasks: [] });
      groups.get(name).tasks.push(task);
    }

    const byNext = (a, b) =>
      (a.next_due || "9999").localeCompare(b.next_due || "9999") || a.title.localeCompare(b.title);
    return [...groups.values()]
      .sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name))
      .map((g) => ({ ...g, tasks: g.tasks.sort(byNext) }));
  }

  render() {
    const { app } = this;
    const groups = this._groups();
    return html`
      <div class="page">
        <div class="card">
          <div class="row header">
            <h2>Maintenance schedule</h2>
            <span class="spacer"></span>
            <button class="primary" @click=${() => app.openTask(null)}>+ New task</button>
          </div>
          <p class="muted small">
            Every task and when it next appears on the to-do list. Click a task to change or pause it.
          </p>
          <div class="filters">
            <input
              type="search"
              placeholder="Search…"
              .value=${this._search}
              @input=${(e) => (this._search = e.target.value)}
            />
            <label class="row small">
              Group by
              <select @change=${(e) => (this._groupBy = e.target.value)}>
                ${opt("when", "When it next appears", this._groupBy)}
                ${opt("frequency", "How often", this._groupBy)}
                ${opt("asset", "Asset", this._groupBy)}
              </select>
            </label>
            <label class="row small">
              <input
                type="checkbox"
                .checked=${this._showFinished}
                @change=${(e) => (this._showFinished = e.target.checked)}
              />
              Show finished one-time tasks
            </label>
          </div>
        </div>

        ${groups.length
          ? groups.map((g) => this._renderGroup(g))
          : html`<div class="card empty">No tasks yet. Add one with “+ New task”.</div>`}
      </div>
    `;
  }

  _renderGroup(group) {
    const { app, model } = this;
    const showAssignee = model.users.length > 1;
    return html`
      <div class="card">
        <h2>${group.name} <span class="chip">${group.tasks.length}</span></h2>
        <div class="table-wrap">
          <table>
            <tr>
              <th>Task</th>
              ${this._groupBy === "asset" ? "" : html`<th>Asset</th>`}
              <th>Repeats</th>
              <th>Next appears</th>
              <th class="wide-only">Last done</th>
              ${showAssignee ? html`<th class="wide-only">Assignee</th>` : ""}
            </tr>
            ${group.tasks.map((t) => {
              const state = taskState(t);
              return html`
                <tr class="clickable" @click=${() => app.openTask(t)}>
                  <td>
                    ${t.title}
                    ${state === "open" ? html` <span class="chip warn">To do</span>` : ""}
                    ${state === "skipped" ? html` <span class="chip skip">Skipped</span>` : ""}
                    ${state === "paused" ? html` <span class="chip">Paused</span>` : ""}
                  </td>
                  ${this._groupBy === "asset"
                    ? ""
                    : html`<td>
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
                      </td>`}
                  <td class="muted">${describeSchedule(t.schedule)}</td>
                  <td title=${fmtDateTime(t.next_due)}>
                    ${t.enabled && t.next_due
                      ? html`${fmtDate(t.next_due)} <span class="muted small">(${relativeDay(t.next_due)})</span>`
                      : html`<span class="muted">—</span>`}
                  </td>
                  <td class="muted wide-only">${t.last_completed ? fmtDate(t.last_completed) : "—"}</td>
                  ${showAssignee ? html`<td class="muted wide-only">${model.userName(t.assignee)}</td>` : ""}
                </tr>
              `;
            })}
          </table>
        </div>
      </div>
    `;
  }

  static styles = [
    sharedStyles,
    css`
      .header h2 {
        margin: 0;
      }
      .filters label select {
        margin-left: 6px;
      }
    `,
  ];
}

define("hm-schedule-page", SchedulePage);
