// Assets page: searchable list, CSV export (for insurance) and CSV import.

import { LitElement, html, css } from "../lit.js";
import { sharedStyles } from "../styles.js";
import { opt } from "../components.js";
import { define, downloadFile, fmtDate, fmtMoney, parseCSV, toCSV, todayISO } from "../util.js";

// Column order for export, and the header names import understands.
export const CSV_COLUMNS = [
  ["Name", "name"],
  ["Category", "category_name"],
  ["Location", "location_path"],
  ["Manufacturer", "manufacturer"],
  ["Model Number", "model_number"],
  ["Serial Number", "serial_number"],
  ["Purchase Date", "purchase_date"],
  ["Purchase Price", "purchase_price"],
  ["Replacement Value", "replacement_value"],
  ["Description", "description"],
  ["Retired Date", "retired_date"],
];

class AssetsPage extends LitElement {
  static properties = {
    app: { attribute: false },
    model: { attribute: false },
    _search: { state: true },
    _category: { state: true },
    _location: { state: true },
    _showRetired: { state: true },
    _sort: { state: true },
  };

  constructor() {
    super();
    this._search = "";
    this._category = "";
    this._location = "";
    this._showRetired = false;
    this._sort = "name";
  }

  _filtered() {
    const { model } = this;
    const inLocation = this._location ? model.locationAndChildren(this._location) : null;
    const search = this._search.toLowerCase();
    const list = model.assets.filter((a) => {
      if (!this._showRetired && a.retired_date) return false;
      if (this._category && a.category_id !== this._category) return false;
      if (inLocation && !inLocation.has(a.location_id)) return false;
      if (search) {
        const text = [a.name, a.manufacturer, a.model_number, a.serial_number, a.description]
          .join(" ")
          .toLowerCase();
        if (!text.includes(search)) return false;
      }
      return true;
    });
    const key = {
      name: (a) => a.name.toLowerCase(),
      category: (a) => (model.categoriesById[a.category_id]?.name || "~").toLowerCase(),
      location: (a) => model.locationPath(a.location_id) || "~",
      purchased: (a) => a.purchase_date || "",
      price: (a) => Number(a.purchase_price) || 0,
    }[this._sort];
    const desc = this._sort === "purchased" || this._sort === "price";
    return list.sort((a, b) => {
      const ka = key(a);
      const kb = key(b);
      const cmp = typeof ka === "number" ? ka - kb : String(ka).localeCompare(String(kb));
      return desc ? -cmp : cmp;
    });
  }

  render() {
    const { app, model } = this;
    const assets = this._filtered();
    const total = (field) => assets.reduce((sum, a) => sum + (Number(a[field]) || 0), 0);
    const header = (label, key) =>
      html`<th class="sortable ${this._sort === key ? "sorted" : ""}" @click=${() => (this._sort = key)}>
        ${label}
      </th>`;

    return html`
      <div class="page">
        <div class="card">
          <div class="row header">
            <h2>Assets <span class="chip">${assets.length}</span></h2>
            <span class="spacer"></span>
            <button @click=${this._import}>Import CSV</button>
            <button @click=${() => this._export(assets)}>Export CSV</button>
            <button class="primary" @click=${() => app.openAsset(null)}>+ New asset</button>
          </div>
          <div class="filters">
            <input
              type="search"
              placeholder="Search name, model, serial, description…"
              .value=${this._search}
              @input=${(e) => (this._search = e.target.value)}
            />
            <select @change=${(e) => (this._category = e.target.value)}>
              ${opt("", "All categories", this._category)}
              ${model.categoryOptions.map((c) => opt(c.id, c.name, this._category))}
            </select>
            <select @change=${(e) => (this._location = e.target.value)}>
              ${opt("", "All locations", this._location)}
              ${model.locationOptions.map((l) => opt(l.id, l.path, this._location))}
            </select>
            <label class="row small">
              <input
                type="checkbox"
                .checked=${this._showRetired}
                @change=${(e) => (this._showRetired = e.target.checked)}
              />
              Show retired
            </label>
          </div>
          ${assets.length
            ? html`
                <div class="table-wrap">
                  <table>
                    <tr>
                      ${header("Name", "name")} ${header("Category", "category")}
                      ${header("Location", "location")}
                      <th>Model</th>
                      ${header("Purchased", "purchased")} ${header("Price", "price")}
                    </tr>
                    ${assets.map(
                      (a) => html`
                        <tr class="clickable" @click=${() => app.navigate(`/assets/${a.id}`)}>
                          <td>
                            ${a.name}
                            ${a.retired_date ? html`<span class="chip">Retired</span>` : ""}
                            ${a.attachments?.length ? html`<span class="muted small" title="Attachments">📎${a.attachments.length}</span>` : ""}
                          </td>
                          <td class="muted">${model.categoriesById[a.category_id]?.name || ""}</td>
                          <td class="muted">${model.locationPath(a.location_id)}</td>
                          <td class="muted">${a.model_number || ""}</td>
                          <td class="muted">${fmtDate(a.purchase_date)}</td>
                          <td class="muted">${fmtMoney(a.purchase_price)}</td>
                        </tr>
                      `
                    )}
                  </table>
                </div>
                <div class="row muted small totals">
                  <span>Purchase total: <b>${fmtMoney(total("purchase_price"))}</b></span>
                  <span>Replacement value total: <b>${fmtMoney(total("replacement_value"))}</b></span>
                </div>
              `
            : html`<div class="empty">No assets match.</div>`}
        </div>
      </div>
    `;
  }

  _export(assets) {
    const { model } = this;
    const rows = [
      [...CSV_COLUMNS.map(([label]) => label), "Attachments", "Asset ID"],
      ...assets.map((a) => {
        const values = {
          ...a,
          category_name: model.categoriesById[a.category_id]?.name || "",
          location_path: model.locationPath(a.location_id),
        };
        return [
          ...CSV_COLUMNS.map(([, key]) => values[key] ?? ""),
          (a.attachments || []).map((f) => f.filename).join("; "),
          a.id,
        ];
      }),
    ];
    downloadFile(`house-assets-${todayISO()}.csv`, toCSV(rows), "text/csv");
  }

  _import() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".csv,text/csv";
    input.onchange = async () => {
      const file = input.files[0];
      if (!file) return;
      const rows = parseCSV(await file.text());
      if (rows.length < 2) {
        this.app.toast("That file has no data rows.");
        return;
      }
      const headers = rows[0].map((h) => h.trim().toLowerCase());
      const columnIndex = Object.fromEntries(
        CSV_COLUMNS.map(([label, key]) => [key, headers.indexOf(label.toLowerCase())])
      );
      if (columnIndex.name < 0) {
        this.app.toast('The CSV needs a "Name" column. Export first to see the expected columns.');
        return;
      }
      const assets = rows.slice(1).map((row) => {
        const asset = {};
        for (const [key, index] of Object.entries(columnIndex)) {
          if (index < 0) continue;
          let value = (row[index] ?? "").trim();
          if (key === "purchase_price" || key === "replacement_value") {
            value = value.replace(/[^0-9.\-]/g, "");
            asset[key] = value === "" ? null : Number(value);
          } else {
            asset[key] = value || null;
          }
        }
        return asset;
      }).filter((a) => a.name);
      const ok = await this.app.confirm({
        title: "Import assets",
        text: `Add ${assets.length} new assets from ${file.name}? Missing categories and locations are created automatically. Existing assets are not changed.`,
        confirmText: "Import",
      });
      if (!ok) return;
      const result = await this.app.call("asset/import", { rows: assets });
      this.app.toast(`Imported ${result.imported} assets.`);
    };
    input.click();
  }

  static styles = [
    sharedStyles,
    css`
      .header h2 {
        margin: 0;
      }
      .header {
        margin-bottom: 12px;
      }
      th.sortable {
        cursor: pointer;
      }
      th.sorted {
        color: var(--primary-color);
      }
      .totals {
        margin-top: 12px;
        gap: 24px;
      }
    `,
  ];
}

define("hm-assets-page", AssetsPage);
