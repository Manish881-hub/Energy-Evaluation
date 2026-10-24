const API_ROOT = "/api";

export async function api(path, params = {}) {
  const query = new URLSearchParams(
    Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== "")
  ).toString();
  const response = await fetch(`${API_ROOT}/${path}${query ? `?${query}` : ""}`);
  if (!response.ok) {
    let detail = response.statusText;
    try {
      const body = await response.json();
      detail = body.detail || detail;
    } catch {
      // Keep the status text when the body is not JSON.
    }
    throw new Error(detail);
  }
  return response.json();
}

export function downloadCsv(filename, rows) {
  const csv = rows
    .map((row) =>
      row
        .map((value) => {
          const text = value == null ? "" : String(value);
          return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
        })
        .join(",")
    )
    .join("\n");
  const blob = new Blob([`${csv}\n`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

const number = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 });
const oneDecimal = new Intl.NumberFormat("en-GB", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export const fmtMW = (value) => (value == null ? "–" : `${number.format(Math.round(value))} MW`);
export const fmtGW = (value) => (value == null ? "–" : `${oneDecimal.format(value / 1000)} GW`);
export const fmtGWh = (value) => (value == null ? "–" : `${oneDecimal.format(value / 1000)} GWh`);
export const fmtPct = (value, digits = 1) =>
  value == null ? "–" : `${Number(value).toLocaleString("en-GB", { maximumFractionDigits: digits, minimumFractionDigits: digits })}%`;
export const fmtSignedMW = (value) =>
  value == null ? "–" : `${value > 0 ? "+" : ""}${number.format(Math.round(value))} MW`;
export const fmtCount = (value) => (value == null ? "–" : number.format(value));

export const fmtDateTime = (iso) =>
  iso
    ? new Date(iso).toLocaleString("en-GB", {
        timeZone: "Europe/London",
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "–";

export const fmtDate = (iso) =>
  iso
    ? new Date(iso).toLocaleDateString("en-GB", {
        timeZone: "Europe/London",
        weekday: "short",
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "–";

export const fmtShortDate = (iso) =>
  iso
    ? new Date(iso).toLocaleDateString("en-GB", {
        timeZone: "Europe/London",
        day: "2-digit",
        month: "short",
      })
    : "";

export const fmtTime = (iso) =>
  iso
    ? new Date(iso).toLocaleTimeString("en-GB", {
        timeZone: "Europe/London",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "–";

export const fmtHour = (hour) => `${String(hour).padStart(2, "0")}:00`;
