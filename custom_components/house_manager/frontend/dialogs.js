// Dialogs: task editor (with schedule builder), asset editor, maintenance
// record editor, and a simple confirm box. All use the native <dialog>.

import { LitElement, html, css } from "./lit.js";
import { sharedStyles } from "./styles.js";
import { opt } from "./components.js";
import { MONTHS, WEEKDAYS, define, fmtDate, fmtDateTime, pad, todayISO } from "./util.js";

const dialogStyles = [
  sharedStyles,
  css`
    dialog {
      border: none;
      border-radius: 16px;
      padding: 0;
      width: min(640px, calc(100vw - 24px));
      max-height: calc(100vh - 24px);
      background: var(--card-background-color, #fff);
      color: var(--primary-text-color);
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
    }
    dialog::backdrop {
      background: rgba(0, 0, 0, 0.45);
    }
    .content {
      padding: 20px;
      overflow-y: auto;
      max-height: calc(100vh - 110px);
    }
    h2 {
      margin: 0 0 16px;
      font-weight: 500;
      font-size: 20px;
    }
    .actions {
      display: flex;
      gap: 8px;
      padding: 12px 20px;
      border-top: 1px solid var(--divider-color);
      align-items: center;
    }
    .section {
      margin-top: 16px;
      padding-top: 16px;
      border-top: 1px solid var(--divider-color);
    }
    .weekdays {
      display: flex;
      gap: 4px;
      flex-wrap: wrap;
    }
    .weekdays button.on {
      background: var(--primary-color);
      border-color: var(--primary-color);
      color: var(--text-primary-color, #fff);
    }
    .preview {
      margin-top: 12px;
      font-size: 13px;
    }
    .error {
      color: var(--error-color, #db4437);
    }
    input.short {
      width: 70px;
    }
  `,
];

class BaseDialog extends LitElement {
  get _dialog() {
    return this.shadowRoot.querySelector("dialog");
  }

  async _show() {
    await this.updateComplete;
    if (!this._dialog.open) this._dialog.showModal();
  }

  close() {
    this._dialog?.close();
  }
}

// ---------------------------------------------------------------------------
// Task dialog
// ---------------------------------------------------------------------------

const KINDS = [
  ["once", "One time"],
  ["daily", "Daily"],
  ["weekly", "Weekly"],
  ["monthly", "Monthly"],
  ["quarterly", "Quarterly"],
  ["yearly", "Yearly / specific dates"],
  ["cron", "Custom (cron)"],
];

function defaultRule() {
  const now = new Date();
  return {
    kind: "weekly",
    date: todayISO(),
    interval: 1,
    start: todayISO(),
    weekdays: [(now.getDay() + 6) % 7],
    day: 1,
    dates: [`${pad(now.getMonth() + 1)}-01`],
    expression: "0 8 * * 5",
  };
}

function ruleFromSchedule(s) {
  const rule = defaultRule();
  if (!s) return rule;
  Object.assign(rule, s, { kind: s.type });
  if (s.type === "monthly" && s.interval === 3) {
    rule.kind = "quarterly";
  }
  return rule;
}

function scheduleFromRule(r) {
  const interval = Math.max(1, parseInt(r.interval, 10) || 1);
  switch (r.kind) {
    case "once":
      return { type: "once", date: r.date };
    case "daily":
      return { type: "daily", interval, start: r.start };
    case "weekly":
      return { type: "weekly", interval, weekdays: r.weekdays, start: r.start };
    case "monthly":
      return { type: "monthly", interval, day: parseInt(r.day, 10) || 1, start: r.start };
    case "quarterly":
      return { type: "monthly", interval: 3, day: parseInt(r.day, 10) || 1, start: r.start };
    case "yearly":
      return { type: "yearly", dates: r.dates };
    case "cron":
      return { type: "cron", expression: r.expression };
  }
  return null;
}

class TaskDialog extends BaseDialog {
  static properties = {
    app: { attribute: false },
    model: { attribute: false },
    _task: { state: true },
    _form: { state: true },
    _rule: { state: true },
    _preview: { state: true },
  };

  open(task, defaults = {}) {
    this._task = task;
    this._form = {
      title: task?.title || "",
      notes: task?.notes || "",
      asset_id: task?.asset_id ?? defaults.asset_id ?? "",
      assignee: task?.assignee || "",
      enabled: task ? task.enabled : true,
      open_now: false,
    };
    this._rule = ruleFromSchedule(task?.schedule);
    this._preview = undefined;
    this._updatePreview();
    this._show();
  }

  _set(changes) {
    this._form = { ...this._form, ...changes };
  }

  _setRule(changes) {
    this._rule = { ...this._rule, ...changes };
    clearTimeout(this._previewTimer);
    this._previewTimer = setTimeout(() => this._updatePreview(), 300);
  }

  async _updatePreview() {
    try {
      const result = await this.app.hass.callWS({
        type: "house_manager/schedule/preview",
        schedule: scheduleFromRule(this._rule),
      });
      this._preview = { next: result.next };
    } catch (err) {
      this._preview = { error: err.message };
    }
  }

  render() {
    if (!this._form) return html`<dialog></dialog>`;
    const { model } = this;
    const f = this._form;
    return html`
      <dialog @close=${() => (this._form = undefined)}>
        <div class="content">
          <h2>${this._task ? "Edit task" : "New task"}</h2>
          <div class="form">
            <label class="field wide">
              Title
              <input
                .value=${f.title}
                @input=${(e) => this._set({ title: e.target.value })}
                placeholder="e.g. Check water softener salt"
              />
            </label>
            <label class="field">
              Asset (optional)
              <select @change=${(e) => this._set({ asset_id: e.target.value })}>
                ${opt("", "— None —", f.asset_id)}
                ${model.activeAssets.map((a) => opt(a.id, a.name, f.asset_id))}
              </select>
            </label>
            <label class="field">
              Assigned to (optional)
              <select @change=${(e) => this._set({ assignee: e.target.value })}>
                ${opt("", "— Anyone —", f.assignee)}
                ${model.users.map((u) => opt(u.id, u.name, f.assignee))}
              </select>
            </label>
            <label class="field wide">
              Notes
              <textarea .value=${f.notes} @input=${(e) => this._set({ notes: e.target.value })}></textarea>
            </label>
          </div>

          <div class="section">${this._renderSchedule()}</div>

          <div class="section form">
            <label class="row">
              <input type="checkbox" .checked=${f.enabled} @change=${(e) => this._set({ enabled: e.target.checked })} />
              Active (untick to pause this task)
            </label>
            ${this._task?.status === "open"
              ? ""
              : html`<label class="row">
                  <input
                    type="checkbox"
                    .checked=${f.open_now}
                    @change=${(e) => this._set({ open_now: e.target.checked })}
                  />
                  Put it on the to-do list now
                </label>`}
          </div>
        </div>
        <div class="actions">
          ${this._task ? html`<button class="danger" @click=${this._delete}>Delete</button>` : ""}
          <span class="spacer"></span>
          <button @click=${() => this.close()}>Cancel</button>
          <button class="primary" @click=${this._save}>Save</button>
        </div>
      </dialog>
    `;
  }

  _renderSchedule() {
    const r = this._rule;
    const intervalInput = (unit) => html`<label class="field">
      Every
      <span class="row">
        <input
          class="short"
          type="number"
          min="1"
          .value=${String(r.interval)}
          @input=${(e) => this._setRule({ interval: e.target.value })}
        />
        ${unit}(s)
      </span>
    </label>`;
    const startInput = (label = "Starting") => html`<label class="field">
      ${label}
      <input type="date" .value=${r.start} @change=${(e) => this._setRule({ start: e.target.value })} />
    </label>`;
    const dayInput = html`<label class="field">
      Day of month
      <input
        class="short"
        type="number"
        min="1"
        max="31"
        .value=${String(r.day)}
        @input=${(e) => this._setRule({ day: e.target.value })}
      />
    </label>`;

    let fields;
    switch (r.kind) {
      case "once":
        fields = html`<label class="field">
          Date
          <input type="date" .value=${r.date} @change=${(e) => this._setRule({ date: e.target.value })} />
        </label>`;
        break;
      case "daily":
        fields = html`${intervalInput("day")} ${Number(r.interval) > 1 ? startInput() : ""}`;
        break;
      case "weekly":
        fields = html`
          <div class="field wide">
            <span class="muted small">On</span>
            <div class="weekdays">
              ${WEEKDAYS.map(
                (name, index) => html`<button
                  class=${r.weekdays.includes(index) ? "on" : ""}
                  @click=${() =>
                    this._setRule({
                      weekdays: r.weekdays.includes(index)
                        ? r.weekdays.filter((d) => d !== index)
                        : [...r.weekdays, index].sort(),
                    })}
                >
                  ${name}
                </button>`
              )}
            </div>
          </div>
          ${intervalInput("week")} ${Number(r.interval) > 1 ? startInput("Starting the week of") : ""}
        `;
        break;
      case "monthly":
        fields = html`${dayInput} ${intervalInput("month")}
        ${Number(r.interval) > 1 ? startInput("Starting month") : ""}`;
        break;
      case "quarterly":
        fields = html`${dayInput} ${startInput("First quarter starts")}
          <div class="muted small wide">Appears every 3 months, counting from the month above.</div>`;
        break;
      case "yearly":
        fields = html`<div class="field wide">
          <span class="muted small">On these dates every year</span>
          ${r.dates.map((md, index) => {
            const [m, d] = md.split("-").map(Number);
            const update = (month, day) => {
              const dates = [...r.dates];
              dates[index] = `${pad(month)}-${pad(day)}`;
              this._setRule({ dates });
            };
            return html`<div class="row">
              <select @change=${(e) => update(Number(e.target.value), d)}>
                ${MONTHS.map((name, i) => opt(String(i + 1), name, String(m)))}
              </select>
              <input
                class="short"
                type="number"
                min="1"
                max="31"
                .value=${String(d)}
                @input=${(e) => update(m, Number(e.target.value) || 1)}
              />
              ${r.dates.length > 1
                ? html`<button class="flat" @click=${() => this._setRule({ dates: r.dates.filter((_, i) => i !== index) })}>
                    ✕
                  </button>`
                : ""}
            </div>`;
          })}
          <div><button class="flat" @click=${() => this._setRule({ dates: [...r.dates, "01-01"] })}>+ Add date</button></div>
        </div>`;
        break;
      case "cron":
        fields = html`<label class="field wide">
            Cron expression (minute hour day-of-month month day-of-week)
            <input .value=${r.expression} @input=${(e) => this._setRule({ expression: e.target.value })} />
          </label>
          <div class="muted small wide">
            Examples: <code>0 8 * * 5</code> = Fridays 8am · <code>0 7 1 4,10 *</code> = Apr 1 and Oct 1 at 7am ·
            <code>0 9 * * 1-5</code> = weekdays 9am
          </div>`;
        break;
    }

    return html`
      <div class="form">
        <label class="field">
          Repeats
          <select @change=${(e) => this._setRule({ kind: e.target.value, interval: 1 })}>
            ${KINDS.map(([value, label]) => opt(value, label, r.kind))}
          </select>
        </label>
        ${fields}
      </div>
      <div class="preview">
        ${this._preview?.error
          ? html`<span class="error">${this._preview.error}</span>`
          : this._preview?.next
            ? html`<span class="muted"
                >Appears on:
                ${this._preview.next.map((d) => (r.kind === "cron" ? fmtDateTime(d) : fmtDate(d))).join(" · ") ||
                "never (date has passed)"}</span
              >`
            : ""}
      </div>
    `;
  }

  _save = async () => {
    const f = this._form;
    if (!f.title.trim()) {
      this.app.toast("Please enter a title.");
      return;
    }
    const params = {
      title: f.title.trim(),
      notes: f.notes,
      asset_id: f.asset_id || null,
      assignee: f.assignee || null,
      enabled: f.enabled,
      open_now: f.open_now,
      schedule: scheduleFromRule(this._rule),
    };
    if (this._task) params.item_id = this._task.id;
    try {
      await this.app.call("task/save", params);
      this.close();
    } catch (err) {
      // toast already shown; keep the dialog open
    }
  };

  _delete = async () => {
    const ok = await this.app.confirm({
      title: "Delete task",
      text: `Delete "${this._task.title}"? Its past completions stay in the asset's history.`,
      confirmText: "Delete",
    });
    if (ok) {
      await this.app.call("task/delete", { item_id: this._task.id });
      this.close();
    }
  };

  static styles = dialogStyles;
}

// ---------------------------------------------------------------------------
// Asset dialog
// ---------------------------------------------------------------------------

const ASSET_TEXT_FIELDS = [
  ["manufacturer", "Manufacturer"],
  ["model_number", "Model number"],
  ["serial_number", "Serial number"],
];

class AssetDialog extends BaseDialog {
  static properties = {
    app: { attribute: false },
    model: { attribute: false },
    _asset: { state: true },
    _form: { state: true },
    _saving: { state: true },
  };

  open(asset) {
    const { model } = this;
    this._asset = asset;
    this._files = [];
    this._form = {
      name: asset?.name || "",
      category_name: model.categoriesById[asset?.category_id]?.name || "",
      location_path: asset ? model.locationPath(asset.location_id) : "",
      manufacturer: asset?.manufacturer || "",
      model_number: asset?.model_number || "",
      serial_number: asset?.serial_number || "",
      purchase_date: asset?.purchase_date || "",
      purchase_price: asset?.purchase_price ?? "",
      replacement_value: asset?.replacement_value ?? "",
      description: asset?.description || "",
    };
    this._show();
  }

  _set(changes) {
    this._form = { ...this._form, ...changes };
  }

  render() {
    if (!this._form) return html`<dialog></dialog>`;
    const { model } = this;
    const f = this._form;
    const input = (key, label, type = "text", extra = {}) => html`<label class="field">
      ${label}
      <input
        type=${type}
        step=${extra.step || ""}
        list=${extra.list || ""}
        placeholder=${extra.placeholder || ""}
        .value=${String(f[key] ?? "")}
        @input=${(e) => this._set({ [key]: e.target.value })}
      />
    </label>`;
    return html`
      <dialog @close=${() => (this._form = undefined)}>
        <div class="content">
          <h2>${this._asset ? `Edit ${this._asset.name}` : "New asset"}</h2>
          <datalist id="categories">
            ${model.categoryOptions.map((c) => html`<option value=${c.name}></option>`)}
          </datalist>
          <datalist id="locations">
            ${model.locationOptions.map((l) => html`<option value=${l.path}></option>`)}
          </datalist>
          <div class="form">
            <label class="field wide">
              Name
              <input
                .value=${f.name}
                @input=${(e) => this._set({ name: e.target.value })}
                placeholder="e.g. Water heater"
              />
            </label>
            ${input("category_name", "Category (pick or type a new one)", "text", { list: "categories" })}
            ${input("location_path", "Location (pick or type, e.g. Basement > Laundry)", "text", { list: "locations" })}
            ${ASSET_TEXT_FIELDS.map(([key, label]) => input(key, label))}
            ${input("purchase_date", "Purchase date", "date")}
            ${input("purchase_price", "Purchase price", "number", { step: "0.01" })}
            ${input("replacement_value", "Replacement value", "number", { step: "0.01" })}
            <label class="field wide">
              Description
              <textarea
                .value=${f.description}
                @input=${(e) => this._set({ description: e.target.value })}
              ></textarea>
            </label>
            ${this._asset
              ? ""
              : html`<label class="field wide">
                  Attachments (manuals, receipts, photos)
                  <input type="file" multiple @change=${(e) => (this._files = [...e.target.files])} />
                </label>`}
          </div>
        </div>
        <div class="actions">
          <span class="spacer"></span>
          <button @click=${() => this.close()}>Cancel</button>
          <button class="primary" ?disabled=${this._saving} @click=${this._save}>Save</button>
        </div>
      </dialog>
    `;
  }

  _save = async () => {
    const f = this._form;
    if (!f.name.trim()) {
      this.app.toast("Please enter a name.");
      return;
    }
    const number = (v) => (v === "" || v === null || isNaN(Number(v)) ? null : Number(v));
    const params = {
      ...f,
      name: f.name.trim(),
      purchase_date: f.purchase_date || null,
      purchase_price: number(f.purchase_price),
      replacement_value: number(f.replacement_value),
    };
    if (this._asset) params.item_id = this._asset.id;
    this._saving = true;
    try {
      const asset = await this.app.call("asset/save", params);
      if (this._files.length) await this.app.upload("asset", asset.id, this._files);
      this.close();
      if (!this._asset) this.app.navigate(`/assets/${asset.id}`);
    } catch (err) {
      // toast already shown
    } finally {
      this._saving = false;
    }
  };

  static styles = dialogStyles;
}

// ---------------------------------------------------------------------------
// Maintenance record dialog
// ---------------------------------------------------------------------------

class RecordDialog extends BaseDialog {
  static properties = {
    app: { attribute: false },
    model: { attribute: false },
    _record: { state: true },
    _form: { state: true },
    _saving: { state: true },
  };

  open(record, assetId) {
    this._record = record;
    this._assetId = assetId;
    this._files = [];
    this._form = { date: record?.date || todayISO(), notes: record?.notes || "" };
    this._show();
  }

  render() {
    if (!this._form) return html`<dialog></dialog>`;
    const f = this._form;
    return html`
      <dialog @close=${() => (this._form = undefined)}>
        <div class="content">
          <h2>${this._record ? "Edit maintenance record" : "Add maintenance record"}</h2>
          <div class="form">
            <label class="field">
              Date
              <input type="date" .value=${f.date} @change=${(e) => (this._form = { ...f, date: e.target.value })} />
            </label>
            <label class="field wide">
              Notes
              <textarea
                .value=${f.notes}
                placeholder="What was done, by whom, parts used, cost…"
                @input=${(e) => (this._form = { ...this._form, notes: e.target.value })}
              ></textarea>
            </label>
            <label class="field wide">
              ${this._record ? "Add photos or files" : "Photos or files (optional)"}
              <input type="file" multiple accept="image/*,application/pdf" @change=${(e) => (this._files = [...e.target.files])} />
            </label>
          </div>
        </div>
        <div class="actions">
          ${this._record ? html`<button class="danger" @click=${this._delete}>Delete</button>` : ""}
          <span class="spacer"></span>
          <button @click=${() => this.close()}>Cancel</button>
          <button class="primary" ?disabled=${this._saving} @click=${this._save}>Save</button>
        </div>
      </dialog>
    `;
  }

  _save = async () => {
    const params = { ...this._form };
    if (this._record) params.item_id = this._record.id;
    else params.asset_id = this._assetId;
    this._saving = true;
    try {
      const record = await this.app.call("record/save", params);
      if (this._files.length) await this.app.upload("record", record.id, this._files);
      this.close();
    } catch (err) {
      // toast already shown
    } finally {
      this._saving = false;
    }
  };

  _delete = async () => {
    if (await this.app.confirm({ title: "Delete record", text: "Delete this maintenance record and its files?", confirmText: "Delete" })) {
      await this.app.call("record/delete", { item_id: this._record.id });
      this.close();
    }
  };

  static styles = dialogStyles;
}

// ---------------------------------------------------------------------------
// Confirm dialog
// ---------------------------------------------------------------------------

class ConfirmDialog extends BaseDialog {
  static properties = { _options: { state: true } };

  ask(options) {
    this._options = options;
    this._date = options.defaultDate || todayISO();
    this._show();
    return new Promise((resolve) => (this._resolve = resolve));
  }

  _finish(value) {
    const resolve = this._resolve;
    this._resolve = undefined;
    this.close();
    resolve?.(value);
  }

  render() {
    const o = this._options || {};
    return html`
      <dialog @close=${() => this._finish(false)}>
        <div class="content">
          <h2>${o.title}</h2>
          <p>${o.text}</p>
          ${o.dateLabel
            ? html`<label class="field">
                ${o.dateLabel}
                <input type="date" .value=${this._date} @change=${(e) => (this._date = e.target.value)} />
              </label>`
            : ""}
        </div>
        <div class="actions">
          <span class="spacer"></span>
          <button @click=${() => this._finish(false)}>Cancel</button>
          <button class="primary" @click=${() => this._finish(o.dateLabel ? this._date || todayISO() : true)}>
            ${o.confirmText || "OK"}
          </button>
        </div>
      </dialog>
    `;
  }

  static styles = dialogStyles;
}

define("hm-task-dialog", TaskDialog);
define("hm-asset-dialog", AssetDialog);
define("hm-record-dialog", RecordDialog);
define("hm-confirm", ConfirmDialog);
