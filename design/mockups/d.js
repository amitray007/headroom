// First-paint motion: bars grow from the left, numbers count up once, staggered 70 ms per cell.
const ease = (t) => 1 - Math.pow(1 - t, 4);
(() => {
  const reduce =
    matchMedia("(prefers-reduced-motion: reduce)").matches ||
    new URLSearchParams(location.search).get("motion") === "off";
  if (reduce) document.documentElement.classList.add("no-motion");
  const root = document.documentElement;
  const counters = [...document.querySelectorAll("[data-count]")];
  function run(el, i) {
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
    const delay = Math.min(i * 70, 250);
    const dur = 580;
    let start;
    const step = (now) => {
      if (start === undefined) start = now + delay;
      const t = Math.min(Math.max((now - start) / dur, 0), 1);
      el.textContent = prefix + fmt.format(target * ease(t));
      if (t < 1) requestAnimationFrame(step);
    };
    el.textContent = prefix + fmt.format(0);
    requestAnimationFrame(step);
  }
  requestAnimationFrame(() => {
    root.classList.remove("pre");
    counters.forEach(run);
  });
})();

// Details toggles: the header button opens the body at the end of its panel.
for (const btn of document.querySelectorAll(".toggle")) {
  btn.addEventListener("click", () => {
    const body = document.getElementById(btn.getAttribute("aria-controls"));
    const open = btn.getAttribute("aria-expanded") !== "true";
    btn.setAttribute("aria-expanded", String(open));
    body.classList.toggle("open", open);
  });
}
