# Generates d-panels.html and d-states.html from one data description. Synthetic data only.
I = {
 "warn": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/></svg>',
 "clock": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
 "pause": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>',
 "alert": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/></svg>',
 "partial": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" stroke-dasharray="4.2 3.2"/></svg>',
 "retry": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/></svg>',
 "chev": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>',
 "reset": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 2.6-6.4"/><path d="M3 3v6h6"/></svg>',
 "plus": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
 "plug": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22v-5M9 8V2M15 8V2M6 8h12v5a6 6 0 0 1-12 0V8z"/></svg>',
}
LOGO = '<svg viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="18" fill="currentColor"/><rect x="14" y="16" width="36" height="4" rx="2" fill="var(--background)" opacity=".55"/><rect x="14" y="30" width="26" height="8" rx="4" fill="var(--background)"/><rect x="14" y="42" width="16" height="8" rx="4" fill="var(--background)"/></svg>'

def head(title):
    return f'''<!doctype html>
<html lang="en" class="pre">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500&family=Geist+Mono:wght@500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="d.css">
<script>/* ?scheme=light|dark forces the appearance for review; otherwise the OS decides. */
const s=new URLSearchParams(location.search).get("scheme");if(s)document.documentElement.style.colorScheme=s;</script>
</head>
<body>
<div class="page">
'''
FOOT = '''</div>
<script src="d.js"></script>
</body>
</html>
'''

def top(summary):
    return f'''  <header class="top">
    <a class="lockup" href="#">{LOGO}Headroom</a>
    <nav aria-label="Page"><span class="summary muted">{summary}</span><a href="#">Connect an account</a><a href="#">Account</a></nav>
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
            for i, (w, c) in enumerate(segs):
                inner += f'<span class="seg {c}" style="--x:{x}%; --w:{w}%"></span>'
                x += w
        else:
            inner += '<span class="fill"></span>'
        if t is not None:
            inner += '<span class="tick" title="How far this window has elapsed"></span>'
    a = f' role="meter" aria-valuenow="{v}" aria-valuemin="0" aria-valuemax="100" aria-label="{aria}"' if (v is not None and not unknown) else f' aria-label="{aria}"'
    return f'<div class="{cls}"{a} style="{"; ".join(style)}">{inner}</div>'

def legend(items):
    return '<div class="legend">' + "".join(f'<span class="item"><span class="sw {c}"></span>{l} <b class="num">{v}</b></span>' for c, l, v in items) + '</div>'

def cell(label, window, val, caption, b=None, lg=None, fact=False):
    w = f' <span class="window">{window}</span>' if window else ""
    cls = "cell fact" if fact else "cell"
    return f'''      <div class="{cls}">
        <div class="label"><span>{label}</span>{w}</div>
        {val}
        {b or ""}
        {lg or ""}
        <div class="caption">{caption}</div>
      </div>
'''

def status(kind, text):
    if kind == "ok":
        return f'<span class="status"><span class="dot"></span>{text}</span>'
    icon = {"retry": I["retry"], "stale": I["clock"], "partial": I["partial"], "bad": I["alert"], "paused": I["pause"], "wait": I["clock"]}[kind]
    tone = {"retry": "neutral", "stale": "warn", "partial": "warn", "bad": "bad", "paused": "quiet", "wait": "quiet"}[kind]
    return f'<span class="pill {tone}">{icon}{text}</span>'

def chips(*names):
    return "".join(f'<span class="chip">{n}</span>' for n in names)

def details(id_, open_=False, caps=None, run=None, meta=None):
    o = " open" if open_ else ""
    rows = "".join(f"<tr><td>{a}</td><td>{b}</td><td>{c}</td><td>{d}</td></tr>" for a, b, c, d in (caps or []))
    table = f'<table><thead><tr><th>Metric or action</th><th>Availability</th><th>Interface</th><th>Evidence</th></tr></thead><tbody>{rows}</tbody></table>' if caps else ""
    return f'''      <div class="more{o}" id="more-{id_}"><div>
        <div class="body">
          <div class="meta">{meta}</div>
          {table}
          <div class="meta">Latest run <b>{run}</b></div>
          <div class="actions"><button class="btn sm" type="button">Refresh now</button><button class="btn sm" type="button">Pause</button><button class="btn sm danger" type="button">Disconnect</button></div>
        </div>
      </div></div>
'''

def toggle(id_, open_=False):
    return f'<button class="btn quiet sm toggle" type="button" aria-expanded="{"true" if open_ else "false"}" aria-controls="more-{id_}">Details {I["chev"]}</button>'

def panel(id_, name, plan, st, right_chips, cells, facts="", notice="", dim=False, more="", open_=False):
    plan_html = f' <span class="plan">{plan}</span>' if plan else ""
    facts_html = f'      <div class="facts">\n{facts}      </div>\n' if facts else ""
    tg = toggle(id_, open_) if more else ""
    return f'''    <section class="panel{" dim" if dim else ""}" aria-labelledby="{id_}">
      <header>
        <h3 id="{id_}">{name}{plan_html}</h3>
        <div class="right">{st}{right_chips}{tg}</div>
      </header>
{notice}      <div class="cells">
{cells}      </div>
{facts_html}{more}    </section>
'''

def provider(id_, mark, name, panels, count=1):
    c = f'<span class="count">{count} accounts</span>' if count > 1 else ""
    return f'''  <section class="provider" aria-labelledby="{id_}">
    <header><span class="mark" aria-hidden="true">{mark}</span><h2 id="{id_}">{name}</h2>{c}</header>
    <div class="stack">
{panels}    </div>
  </section>

'''

def notice(tone, icon, text, action):
    return f'      <div class="notice {tone}"><span class="text">{I[icon]}{text}</span>{action}</div>\n'

# ---------- panels page ----------
claude1 = panel("a-cl1", "Personal", "Max", status("ok", "2 min ago"), chips("private"),
  cell("5-hour", "rolling", value(42, "%"), "resets in <b>2h 10m</b>", bar(42, 57, aria="5-hour usage 42%")) +
  cell("Weekly", "all models", value(61, "%"), "resets <b>Thu 09:00</b> · 3d 4h", bar(61, 55, aria="Weekly usage 61%")) +
  cell("Weekly", "Sonnet", value(23, "%"), "same window", bar(23, 55, aria="Weekly Sonnet usage 23%")) +
  cell("Weekly", "Opus", value(48, "%"), "same window", bar(48, 55, aria="Weekly Opus usage 48%")) +
  cell("Extra usage", "this month", value("12.50", "", of="of $50", decimals=2, prefix="$"), "<b>$37.50</b> left under the monthly cap", bar(25, thin=True, aria="Extra usage $12.50 of $50")),
  facts='        <span class="kv">Reset grants <span class="pips" aria-label="1 available"><span class="pip"></span></span> <b>1</b> available</span>\n',
  open_=True, more=details("a-cl1", True,
    caps=[("usage.five_hour", "available", "private", "validated"), ("usage.seven_day", "available", "private", "validated"), ("extra_usage", "available", "private", "validated"), ("reset_grants", "available", "private", "validated")],
    run="succeeded · 2 min ago", meta="Observed <b>2 min ago</b> Received <b>2 min ago</b> Connector <b>claude 0.3.0</b> Signed in by <b>command-line login</b>"))

claude2 = panel("a-cl2", "Studio", "Pro", status("retry", "14 min ago · retrying"), chips("private"),
  cell("5-hour", "rolling", value(8, "%"), "resets in <b>4h 25m</b>", bar(8, 12, aria="5-hour usage 8%")) +
  cell("Weekly", "all models", value(35, "%"), "resets <b>Thu 09:00</b> · 3d 4h", bar(35, 55, aria="Weekly usage 35%")),
  facts='        <span class="kv">Reset grants <span class="pips" aria-label="0 available"><span class="pip spent"></span></span> <b>0</b> available</span>\n        <span class="kv muted">Last refresh failed: provider unavailable. Retrying.</span>\n        <span class="spacer"></span>\n',
  more=details("a-cl2", False, caps=[], run="provider_unavailable · usage returned 503 · 1 min ago", meta="Observed <b>14 min ago</b>"))

codex1 = panel("a-cx1", "Personal", "Pro", status("ok", "2 min ago"), chips("private"),
  cell("Weekly", "7 days", value(78, "%"), "resets in <b>1d 6h</b>", bar(78, 82, tone="warn", aria="Weekly usage 78%")) +
  cell("Credits", "balance", value(1240, "credits"), "not time-bound", fact=True) +
  cell("Reset credits", "banked", value(3, "", of="usable"), 'first expires in <b>12 d</b> <span class="pips" aria-hidden="true" style="margin-left:6px"><span class="pip"></span><span class="pip"></span><span class="pip"></span></span>', fact=True),
  facts='        <span class="kv muted">Consuming a reset credit renews the weekly window now and spends one credit.</span>\n        <span class="spacer"></span>\n        <button class="btn hold" type="button" disabled title="Switched off. Start Headroom with HEADROOM_ENABLE_ACTIONS=true to allow it."><span class="face">' + I["reset"] + 'Hold to reset weekly limit</span><span class="fillface" aria-hidden="true">' + I["reset"] + 'Hold to reset weekly limit</span></button>\n',
  more=details("a-cx1", False, caps=[], run="succeeded · 2 min ago", meta="Observed <b>2 min ago</b>"))

codex2 = panel("a-cx2", "Work", "Business", status("paused", "Paused · 1 d ago"), chips("private", "member"),
  cell("Weekly", "7 days", value(12, "%"), "resets in <b>1d 6h</b> · as of 1 d ago", bar(12, 82, aria="Weekly usage 12%")),
  notice=notice("neutral", "pause", "Paused. Headroom is not refreshing this account.", '<button class="btn sm" type="button">Resume</button>'),
  more=details("a-cx2", False, caps=[], run="succeeded · 1 d ago", meta="Observed <b>1 d ago</b> Connector <b>codex 0.4.1</b>"))

cursor = panel("a-cu", "Personal", "Pro", status("ok", "2 min ago"), chips("private"),
  cell("Included", "15 Sep to 15 Oct", value(58, "%"), "<b>$20</b> plan · <b>13 d</b> left", bar(58, 57, segs=[(40, "s1"), (18, "s2")], aria="Included usage 58%: API 40%, Auto 18%"), legend([("s1", "API", "40%"), ("s2", "Auto", "18%"), ("free", "Free", "42%")])) +
  cell("On-demand", "this cycle", value("3.20", "", of="of $20", decimals=2, prefix="$"), "<b>$16.80</b> left under the cap", bar(16, thin=True, aria="On-demand $3.20 of $20")),
  more=details("a-cu", False, caps=[], run="succeeded · 2 min ago", meta="Observed <b>2 min ago</b> Connector <b>cursor 0.2.0</b>"))

grok = panel("a-gk", "Personal", "", status("stale", "Stale · 3 h ago"), chips("private"),
  cell("Weekly pool", "7 days", value(34, "%"), "resets in <b>4d 11h</b>", bar(34, 36, segs=[(22, "s1"), (12, "s2")], aria="Weekly pool 34%: Code 22%, Chat 12%"), legend([("s1", "Code", "22%"), ("s2", "Chat", "12%"), ("free", "Free", "66%")])) +
  cell("On-demand", "this week", value(120, "", of="of 500 credits"), "<b>380</b> credits left under the cap", bar(24, thin=True, aria="On-demand 120 of 500 credits")) +
  cell("Prepaid", "balance", value(2500, "credits"), "not time-bound", fact=True),
  more=details("a-gk", False, caps=[], run="succeeded · 3 h ago", meta="Observed <b>3 h ago</b> Connector <b>grok 0.2.0</b>"))

anti = panel("a-ag", "Personal", "Free", status("ok", "2 min ago"), chips("private"),
  cell("Gemini", "weekly", value(95, "%"), "resets in <b>5d 2h</b>", bar(95, 27, tone="bad", aria="Gemini weekly usage 95%")) +
  cell("Claude and GPT", "weekly", value(12, "%"), "same window", bar(12, 27, aria="Claude and GPT weekly usage 12%")),
  facts='        <span class="kv muted">The free tier reports weekly buckets only.</span>\n',
  more=details("a-ag", False, caps=[], run="succeeded · 2 min ago", meta="Observed <b>2 min ago</b> Connector <b>antigravity 0.2.0</b>"))

copilot = panel("a-cp", "Personal", "Pro", status("bad", "Reconnect needed · 2 days ago"), chips("private"),
  cell("AI credits", "monthly", value(100, "%"), "resets <b>1 Nov</b>", bar(100, 6, tone="bad", aria="AI credits 100% used")) +
  cell("Credits used", "this month", value(300, "credits"), "no entitlement is reported", fact=True) +
  cell("Extra usage", "this month", value(0, "requests"), "beyond the included credits", fact=True),
  facts='        <span class="kv">Chat <b>unlimited</b></span>\n        <span class="kv">Completions <b>unlimited</b></span>\n',
  notice=notice("bad", "alert", "The provider rejected the saved sign-in.", '<button class="btn primary sm" type="button">Reconnect</button>'), dim=True,
  more=details("a-cp", False, caps=[], run="authentication_failed · usage returned 401 · 2 days ago", meta="Observed <b>2 days ago</b> Connector <b>copilot 0.2.0</b>"))

vercel = panel("a-vc", "Team", "", status("partial", "Partial"), "",
  cell("Credit balance", "", value("14.20", "credits", decimals=2), "<b>85.80</b> used of 100.00", bar(86, thin=True, aria="Credits used 85.80 of 100")) +
  cell("Credits used", "lifetime", value("85.80", "credits", decimals=2), "on this gateway key", fact=True) +
  cell("Spend", "last 30 days", value(0, unknown=True), "unknown · the spend report needs a Pro plan", bar(unknown=True, aria="Spend last 30 days unknown")),
  more=details("a-vc", False, caps=[("credits", "available", "official", "validated"), ("spend.report", "not_authorized", "official", "documented")], run="partial · 2 min ago", meta="Observed <b>2 min ago</b> Connector <b>vercel_ai_gateway 0.1.0</b>"))

body = (
  provider("p-cl", "CL", "Claude", claude1 + claude2, 2) +
  provider("p-cx", "CX", "Codex", codex1 + codex2, 2) +
  provider("p-cu", "CU", "Cursor", cursor) +
  provider("p-gk", "GK", "Grok", grok) +
  provider("p-ag", "AG", "Antigravity", anti) +
  provider("p-cp", "GH", "Copilot", copilot) +
  provider("p-vc", "VC", "Vercel AI Gateway", vercel)
)

key = '''  <footer class="key">
    <span><span class="sw"></span>used share of the window</span>
    <span><span class="sw tick"></span> how far the window has elapsed</span>
    <span><span class="sw warn"></span>from 70%</span>
    <span><span class="sw bad"></span>from 90%</span>
    <span><span class="sw unknown"></span>unknown, not zero</span>
  </footer>
'''
open("d-panels.html", "w").write(head("Headroom · mockup D · panels") + top("<b>9</b> accounts · <b>2</b> need attention") + body + f'  <a class="add" href="#">{I["plus"]}&nbsp; Connect another account</a>\n' + key + FOOT)

# ---------- states page ----------
states = head("Headroom · mockup D · states") + top("States and primitives") + '''  <div class="demo">
    <h2>Status in the panel header</h2>
    <div class="row">''' + status("ok", "2 min ago") + status("retry", "14 min ago · retrying") + status("stale", "Stale · 3 h ago") + status("partial", "Partial") + status("bad", "Reconnect needed · 2 days ago") + status("paused", "Paused · 1 d ago") + status("wait", "Waiting for the first refresh") + '''</div>

    <h2>Buttons</h2>
    <div class="row"><button class="btn primary" type="button">Reconnect</button><button class="btn" type="button">Resume</button><button class="btn quiet" type="button">Details ''' + I["chev"] + '''</button><button class="btn danger" type="button">Disconnect</button><button class="btn" type="button" disabled>Pause</button>
      <button class="btn hold" type="button" style="--p:42%"><span class="face">''' + I["reset"] + '''Hold to reset weekly limit</span><span class="fillface" aria-hidden="true">''' + I["reset"] + '''Hold to reset weekly limit</span></button></div>
    <p class="muted" style="margin:0; font-size:13px">Press scales to 0.97 in 120 ms and releases on the spring. Hover fills apply on fine pointers only. The hold button fills linearly over 1.2 s and rewinds if released early.</p>

    <h2>Loading: skeleton in the final layout</h2>
    <section class="panel" aria-busy="true" aria-label="Loading account">
      <header><div class="sk title"></div><div class="sk line" style="width:96px"></div></header>
      <div class="cells">
        <div class="cell"><div class="sk line" style="width:40%"></div><div class="sk big"></div><div class="sk bar"></div><div class="sk line" style="width:60%"></div></div>
        <div class="cell"><div class="sk line" style="width:40%"></div><div class="sk big"></div><div class="sk bar"></div><div class="sk line" style="width:60%"></div></div>
        <div class="cell"><div class="sk line" style="width:40%"></div><div class="sk big"></div><div class="sk bar"></div><div class="sk line" style="width:60%"></div></div>
      </div>
    </section>

    <h2>Never collected</h2>
''' + panel("s-wait", "Personal", "Pro", status("wait", "Waiting for the first refresh"), chips("private"),
      '        <div class="cell"><div class="sk line" style="width:40%"></div><div class="sk big"></div><div class="sk bar"></div><div class="sk line" style="width:60%"></div></div>\n        <div class="cell"><div class="sk line" style="width:40%"></div><div class="sk big"></div><div class="sk bar"></div><div class="sk line" style="width:60%"></div></div>\n',
      notice=notice("neutral", "clock", "Connected just now. The first refresh is running.", "")) + '''
    <h2>List failed</h2>
''' + notice("bad", "alert", "Headroom could not load your accounts. Check that the server is running and try again.", '<button class="btn sm" type="button">Try again</button>') + '''
    <h2>Empty</h2>
    <section class="panel">
      <div class="empty">
        <div class="tile">''' + I["plug"] + '''</div>
        <h2>No accounts connected</h2>
        <p>Connect a provider account and its limits, balances and resets appear here within a minute.</p>
        <div class="actions"><button class="btn primary" type="button">Connect an account</button></div>
        <p class="providers">Claude · Codex · Cursor · Copilot · Grok · Antigravity · Vercel AI Gateway</p>
      </div>
    </section>

    <h2>Over the limit</h2>
    <section class="panel">
      <div class="cells">
''' + cell("Weekly", "7 days", value(112, "%"), "<b>12%</b> over · resets in <b>1d 6h</b>", bar(100, 82, tone="bad", limit=89, aria="Weekly usage 112%, over the limit")) + cell("Included", "15 Sep to 15 Oct", value(58, "%"), "<b>$20</b> plan · <b>13 d</b> left", bar(58, 57, segs=[(40, "s1"), (18, "s2")], aria="Included usage 58%"), legend([("s1", "API", "40%"), ("s2", "Auto", "18%"), ("free", "Free", "42%")])) + '''      </div>
    </section>
  </div>
''' + FOOT
open("d-states.html", "w").write(states)
print("ok")
