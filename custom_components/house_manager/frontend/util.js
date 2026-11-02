// Small helpers shared by the House Manager panel. No dependencies.

export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function pad(n) {
  return String(n).padStart(2, "0");
}

function ordinal(n) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/** Format "2026-11-02" or a full ISO datetime as a short local date. */
export function fmtDate(value) {
  if (!value) return "";
  let date;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split("-").map(Number);
    date = new Date(y, m - 1, d);
  } else {
    date = new Date(value);
  }
  if (isNaN(date)) return value;
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function fmtDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  const time = date.getHours() || date.getMinutes()
    ? " " + date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : "";
  return fmtDate(value) + time;
}

/** "Today", "Tomorrow", "in 5 days", "3 days ago" */
export function relativeDay(value) {
  if (!value) return "";
  const then = new Date(value);
  const start = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const days = Math.round((start(then) - start(new Date())) / 86400000);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  return days > 0 ? `in ${days} days` : `${-days} days ago`;
}

export function fmtMoney(value) {
  if (value === null || value === undefined || value === "") return "";
  return Number(value).toLocaleString(undefined, { style: "currency", currency: "USD" });
}

export function fmtSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Human description of a schedule dict (see schedule.py for shapes). */
export function describeSchedule(s) {
  if (!s) return "";
  const every = (n, unit) => (n > 1 ? `Every ${n} ${unit}s` : `Every ${unit}`);
  switch (s.type) {
    case "once":
      return `One time (${fmtDate(s.date)})`;
    case "daily":
      return every(s.interval, "day");
    case "weekly":
      return `${every(s.interval, "week")} on ${s.weekdays.map((d) => WEEKDAYS[d]).join(", ")}`;
    case "monthly": {
      const on = `on the ${ordinal(s.day)}`;
      if (s.interval === 1) return `Monthly ${on}`;
      if (s.interval === 3) return `Quarterly ${on}`;
      if (s.interval === 6) return `Every 6 months ${on}`;
      if (s.interval === 12) return `Yearly ${on}`;
      return `Every ${s.interval} months ${on}`;
    }
    case "yearly":
      return `Yearly on ${s.dates
        .map((md) => {
          const [m, d] = md.split("-").map(Number);
          return `${MONTHS[m - 1]} ${d}`;
        })
        .join(", ")}`;
    case "cron":
      return `Custom (${s.expression})`;
    default:
      return s.type;
  }
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

export function toCSV(rows) {
  const cell = (v) => {
    const text = v === null || v === undefined ? "" : String(v);
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return rows.map((row) => row.map(cell).join(",")).join("\r\n");
}

/** Parse CSV text into an array of arrays. Handles quotes and newlines in quotes. */
export function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  text = text.replace(/^﻿/, "");
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((v) => v.trim() !== ""));
}

export function downloadFile(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** customElements.define that tolerates the module being loaded twice. */
export function define(name, cls) {
  if (!customElements.get(name)) customElements.define(name, cls);
}
