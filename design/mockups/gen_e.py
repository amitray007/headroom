# Generates e-panels.html, e-states.html and e-connect.html with CSS, JS and brand marks inlined.
import re, pathlib
CSS = pathlib.Path("e.css").read_text()
JS = pathlib.Path("e.js").read_text()

def icon_svg(name, mono):
    s = pathlib.Path(f"icons/{name}.svg").read_text()
    s = re.sub(r"<\?xml[^>]*\?>", "", s); s = re.sub(r"<!--.*?-->", "", s, flags=re.S)
    s = re.sub(r'\s(width|height)="[^"]*"', "", s, count=2)
    if mono:
        s = re.sub(r'fill="(#000|#000000|black|#0A0A0A|#0a0a0a)"', 'fill="currentColor"', s)
        s = re.sub(r"fill:\s*#[0-9a-fA-F]{3,6};", "fill: currentColor;", s)
        if 'fill="currentColor"' not in s and "fill: currentColor" not in s:
            s = s.replace("<svg ", '<svg fill="currentColor" ', 1)
    s = s.replace("<svg ", '<svg aria-hidden="true" focusable="false" ', 1)
    return s.strip()
BRAND = {
    "claude": icon_svg("claude", False), "codex": icon_svg("codex", True), "cursor": icon_svg("cursor", True),
    "copilot": icon_svg("copilot", True), "grok": icon_svg("grok", True), "antigravity": icon_svg("antigravity", False),
    "vercel_ai_gateway": icon_svg("vercel_ai_gateway", True),
}
I = {
 "clock": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
 "pause": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>',
 "alert": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/></svg>',
 "partial": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" stroke-dasharray="4.2 3.2"/></svg>',
 "retry": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/></svg>',
 "reset": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 2.6-6.4"/><path d="M3 3v6h6"/></svg>',
 "plus": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
 "plug": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22v-5M9 8V2M15 8V2M6 8h12v5a6 6 0 0 1-12 0V8z"/></svg>',
 "user": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>',
 "key": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="15" r="4"/><path d="m10.9 12.1 9.1-9.1M15 7l3 3"/></svg>',
 "out": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>',
 "ext": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/></svg>',
 "copy": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>',
 "check": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 5 5 9-10"/></svg>',
}
LOGO = '<svg viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="18" fill="currentColor"/><rect x="14" y="16" width="36" height="4" rx="2" fill="var(--background)" opacity=".55"/><rect x="14" y="30" width="26" height="8" rx="4" fill="var(--background)"/><rect x="14" y="42" width="16" height="8" rx="4" fill="var(--background)"/></svg>'

def head(title):
    return f'''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500&family=Geist+Mono:wght@500&display=swap" rel="stylesheet">
<style>
{CSS}
</style>
<script>/* ?scheme=light|dark forces the appearance for review; otherwise the OS decides. Bars start collapsed only when JS runs. */
const s=new URLSearchParams(location.search).get("scheme");if(s)document.documentElement.style.colorScheme=s;
if(!matchMedia("(prefers-reduced-motion: reduce)").matches&&new URLSearchParams(location.search).get("motion")!=="off")document.documentElement.classList.add("pre");</script>
</head>
<body>
<div class="page">
'''
FOOT = f'''</div>
<script>
{JS}
</script>
</body>
</html>
'''

def top(summary, page="panels"):
    connect = '<a href="e-connect.html">Connect an account</a>' if page != "connect" else '<a href="e-panels.html">Back to accounts</a>'
    return f'''  <header class="top">
    <a class="lockup" href="e-panels.html">{LOGO}Headroom</a>
    <nav aria-label="Page"><span class="summary muted">{summary}</span>{connect}
      <span class="menu-anchor"><button class="avatar" type="button" aria-label="Account menu" aria-haspopup="menu" aria-expanded="false" aria-controls="account-menu">M</button>
        <div class="menu" id="account-menu" role="menu">
          <div class="who">Signed in as<b>alex</b></div>
          <div class="theme"><span>Appearance</span><span class="seg" role="group" aria-label="Appearance"><button type="button" data-scheme="system" aria-pressed="true">System</button><button type="button" data-scheme="light" aria-pressed="false">Light</button><button type="button" data-scheme="dark" aria-pressed="false">Dark</button></span></div>
          <a class="item" role="menuitem" href="#">{I["key"]}Passkeys and password</a>
          <button class="item danger" role="menuitem" type="button">{I["out"]}Sign out</button>
        </div></span></nav>
  </header>
'''

def value(v, unit="", of=None, decimals=0, prefix="", unknown=False):
    if unknown:
        return '<div class="value unknown" aria-hidden="true">—</div>'
    num = f'<span class="num" data-count="{v}" data-decimals="{decimals}" data-prefix="{prefix}">{prefix}{v}</span>'
    u = f'<span class="unit">{unit}</span>' if unit else ""
    o = f'<span class="of">{of}</span>' if of else ""
    return f'<div class="value">{num}{u}{o}</div>'

def bar(v=None, t=None, tone="", thin=False, segs=None, unknown=False, aria="", limit=None):
    cls = "bar" + (f" {tone}" if tone else "") + (" thin" if thin else "") + (" unknown" if unknown else "") + (" hatch" if limit else "")
    style = []
    if v is not None: style.append(f"--v:{v}%")
    if t is not None: style.append(f"--t:{t}%")
    if limit is not None: style.append(f"--limit:{limit}%")
    inner = ""
    if not unknown:
        if segs:
            x = 0
            for w, c in segs:
                inner += f'<span class="seg {c}" style="--x:{x}%; --w:{w}%"></span>'; x += w
        else:
            inner += '<span class="fill"></span>'
        if t is not None: inner += '<span class="tick" title="How far this window has elapsed"></span>'
    a = f' role="meter" aria-valuenow="{v}" aria-valuemin="0" aria-valuemax="100" aria-label="{aria}"' if (v is not None and not unknown) else f' aria-label="{aria}"'
    return f'<div class="{cls}"{a} style="{"; ".join(style)}">{inner}</div>'

def legend(items):
    return '<div class="legend">' + "".join(f'<span class="item"><span class="sw {c}"></span>{l} <b class="num">{v}</b></span>' for c, l, v in items) + '</div>'

def cell(label, window, val, caption, b=None, lg=None, fact=False, key=None):
    w = f' <span class="window">{window}</span>' if window else ""
    cls = "cell fact" if fact else "cell"
    k = f' data-key="{key}"' if key else ""
    return f'''      <div class="{cls}"{k}>
        <div class="label"><span>{label}</span>{w}</div>
        {val}
        {b or ""}
        {lg or ""}
        <div class="caption">{caption}</div>
      </div>
'''

def status(kind, text):
    if kind == "ok":
        return f'<span class="status-slot"><span class="status"><span class="dot"></span><span class="age">{text}</span></span></span>'
    icon = {"retry": I["retry"], "stale": I["clock"], "partial": I["partial"], "bad": I["alert"], "paused": I["pause"], "wait": I["clock"]}[kind]
    tone = {"retry": "neutral", "stale": "warn", "partial": "warn", "bad": "bad", "paused": "quiet", "wait": "quiet"}[kind]
    return f'<span class="status-slot"><span class="pill {tone}">{icon}{text}</span></span>'

def chips(*names):
    return "".join(f'<span class="chip">{n}</span>' for n in names)

def foot(last, outcome, actions=True, paused=False):
    acts = ""
    if actions:
        acts = f'''<span class="acts">
          <button class="btn quiet sm" type="button" data-act="refresh"><span class="label">Refresh</span></button>
          <button class="btn quiet sm" type="button" data-act="pause"><span class="label">{"Resume" if paused else "Pause"}</span></button>
          <button class="btn quiet sm danger" type="button" data-act="disconnect"><span class="label">Disconnect</span></button>
        </span>'''
    return f'''      <div class="foot"><span class="last">Last refreshed <b>{last}</b> · {outcome}</span>{acts}</div>
'''

def panel(id_, name, plan, st, right_chips, cells, facts="", notice="", dim=False, paused=False, footer=""):
    plan_html = f' <span class="plan">{plan}</span>' if plan else ""
    facts_html = f'      <div class="facts">\n{facts}      </div>\n' if facts else ""
    cls = "panel" + (" dim" if dim else "") + (" paused" if paused else "")
    return f'''    <div class="collapse"><section class="{cls}" aria-labelledby="{id_}">
      <header>
        <h3 id="{id_}">{name}{plan_html}</h3>
        <div class="right">{st}{right_chips}</div>
      </header>
{notice}      <div class="cells">
{cells}      </div>
{facts_html}{footer}    </section></div>
'''

def provider(id_, key, name, panels, count=1):
    c = f'<span class="count">{count} accounts</span>' if count > 1 else '<span class="count"></span>'
    return f'''  <div class="collapse"><section class="provider" data-accent="{key}" aria-labelledby="{id_}">
    <header><span class="brand">{BRAND[key]}</span><h2 id="{id_}">{name}</h2>{c}</header>
    <div class="stack">
{panels}    </div>
  </section></div>

'''

def notice(tone, icon, text, action):
    return f'      <div class="notice {tone}"><span class="text">{I[icon]}{text}</span>{action}</div>\n'

# ---------- panels ----------
claude1 = panel("a-cl1", "Personal", "Max", status("ok", "2 min ago"), chips("private"),
  cell("5-hour", "rolling", value(42, "%"), "resets in <b>2h 10m</b>", bar(42, 57, aria="5-hour usage 42%")) +
  cell("Weekly", "all models", value(61, "%"), "resets <b>Thu 09:00</b> · 3d 4h", bar(61, 55, aria="Weekly usage 61%")) +
  cell("Weekly", "Sonnet", value(23, "%"), "same window", bar(23, 55, aria="Weekly Sonnet usage 23%")) +
  cell("Weekly", "Opus", value(48, "%"), "same window", bar(48, 55, aria="Weekly Opus usage 48%")) +
  cell("Extra usage", "this month", value("12.50", "", of="of $50", decimals=2, prefix="$"), "<b>$37.50</b> left under the monthly cap", bar(25, thin=True, aria="Extra usage $12.50 of $50")),
  facts='        <span class="kv">Reset grants <span class="pips" aria-label="1 available"><span class="pip"></span></span> <b>1</b> available</span>\n',
  footer=foot("14:02", "succeeded"))

claude2 = panel("a-cl2", "Studio", "Pro", status("retry", "14 min ago · retrying"), chips("private"),
  cell("5-hour", "rolling", value(8, "%"), "resets in <b>4h 25m</b>", bar(8, 12, aria="5-hour usage 8%")) +
  cell("Weekly", "all models", value(0, unknown=True), "not reported in the last refresh · retrying", bar(unknown=True, aria="Weekly usage unknown")),
  facts='        <span class="kv">Reset grants <span class="pips" aria-label="0 available"><span class="pip spent"></span></span> <b>0</b> available</span>\n',
  footer=foot("13:50", "provider unavailable, usage returned 503"))

codex1 = panel("a-cx1", "Personal", "Pro", status("ok", "2 min ago"), chips("private"),
  cell("Weekly", "7 days", value(78, "%"), "resets in <b>1d 6h</b>", bar(78, 82, tone="warn", aria="Weekly usage 78%"), key="weekly") +
  cell("Credits", "balance", value(1240, "credits"), "not time-bound", fact=True) +
  cell("Reset credits", "banked", value(3, "", of="usable"), 'first expires in <b>12 d</b> <span class="pips" aria-hidden="true" style="margin-left:6px"><span class="pip"></span><span class="pip"></span><span class="pip"></span></span>', fact=True, key="resets"),
  facts='        <span class="kv muted">Consuming a reset credit renews the weekly window now and spends one credit.</span>\n        <span class="spacer"></span>\n        <button class="btn hold" type="button" aria-describedby="hold-hint"><span class="face">' + I["reset"] + '<span class="label">Hold to reset weekly limit</span></span><span class="fillface" aria-hidden="true">' + I["reset"] + 'Hold to reset weekly limit</span></button><span id="hold-hint" class="sr">Press and hold for 1.2 seconds to confirm. With a keyboard, hold Space or Enter.</span>\n',
  footer=foot("14:02", "succeeded"))

codex2 = panel("a-cx2", "Work", "Business", status("paused", "Paused · 1 d ago"), chips("private", "member"),
  cell("Weekly", "7 days", value(12, "%"), "resets in <b>1d 6h</b> · as of 1 d ago", bar(12, 82, aria="Weekly usage 12%")),
  paused=True, footer=foot("yesterday 09:14", "succeeded", paused=True))

cursor = panel("a-cu", "Personal", "Pro", status("ok", "2 min ago"), chips("private"),
  cell("Included", "15 Sep to 15 Oct", value(58, "%"), "<b>$20</b> plan · <b>13 d</b> left", bar(58, 57, segs=[(40, "s1"), (18, "s2")], aria="Included usage 58%: API 40%, Auto 18%"), legend([("s1", "API", "40%"), ("s2", "Auto", "18%"), ("free", "Free", "42%")])) +
  cell("On-demand", "this cycle", value("3.20", "", of="of $20", decimals=2, prefix="$"), "<b>$16.80</b> left under the cap", bar(16, thin=True, aria="On-demand $3.20 of $20")),
  footer=foot("14:01", "succeeded"))

grok = panel("a-gk", "Personal", "", status("stale", "Stale · 3 h ago"), chips("private"),
  cell("Weekly pool", "7 days", value(34, "%"), "resets in <b>4d 11h</b>", bar(34, 36, segs=[(22, "s1"), (12, "s2")], aria="Weekly pool 34%: Code 22%, Chat 12%"), legend([("s1", "Code", "22%"), ("s2", "Chat", "12%"), ("free", "Free", "66%")])) +
  cell("On-demand", "this week", value(120, "", of="of 500 credits"), "<b>380</b> credits left under the cap", bar(24, thin=True, aria="On-demand 120 of 500 credits")) +
  cell("Prepaid", "balance", value(2500, "credits"), "not time-bound", fact=True),
  footer=foot("11:05", "rate limited, retrying after the provider's wait"))

anti = panel("a-ag", "Personal", "Free", status("ok", "2 min ago"), chips("private"),
  cell("Gemini", "weekly", value(95, "%"), "resets in <b>5d 2h</b>", bar(95, 27, tone="bad", aria="Gemini weekly usage 95%")) +
  cell("Claude and GPT", "weekly", value(12, "%"), "same window", bar(12, 27, aria="Claude and GPT weekly usage 12%")),
  facts='        <span class="kv muted">The free tier reports weekly buckets only.</span>\n',
  footer=foot("14:02", "succeeded"))

copilot = panel("a-cp", "Personal", "Pro", status("bad", "Reconnect needed · 2 days ago"), chips("private"),
  cell("AI credits", "monthly", value(100, "%"), "resets <b>1 Nov</b>", bar(100, 6, tone="bad", aria="AI credits 100% used")) +
  cell("Credits used", "this month", value(300, "credits"), "no entitlement is reported", fact=True) +
  cell("Extra usage", "this month", value(0, "requests"), "beyond the included credits", fact=True),
  facts='        <span class="kv">Chat <b>unlimited</b></span>\n        <span class="kv">Completions <b>unlimited</b></span>\n',
  notice=notice("bad", "alert", "The provider rejected the saved sign-in.", '<button class="btn primary sm" type="button">Reconnect</button>'), dim=True,
  footer=foot("Tue 08:30", "authentication failed, usage returned 401"))

vercel = panel("a-vc", "Team", "", status("partial", "Partial"), '<span class="chip" title="The spend report needs a Pro plan, so Headroom does not show spend for this key.">spend not available</span>',
  cell("Credit balance", "", value("14.20", "credits", decimals=2), "<b>85.80</b> used of 100.00", bar(86, thin=True, aria="Credits used 85.80 of 100")) +
  cell("Credits used", "lifetime", value("85.80", "credits", decimals=2), "on this gateway key", fact=True),
  footer=foot("14:00", "partial, the spend report needs a Pro plan"))

body = (
  provider("p-cl", "claude", "Claude", claude1 + claude2, 2) +
  provider("p-cx", "codex", "Codex", codex1 + codex2, 2) +
  provider("p-cu", "cursor", "Cursor", cursor) +
  provider("p-gk", "grok", "Grok", grok) +
  provider("p-ag", "antigravity", "Antigravity", anti) +
  provider("p-cp", "copilot", "Copilot", copilot) +
  provider("p-vc", "vercel_ai_gateway", "Vercel AI Gateway", vercel)
)
key = '''  <footer class="key">
    <span><span class="sw"></span>used share of the window</span>
    <span><span class="sw tick"></span> how far the window has elapsed</span>
    <span><span class="sw warn"></span>from 70%</span>
    <span><span class="sw bad"></span>from 90%</span>
    <span><span class="sw unknown"></span>not reported yet</span>
  </footer>
'''
pathlib.Path("e-panels.html").write_text(head("Headroom · mockup E · accounts") + top("<b>9</b> accounts · <b>2</b> need attention") + body + f'  <a class="add" href="e-connect.html">{I["plus"]} Connect another account</a>\n' + key + FOOT)

# ---------- states ----------
sk_cell = '<div class="cell"><div class="sk line" style="width:40%"></div><div class="sk big"></div><div class="sk bar"></div><div class="sk line" style="width:60%"></div></div>'
states = head("Headroom · mockup E · states") + top("States and primitives") + f'''  <div class="demo">
    <h2>Status in the panel header</h2>
    <div class="row">{status("ok", "2 min ago")}{status("retry", "14 min ago · retrying")}{status("stale", "Stale · 3 h ago")}{status("partial", "Partial")}{status("bad", "Reconnect needed · 2 days ago")}{status("paused", "Paused · 1 d ago")}{status("wait", "Waiting for the first refresh")}</div>

    <h2>Buttons</h2>
    <div class="row"><button class="btn primary" type="button">Reconnect</button><button class="btn" type="button">Resume</button><button class="btn quiet" type="button">Refresh</button><button class="btn quiet danger" type="button">Disconnect</button><button class="btn" type="button" disabled>Pause</button>
      <button class="btn hold" type="button"><span class="face">{I["reset"]}<span class="label">Hold to reset weekly limit</span></span><span class="fillface" aria-hidden="true">{I["reset"]}Hold to reset weekly limit</span></button></div>
    <p class="muted" style="margin:0; font-size:13px">Press scales to 0.97 in 120 ms and releases on the spring. Hover fills apply on fine pointers only. The hold button fills linearly over 1.2 s and rewinds if released early. Try it.</p>

    <h2>Provider marks and accents</h2>
    <div class="row">''' + "".join(f'<span class="provider" data-accent="{k}" style="margin:0; display:inline-flex; align-items:center; gap:10px"><span class="brand">{BRAND[k]}</span><span class="bar" style="--v:60%; width:120px; display:inline-block"><span class="fill"></span></span></span>' for k in BRAND) + f'''</div>

    <h2>Loading: skeleton in the final layout</h2>
    <section class="panel" aria-busy="true" aria-label="Loading account">
      <header><div class="sk title"></div><div class="sk line" style="width:96px"></div></header>
      <div class="cells">{sk_cell}{sk_cell}{sk_cell}</div>
    </section>

    <h2>Never collected</h2>
{panel("s-wait", "Personal", "Pro", status("wait", "Waiting for the first refresh"), chips("private"), sk_cell + sk_cell, notice=notice("neutral", "clock", "Connected just now. The first refresh is running.", ""))}
    <h2>List failed</h2>
{notice("bad", "alert", "Headroom could not load your accounts. Check that the server is running and try again.", '<button class="btn sm" type="button">Try again</button>')}
    <h2>Empty</h2>
    <section class="panel">
      <div class="empty">
        <div class="tile">{I["plug"]}</div>
        <h2>No accounts connected</h2>
        <p>Connect a provider account and its limits, balances and resets appear here within a minute.</p>
        <div class="actions"><a class="btn primary" href="e-connect.html">Connect an account</a></div>
        <p class="providers">Claude · Codex · Cursor · Copilot · Grok · Antigravity · Vercel AI Gateway</p>
      </div>
    </section>

    <h2>Over the limit</h2>
    <section class="panel">
      <div class="cells">
{cell("Weekly", "7 days", value(112, "%"), "<b>12%</b> over · resets in <b>1d 6h</b>", bar(100, 82, tone="bad", limit=89, aria="Weekly usage 112%, over the limit"))}      </div>
    </section>
  </div>
''' + FOOT
pathlib.Path("e-states.html").write_text(states)

# ---------- connect ----------
def card(key, name, hint, meta):
    return f'''    <button class="card" type="button"><span class="head"><span class="brand lg">{BRAND[key]}</span>{name}</span><span class="hint">{hint}</span><span class="meta">{meta}</span></button>
'''
cards = (
  card("claude", "Claude", "Signs in through the Claude Code command line, once.", chips("private interface")) +
  card("codex", "Codex", "Signs in through the Codex command line, once.", chips("private interface")) +
  card("cursor", "Cursor", "Paste the redirect after signing in on cursor.com.", chips("private interface")) +
  card("copilot", "Copilot", "Enter a device code on github.com.", chips("private interface")) +
  card("grok", "Grok", "Signs in through the Grok command line, once.", chips("private interface")) +
  card("antigravity", "Antigravity", "Paste the redirect after signing in with Google.", chips("private interface")) +
  card("vercel_ai_gateway", "Vercel AI Gateway", "Paste a Gateway API key. Spend needs a Pro plan.", chips("official API"))
)
steps = f'''
  <div class="demo">
    <h2>Step states</h2>
    <section class="panel step" data-accent="copilot">
      <div class="title"><h2><span class="brand">{BRAND["copilot"]}</span>Copilot</h2>{status("wait", "Waiting for you · 9:42 left")}</div>
      <p class="secondary" style="margin:0">Open GitHub and enter this code. Headroom finishes on its own once GitHub approves.</p>
      <div class="row"><span class="code">WDJB-MJHT<button class="btn sm" type="button" aria-label="Copy code">{I["copy"]}</button></span><a class="btn primary" href="#">{I["ext"]}Open github.com/login/device</a><button class="btn quiet" type="button">Cancel</button></div>
    </section>
    <section class="panel step" data-accent="cursor">
      <div class="title"><h2><span class="brand">{BRAND["cursor"]}</span>Cursor</h2>{status("wait", "Waiting for your input")}</div>
      <p class="secondary" style="margin:0">Sign in on cursor.com, then paste the full URL you were sent to.</p>
      <div class="field"><label for="redirect">Redirect URL</label><input id="redirect" type="url" placeholder="http://localhost:…/callback?code=…"></div>
      <div class="row"><button class="btn primary" type="button">Continue</button><button class="btn quiet" type="button">Cancel</button></div>
    </section>
    <section class="panel step" data-accent="vercel_ai_gateway">
      <div class="title"><h2><span class="brand">{BRAND["vercel_ai_gateway"]}</span>Vercel AI Gateway</h2>{status("wait", "Waiting for your input")}</div>
      <div class="field"><label for="apikey">Gateway API key</label><input id="apikey" type="password" placeholder="vck_…"></div>
      <p class="muted" style="margin:0; font-size:13px">The key is encrypted at rest and never shown again.</p>
      <div class="row"><button class="btn primary" type="button">Connect Vercel AI Gateway</button><button class="btn quiet" type="button">Cancel</button></div>
    </section>
    <section class="panel step" data-accent="codex">
      <div class="title"><h2><span class="brand">{BRAND["codex"]}</span>Codex</h2><span class="pill neutral"><span class="spin" aria-hidden="true"></span>Checking</span></div>
      <p class="secondary" style="margin:0">Sign-in accepted. Headroom is checking which limits this account reports.</p>
    </section>
    <section class="panel step" data-accent="claude">
      <div class="title"><h2><span class="brand">{BRAND["claude"]}</span>Claude</h2><span class="pill" style="--tone: var(--success)">{I["check"]}Connected</span></div>
      <p class="secondary" style="margin:0">Personal · Max is connected. Its first refresh is running.</p>
      <div class="row"><a class="btn primary" href="e-panels.html">Open your accounts</a><a class="btn quiet" href="#">Connect another</a></div>
    </section>
  </div>
'''
connect = head("Headroom · mockup E · connect") + top("", "connect") + f'''  <div class="intro">
    <h1>Connect an account</h1>
    <p>Choose a provider. Headroom signs in once, stores the credential encrypted, and refreshes on its own. Private interfaces read the same endpoints the provider's own app uses.</p>
  </div>
  <div class="cards">
{cards}  </div>
{steps}''' + FOOT
pathlib.Path("e-connect.html").write_text(connect)
print("pages ok")
