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
  const num = cell.querySelector("[data-count]");
  const from = Number(num.dataset.count);
  cell.dataset.used = String(value);
  applyMeter(cell, from);
}

// Refresh: the label fades between Refresh, Refreshing (with a spinner) and Refreshed; the header age updates.
function setLabel(label, html) {
  if (reduce) {
    label.innerHTML = html;
    return;
  }
  label.classList.add("fading");
  setTimeout(() => {
    label.innerHTML = html;
    label.classList.remove("fading");
  }, 120);
}
async function refresh(btn) {
  const panel = btn.closest(".panel"),
    label = btn.querySelector(".label");
  btn.setAttribute("aria-busy", "true");
  btn.disabled = true;
  setLabel(label, `${ICON.spin}Refreshing`);
  await wait(1400);
  setLabel(label, "Refreshed");
  const age = panel.querySelector(".status .age");
  if (age) swap(age, "Just now");
  await wait(1600);
  setLabel(label, `${RETRY_ICON}Refresh`);
  btn.removeAttribute("aria-busy");
  btn.disabled = false;
}

// Pause and resume: the panel dims, the header status fades to a paused pill, the button label fades.
function togglePause(btn) {
  const panel = btn.closest(".panel"),
    paused = !panel.classList.contains("paused");
  const status = panel.querySelector(".status-slot"),
    label = btn.querySelector(".label");
  if (btn.dataset.busy) return;
  btn.dataset.busy = "1";
  panel.classList.toggle("paused", paused);
  if (!status.dataset.prev) status.dataset.prev = status.innerHTML;
  status.classList.add("fading");
  setTimeout(() => {
    status.innerHTML = paused
      ? `<span class="pill quiet">${PAUSE_ICON}Paused</span>`
      : status.dataset.prev;
    status.classList.remove("fading");
    delete btn.dataset.busy;
  }, 140);
  setLabel(label, paused ? `${PLAY_ICON}Resume` : `${PAUSE_ICON}Pause`);
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
  ask.innerHTML = `<span class="q">Disconnect ${name}? Its saved sign-in is deleted.</span><button class="btn sm" type="button" data-cancel>Cancel</button><button class="btn sm primary" type="button" data-confirm>Disconnect</button>`;
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
    if (done || btn.disabled || btn.classList.contains("off")) return;
    btn.classList.remove("failed");
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
    swap(face, `${ICON.spin} Resetting`);
    await wait(1200);
    if (btn.dataset.outcome === "failed") {
      btn.classList.remove("done", "holding");
      btn.classList.add("failed");
      btn.disabled = false;
      done = false;
      swap(face, "Reset Failed · Hold to Try Again");
      return;
    }
    btn.classList.add("good");
    swap(face, `${ICON.check} Weekly Limit Reset`);
    const panel = btn.closest(".panel");
    const weekly = panel.querySelector('[data-key="weekly"]');
    if (weekly) {
      setMeter(weekly, 2);
      const cap = weekly.querySelector(".caption");
      swap(cap, "Resets in <b>7 d</b>");
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
    if (!panel.contains(e.target) && !trigger.contains(e.target)) set(false);
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

const PLAY_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 5v14l12-7z"/></svg>';
const RETRY_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/></svg>';
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

// Notification center: open and close like the account menu; rows mark read on click; counts follow.
for (const bell of document.querySelectorAll(".bell[aria-controls]")) {
  const panel = document.getElementById(bell.getAttribute("aria-controls"));
  const badge = bell.querySelector(".badge");
  const sub = panel.querySelector(".nsub");
  const foot = panel.querySelector(".nfoot .muted");
  const recount = () => {
    const unread = panel.querySelectorAll(".nrow.unread").length;
    const read = panel.querySelectorAll(".nrow:not(.unread)").length;
    badge.textContent = String(unread);
    badge.classList.toggle("zero", unread === 0);
    bell.setAttribute("aria-label", `Notifications, ${unread} unread`);
    swap(
      sub,
      unread === 0
        ? "You are all caught up"
        : `${unread} update${unread === 1 ? "" : "s"} waiting for you`,
    );
    foot.textContent = read === 1 ? "1 read" : `${read} read`;
  };
  const set = (open) => {
    bell.setAttribute("aria-expanded", String(open));
    panel.classList.toggle("open", open);
  };
  bell.addEventListener("click", () => set(bell.getAttribute("aria-expanded") !== "true"));
  document.addEventListener("click", (e) => {
    if (!panel.contains(e.target) && !bell.contains(e.target)) set(false);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && panel.classList.contains("open")) {
      set(false);
      bell.focus();
    }
  });
  for (const row of panel.querySelectorAll(".nrow"))
    row.addEventListener("click", () => {
      row.classList.remove("unread");
      recount();
    });
  panel.querySelector("[data-markall]")?.addEventListener("click", () => {
    for (const r of panel.querySelectorAll(".nrow.unread")) r.classList.remove("unread");
    recount();
  });
  panel.querySelector("[data-clearread]")?.addEventListener("click", () => {
    const rows = [...panel.querySelectorAll(".nrow:not(.unread)")];
    rows.forEach((r, i) => {
      r.style.animationDelay = `${Math.min(i * 35, 200)}ms`;
      r.classList.add("leaving");
    });
    setTimeout(() => {
      rows.forEach((r) => r.remove());
      recount();
    }, 400);
  });
}

// Connect flow (mockup): pick a provider, run its sign-in stage, check, then succeed or fail.
(() => {
  const flow = document.getElementById("flow");
  if (!flow) return;
  const cards = document.getElementById("cards");
  const stages = [...flow.querySelectorAll(".stage")];
  const steps = [...flow.querySelectorAll(".stepper li")];
  const slot = (n) => flow.querySelector(`[data-slot='${n}']`);
  let picked = null,
    timer = null;
  const REASONS = {
    expired: "The approval expired before it was confirmed. Nothing was saved.",
    rejected:
      "The provider rejected the sign-in. Nothing was saved. Check that you approved the right account and try again.",
    duplicate:
      "This account is already connected. Open your accounts to see it, or sign in with a different account.",
  };
  const show = (name) => {
    for (const s of stages) s.hidden = s.dataset.stage !== name;
  };
  const mark = (n, state) =>
    steps.forEach((li, i) => {
      li.classList.remove("current", "done", "failed");
      if (i + 1 < n) li.classList.add("done");
      if (i + 1 === n) li.classList.add(state || "current");
    });
  const status = (html) => swap(slot("status"), html);
  const pick = (card) => {
    picked = card;
    clearTimeout(timer);
    for (const c of cards.querySelectorAll(".card"))
      c.setAttribute("aria-pressed", String(c === card));
    cards.classList.add("picked");
    slot("mark").innerHTML = document.querySelector(
      `template[data-mark='${card.dataset.pick}']`,
    ).innerHTML;
    slot("name").textContent = card.dataset.name;
    flow.hidden = false;
    mark(2);
    status('<span class="spin" aria-hidden="true"></span>Waiting for You · 9:42 left');
    show(card.dataset.flow);
    flow.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  };
  const checking = () => {
    mark(3);
    status('<span class="spin" aria-hidden="true"></span>Checking');
    show("checking");
  };
  const success = () => {
    mark(4, "done");
    status("Connected");
    slot("account").textContent = `Personal · ${picked?.dataset.name ?? ""}`;
    show("success");
  };
  const failure = (why) => {
    mark(3, "failed");
    status("Did Not Finish");
    slot("reason").textContent = REASONS[why] ?? REASONS.expired;
    show("failure");
  };
  const reset = () => {
    flow.hidden = true;
    cards.classList.remove("picked");
    for (const c of cards.querySelectorAll(".card")) c.setAttribute("aria-pressed", "false");
    picked = null;
    cards.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  };
  for (const card of cards.querySelectorAll(".card"))
    card.addEventListener("click", () => pick(card));
  for (const b of flow.querySelectorAll("[data-go='checking']"))
    b.addEventListener("click", (e) => {
      e.preventDefault();
      checking();
      timer = setTimeout(success, 1800);
    });
  for (const b of flow.querySelectorAll("[data-cancel], [data-reset]"))
    b.addEventListener("click", reset);
  for (const b of flow.querySelectorAll("[data-retry]"))
    b.addEventListener("click", () => {
      if (picked) pick(picked);
    });
  for (const b of flow.querySelectorAll("[data-sim]"))
    b.addEventListener("click", () => {
      clearTimeout(timer);
      if (b.dataset.sim === "success") {
        checking();
        timer = setTimeout(success, 1200);
      } else failure(b.dataset.sim);
    });
  for (const b of flow.querySelectorAll("[data-copy]"))
    b.addEventListener("click", () => {
      const old = b.innerHTML;
      b.innerHTML = ICON.check;
      setTimeout(() => {
        b.innerHTML = old;
      }, 1200);
    });
})();

// Privacy blur: remembered for this browser (mockup). The app would store it per owner.
(() => {
  const box = document.getElementById("privacy");
  if (!box) return;
  const apply = (on) => {
    document.documentElement.toggleAttribute("data-privacy", on);
    box.checked = on;
  };
  apply(localStorage.getItem("headroom.privacy") !== "0");
  box.addEventListener("change", () => {
    apply(box.checked);
    localStorage.setItem("headroom.privacy", box.checked ? "1" : "0");
  });
})();

// Inline rename: the name becomes a field; Enter saves, Escape cancels, blur saves. Confirms in place.
for (const btn of document.querySelectorAll(".rename")) {
  btn.addEventListener("click", () => {
    const h3 = btn.closest("h3"),
      name = h3.querySelector(".name");
    if (h3.querySelector(".name-edit")) return;
    const input = document.createElement("input");
    input.className = "name-edit";
    input.value = name.textContent.trim();
    input.setAttribute("aria-label", "Account name");
    input.maxLength = 40;
    input.style.width = Math.max(6, input.value.length + 2) + "ch";
    name.replaceWith(input);
    btn.hidden = true;
    input.focus();
    input.select();
    input.addEventListener("input", () => {
      input.style.width = Math.max(6, input.value.length + 2) + "ch";
    });
    let finished = false;
    const finish = (save) => {
      if (finished) return;
      finished = true;
      const next = save && input.value.trim() ? input.value.trim() : name.textContent.trim();
      name.textContent = next;
      input.replaceWith(name);
      btn.hidden = false;
      if (save && next !== input.defaultValue) {
        const ok = document.createElement("span");
        ok.className = "saved";
        ok.innerHTML = `${ICON.check} Saved`;
        h3.append(ok);
        setTimeout(() => ok.remove(), 1600);
      }
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") finish(true);
      if (e.key === "Escape") finish(false);
    });
    input.addEventListener("blur", () => finish(true));
  });
}

// Security dialog: opened from the account menu; passkeys add and remove in place; the password form confirms in place.
(() => {
  const dlg = document.getElementById("security");
  if (!dlg) return;
  for (const b of document.querySelectorAll("[data-open='security']"))
    b.addEventListener("click", () => {
      document.getElementById("account-menu")?.classList.remove("open");
      document.querySelector(".avatar")?.setAttribute("aria-expanded", "false");
      dlg.showModal();
    });
  dlg.querySelector("[data-close]").addEventListener("click", () => dlg.close());
  dlg.addEventListener("click", (e) => {
    if (e.target === dlg) dlg.close();
  });
  const list = dlg.querySelector(".plist");
  const bind = (li) =>
    li.querySelector("[data-remove]")?.addEventListener("click", () => {
      li.classList.add("leaving");
      setTimeout(() => {
        li.remove();
        if (!list.children.length)
          list.innerHTML =
            '<li class="empty-note">No passkeys yet. Add one to sign in without a password.</li>';
      }, 160);
    });
  list.querySelectorAll("li").forEach(bind);
  dlg.querySelector("[data-add-passkey]").addEventListener(
    "click",
    () =>
      void (async () => {
        const btn = dlg.querySelector("[data-add-passkey]");
        const old = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = `${ICON.spin}Waiting for Your Device`;
        await wait(1400);
        list.querySelector(".empty-note")?.remove();
        const li = document.createElement("li");
        li.innerHTML = `<span class="pk">${dlg.querySelector(".pk")?.innerHTML ?? ""}</span><span class="pbody"><b>New Passkey</b><span class="muted">Added just now</span></span><button class="btn quiet sm danger" type="button" data-remove aria-label="Remove New Passkey">Remove</button>`;
        list.append(li);
        bind(li);
        btn.disabled = false;
        btn.innerHTML = old;
      })(),
  );
  dlg.querySelector("[data-password]").addEventListener(
    "submit",
    (e) =>
      void (async () => {
        e.preventDefault();
        const form = e.currentTarget,
          btn = form.querySelector("button[type='submit']"),
          label = btn.querySelector(".label");
        btn.disabled = true;
        setLabel(label, `${ICON.spin}Changing`);
        await wait(1200);
        setLabel(label, "Password Changed");
        form.reset();
        await wait(1600);
        setLabel(label, "Change Password");
        btn.disabled = false;
      })(),
  );
})();

const hideRowMenu = (pop, btn) => {
  if (pop.matches(":popover-open")) pop.hidePopover();
  pop.classList.remove("open", "above");
  btn.setAttribute("aria-expanded", "false");
};
const placeRowMenu = (pop, btn) => {
  const r = btn.getBoundingClientRect();
  const gap = 6;
  pop.style.top = "0px";
  pop.style.left = "0px";
  const w = pop.offsetWidth,
    h = pop.offsetHeight;
  const below = r.bottom + gap + h <= window.innerHeight - 8;
  pop.classList.toggle("above", !below);
  pop.style.top = (below ? r.bottom + gap : r.top - gap - h) + "px";
  pop.style.left = Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8)) + "px";
};
// Row menus in the accounts table: one open at a time, floated in the top layer via the Popover API
// so the table never clips them, placed from the trigger and flipped above when there is no room below.
(() => {
  const anchors = [...document.querySelectorAll(".rowmenu")];
  if (!anchors.length) return;
  const closeAll = () =>
    anchors.forEach((a) => hideRowMenu(a.querySelector(".pop"), a.querySelector("button")));
  for (const a of anchors) {
    const btn = a.querySelector("button"),
      pop = a.querySelector(".pop");
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const open = !pop.matches(":popover-open");
      closeAll();
      if (!open) return;
      pop.showPopover();
      placeRowMenu(pop, btn);
      btn.setAttribute("aria-expanded", "true");
      pop.querySelector(".item")?.focus();
    });
    pop.addEventListener("click", (e) => {
      e.stopPropagation();
      closeAll();
      btn.focus();
    });
  }
  document.addEventListener("click", closeAll);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeAll();
  });
  window.addEventListener("scroll", closeAll, { passive: true });
  window.addEventListener("resize", closeAll);
})();

// Settings: one dialog, several live view options. Stored in localStorage under headroom.settings.
const SETTINGS_DEFAULTS = {
  limits: "used",
  warnAt: "30",
  refreshEvery: "10",
  time: "relative",
  clock: "24",
  density: "comfortable",
  actions: false,
  notifyLow: true,
  notifyResets: true,
  notifyFail: true,
};
const SETTINGS = (() => {
  try {
    return {
      ...SETTINGS_DEFAULTS,
      ...JSON.parse(localStorage.getItem("headroom.settings") || "{}"),
    };
  } catch {
    return { ...SETTINGS_DEFAULTS };
  }
})();

// A meter reads from data-used; the view decides whether the number and fill say used or left, and where amber starts.
function applyMeter(cell, from) {
  const used = Number(cell.dataset.used);
  if (Number.isNaN(used)) return;
  const left = Math.max(0, 100 - used);
  const showLeft = SETTINGS.limits === "left";
  const bar = cell.querySelector(".bar"),
    num = cell.querySelector("[data-count]"),
    unit = cell.querySelector(".value .unit"),
    tw = cell.querySelector(".tw");
  const shown = showLeft ? left : used;
  const decimals = Number(num?.dataset.decimals || 0);
  const rounded = decimals ? Number(shown.toFixed(decimals)) : Math.round(shown);
  if (bar) {
    bar.style.setProperty("--v", rounded + "%");
    bar.setAttribute("aria-valuenow", String(Math.round(used)));
    const warnAt = Number(SETTINGS.warnAt);
    bar.classList.toggle("bad", left < 10);
    bar.classList.toggle("warn", left >= 10 && left < warnAt);
    bar.classList.toggle("good", left >= warnAt);
    if (tw)
      tw.innerHTML =
        left < 10
          ? '<span class="tone bad">Almost Out</span> · '
          : left < warnAt
            ? '<span class="tone warn">Running Low</span> · '
            : "";
  }
  if (num) {
    num.dataset.count = String(rounded);
    if (from === undefined)
      num.textContent = new Intl.NumberFormat("en-US", {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      }).format(rounded);
    else count(num, 0, from);
  }
  if (unit) unit.textContent = showLeft ? "% left" : "%";
}

const to12 = (t) =>
  t.replace(/\b(\d{1,2}):(\d{2})\b/g, (m, h, mm) => {
    const H = Number(h);
    if (H > 23) return m;
    return `${H % 12 || 12}:${mm} ${H < 12 ? "AM" : "PM"}`;
  });
const applyActions = () => {
  for (const h of document.querySelectorAll(".hold")) {
    if (h.dataset.demo) continue;
    const on = Boolean(SETTINGS.actions);
    h.classList.toggle("off", !on);
    if (on) {
      h.disabled = false;
      h.removeAttribute("title");
    } else if (!h.classList.contains("done")) {
      h.disabled = true;
      h.setAttribute("title", "Account actions are switched off in Settings.");
    }
  }
};
const save = () => localStorage.setItem("headroom.settings", JSON.stringify(SETTINGS));

(() => {
  const dlg = document.getElementById("settings");
  const times = [...document.querySelectorAll("time.when")];
  for (const t of times) {
    t.dataset.rel = t.textContent;
    t.dataset.abs = t.getAttribute("title") || "";
  }
  const applyTimes = () => {
    const exact = SETTINGS.time === "exact",
      clock12 = SETTINGS.clock === "12";
    for (const t of times) {
      let rel = t.dataset.rel,
        abs = t.dataset.abs;
      if (clock12) abs = to12(abs);
      // Exact wording: "at 15:06" for today, otherwise the day itself ("Wed, Oct 8 · 08:14") with no lead word.
      const today = abs.startsWith("Today · ");
      const lead = today ? "at " : "";
      if (exact && today) abs = abs.slice(8);
      let text = exact ? abs : rel,
        title = exact ? rel : t.dataset.abs;
      if (exact)
        text = text.replace(/^(Resets|First expires|Cycle ends|Last known) in /, `$1 ${lead}`);
      // A lead-in word outside the element ("Resets in <b>52 min</b>") flips the same way.
      const b = t.parentElement?.tagName === "B" ? t.parentElement : t;
      const prev = b.previousSibling;
      if (prev?.nodeType === 3) {
        if (!("lead" in b.dataset)) b.dataset.lead = prev.textContent;
        prev.textContent = exact ? b.dataset.lead.replace(/\bin\s*$/, lead) : b.dataset.lead;
      }
      t.textContent = text;
      t.setAttribute("title", title);
    }
  };
  const applyAll = (animate) => {
    document.documentElement.dataset.density = SETTINGS.density;
    for (const cell of document.querySelectorAll(".cell[data-used]"))
      applyMeter(
        cell,
        animate ? Number(cell.querySelector("[data-count]")?.dataset.count) : undefined,
      );
    applyTimes();
    applyActions();
  };
  if (dlg) {
    for (const b of document.querySelectorAll("[data-open='settings']"))
      b.addEventListener("click", () => {
        document.getElementById("account-menu")?.classList.remove("open");
        document.querySelector(".avatar")?.setAttribute("aria-expanded", "false");
        dlg.showModal();
      });
    dlg.querySelector("[data-close]").addEventListener("click", () => dlg.close());
    dlg.addEventListener("click", (e) => {
      if (e.target === dlg) dlg.close();
    });
    for (const seg of dlg.querySelectorAll(".seg[data-setting]")) {
      const key = seg.dataset.setting;
      const paint = () => {
        for (const o of seg.children)
          o.setAttribute("aria-pressed", String(o.dataset.value === String(SETTINGS[key])));
      };
      paint();
      for (const o of seg.children)
        o.addEventListener("click", () => {
          if (String(SETTINGS[key]) === o.dataset.value) return;
          SETTINGS[key] = o.dataset.value;
          paint();
          save();
          applyAll(true);
        });
    }
    for (const box of dlg.querySelectorAll("input[data-setting]")) {
      const key = box.dataset.setting;
      box.checked = Boolean(SETTINGS[key]);
      box.addEventListener("change", () => {
        SETTINGS[key] = box.checked;
        save();
        applyAll(true);
      });
    }
  }
  const isDefault = Object.keys(SETTINGS_DEFAULTS).every(
    (k) => String(SETTINGS[k]) === String(SETTINGS_DEFAULTS[k]),
  );
  if (!isDefault) applyAll(false);
})();
