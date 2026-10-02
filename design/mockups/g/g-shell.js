// Shared shell for the Headroom view mockups: top bar with the view switcher, plus the
// formatting helpers every view uses. Wording follows the app (apps/web/src/lib/time.ts, tone.ts).
import { accounts, providers, now } from "./data.js";

export { accounts, providers, now };

/* ---------- Small helpers ---------- */

export const esc = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );

export const providerName = (id) => providers.find((p) => p.id === id)?.name ?? id;

/** "52 min", "1 h 12 min", "2 days 16 h", "12 days". Takes minutes. */
export function countdown(minutes) {
  const m = Math.floor(Math.abs(minutes));
  if (m < 1) return "Under 1 min";
  if (m < 60) return `${m} min`;
  if (m < 1440) {
    const h = Math.floor(m / 60);
    const rest = m % 60;
    return rest === 0 ? `${h} h` : `${h} h ${rest} min`;
  }
  const d = Math.floor(m / 1440);
  const unit = d === 1 ? "day" : "days";
  if (m < 7 * 1440) {
    const h = Math.floor((m % 1440) / 60);
    return h === 0 ? `${d} ${unit}` : `${d} ${unit} ${h} h`;
  }
  return `${d} days`;
}

/** "Just now", "12 min ago". Takes minutes, past as a negative or positive number. */
export function ago(minutes) {
  if (Math.abs(minutes) < 1) return "Just now";
  return `${countdown(minutes)} ago`;
}

/** good under 70 used, warn 70 to 89, bad from 90. Unknown stays null. */
export function tone(used) {
  if (used === null || used === undefined) return null;
  if (used >= 90) return "bad";
  return used >= 70 ? "warn" : "good";
}
export const toneWords = { warn: "Running Low", bad: "Almost Out" };
export const left = (used) => Math.max(0, 100 - used);

/** 64 stays 64; 99.2 stays 99.2. */
export const pct = (value) =>
  Number.isInteger(value) ? String(value) : String(Number(value.toFixed(1)));

/** The limit that matters most for an account: the highest used share (the primary meter wins a tie).
 *  A balance with a total ("4.99 of 5") counts as a limit when there are no meters. Null when nothing is reported. */
export function tightest(account) {
  const known = account.meters.filter((m) => m.used !== null && m.used !== undefined);
  if (known.length > 0) {
    return known.reduce((best, m) =>
      m.used > best.used || (m.used === best.used && m.primary) ? m : best,
    );
  }
  const balance = account.balances?.find((b) => b.of);
  if (balance) {
    return {
      key: "balance",
      label: balance.label,
      window: null,
      used: ((balance.of - balance.value) / balance.of) * 100,
      resets: null,
      balance,
    };
  }
  return null;
}

/** Reset wording for one meter, as in the app's cell caption. */
export function resetText(meter) {
  if (meter.notStarted) return "Not Started";
  if (meter.words === "with_cycle") return "Resets with the cycle";
  if (meter.resets === null || meter.resets === undefined)
    return meter.balance ? "No reset time" : "No reset time";
  return `${meter.words === "cycle_end" ? "Cycle ends" : "Resets"} in ${countdown(meter.resets)}`;
}
export const windowName = (m) => (m.window ? `${m.label} · ${m.window}` : m.label);

/* ---------- Left or used (shared by every view, remembered on this device) ---------- */

const KEY = "headroom.limitsView";
export const getLimitsView = () => {
  try {
    return localStorage.getItem(KEY) === "used" ? "used" : "left";
  } catch {
    return "left";
  }
};
export const setLimitsView = (value) => {
  try {
    localStorage.setItem(KEY, value);
  } catch {
    /* private mode: keep the choice in memory only */
  }
};
/** { text: "19", unit: "% left", fill: 19 } for a used percent. */
export function display(used, view = getLimitsView()) {
  if (used === null || used === undefined) return null;
  return view === "used"
    ? { text: pct(used), unit: "% used", fill: used }
    : { text: pct(left(used)), unit: "% left", fill: left(used) };
}

/* ---------- Icons (24 px stroke, same paths as the app) ---------- */

const stroke = (inner, w = 2) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${inner}</svg>`;
export const icons = {
  clock: stroke('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  pause: stroke(
    '<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>',
  ),
  alert: stroke('<circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/>'),
  retry: stroke('<path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/>'),
  reset: stroke('<path d="M3 12a9 9 0 1 0 2.6-6.4"/><path d="M3 3v6h6"/>'),
  check: stroke('<path d="m5 12 5 5 9-10"/>', 2.2),
  chevron: stroke('<path d="m6 9 6 6 6-6"/>'),
  bell: stroke(
    '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/>',
  ),
  arrow: stroke('<path d="M12 5v14M6 13l6 6 6-6"/>'),
  star: stroke(
    '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
  ),
};

/* ---------- Brand marks (monochrome ones follow the text colour; Claude and Antigravity keep their colours) ---------- */

const marks = {
  claude: "claude.svg",
  antigravity: "antigravity.svg",
  codex:
    '<svg aria-hidden="true" focusable="false" viewBox="0 0 611 611" fill="none" xmlns="http://www.w3.org/2000/svg"> <path fill-rule="evenodd" clip-rule="evenodd" d="M252.794 108.802C289.191 99.0484 326.265 110.305 351.148 135.135C385.113 126.072 422.85 134.862 449.492 161.505C476.136 188.149 484.925 225.888 475.862 259.85V259.854C500.696 284.735 511.95 321.81 502.198 358.207C492.447 394.602 464.161 421.084 430.215 430.217C421.083 464.162 394.603 492.448 358.206 502.199C321.812 511.951 284.734 500.693 259.852 475.864C225.887 484.927 188.15 476.137 161.507 449.495C134.864 422.851 126.073 385.111 135.136 351.149C110.304 326.266 99.0496 289.192 108.801 252.795C118.552 216.4 146.84 189.918 180.784 180.785C189.917 146.841 216.396 118.553 252.794 108.802ZM374.292 407.145C374.292 411.271 372.092 415.086 368.517 417.148L283.723 466.102C302.487 480.585 327.555 486.459 352.217 479.852C386.997 470.532 410.068 439.312 410.555 405.006V317.717C410.555 315.08 409.125 312.621 406.843 311.303L374.292 292.509V407.145ZM251.868 415.897C248.296 417.959 243.893 417.959 240.317 415.897L155.526 366.942C152.366 390.436 159.811 415.08 177.866 433.136H177.863C203.325 458.594 241.896 462.962 271.85 446.232L347.449 402.586C349.735 401.268 351.148 398.8 351.148 396.163V358.579L251.868 415.897ZM368.602 220.628C366.319 219.309 363.474 219.318 361.191 220.637L328.641 239.431L427.921 296.749C431.496 298.811 433.697 302.627 433.697 306.752V404.661C455.622 395.654 473.244 376.881 479.851 352.218C489.169 317.442 473.668 281.85 444.201 264.274L368.602 220.628ZM177.303 206.34C155.377 215.348 137.756 234.122 131.148 258.783C121.832 293.561 137.331 329.153 166.799 346.727L242.398 390.373C244.68 391.692 247.525 391.684 249.807 390.366L282.357 371.572L183.078 314.253C179.504 312.189 177.303 308.375 177.303 304.251V206.34ZM259.849 279.145V331.858L305.5 358.213L351.15 331.858V279.145L305.5 252.789L259.849 279.145ZM327.276 144.9C308.512 130.418 283.445 124.543 258.782 131.15C224.002 140.471 200.931 171.691 200.445 205.995V293.286C200.445 295.923 201.875 298.381 204.158 299.7L236.707 318.493V203.856C236.707 199.731 238.909 195.916 242.483 193.853L327.276 144.9ZM433.137 177.867C407.675 152.407 369.103 148.038 339.149 164.769L263.55 208.415C261.265 209.734 259.852 212.202 259.852 214.838V252.423L359.132 195.105C362.703 193.041 367.108 193.041 370.682 195.105L455.473 244.06C458.635 220.567 451.189 195.922 433.135 177.867H433.137Z" fill="currentColor"/> </svg>',
  cursor:
    '<svg aria-hidden="true" focusable="false" id="Ebene_1" xmlns="http://www.w3.org/2000/svg" version="1.1" viewBox="0 0 466.73 532.09"> <defs> <style> .st0 { fill: currentColor; } </style> </defs> <path class="st0" d="M457.43,125.94L244.42,2.96c-6.84-3.95-15.28-3.95-22.12,0L9.3,125.94c-5.75,3.32-9.3,9.46-9.3,16.11v247.99c0,6.65,3.55,12.79,9.3,16.11l213.01,122.98c6.84,3.95,15.28,3.95,22.12,0l213.01-122.98c5.75-3.32,9.3-9.46,9.3-16.11v-247.99c0-6.65-3.55-12.79-9.3-16.11h-.01ZM444.05,151.99l-205.63,356.16c-1.39,2.4-5.06,1.42-5.06-1.36v-233.21c0-4.66-2.49-8.97-6.53-11.31L24.87,145.67c-2.4-1.39-1.42-5.06,1.36-5.06h411.26c5.84,0,9.49,6.33,6.57,11.39h-.01Z"/> </svg>',
  copilot:
    '<svg aria-hidden="true" focusable="false" fill="currentColor" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid" viewBox="0 0 256 208"><path d="M205.3 31.4c14 14.8 20 35.2 22.5 63.6 6.6 0 12.8 1.5 17 7.2l7.8 10.6c2.2 3 3.4 6.6 3.4 10.4v28.7a12 12 0 0 1-4.8 9.5C215.9 187.2 172.3 208 128 208c-49 0-98.2-28.3-123.2-46.6a12 12 0 0 1-4.8-9.5v-28.7c0-3.8 1.2-7.4 3.4-10.5l7.8-10.5c4.2-5.7 10.4-7.2 17-7.2 2.5-28.4 8.4-48.8 22.5-63.6C77.3 3.2 112.6 0 127.6 0h.4c14.7 0 50.4 2.9 77.3 31.4ZM128 78.7c-3 0-6.5.2-10.3.6a27.1 27.1 0 0 1-6 12.1 45 45 0 0 1-32 13c-6.8 0-13.9-1.5-19.7-5.2-5.5 1.9-10.8 4.5-11.2 11-.5 12.2-.6 24.5-.6 36.8 0 6.1 0 12.3-.2 18.5 0 3.6 2.2 6.9 5.5 8.4C79.9 185.9 105 192 128 192s48-6 74.5-18.1a9.4 9.4 0 0 0 5.5-8.4c.3-18.4 0-37-.8-55.3-.4-6.6-5.7-9.1-11.2-11-5.8 3.7-13 5.1-19.7 5.1a45 45 0 0 1-32-12.9 27.1 27.1 0 0 1-6-12.1c-3.4-.4-6.9-.5-10.3-.6Zm-27 44c5.8 0 10.5 4.6 10.5 10.4v19.2a10.4 10.4 0 0 1-20.8 0V133c0-5.8 4.6-10.4 10.4-10.4Zm53.4 0c5.8 0 10.4 4.6 10.4 10.4v19.2a10.4 10.4 0 0 1-20.8 0V133c0-5.8 4.7-10.4 10.4-10.4Zm-73-94.4c-11.2 1.1-20.6 4.8-25.4 10-10.4 11.3-8.2 40.1-2.2 46.2A31.2 31.2 0 0 0 75 91.7c6.8 0 19.6-1.5 30.1-12.2 4.7-4.5 7.5-15.7 7.2-27-.3-9.1-2.9-16.7-6.7-19.9-4.2-3.6-13.6-5.2-24.2-4.3Zm69 4.3c-3.8 3.2-6.4 10.8-6.7 19.9-.3 11.3 2.5 22.5 7.2 27a41.7 41.7 0 0 0 30 12.2c8.9 0 17-2.9 21.3-7.2 6-6.1 8.2-34.9-2.2-46.3-4.8-5-14.2-8.8-25.4-9.9-10.6-1-20 .7-24.2 4.3ZM128 56c-2.6 0-5.6.2-9 .5.4 1.7.5 3.7.7 5.7 0 1.5 0 3-.2 4.5 3.2-.3 6-.3 8.5-.3 2.6 0 5.3 0 8.5.3-.2-1.6-.2-3-.2-4.5.2-2 .3-4 .7-5.7-3.4-.3-6.4-.5-9-.5Z"/></svg>',
  grok: '<svg aria-hidden="true" focusable="false" viewBox="0 0 1024 1024" fill="none" xmlns="http://www.w3.org/2000/svg"> <path d="M395.479 633.828L735.91 381.105C752.599 368.715 776.454 373.548 784.406 392.792C826.26 494.285 807.561 616.253 724.288 699.996C641.016 783.739 525.151 802.104 419.247 760.277L303.556 814.143C469.49 928.202 670.987 899.995 796.901 773.282C896.776 672.843 927.708 535.937 898.785 412.476L899.047 412.739C857.105 231.37 909.358 158.874 1016.4 10.6326C1018.93 7.11771 1021.47 3.60279 1024 0L883.144 141.651V141.212L395.392 633.916" fill="currentColor"/> <path d="M325.226 695.251C206.128 580.84 226.662 403.776 328.285 301.668C403.431 226.097 526.549 195.254 634.026 240.596L749.454 186.994C728.657 171.88 702.007 155.623 671.424 144.2C533.19 86.9942 367.693 115.465 255.323 228.382C147.234 337.081 113.244 504.215 171.613 646.833C215.216 753.423 143.739 828.818 71.7385 904.916C46.2237 931.893 20.6216 958.87 0 987.429L325.139 695.339" fill="currentColor"/> </svg>',
  vercel_ai_gateway:
    '<svg aria-hidden="true" focusable="false" viewBox="0 0 256 222" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid"><path fill="currentColor" d="m128 0 128 221.705H0z"/></svg>',
};
export function brandMark(providerId, size = 20) {
  const mark = marks[providerId];
  const cls = size === 24 ? "brand lg" : "brand";
  if (!mark) return `<span class="${cls}"></span>`;
  return mark.startsWith("<svg")
    ? `<span class="${cls}">${mark}</span>`
    : `<span class="${cls}"><img src="${mark}" alt="" /></span>`;
}

/* ---------- Status ---------- */

export const statusLook = {
  active: { tone: "good", icon: '<span class="dot" aria-hidden="true"></span>', words: "Active" },
  paused: { tone: "quiet", icon: icons.pause, words: "Paused" },
  disconnected: { tone: "bad", icon: icons.alert, words: "Disconnected" },
  failed: { tone: "neutral", icon: icons.retry, words: "Refresh Failed" },
  stale: { tone: "warn", icon: icons.clock, words: "Out of Date" },
};
/** The app's status pill: icon and words, never colour alone. */
export function statusPill(status) {
  const look = statusLook[status] ?? statusLook.active;
  return `<span class="pill ${look.tone}">${look.icon}${look.words}</span>`;
}
/** Healthy accounts show a dot and their age, like the app; anything else shows the pill. */
export function statusLine(account) {
  return account.status === "active"
    ? `<span class="status"><span class="dot" aria-hidden="true"></span><span class="sr">Active, refreshed </span>${ago(account.refreshed)}</span>`
    : statusPill(account.status);
}
export const isLive = (account) => account.status !== "paused" && account.status !== "disconnected";

/* ---------- Detail cells (the app's .cells / .cell / .bar markup) ---------- */

/** One bar. `used` null draws the hatch for a figure that is not known. */
export function bar(used, { thin = false, view = getLimitsView(), label = "" } = {}) {
  if (used === null || used === undefined)
    return `<div class="bar unknown${thin ? " thin" : ""}" aria-hidden="true"></div>`;
  const d = display(used, view);
  const t = view === "used" ? tone(used) : tone(used);
  return `<div class="bar ${t}${thin ? " thin" : ""}${d.fill <= 0 ? " zero" : ""} pre" style="--v:${Math.min(100, d.fill)}%" role="img" aria-label="${esc(label || `${pct(used)}% used`)}"><span class="fill"></span></div>`;
}

function meterCell(m, view) {
  const label = `<div class="label"><span>${esc(m.label)}</span>${m.window ? `<span class="window">${esc(m.window)}</span>` : ""}</div>`;
  if (m.used === null || m.used === undefined) {
    return `<div class="cell">${label}<div class="value unknown" aria-hidden="true">—</div>${bar(null)}<div class="caption">${m.notStarted ? "Not Started" : "Not reported"}</div></div>`;
  }
  const d = display(m.used, view);
  const t = tone(m.used);
  const word = toneWords[t] ? `<span class="tone ${t}">${toneWords[t]}</span> · ` : "";
  return `<div class="cell">${label}<div class="value">${d.text}<span class="unit">${d.unit}</span></div>${bar(m.used, { view, label: `${windowName(m)} ${pct(m.used)}% used` })}<div class="caption">${word}${resetText(m)}</div></div>`;
}

function balanceCell(b) {
  const label = `<div class="label"><span>${esc(b.label)}</span></div>`;
  const number =
    b.unit === "usd"
      ? `$${b.value}`
      : b.value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  const unit = b.unit === "credits" ? `<span class="unit">credits</span>` : "";
  if (b.of) {
    const used = ((b.of - b.value) / b.of) * 100;
    return `<div class="cell">${label}<div class="value">${number}${unit}</div>${bar(used, { thin: true, view: "left", label: `${b.label} ${b.value} left of ${b.of}` })}<div class="caption">${b.value} of ${b.of} left</div></div>`;
  }
  return `<div class="cell fact">${label}<div class="value">${number}${unit}</div></div>`;
}

function bankedCell(b) {
  const label = `<div class="label"><span>${esc(b.label)}s</span></div>`;
  const first = b.expiries[0];
  return `<div class="cell fact">${label}<div class="value">${b.count}<span class="of">${b.count === 1 ? "full reset" : "full resets"}</span></div><div class="caption">${first === undefined ? "No expiry reported" : `First expires in ${countdown(first)}`}</div></div>`;
}

/** Full detail for one account: every figure as a cell, then a facts line. */
export function accountDetail(account, view = getLimitsView()) {
  const cells = [
    ...account.meters.map((m) => meterCell(m, view)),
    ...(account.balances ?? []).map(balanceCell),
    ...(account.banked ? [bankedCell(account.banked)] : []),
  ];
  const note = !isLive(account)
    ? `<span class="kv">${account.status === "paused" ? "Paused" : "Disconnected"} <b>Numbers from ${ago(account.refreshed)}</b></span>`
    : `<span class="kv">Refreshed <b>${ago(account.refreshed)}</b></span>`;
  return `<div class="cells${isLive(account) ? "" : " dim"}">${cells.join("")}</div><div class="facts">${note}<a class="btn sm g-open" href="../f-panels.html">Open in Detailed</a></div>`;
}

/** Let bars grow from zero once, as in the app. Call after inserting markup. */
export function growBars(root = document) {
  requestAnimationFrame(() =>
    requestAnimationFrame(() =>
      root.querySelectorAll(".bar.pre").forEach((el) => el.classList.remove("pre")),
    ),
  );
}

/* ---------- Top bar ---------- */

const views = [
  { id: "overview", label: "Overview", href: "g-glance.html" },
  { id: "compare", label: "Compare", href: "g-compare.html" },
  { id: "timeline", label: "Timeline", href: "g-timeline.html" },
  { id: "wallet", label: "Wallet", href: "g-wallet.html" },
  { id: "detailed", label: "Detailed", href: "../f-panels.html" },
];

const lockupMark = `<svg viewBox="0 0 64 64" aria-hidden="true" focusable="false"><path d="M22.93 0H41.07C47.673 0 50.974 0 54.528 1.124C58.408 2.536 61.464 5.592 62.876 9.472C64 13.026 64 16.327 64 22.93V41.07C64 47.673 64 50.974 62.876 54.528C61.464 58.408 58.408 61.464 54.528 62.876C50.974 64 47.673 64 41.07 64H22.93C16.327 64 13.026 64 9.472 62.876C5.592 61.464 2.536 58.408 1.124 54.528C0 50.974 0 47.673 0 41.07V22.93C0 16.327 0 13.026 1.124 9.472C2.536 5.592 5.592 2.536 9.472 1.124C13.026 0 16.327 0 22.93 0Z" style="fill:var(--logo-tile)"/><rect x="12" y="16" width="40" height="4" rx="2" style="fill:var(--logo-ceiling)"/><rect x="12" y="28" width="28" height="8" rx="4" style="fill:var(--logo-ink)"/><rect x="12" y="40" width="16" height="8" rx="4" style="fill:var(--logo-ink)"/></svg>`;

/** Attention count for the bell: disconnected, failed, stale, or almost out. */
export function attention() {
  return accounts.filter((a) => {
    const t = tightest(a);
    return (
      ["disconnected", "failed", "stale"].includes(a.status) ||
      (a.status !== "paused" && t && tone(t.used) === "bad")
    );
  });
}

/** Render the top bar into <header class="top">. `active` is one of overview, compare, timeline, wallet, detailed. */
export function renderShell({ active }) {
  // Identity lines are blurred like the app's Hide Details; hovering reveals them.
  document.documentElement.dataset.privacy = "";
  const host = document.querySelector("header.top");
  const n = attention().length;
  host.classList.add("g-top");
  host.innerHTML = `
    <a class="lockup" href="g-glance.html">${lockupMark}Headroom</a>
    <div class="seg g-switch" role="navigation" aria-label="View">
      ${views.map((v) => `<a href="${v.href}"${v.id === active ? ' aria-current="page"' : ""}>${v.label}</a>`).join("")}
    </div>
    <nav aria-label="Account">
      <span class="menu-anchor"><button class="bell" type="button" aria-label="Notifications, ${n} unread">${icons.bell}<span class="badge num${n === 0 ? " zero" : ""}" aria-hidden="true">${n === 0 ? "" : n}</span></button></span>
      <span class="menu-anchor"><button class="avatar" type="button" aria-label="Account Menu"><img src="avatar.svg" alt="" width="34" height="34" /></button></span>
    </nav>`;
}
