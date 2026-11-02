// Settings: daily digest notifications, categories, locations, backup export.

import { LitElement, html, css } from "../lit.js";
import { sharedStyles } from "../styles.js";
import { opt } from "../components.js";
import { define, downloadFile, todayISO } from "../util.js";

class SettingsPage extends LitElement {
  static properties = {
    app: { attribute: false },
    model: { attribute: false },
    _newParent: { state: true },
  };

  _save(changes) {
    return this.app.call("settings/save", changes);
  }

  render() {
    return html`
      <div class="page">
        <div class="grid">
          ${this._renderNotifications()} ${this._renderCategories()}
        </div>
        ${this._renderLocations()} ${this._renderData()}
      </div>
    `;
  }

  _renderNotifications() {
    const { settings, notify_services: services } = this.model;
    const mobile = services.filter((s) => s.startsWith("mobile_app_"));
    const other = services.filter((s) => !s.startsWith("mobile_app_"));
    const toggleService = (service, on) => {
      const set = new Set(settings.notify_services);
      on ? set.add(service) : set.delete(service);
      this._save({ notify_services: [...set] });
    };
    const serviceBox = (service) => html`<label class="row">
      <input
        type="checkbox"
        .checked=${settings.notify_services.includes(service)}
        @change=${(e) => toggleService(service, e.target.checked)}
      />
      notify.${service}
    </label>`;

    return html`
      <div class="card">
        <h2>Daily digest</h2>
        <p class="muted small">
          Once a day, House Manager sends one notification listing the tasks that appeared since the last
          digest.
        </p>
        <div class="stack">
          <label class="row">
            <input
              type="checkbox"
              .checked=${settings.digest_enabled}
              @change=${(e) => this._save({ digest_enabled: e.target.checked })}
            />
            Send a daily digest
          </label>
          <label class="row">
            Send at
            <input
              type="time"
              .value=${settings.digest_time}
              @change=${(e) => e.target.value && this._save({ digest_time: e.target.value })}
            />
          </label>
          <label class="row">
            <input
              type="checkbox"
              .checked=${settings.digest_only_new}
              @change=${(e) => this._save({ digest_only_new: e.target.checked })}
            />
            Skip the digest on days with no new tasks
          </label>
          <div>
            <div class="muted small">Send to</div>
            ${mobile.map(serviceBox)}
            ${other.length
              ? html`<details>
                  <summary class="muted small">Other notify services (${other.length})</summary>
                  ${other.map(serviceBox)}
                </details>`
              : ""}
            ${services.length ? "" : html`<div class="empty">No notify services found. Install the HA companion app on your phone.</div>`}
          </div>
          <div class="row">
            <button @click=${this._testDigest}>Send digest now</button>
          </div>
          <p class="muted small">
            Want something fancier? Every digest also fires a <code>house_manager_digest</code> event, and each
            task that appears fires <code>house_manager_task_opened</code>, which you can use in your own automations.
          </p>
        </div>
      </div>
    `;
  }

  _testDigest = async () => {
    const result = await this.app.call("send_digest");
    this.app.toast(result.sent ? "Digest sent." : "No open tasks, so nothing was sent.");
  };

  _renderCategories() {
    const { model } = this;
    const counts = {};
    for (const a of model.assets) counts[a.category_id] = (counts[a.category_id] || 0) + 1;
    return html`
      <div class="card">
        <h2>Categories</h2>
        <table>
          ${model.categoryOptions.map(
            (c) => html`<tr>
              <td>
                <input
                  class="name"
                  .value=${c.name}
                  @change=${(e) => this.app.call("category/save", { item_id: c.id, name: e.target.value })}
                />
              </td>
              <td class="muted small nowrap">${counts[c.id] || 0} ${counts[c.id] === 1 ? "asset" : "assets"}</td>
              <td class="actions">
                <button class="flat" title="Delete" @click=${() => this._deleteCategory(c, counts[c.id] || 0)}>✕</button>
              </td>
            </tr>`
          )}
        </table>
        <form class="row add" @submit=${this._addCategory}>
          <input name="name" placeholder="New category" autocomplete="off" />
          <button type="submit">Add</button>
        </form>
      </div>
    `;
  }

  _addCategory = async (e) => {
    e.preventDefault();
    const input = e.target.elements.name;
    if (!input.value.trim()) return;
    await this.app.call("category/save", { name: input.value.trim() });
    input.value = "";
  };

  async _deleteCategory(category, count) {
    const ok = await this.app.confirm({
      title: `Delete ${category.name}`,
      text: count ? `${count} assets will have no category.` : "Delete this category?",
      confirmText: "Delete",
    });
    if (ok) await this.app.call("category/delete", { item_id: category.id });
  }

  _renderLocations() {
    const { model } = this;
    const counts = {};
    for (const a of model.assets) counts[a.location_id] = (counts[a.location_id] || 0) + 1;
    const depth = (loc) => {
      let d = 0;
      let p = loc.parent_id;
      while (p && model.locationsById[p] && d < 10) {
        d++;
        p = model.locationsById[p].parent_id;
      }
      return d;
    };
    return html`
      <div class="card">
        <h2>Locations</h2>
        <p class="muted small">
          Locations can be nested, like <b>Basement &gt; Mechanical Room</b>. You can also type a new path
          straight into the location box when editing an asset.
        </p>
        <div class="table-wrap">
          <table>
            <tr>
              <th>Name</th>
              <th>Inside</th>
              <th>Assets</th>
              <th></th>
            </tr>
            ${model.locationOptions.map(({ id }) => {
              const loc = model.locationsById[id];
              const excluded = model.locationAndChildren(id);
              return html`<tr>
                <td style="padding-left:${8 + depth(loc) * 20}px">
                  <input
                    class="name"
                    .value=${loc.name}
                    @change=${(e) =>
                      this.app.call("location/save", { item_id: id, name: e.target.value, parent_id: loc.parent_id })}
                  />
                </td>
                <td>
                  <select
                    @change=${(e) =>
                      this.app.call("location/save", { item_id: id, name: loc.name, parent_id: e.target.value || null })}
                  >
                    ${opt("", "(top level)", loc.parent_id || "")}
                    ${model.locationOptions
                      .filter((o) => !excluded.has(o.id))
                      .map((o) => opt(o.id, o.path, loc.parent_id || ""))}
                  </select>
                </td>
                <td class="muted small">${counts[id] || 0}</td>
                <td class="actions">
                  <button class="flat" title="Delete" @click=${() => this._deleteLocation(loc)}>✕</button>
                </td>
              </tr>`;
            })}
          </table>
        </div>
        <form class="row add" @submit=${this._addLocation}>
          <input name="name" placeholder="New location" autocomplete="off" />
          <select name="parent">
            ${opt("", "(top level)", "")}
            ${model.locationOptions.map((o) => opt(o.id, `inside ${o.path}`, ""))}
          </select>
          <button type="submit">Add</button>
        </form>
      </div>
    `;
  }

  _addLocation = async (e) => {
    e.preventDefault();
    const { name, parent } = e.target.elements;
    if (!name.value.trim()) return;
    await this.app.call("location/save", { name: name.value.trim(), parent_id: parent.value || null });
    name.value = "";
  };

  async _deleteLocation(loc) {
    const ok = await this.app.confirm({
      title: `Delete ${loc.name}`,
      text: "Assets and locations inside it move up one level.",
      confirmText: "Delete",
    });
    if (ok) await this.app.call("location/delete", { item_id: loc.id });
  }

  _renderData() {
    return html`
      <div class="card">
        <h2>Backup</h2>
        <p class="muted small">
          All House Manager data is included in your normal Home Assistant backups (it lives in
          <code>.storage/house_manager.data</code>, with files in <code>house_manager_files/</code>). For insurance,
          also keep an off-site copy: use <b>Assets → Export CSV</b>, or download a full JSON copy here. Neither
          download includes the attached files themselves.
        </p>
        <button @click=${this._exportJson}>Download full data (JSON)</button>
      </div>
    `;
  }

  _exportJson = async () => {
    const raw = await this.app.hass.callWS({ type: "house_manager/get_data" });
    raw.history = await this.app.hass.callWS({ type: "house_manager/history" });
    delete raw.notify_services;
    downloadFile(`house-manager-${todayISO()}.json`, JSON.stringify(raw, null, 2), "application/json");
  };

  static styles = [
    sharedStyles,
    css`
      .stack {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .stack label.row {
        flex-wrap: nowrap;
      }
      input.name {
        width: 100%;
        min-width: 140px;
        background: transparent;
        border-color: transparent;
      }
      input.name:hover,
      input.name:focus {
        border-color: var(--divider-color);
      }
      .nowrap {
        white-space: nowrap;
      }
      td.actions {
        width: 40px;
        text-align: right;
      }
      form.add {
        margin-top: 12px;
      }
      form.add input {
        flex: 1;
      }
      code {
        font-size: 12px;
      }
    `,
  ];
}

define("hm-settings-page", SettingsPage);
