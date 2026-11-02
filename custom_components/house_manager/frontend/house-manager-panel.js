// Entry point for the House Manager sidebar panel.
//
// Home Assistant creates <house-manager-panel> and sets `hass`, `narrow`,
// `route` and `panel` on it. This element loads all data over the websocket
// API, keeps it fresh via a subscription, and renders one of the pages.

import { LitElement, html, css } from "./lit.js";
import { sharedStyles } from "./styles.js";
import { define } from "./util.js";
import "./pages/overview.js";
import "./pages/tasks.js";
import "./pages/assets.js";
import "./pages/asset-detail.js";
import "./pages/settings.js";
import "./dialogs.js";

const TABS = [
  { path: "", label: "Overview" },
  { path: "/tasks", label: "Tasks" },
  { path: "/assets", label: "Assets" },
  { path: "/settings", label: "Settings" },
];

/** Add lookup maps and helpers to the raw data from the backend. */
function buildModel(raw) {
  const byId = (list) => Object.fromEntries(list.map((item) => [item.id, item]));
  const model = {
    ...raw,
    assetsById: byId(raw.assets),
    categoriesById: byId(raw.categories),
    locationsById: byId(raw.locations),
    tasksById: byId(raw.tasks),
    usersById: byId(raw.users),
  };
  model.locationPath = (id) => {
    const names = [];
    const seen = new Set();
    while (id && model.locationsById[id] && !seen.has(id)) {
      seen.add(id);
      names.unshift(model.locationsById[id].name);
      id = model.locationsById[id].parent_id;
    }
    return names.join(" > ");
  };
  /** ids of a location and everything inside it */
  model.locationAndChildren = (id) => {
    const result = new Set([id]);
    let added = true;
    while (added) {
      added = false;
      for (const loc of raw.locations) {
        if (loc.parent_id && result.has(loc.parent_id) && !result.has(loc.id)) {
          result.add(loc.id);
          added = true;
        }
      }
    }
    return result;
  };
  model.locationOptions = raw.locations
    .map((loc) => ({ id: loc.id, path: model.locationPath(loc.id) }))
    .sort((a, b) => a.path.localeCompare(b.path));
  model.categoryOptions = [...raw.categories].sort((a, b) => a.name.localeCompare(b.name));
  model.activeAssets = raw.assets
    .filter((a) => !a.retired_date)
    .sort((a, b) => a.name.localeCompare(b.name));
  model.assetName = (id) => model.assetsById[id]?.name || "";
  model.userName = (id) => model.usersById[id]?.name || "";
  return model;
}

class HouseManagerPanel extends LitElement {
  static properties = {
    hass: { attribute: false },
    narrow: { type: Boolean },
    route: { attribute: false },
    panel: { attribute: false },
    _model: { state: true },
    _error: { state: true },
    _toast: { state: true },
  };

  connectedCallback() {
    super.connectedCallback();
    if (this.hass && !this._unsub) this._start();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._unsub) {
      this._unsub.then((unsub) => unsub()).catch(() => {});
      this._unsub = undefined;
    }
  }

  updated(changed) {
    if (changed.has("hass") && this.hass && !this._unsub && this.isConnected) this._start();
  }

  _start() {
    this._unsub = this.hass.connection.subscribeMessage(() => this._scheduleRefresh(), {
      type: "house_manager/subscribe",
    });
    this.refresh();
  }

  _scheduleRefresh() {
    clearTimeout(this._refreshTimer);
    this._refreshTimer = setTimeout(() => this.refresh(), 150);
  }

  async refresh() {
    try {
      const raw = await this.hass.callWS({ type: "house_manager/get_data" });
      this._model = buildModel(raw);
      this._error = undefined;
    } catch (err) {
      this._error = err.message || String(err);
    }
  }

  // ---- Actions used by pages and dialogs ---------------------------------

  /** Call a house_manager/<type> websocket command. Shows errors as a toast. */
  async call(type, params = {}) {
    try {
      const result = await this.hass.callWS({ type: `house_manager/${type}`, ...params });
      this._scheduleRefresh();
      return result;
    } catch (err) {
      this.toast(err.message || String(err));
      throw err;
    }
  }

  toast(message) {
    this._toast = message;
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => (this._toast = undefined), 5000);
  }

  navigate(path) {
    const prefix = this.route?.prefix || "/house-manager";
    history.pushState(null, "", prefix + path);
    window.dispatchEvent(new CustomEvent("location-changed", { detail: { replace: false } }));
  }

  async upload(ownerType, ownerId, files) {
    for (const file of files) {
      const form = new FormData();
      form.append("file", file, file.name);
      const url = `/api/house_manager/upload?owner_type=${ownerType}&owner_id=${encodeURIComponent(ownerId)}`;
      const response = this.hass.fetchWithAuth
        ? await this.hass.fetchWithAuth(url, { method: "POST", body: form })
        : await fetch(url, {
            method: "POST",
            body: form,
            headers: { Authorization: `Bearer ${this.hass.auth.data.access_token}` },
          });
      if (!response.ok) {
        let message = `Upload of ${file.name} failed (${response.status})`;
        try {
          message = (await response.json()).message || message;
        } catch (e) {
          // not JSON
        }
        this.toast(message);
      }
    }
    this._scheduleRefresh();
  }

  /** A short-lived URL for an attachment that works without auth headers. */
  async fileUrl(attachment, download = false) {
    const result = await this.hass.callWS({
      type: "auth/sign_path",
      path: `/api/house_manager/file/${attachment.id}`,
      expires: 3600,
    });
    return result.path + (download ? "&download=1" : "");
  }

  async openFile(attachment) {
    // Open the window first (inside the click) so pop-up blockers allow it.
    const win = window.open("", "_blank");
    const url = await this.fileUrl(attachment);
    if (win) win.location.href = url;
    else window.location.href = url;
  }

  openTask(task, defaults = {}) {
    this.shadowRoot.querySelector("hm-task-dialog").open(task, defaults);
  }

  openAsset(asset) {
    this.shadowRoot.querySelector("hm-asset-dialog").open(asset);
  }

  openRecord(record, assetId) {
    this.shadowRoot.querySelector("hm-record-dialog").open(record, assetId);
  }

  /** Promise-based confirm dialog. Resolves to false, true, or the date entered. */
  confirm(options) {
    return this.shadowRoot.querySelector("hm-confirm").ask(options);
  }

  toggleTask(task) {
    return this.call(task.status === "open" ? "task/complete" : "task/reopen", {
      item_id: task.id,
    });
  }

  // ---- Rendering -----------------------------------------------------------

  get _path() {
    return this.route?.path || "";
  }

  render() {
    const path = this._path;
    const active = path.startsWith("/tasks")
      ? "/tasks"
      : path.startsWith("/assets")
        ? "/assets"
        : path.startsWith("/settings")
          ? "/settings"
          : "";
    return html`
      <div class="toolbar">
        <ha-menu-button .hass=${this.hass} .narrow=${this.narrow}></ha-menu-button>
        <div class="title">House Manager</div>
      </div>
      <nav class="tabs">
        ${TABS.map(
          (tab) => html`<a
            class=${tab.path === active ? "active" : ""}
            href=${(this.route?.prefix || "/house-manager") + tab.path}
            @click=${(e) => {
              e.preventDefault();
              this.navigate(tab.path);
            }}
            >${tab.label}</a
          >`
        )}
      </nav>
      <main>${this._renderPage(path)}</main>
      ${this._toast ? html`<div class="toast" @click=${() => (this._toast = undefined)}>${this._toast}</div>` : ""}
      <hm-task-dialog .app=${this} .model=${this._model}></hm-task-dialog>
      <hm-asset-dialog .app=${this} .model=${this._model}></hm-asset-dialog>
      <hm-record-dialog .app=${this} .model=${this._model}></hm-record-dialog>
      <hm-confirm></hm-confirm>
    `;
  }

  _renderPage(path) {
    if (this._error && !this._model) {
      return html`<div class="page"><div class="card">Could not load House Manager: ${this._error}</div></div>`;
    }
    if (!this._model) return html`<div class="page muted">Loading…</div>`;
    const props = { app: this, model: this._model };
    if (path.startsWith("/tasks")) return html`<hm-tasks-page .app=${props.app} .model=${props.model}></hm-tasks-page>`;
    if (path.startsWith("/assets/")) {
      return html`<hm-asset-detail
        .app=${props.app}
        .model=${props.model}
        .assetId=${decodeURIComponent(path.slice("/assets/".length))}
      ></hm-asset-detail>`;
    }
    if (path.startsWith("/assets")) return html`<hm-assets-page .app=${props.app} .model=${props.model}></hm-assets-page>`;
    if (path.startsWith("/settings")) return html`<hm-settings-page .app=${props.app} .model=${props.model}></hm-settings-page>`;
    return html`<hm-overview-page .app=${props.app} .model=${props.model}></hm-overview-page>`;
  }

  static styles = [
    sharedStyles,
    css`
      :host {
        display: block;
        min-height: 100vh;
        background: var(--primary-background-color);
      }
      .toolbar {
        display: flex;
        align-items: center;
        height: var(--header-height, 56px);
        padding: 0 12px;
        background: var(--app-header-background-color, var(--primary-color));
        color: var(--app-header-text-color, #fff);
        border-bottom: var(--app-header-border-bottom, none);
      }
      .title {
        font-size: 20px;
        margin-left: 8px;
      }
      .tabs {
        display: flex;
        gap: 4px;
        padding: 0 12px;
        overflow-x: auto;
        background: var(--app-header-background-color, var(--primary-color));
      }
      .tabs a {
        color: var(--app-header-text-color, #fff);
        opacity: 0.75;
        padding: 10px 16px;
        border-bottom: 3px solid transparent;
        white-space: nowrap;
        text-decoration: none;
      }
      .tabs a.active {
        opacity: 1;
        border-bottom-color: var(--app-header-text-color, #fff);
      }
      .toast {
        position: fixed;
        bottom: 24px;
        left: 50%;
        transform: translateX(-50%);
        background: #323232;
        color: #fff;
        padding: 12px 20px;
        border-radius: 8px;
        z-index: 10;
        max-width: 90vw;
        cursor: pointer;
      }
    `,
  ];
}

define("house-manager-panel", HouseManagerPanel);
