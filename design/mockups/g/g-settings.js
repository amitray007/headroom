// Shared Settings mock for the Headroom view mockups: the avatar menu and the app-style Settings dialog
// (.dlg.settings) with an "Overview" section. Pages read the choices with getOverviewPrefs() and
// listen for the "headroom:settings" event on window. Mounted by renderShell() in g-shell.js.
import { accounts, providers } from "./data.js";

/* ---------- Overview preferences (remembered on this device) ---------- */

const KEY = "headroom.overview";
export const ORDERS = [
  { id: "urgency", label: "By Urgency" },
  { id: "provider", label: "By Provider" },
  { id: "custom", label: "Custom" },
];

/** Order, provider order, and whether inactive (paused and disconnected) accounts sit last. */
export function getOverviewPrefs() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(KEY) || "{}") ?? {};
  } catch {
    /* private mode or bad JSON: use the defaults */
  }
  const ids = providers.map((p) => p.id);
  const known = Array.isArray(saved.providerOrder)
    ? saved.providerOrder.filter((id) => ids.includes(id))
    : [];
  return {
    order: ORDERS.some((o) => o.id === saved.order) ? saved.order : "urgency",
    providerOrder: [...new Set([...known, ...ids])],
    dormantLast: saved.dormantLast !== false,
  };
}

export function setOverviewPrefs(patch) {
  const next = { ...getOverviewPrefs(), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* keep going: the change still applies for this page */
  }
  window.dispatchEvent(
    new CustomEvent("headroom:settings", { detail: { keys: Object.keys(patch) } }),
  );
}

/** The owner's own order from the Connect page's accounts table. The mock uses the data.js order. */
export const customOrder = () => accounts.map((a) => a.id);

/* ---------- Icons ---------- */

const svg = (inner, w = 2) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${inner}</svg>`;
const gear = svg(
  '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
);
const signOut = svg('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>');
const close = svg('<path d="M18 6 6 18M6 6l12 12"/>');
const grip = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/></svg>`;
export const settingsIcons = { gear };

const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const esc = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );

/* ---------- Provider order list: pointer drag and keyboard, spring motion ---------- */

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const press = (seg, value) =>
  seg
    .querySelectorAll("[data-value]")
    .forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.value === value)));

function providerList(ul, brandMark, live) {
  function render() {
    const order = getOverviewPrefs().providerOrder;
    ul.innerHTML = order
      .map((id) => {
        const p = providers.find((x) => x.id === id);
        return `<li class="g-pitem" data-id="${id}">
          <button class="g-grip" type="button" aria-describedby="g-porder-hint"></button>
          ${brandMark(id)}<span class="g-pname">${esc(p.name)}</span>
        </li>`;
      })
      .join("");
    ul.querySelectorAll(".g-grip").forEach((b) => (b.innerHTML = grip));
    labels();
  }
  function labels() {
    const items = [...ul.children];
    items.forEach((li, i) => {
      const name = providers.find((p) => p.id === li.dataset.id).name;
      li.querySelector(".g-grip").setAttribute(
        "aria-label",
        `Reorder ${name}, position ${i + 1} of ${items.length}`,
      );
    });
  }
  const save = () =>
    setOverviewPrefs({ providerOrder: [...ul.children].map((li) => li.dataset.id) });

  /* Pointer: the lifted row follows the pointer, the others slide aside, the row settles into its slot. */
  ul.addEventListener("pointerdown", (e) => {
    const grabbed = e.target.closest(".g-grip");
    if (!grabbed || (e.pointerType === "mouse" && e.button !== 0)) return;
    e.preventDefault();
    const li = grabbed.closest("li");
    const items = [...ul.children];
    const from = items.indexOf(li);
    const step = items.length > 1 ? items[1].offsetTop - items[0].offsetTop : li.offsetHeight;
    const startY = e.clientY;
    let to = from;
    grabbed.setPointerCapture(e.pointerId);
    grabbed.focus({ preventScroll: true });
    ul.classList.add("sorting");
    li.classList.add("lift");
    document.documentElement.classList.add("is-reordering");

    const move = (ev) => {
      const dy = clamp(ev.clientY - startY, -from * step, (items.length - 1 - from) * step);
      li.style.translate = `0 ${dy}px`;
      to = clamp(Math.round(from + dy / step), 0, items.length - 1);
      items.forEach((el, i) => {
        if (el === li) return;
        const shift =
          from < to && i > from && i <= to ? -step : from > to && i >= to && i < from ? step : 0;
        el.style.translate = shift ? `0 ${shift}px` : "";
      });
    };
    const finish = (commit) => {
      grabbed.removeEventListener("pointermove", move);
      grabbed.removeEventListener("pointerup", up);
      grabbed.removeEventListener("pointercancel", cancel);
      document.documentElement.classList.remove("is-reordering");
      const target = commit ? to : from;
      const done = () => {
        ul.classList.add("still");
        items.forEach((el) => (el.style.translate = ""));
        li.classList.remove("lift", "settle");
        ul.classList.remove("sorting");
        if (commit && to !== from) {
          ul.insertBefore(li, to > from ? items[to].nextSibling : items[to]);
          labels();
          save();
          live(
            `${li.querySelector(".g-pname").textContent} moved to position ${to + 1} of ${items.length}`,
          );
        }
        void ul.offsetWidth; // apply the final layout before transitions come back
        ul.classList.remove("still");
      };
      if (reduced()) return done();
      li.classList.add("settle");
      li.style.translate = `0 ${(target - from) * step}px`;
      let ended = false;
      const once = () => {
        if (ended) return;
        ended = true;
        done();
      };
      li.addEventListener("transitionend", (t) => t.propertyName === "translate" && once(), {
        once: true,
      });
      setTimeout(once, 420);
    };
    const up = () => finish(true);
    const cancel = () => finish(false);
    grabbed.addEventListener("pointermove", move);
    grabbed.addEventListener("pointerup", up);
    grabbed.addEventListener("pointercancel", cancel);
  });

  /* Keyboard: Up and Down move the focused row one place. */
  ul.addEventListener("keydown", (e) => {
    const grabbed = e.target.closest(".g-grip");
    if (!grabbed || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
    e.preventDefault();
    const li = grabbed.closest("li");
    const items = [...ul.children];
    const i = items.indexOf(li);
    const j = i + (e.key === "ArrowUp" ? -1 : 1);
    if (j < 0 || j >= items.length) return;
    const before = new Map(items.map((el) => [el, el.offsetTop]));
    ul.insertBefore(li, e.key === "ArrowUp" ? items[j] : items[j].nextSibling);
    if (!reduced()) {
      const ease = getComputedStyle(ul).getPropertyValue("--ease-spring").trim() || "ease-out";
      for (const el of ul.children) {
        const delta = before.get(el) - el.offsetTop;
        if (delta)
          el.animate([{ translate: `0 ${delta}px` }, { translate: "0 0" }], {
            duration: 320,
            easing: ease,
          });
      }
    }
    grabbed.focus({ preventScroll: true });
    labels();
    save();
    live(
      `${li.querySelector(".g-pname").textContent} moved to position ${j + 1} of ${items.length}`,
    );
  });

  render();
  return render;
}

/* ---------- The dialog ---------- */

let dialog = null;

function buildDialog({ brandMark, getLimitsView, setLimitsView }) {
  const el = document.createElement("dialog");
  el.className = "dlg settings";
  el.id = "g-settings";
  el.setAttribute("aria-labelledby", "g-set-title");
  const p = getOverviewPrefs();
  el.innerHTML = `
    <div class="dhead">
      <h2 id="g-set-title">Settings</h2>
      <button class="btn quiet sm" type="button" data-close aria-label="Close">${close}</button>
    </div>
    <div class="dbody">
      <section class="dsec" id="g-set-limits">
        <div class="dsec-head"><h3>Limits</h3></div>
        <div class="srow">
          <span class="sbody"><b>Show Limits As</b><span class="muted">Show what you have used, or what is left.</span></span>
          <span class="seg" role="group" aria-label="Show limits as" data-setting="limits">
            <button type="button" data-value="left" aria-pressed="${getLimitsView() !== "used"}">Left</button>
            <button type="button" data-value="used" aria-pressed="${getLimitsView() === "used"}">Used</button>
          </span>
        </div>
      </section>
      <section class="dsec" id="g-set-overview" aria-labelledby="g-set-overview-h">
        <div class="dsec-head"><h3 id="g-set-overview-h">Overview</h3></div>
        <div class="srow stack-sm">
          <span class="sbody"><b>Default Order</b><span class="muted">Custom uses your order from Connect.</span></span>
          <span class="seg" role="group" aria-label="Default order" data-setting="order">
            ${ORDERS.map((o) => `<button type="button" data-value="${o.id}" aria-pressed="${p.order === o.id}">${o.label}</button>`).join("")}
          </span>
        </div>
        <div class="srow g-porder-row">
          <span class="sbody"><b>Provider Order</b><span class="muted" id="g-porder-hint">Drag to set the By Provider order.</span></span>
          <ul class="g-plist" aria-label="Provider order"></ul>
        </div>
        <label class="srow switchrow">
          <span class="sbody"><b>Keep Inactive Last</b><span class="muted">Paused and disconnected stay at the bottom.</span></span>
          <span class="switch"><input type="checkbox" role="switch" data-setting="dormantLast" ${p.dormantLast ? "checked" : ""} /><span class="track"><span class="thumb"></span></span></span>
        </label>
      </section>
    </div>
    <p class="sr" id="g-live" aria-live="polite"></p>`;
  document.body.append(el);

  el.querySelector("[data-close]").addEventListener("click", () => el.close());
  el.addEventListener("click", (e) => {
    if (e.target === el) el.close();
  });

  const live = (text) => (el.querySelector("#g-live").textContent = text);
  const renderList = providerList(el.querySelector(".g-plist"), brandMark, live);

  el.querySelector('[data-setting="order"]').addEventListener("click", (e) => {
    const b = e.target.closest("[data-value]");
    if (b) setOverviewPrefs({ order: b.dataset.value });
  });
  el.querySelector('[data-setting="limits"]').addEventListener("click", (e) => {
    const b = e.target.closest("[data-value]");
    if (!b) return;
    setLimitsView(b.dataset.value);
    press(e.currentTarget, b.dataset.value);
    window.dispatchEvent(new CustomEvent("headroom:settings", { detail: { keys: ["limits"] } }));
  });
  el.querySelector('[data-setting="dormantLast"]').addEventListener("change", (e) =>
    setOverviewPrefs({ dormantLast: e.target.checked }),
  );

  /* Keep the dialog in step when the page changes the same setting. */
  window.addEventListener("headroom:settings", () => {
    const now = getOverviewPrefs();
    press(el.querySelector('[data-setting="order"]'), now.order);
    press(el.querySelector('[data-setting="limits"]'), getLimitsView());
    el.querySelector('[data-setting="dormantLast"]').checked = now.dormantLast;
  });
  el.renderList = renderList;
  return el;
}

export function openSettings(section) {
  if (!dialog) return;
  dialog.renderList();
  dialog.showModal();
  if (section) dialog.querySelector(`#g-set-${section}`)?.scrollIntoView({ block: "start" });
}

/* ---------- Avatar menu ---------- */

function mountMenu() {
  const btn = document.querySelector("header.top .avatar");
  if (!btn || document.getElementById("g-account-menu")) return;
  const menu = document.createElement("div");
  menu.className = "menu menu-account g-menu";
  menu.id = "g-account-menu";
  menu.setAttribute("role", "menu");
  menu.setAttribute("popover", "");
  menu.innerHTML = `
    <div class="menu-who"><span class="menu-who-face"><img src="avatar.svg" alt="" width="32" height="32" /></span><span class="menu-who-line">Signed in as <b>alex</b></span></div>
    <button class="item" role="menuitem" type="button" data-open-settings style="--i:0">${gear}Settings</button>
    <hr class="menu-sep" />
    <button class="item danger" role="menuitem" type="button" style="--i:1">${signOut}Sign Out</button>`;
  btn.parentElement.append(menu);
  btn.setAttribute("aria-haspopup", "menu");
  btn.setAttribute("aria-expanded", "false");
  btn.setAttribute("aria-controls", "g-account-menu");

  const place = () => {
    const r = btn.getBoundingClientRect();
    menu.style.top = `${r.bottom + 8}px`;
    menu.style.left = `${Math.max(8, Math.min(r.right - menu.offsetWidth, innerWidth - menu.offsetWidth - 8))}px`;
  };
  btn.addEventListener("click", () => {
    if (menu.matches(":popover-open")) return menu.hidePopover();
    menu.showPopover();
    place();
    menu.querySelector(".item")?.focus();
  });
  menu.addEventListener("toggle", (e) =>
    btn.setAttribute("aria-expanded", String(e.newState === "open")),
  );
  menu.addEventListener("click", (e) => {
    if (e.target.closest(".item")) menu.hidePopover();
  });
  menu.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const items = [...menu.querySelectorAll(".item")];
    const i = items.indexOf(document.activeElement);
    items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length].focus();
  });
}

/** Build the avatar menu and the Settings dialog. Safe to call again after the top bar re-renders. */
export function mountSettings(deps) {
  if (!dialog || !dialog.isConnected) {
    dialog = buildDialog(deps);
    document.addEventListener("click", (e) => {
      const opener = e.target.closest("[data-open-settings]");
      if (opener) openSettings(opener.dataset.openSettings || undefined);
    });
  }
  mountMenu();
}
