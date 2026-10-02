// Mockup E behaviour. Everything here is a demonstration of motion and state; nothing calls a server.
const reduce =
  matchMedia("(prefers-reduced-motion: reduce)").matches ||
  new URLSearchParams(location.search).get("motion") === "off";
const ease = (t) => 1 - Math.pow(1 - t, 4);
const wait = (ms) => new Promise((r) => setTimeout(r, reduce ? 0 : ms));
const ICON = {
  spin: '<span class="spin" aria-hidden="true"></span>',
  check:
    '<svg class="check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 5 5 9-10"/></svg>',
};

// Swap the text of an element: old copy leaves upward, new copy rises in. Width follows the new text.
function swap(el, html) {
  if (reduce) {
    el.innerHTML = html;
    return;
  }
  const old = el.innerHTML;
  el.classList.add("swap");
  el.innerHTML = `<span class="swap-out">${old}</span><span class="swap-in">${html}</span>`;
  setTimeout(() => {
    el.classList.remove("swap");
    el.innerHTML = html;
  }, 260);
}

// Count numbers up once on first paint, 70 ms apart, 250 ms cap.
function count(el, i, from = 0) {
  const target = Number(String(el.dataset.count).replace(/,/g, ""));
  const decimals = Number(el.dataset.decimals || 0);
  const fmt = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  const prefix = el.dataset.prefix || "";
  if (reduce) {
    el.textContent = prefix + fmt.format(target);
    return;
  }
  const delay = Math.min(i * 70, 250),
    dur = 580;
  let start;
  const step = (now) => {
    if (start === undefined) start = now + delay;
    const t = Math.min(Math.max((now - start) / dur, 0), 1);
    el.textContent = prefix + fmt.format(from + (target - from) * ease(t));
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// Set a meter to a new value: bar refills on its transition, number counts, tone follows thresholds.
function setMeter(cell, value) {
  const bar = cell.querySelector(".bar"),
    num = cell.querySelector("[data-count]");
  bar.style.setProperty("--v", value + "%");
  bar.setAttribute("aria-valuenow", String(value));
  bar.classList.toggle("warn", value >= 70 && value < 90);
  bar.classList.toggle("bad", value >= 90);
  const from = Number(num.dataset.count);
  num.dataset.count = String(value);
  count(num, 0, from);
}

// Refresh: the button confirms in place, then the header age swaps to "just now".
async function refresh(btn) {
  const panel = btn.closest(".panel"),
    label = btn.querySelector(".label");
  btn.setAttribute("aria-busy", "true");
  btn.disabled = true;
  swap(label, `${ICON.spin} Refreshing`);
  await wait(1400);
  swap(label, `${ICON.check} Refreshed`);
  const age = panel.querySelector(".status .age");
  if (age) swap(age, "just now");
  const last = panel.querySelector(".foot .last");
  if (last) swap(last, "Last refreshed <b>just now</b> · succeeded");
  await wait(1800);
  swap(label, "Refresh");
  btn.removeAttribute("aria-busy");
  btn.disabled = false;
}

// Pause and resume: the panel dims and the header status becomes a pill and back.
function togglePause(btn) {
  const panel = btn.closest(".panel"),
    paused = !panel.classList.contains("paused");
  const status = panel.querySelector(".status-slot"),
    label = btn.querySelector(".label");
  panel.classList.toggle("paused", paused);
  if (paused) {
    status.dataset.prev = status.innerHTML;
    swap(status, `<span class="pill quiet">${PAUSE_ICON}Paused · just now</span>`);
    swap(label, "Resume");
  } else {
    swap(status, status.dataset.prev);
    swap(label, "Pause");
  }
}

// Disconnect: the button becomes an inline question; confirm shows progress, then the panel leaves.
function disconnect(btn) {
  const acts = btn.parentElement,
    panel = btn.closest(".panel"),
    name = panel.querySelector("h3").firstChild.textContent.trim();
  const ask = document.createElement("span");
  ask.className = "confirm";
  ask.setAttribute("role", "group");
  ask.setAttribute("aria-label", "Confirm disconnect");
  ask.innerHTML = `<span class="q">Disconnect ${name}? Saved credentials are deleted.</span><button class="btn sm" type="button" data-cancel>Cancel</button><button class="btn sm primary" type="button" data-confirm>Disconnect</button>`;
  btn.hidden = true;
  acts.append(ask);
  ask.querySelector("[data-cancel]").focus();
  const close = () => {
    ask.remove();
    btn.hidden = false;
    btn.focus();
    clearTimeout(timer);
  };
  const timer = setTimeout(close, 6000);
  ask.querySelector("[data-cancel]").addEventListener("click", close);
  ask.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });
  ask.querySelector("[data-confirm]").addEventListener(
    "click",
    () =>
      void (async () => {
        clearTimeout(timer);
        ask.innerHTML = `<span class="q" role="status">${ICON.spin} Disconnecting</span>`;
        await wait(1200);
        ask.innerHTML = `<span class="q" role="status">${ICON.check} Disconnected</span>`;
        await wait(700);
        const wrap = panel.closest(".collapse");
        panel.classList.add("leaving");
        await wait(160);
        wrap.classList.add("closed");
        const section = panel.closest(".provider");
        const left = section.querySelectorAll(".collapse:not(.closed)").length;
        const countEl = section.querySelector(".count");
        if (countEl) swap(countEl, left > 1 ? `${left} accounts` : "");
        if (left === 0) {
          await wait(240);
          section.closest(".collapse")?.classList.add("closed");
        }
        await wait(300);
        wrap.remove();
        if (left === 0) section.closest(".collapse")?.remove();
      })(),
  );
}

// Hold to confirm: pointer or keyboard hold fills for 1.2 s; releasing early rewinds; completing renews the window.
function hold(btn) {
  let timer = null,
    done = false;
  const start = () => {
    if (done || btn.disabled) return;
    btn.classList.remove("rewind");
    btn.classList.add("holding");
    timer = setTimeout(complete, reduce ? 0 : 1200);
  };
  const cancel = () => {
    if (done) return;
    clearTimeout(timer);
    btn.classList.add("rewind");
    btn.classList.remove("holding");
  };
  const complete = async () => {
    done = true;
    btn.classList.add("done");
    btn.disabled = true;
    const face = btn.querySelector(".face .label");
    swap(face, `${ICON.spin} Requesting reset`);
    await wait(1200);
    swap(face, `${ICON.check} Weekly window renewed`);
    const panel = btn.closest(".panel");
    const weekly = panel.querySelector('[data-key="weekly"]');
    if (weekly) {
      setMeter(weekly, 2);
      const cap = weekly.querySelector(".caption");
      swap(cap, "resets in <b>7d 0h</b>");
    }
    const resets = panel.querySelector('[data-key="resets"] [data-count]');
    if (resets) {
      resets.dataset.count = "2";
      count(resets, 0, 3);
    }
    const pips = panel.querySelector('[data-key="resets"] .pips');
    if (pips) pips.lastElementChild.classList.add("spent");
  };
  btn.addEventListener("pointerdown", (e) => {
    if (e.button === 0) start();
  });
  for (const ev of ["pointerup", "pointerleave", "pointercancel"]) btn.addEventListener(ev, cancel);
  btn.addEventListener("keydown", (e) => {
    if ((e.key === " " || e.key === "Enter") && !e.repeat) {
      e.preventDefault();
      start();
    }
  });
  btn.addEventListener("keyup", (e) => {
    if (e.key === " " || e.key === "Enter") cancel();
  });
  btn.addEventListener("blur", cancel);
  btn.addEventListener("contextmenu", (e) => e.preventDefault());
}

// Account menu
function menu(trigger) {
  const panel = document.getElementById(trigger.getAttribute("aria-controls"));
  const set = (open) => {
    trigger.setAttribute("aria-expanded", String(open));
    panel.classList.toggle("open", open);
    if (open) panel.querySelector("button, a")?.focus();
  };
  trigger.addEventListener("click", () => set(trigger.getAttribute("aria-expanded") !== "true"));
  document.addEventListener("click", (e) => {
    if (!panel.contains(e.target) && e.target !== trigger) set(false);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && panel.classList.contains("open")) {
      set(false);
      trigger.focus();
    }
  });
  for (const b of panel.querySelectorAll(".seg button"))
    b.addEventListener("click", () => {
      for (const o of b.parentElement.children) o.setAttribute("aria-pressed", String(o === b));
      document.documentElement.style.colorScheme =
        b.dataset.scheme === "system" ? "" : b.dataset.scheme;
    });
}

const PAUSE_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>';

requestAnimationFrame(() => {
  document.documentElement.classList.remove("pre");
  document.querySelectorAll("[data-count]").forEach((el, i) => count(el, i));
});
for (const b of document.querySelectorAll("[data-act='refresh']"))
  b.addEventListener("click", () => void refresh(b));
for (const b of document.querySelectorAll("[data-act='pause']"))
  b.addEventListener("click", () => togglePause(b));
for (const b of document.querySelectorAll("[data-act='disconnect']"))
  b.addEventListener("click", () => disconnect(b));
for (const b of document.querySelectorAll(".hold")) hold(b);
for (const t of document.querySelectorAll(".avatar[aria-controls]")) menu(t);
