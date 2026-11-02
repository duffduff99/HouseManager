import { css } from "./lit.js";

// Shared look and feel. Uses Home Assistant's theme variables so the panel
// follows light/dark mode and custom themes.
export const sharedStyles = css`
  :host {
    color: var(--primary-text-color);
    font-family: var(--paper-font-body1_-_font-family, Roboto, sans-serif);
    font-size: 14px;
  }
  * {
    box-sizing: border-box;
  }
  .page {
    max-width: 1200px;
    margin: 0 auto;
    padding: 16px;
  }
  .card {
    background: var(--card-background-color, #fff);
    border-radius: var(--ha-card-border-radius, 12px);
    border: 1px solid var(--divider-color, #e0e0e0);
    padding: 16px;
    margin-bottom: 16px;
  }
  .card h2 {
    margin: 0 0 12px;
    font-size: 18px;
    font-weight: 500;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .card h2 .spacer {
    flex: 1;
  }
  .card h2 button {
    font-size: 14px;
    font-weight: 400;
  }
  .grid {
    display: grid;
    gap: 16px;
    grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  }
  .muted {
    color: var(--secondary-text-color);
  }
  .small {
    font-size: 12px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .spacer {
    flex: 1;
  }
  .empty {
    color: var(--secondary-text-color);
    padding: 12px 0;
    font-style: italic;
  }
  a,
  .link {
    color: var(--primary-color);
    cursor: pointer;
    text-decoration: none;
  }
  .link:hover {
    text-decoration: underline;
  }
  button {
    font: inherit;
    border-radius: 8px;
    padding: 7px 14px;
    border: 1px solid var(--divider-color, #ccc);
    background: var(--card-background-color, #fff);
    color: var(--primary-text-color);
    cursor: pointer;
  }
  button:hover {
    filter: brightness(0.96);
  }
  button.primary {
    background: var(--primary-color);
    border-color: var(--primary-color);
    color: var(--text-primary-color, #fff);
  }
  button.danger {
    color: var(--error-color, #db4437);
    border-color: var(--error-color, #db4437);
  }
  button.flat {
    border-color: transparent;
    background: transparent;
    color: var(--primary-color);
    padding: 4px 8px;
  }
  button:disabled {
    opacity: 0.5;
    cursor: default;
  }
  input,
  select,
  textarea {
    font: inherit;
    color: var(--primary-text-color);
    background: var(--input-fill-color, var(--secondary-background-color, #f5f5f5));
    border: 1px solid var(--divider-color, #ccc);
    border-radius: 6px;
    padding: 7px 9px;
    min-width: 0;
  }
  input[type="checkbox"] {
    width: 18px;
    height: 18px;
    accent-color: var(--primary-color);
    cursor: pointer;
  }
  textarea {
    width: 100%;
    min-height: 80px;
    resize: vertical;
  }
  label.field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 12px;
    color: var(--secondary-text-color);
  }
  label.field > input,
  label.field > select,
  label.field > textarea {
    font-size: 14px;
  }
  .form {
    display: grid;
    gap: 12px;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  }
  .form .wide {
    grid-column: 1 / -1;
  }
  table {
    width: 100%;
    border-collapse: collapse;
  }
  th {
    text-align: left;
    font-weight: 500;
    color: var(--secondary-text-color);
    font-size: 12px;
    padding: 8px;
    border-bottom: 1px solid var(--divider-color);
    white-space: nowrap;
  }
  td {
    padding: 8px;
    border-bottom: 1px solid var(--divider-color);
    vertical-align: middle;
  }
  tr.clickable {
    cursor: pointer;
  }
  tr.clickable:hover td {
    background: var(--secondary-background-color);
  }
  .table-wrap {
    overflow-x: auto;
  }
  .chip {
    display: inline-block;
    font-size: 11px;
    border-radius: 10px;
    padding: 2px 8px;
    background: var(--secondary-background-color, #eee);
    color: var(--secondary-text-color);
    white-space: nowrap;
  }
  .chip.warn {
    background: var(--warning-color, #ffa600);
    color: #000;
  }
  .chip.ok {
    background: var(--success-color, #43a047);
    color: #fff;
  }
  .task-list .item {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 8px 0;
    border-bottom: 1px solid var(--divider-color);
  }
  .task-list .item:last-child {
    border-bottom: none;
  }
  .task-list .item input[type="checkbox"] {
    margin-top: 2px;
    flex-shrink: 0;
  }
  .task-list .item .body {
    flex: 1;
    min-width: 0;
  }
  .task-list .placeholder {
    width: 18px;
    text-align: center;
    color: var(--secondary-text-color);
    flex-shrink: 0;
  }
  .task-list .done .title {
    text-decoration: line-through;
    color: var(--secondary-text-color);
  }
  .filters {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    align-items: center;
    margin-bottom: 12px;
  }
  .filters input[type="search"] {
    flex: 1;
    min-width: 180px;
  }
  @media (max-width: 600px) {
    .wide-only {
      display: none;
    }
    .page {
      padding: 8px;
    }
  }
  .stat {
    font-size: 28px;
    font-weight: 400;
  }
`;
