// Overview: open tasks, what's coming up, and recently added assets.

import { LitElement, html, css } from "../lit.js";
import { sharedStyles } from "../styles.js";
import { taskItem } from "../components.js";
import { define, describeSchedule, fmtDate, fmtMoney, relativeDay, todayISO } from "../util.js";

class OverviewPage extends LitElement {
  static properties = {
    app: { attribute: false },
    model: { attribute: false },
  };

  render() {
    const { app, model } = this;
    const open = model.tasks
      .filter((t) => t.enabled && t.status === "open")
      .sort((a, b) => (a.opened_at || "").localeCompare(b.opened_at || ""));
    const weekAhead = Date.now() + 7 * 86400000;
    const upcoming = model.tasks
      .filter((t) => t.enabled && t.next_due && new Date(t.next_due) <= weekAhead)
      .sort((a, b) => a.next_due.localeCompare(b.next_due));
    const recentAssets = [...model.assets]
      .sort((a, b) => (b.created || "").localeCompare(a.created || ""))
      .slice(0, 6);
    const active = model.assets.filter((a) => !a.retired_date);
    const totalValue = active.reduce(
      (sum, a) => sum + (Number(a.replacement_value ?? a.purchase_price) || 0),
      0
    );

    return html`
      <div class="page">
        <div class="grid">
          <div class="card">
            <h2>
              Open tasks <span class="chip">${open.length}</span>
              <span class="spacer"></span>
              <button class="flat" @click=${() => app.openTask(null)}>+ New task</button>
            </h2>
            <form class="row quick" @submit=${this._quickAdd}>
              <input name="title" placeholder="Quick one-time task…" autocomplete="off" />
              <button type="submit">Add</button>
            </form>
            <div class="task-list">
              ${open.length
                ? open.map((t) => taskItem(app, model, t))
                : html`<div class="empty">Nothing to do right now 🎉</div>`}
            </div>
          </div>

          <div>
            <div class="card">
              <h2>Coming up this week</h2>
              ${upcoming.length
                ? html`<table>
                    ${upcoming.map(
                      (t) => html`<tr class="clickable" @click=${() => app.openTask(t)}>
                        <td>${t.title}<div class="muted small">${describeSchedule(t.schedule)}</div></td>
                        <td class="muted" title=${fmtDate(t.next_due)}>${relativeDay(t.next_due)}</td>
                      </tr>`
                    )}
                  </table>`
                : html`<div class="empty">Nothing scheduled in the next 7 days.</div>`}
            </div>

            <div class="card">
              <h2>
                Recently added assets
                <span class="spacer"></span>
                <button class="flat" @click=${() => app.openAsset(null)}>+ New asset</button>
              </h2>
              ${recentAssets.length
                ? html`<table>
                    ${recentAssets.map(
                      (a) => html`<tr class="clickable" @click=${() => app.navigate(`/assets/${a.id}`)}>
                        <td>${a.name} ${a.retired_date ? html`<span class="chip">Retired</span>` : ""}</td>
                        <td class="muted">${model.categoriesById[a.category_id]?.name || ""}</td>
                        <td class="muted small">${fmtDate(a.created)}</td>
                      </tr>`
                    )}
                  </table>`
                : html`<div class="empty">No assets yet.</div>`}
              <div class="row muted small totals">
                <span>${active.length} active assets</span>
                <span>·</span>
                <span>${fmtMoney(totalValue)} total value</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  async _quickAdd(e) {
    e.preventDefault();
    const input = e.target.elements.title;
    const title = input.value.trim();
    if (!title) return;
    await this.app.call("task/save", {
      title,
      schedule: { type: "once", date: todayISO() },
      open_now: true,
    });
    input.value = "";
  }

  static styles = [
    sharedStyles,
    css`
      .quick {
        margin-bottom: 8px;
        flex-wrap: nowrap;
      }
      .quick input {
        flex: 1;
      }
      .totals {
        margin-top: 12px;
      }
    `,
  ];
}

define("hm-overview-page", OverviewPage);
