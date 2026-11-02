// A single asset: details, attachments, its tasks, and maintenance history.

import { LitElement, html, css } from "../lit.js";
import { sharedStyles } from "../styles.js";
import { taskItem } from "../components.js";
import { define, fmtDate, fmtDateTime, fmtMoney, fmtSize, todayISO } from "../util.js";

const isImage = (attachment) => attachment.content_type?.startsWith("image/") && attachment.content_type !== "image/svg+xml";

class AssetDetail extends LitElement {
  static properties = {
    app: { attribute: false },
    model: { attribute: false },
    assetId: { attribute: false },
    _history: { state: true },
    _thumbs: { state: true },
  };

  constructor() {
    super();
    this._thumbs = {};
  }

  willUpdate(changed) {
    // Reload full (all-time) task history whenever the asset or data changes.
    if (changed.has("assetId") || changed.has("model")) this._loadHistory();
  }

  async _loadHistory() {
    const assetId = this.assetId;
    try {
      const history = await this.app.hass.callWS({ type: "house_manager/history", asset_id: assetId });
      if (assetId === this.assetId) this._history = history;
    } catch (err) {
      this._history = [];
    }
    this._loadThumbnails();
  }

  async _loadThumbnails() {
    const asset = this.model.assetsById[this.assetId];
    if (!asset) return;
    const images = [
      ...(asset.attachments || []),
      ...this.model.records.filter((r) => r.asset_id === asset.id).flatMap((r) => r.attachments || []),
    ].filter((a) => isImage(a) && !this._thumbs[a.id]);
    if (!images.length) return;
    const thumbs = { ...this._thumbs };
    for (const image of images) {
      try {
        thumbs[image.id] = await this.app.fileUrl(image);
      } catch (err) {
        // ignore; the file can still be opened from its link
      }
    }
    this._thumbs = thumbs;
  }

  render() {
    const { app, model } = this;
    const asset = model.assetsById[this.assetId];
    if (!asset) {
      return html`<div class="page"><div class="card">
        Asset not found. <span class="link" @click=${() => app.navigate("/assets")}>Back to assets</span>
      </div></div>`;
    }
    const tasks = model.tasks
      .filter((t) => t.asset_id === asset.id)
      .sort((a, b) => (a.status === "open" ? 0 : 1) - (b.status === "open" ? 0 : 1) || a.title.localeCompare(b.title));
    const field = (label, value) =>
      value || value === 0 ? html`<div class="field"><div class="muted small">${label}</div><div>${value}</div></div>` : "";

    return html`
      <div class="page">
        <div class="row crumbs">
          <span class="link" @click=${() => app.navigate("/assets")}>← Assets</span>
        </div>

        <div class="card">
          <h2>
            ${asset.name}
            ${asset.retired_date ? html`<span class="chip">Retired ${fmtDate(asset.retired_date)}</span>` : ""}
            <span class="spacer"></span>
            <button @click=${() => app.openAsset(asset)}>Edit</button>
            ${asset.retired_date
              ? html`<button @click=${this._unretire}>Un-retire</button>`
              : html`<button @click=${this._retire}>Retire</button>`}
            <button class="danger" @click=${this._delete}>Delete</button>
          </h2>
          <div class="fields">
            ${field("Category", model.categoriesById[asset.category_id]?.name)}
            ${field("Location", model.locationPath(asset.location_id))}
            ${field("Manufacturer", asset.manufacturer)}
            ${field("Model number", asset.model_number)}
            ${field("Serial number", asset.serial_number)}
            ${field("Purchase date", fmtDate(asset.purchase_date))}
            ${field("Purchase price", fmtMoney(asset.purchase_price))}
            ${field("Replacement value", fmtMoney(asset.replacement_value))}
          </div>
          ${asset.description ? html`<div class="description">${asset.description}</div>` : ""}
        </div>

        <div class="grid">
          <div class="card">
            <h2>
              Attachments
              <span class="spacer"></span>
              <button class="flat" @click=${() => this._pickFiles("asset", asset.id)}>+ Add files</button>
            </h2>
            ${this._renderAttachments(asset.attachments || [])}
          </div>

          <div class="card">
            <h2>
              Tasks
              <span class="spacer"></span>
              <button class="flat" @click=${() => app.openTask(null, { asset_id: asset.id })}>+ Add task</button>
            </h2>
            <div class="task-list">
              ${tasks.length
                ? tasks.map((t) => taskItem(app, model, t, { showAsset: false }))
                : html`<div class="empty">No tasks for this asset.</div>`}
            </div>
          </div>
        </div>

        <div class="card">
          <h2>
            Maintenance history
            <span class="spacer"></span>
            <button class="flat" @click=${() => app.openRecord(null, asset.id)}>+ Add record</button>
          </h2>
          ${this._renderHistory(asset)}
        </div>
      </div>
    `;
  }

  _renderAttachments(attachments, compact = false) {
    if (!attachments.length) return compact ? "" : html`<div class="empty">No attachments. Add manuals, receipts or photos.</div>`;
    return html`
      <div class="attachments ${compact ? "compact" : ""}">
        ${attachments.map(
          (a) => html`
            <div class="attachment">
              ${isImage(a) && this._thumbs[a.id]
                ? html`<img src=${this._thumbs[a.id]} alt=${a.filename} @click=${() => this.app.openFile(a)} />`
                : html`<span class="icon">${a.content_type === "application/pdf" ? "📄" : "📎"}</span>`}
              <span class="link name" @click=${() => this.app.openFile(a)}>${a.filename}</span>
              ${compact ? "" : html`<span class="muted small">${fmtSize(a.size)}</span>`}
              <button class="flat remove" title="Delete file" @click=${() => this._deleteAttachment(a)}>✕</button>
            </div>
          `
        )}
      </div>
    `;
  }

  _renderHistory(asset) {
    const records = this.model.records
      .filter((r) => r.asset_id === asset.id)
      .map((r) => ({ kind: "record", sort: r.date, record: r }));
    const taskEvents = (this._history || []).map((h) => ({ kind: "task", sort: h.date, entry: h }));
    const entries = [...records, ...taskEvents].sort((a, b) => b.sort.localeCompare(a.sort));
    if (!entries.length) return html`<div class="empty">No maintenance history yet.</div>`;
    return html`
      <div class="timeline">
        ${entries.map((e) =>
          e.kind === "record"
            ? html`
                <div class="entry">
                  <div class="date">${fmtDate(e.record.date)}</div>
                  <div class="body">
                    <div class="row">
                      <span class="chip">Record</span>
                      <span class="spacer"></span>
                      <button class="flat" @click=${() => this.app.openRecord(e.record, asset.id)}>Edit</button>
                    </div>
                    <div class="notes">${e.record.notes}</div>
                    ${this._renderAttachments(e.record.attachments || [], true)}
                  </div>
                </div>
              `
            : html`
                <div class="entry">
                  <div class="date">${fmtDate(e.entry.date)}</div>
                  <div class="body">
                    <div class="row">
                      ${e.entry.result === "completed"
                        ? html`<span class="chip ok">Completed</span>`
                        : html`<span class="chip">Missed</span>`}
                      <span>${e.entry.title}</span>
                      ${e.entry.user_id ? html`<span class="muted small">by ${this.model.userName(e.entry.user_id)}</span>` : ""}
                    </div>
                    <div class="muted small">${fmtDateTime(e.entry.date)}</div>
                  </div>
                </div>
              `
        )}
      </div>
    `;
  }

  _pickFiles(ownerType, ownerId) {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.onchange = () => input.files.length && this.app.upload(ownerType, ownerId, [...input.files]);
    input.click();
  }

  async _deleteAttachment(attachment) {
    if (await this.app.confirm({ title: "Delete file", text: `Delete ${attachment.filename}?`, confirmText: "Delete" })) {
      await this.app.call("attachment/delete", { item_id: attachment.id });
    }
  }

  _retire = async () => {
    const asset = this.model.assetsById[this.assetId];
    const date = await this.app.confirm({
      title: `Retire ${asset.name}`,
      text: "Retired assets are hidden from lists and exports by default, but their history is kept.",
      dateLabel: "Retired on",
      defaultDate: todayISO(),
      confirmText: "Retire",
    });
    if (date) await this.app.call("asset/save", { item_id: asset.id, retired_date: date });
  };

  _unretire = () => this.app.call("asset/save", { item_id: this.assetId, retired_date: null });

  _delete = async () => {
    const asset = this.model.assetsById[this.assetId];
    const ok = await this.app.confirm({
      title: `Delete ${asset.name}`,
      text: "This permanently deletes the asset, its maintenance records and attachments. Its tasks are kept but unlinked. If you sold or got rid of it, use Retire instead.",
      confirmText: "Delete",
    });
    if (ok) {
      await this.app.call("asset/delete", { item_id: asset.id });
      this.app.navigate("/assets");
    }
  };

  static styles = [
    sharedStyles,
    css`
      .crumbs {
        margin-bottom: 12px;
      }
      .fields {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
        gap: 12px;
      }
      .description {
        margin-top: 16px;
        white-space: pre-wrap;
      }
      .attachments .attachment {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 4px 0;
      }
      .attachments .name {
        flex: 1;
        overflow-wrap: anywhere;
      }
      .attachments img {
        width: 56px;
        height: 56px;
        object-fit: cover;
        border-radius: 6px;
        cursor: pointer;
      }
      .attachments.compact img {
        width: 80px;
        height: 80px;
      }
      .attachments .icon {
        font-size: 20px;
      }
      .remove {
        color: var(--secondary-text-color);
      }
      .timeline .entry {
        display: flex;
        gap: 16px;
        padding: 10px 0;
        border-bottom: 1px solid var(--divider-color);
      }
      .timeline .entry:last-child {
        border-bottom: none;
      }
      .timeline .date {
        width: 110px;
        flex-shrink: 0;
        color: var(--secondary-text-color);
      }
      .timeline .body {
        flex: 1;
        min-width: 0;
      }
      .notes {
        white-space: pre-wrap;
        margin: 4px 0;
      }
    `,
  ];
}

define("hm-asset-detail", AssetDetail);
