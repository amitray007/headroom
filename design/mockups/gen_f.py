# Mockup F: built from the real connections on localhost:18600 (2026-10-02). Values rounded; no identifiers.
import re, pathlib
CSS = pathlib.Path("f.css").read_text()
JS = pathlib.Path("f.js").read_text()

def icon_svg(name, mono):
    s = pathlib.Path(f"icons/{name}.svg").read_text()
    s = re.sub(r"<\?xml[^>]*\?>", "", s); s = re.sub(r"<!--.*?-->", "", s, flags=re.S)
    s = re.sub(r'\s(width|height)="[^"]*"', "", s, count=2)
    if mono:
        s = re.sub(r'fill="(#000|#000000|black|#0A0A0A|#0a0a0a)"', 'fill="currentColor"', s)
        s = re.sub(r"fill:\s*#[0-9a-fA-F]{3,6};", "fill: currentColor;", s)
        if 'fill="currentColor"' not in s and "fill: currentColor" not in s:
            s = s.replace("<svg ", '<svg fill="currentColor" ', 1)
    if 'aria-hidden' not in s: s = s.replace("<svg ", '<svg aria-hidden="true" focusable="false" ', 1)
    return s.strip()
BRAND = {k: icon_svg(k, m) for k, m in [("claude", False), ("codex", True), ("cursor", True), ("copilot", True), ("grok", True), ("antigravity", False), ("vercel_ai_gateway", True)]}
AVATAR = icon_svg("avatar", False)
def ic(d): return f'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{d}</svg>'
I = {
 "clock": ic('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
 "pause": ic('<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>'),
 "alert": ic('<circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/>'),
 "partial": ic('<circle cx="12" cy="12" r="9" stroke-dasharray="4.2 3.2"/>'),
 "retry": ic('<path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/>'),
 "reset": ic('<path d="M3 12a9 9 0 1 0 2.6-6.4"/><path d="M3 3v6h6"/>'),
 "plus": ic('<path d="M12 5v14M5 12h14"/>'),
 "plug": ic('<path d="M12 22v-5M9 8V2M15 8V2M6 8h12v5a6 6 0 0 1-12 0V8z"/>'),
 "key": ic('<circle cx="8" cy="15" r="4"/><path d="m10.9 12.1 9.1-9.1M15 7l3 3"/>'),
 "out": ic('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>'),
 "ext": ic('<path d="M14 4h6v6M20 4l-9 9M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/>'),
 "copy": ic('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>'),
 "check": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 5 5 9-10"/></svg>',
 "terminal": ic('<path d="m4 17 6-6-6-6M12 19h8"/>'),
 "link": ic('<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.5 1.5"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7L12 19"/>'),
 "hash": ic('<path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18"/>'),
 "sparkle": ic('<path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.2 2.2M16.2 16.2l2.2 2.2M5.6 18.4l2.2-2.2M16.2 7.8l2.2-2.2"/>'),
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
<script>const s=new URLSearchParams(location.search).get("scheme");if(s)document.documentElement.style.colorScheme=s;
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

def top(page="panels"):
    link = '<a class="btn" href="f-connect.html">Connect an Account</a>' if page != "connect" else '<a class="btn" href="f-panels.html">Back to Accounts</a>'
    return f'''  <header class="top">
    <a class="lockup" href="f-panels.html">{LOGO}Headroom</a>
    <nav aria-label="Page">{link}
      <span class="menu-anchor"><button class="avatar" type="button" aria-label="Account Menu" aria-haspopup="menu" aria-expanded="false" aria-controls="account-menu">{AVATAR}</button>
        <div class="menu" id="account-menu" role="menu">
          <div class="who">Signed in as<b>maverick</b></div>
          <div class="theme"><span>Appearance</span><span class="seg" role="group" aria-label="Appearance"><button type="button" data-scheme="system" aria-pressed="true">System</button><button type="button" data-scheme="light" aria-pressed="false">Light</button><button type="button" data-scheme="dark" aria-pressed="false">Dark</button></span></div>
          <a class="item" role="menuitem" href="#">{I["key"]}Passkeys and Password</a>
          <button class="item danger" role="menuitem" type="button">{I["out"]}Sign Out</button>
        </div></span></nav>
  </header>
'''

def value(v, unit="", of=None, decimals=0, prefix="", unknown=False):
    if unknown: return '<div class="value unknown" aria-hidden="true">—</div>'
    num = f'<span class="num" data-count="{v}" data-decimals="{decimals}" data-prefix="{prefix}">{prefix}{v}</span>'
    u = f'<span class="unit">{unit}</span>' if unit else ""
    o = f'<span class="of">{of}</span>' if of else ""
    return f'<div class="value">{num}{u}{o}</div>'

def tone_of(used):
    if used is None: return ""
    return "bad" if used >= 90 else ("warn" if used >= 70 else "good")

def tone_word(used):
    t = tone_of(used)
    return {"good": "", "warn": '<span class="tone warn">Running Low</span> · ', "bad": '<span class="tone bad">Almost Out</span> · '}.get(t, "")

def bar(v=None, thin=False, segs=None, unknown=False, aria="", limit=None, neutral=False):
    tone = "neutral" if neutral else tone_of(v)
    cls = "bar" + (f" {tone}" if tone else "") + (" thin" if thin else "") + (" unknown" if unknown else "") + (" hatch" if limit else "")
    style = []
    if v is not None: style.append(f"--v:{min(v,100)}%")
    if limit is not None: style.append(f"--limit:{limit}%")
    inner = "" if unknown else ("".join(f'<span class="seg {c}" style="--x:{x}%; --w:{w}%"></span>' for x, w, c in segs) if segs else '<span class="fill"></span>')
    a = f' role="meter" aria-valuenow="{v}" aria-valuemin="0" aria-valuemax="100" aria-label="{aria}"' if (v is not None and not unknown) else f' aria-label="{aria}"'
    return f'<div class="{cls}"{a} style="{"; ".join(style)}">{inner}</div>'

def cell(label, window, val, caption, b=None, fact=False, key=None, extra=""):
    w = f' <span class="window">{window}</span>' if window else ""
    k = f' data-key="{key}"' if key else ""
    return f'''      <div class="cell{" fact" if fact else ""}"{k}>
        <div class="label"><span>{label}</span>{w}</div>
        {val}
        {b or ""}
        <div class="caption">{caption}</div>
        {extra}
      </div>
'''

def meter(label, window, used, caption, key=None, decimals=0):
    v = round(used, decimals) if decimals else int(round(used))
    return cell(label, window, value(v, "%", decimals=decimals), tone_word(used) + caption, bar(used, aria=f"{label} {v}% used"), key=key)

def status(kind, text):
    if kind == "ok": return f'<span class="status-slot"><span class="status"><span class="dot"></span><span class="age">{text}</span></span></span>'
    icon = {"retry": I["retry"], "stale": I["clock"], "partial": I["partial"], "bad": I["alert"], "paused": I["pause"], "wait": I["clock"]}[kind]
    tone = {"retry": "neutral", "stale": "warn", "partial": "warn", "bad": "bad", "paused": "quiet", "wait": "quiet"}[kind]
    return f'<span class="status-slot"><span class="pill {tone}">{icon}{text}</span></span>'

def chip(text, title=None):
    t = f' title="{title}"' if title else ""
    return f'<span class="chip"{t}>{text}</span>'

def acts(paused=False):
    return f'''        <span class="acts">
          <button class="btn quiet sm" type="button" data-act="refresh"><span class="label">Refresh</span></button>
          <button class="btn quiet sm" type="button" data-act="pause"><span class="label">{"Resume" if paused else "Pause"}</span></button>
          <button class="btn quiet sm danger" type="button" data-act="disconnect"><span class="label">Disconnect</span></button>
        </span>
'''

def hold(state="idle", sm=True, outcome=None):
    label = {"idle": "Hold to Reset Weekly Limit", "off": "Hold to Reset Weekly Limit", "holding": "Hold to Reset Weekly Limit", "requesting": "Resetting", "ok": "Weekly Limit Reset", "failed": "Reset Failed · Hold to Try Again"}[state]
    cls = "btn hold" + (" sm" if sm else "") + {"idle": "", "off": " off", "holding": " holding", "requesting": " done", "ok": " done good", "failed": " failed"}[state]
    icon = {"requesting": '<span class="spin" aria-hidden="true"></span>', "ok": I["check"]}.get(state, I["reset"])
    attrs = ' disabled title="Account actions are switched off in Settings."' if state == "off" else (' disabled' if state in ("requesting", "ok") else "")
    attrs += f' data-outcome="{outcome}"' if outcome else ""
    style = ' style="--p:42%"' if state == "holding" else ""
    return f'<button class="{cls}" type="button" aria-describedby="hold-hint"{attrs}{style}><span class="face">{icon}<span class="label">{label}</span></span><span class="fillface" aria-hidden="true">{I["reset"]}{label}</span></button>'

def panel(id_, name, plan, st, right, cells, facts="", notice="", dim=False, paused=False, actions=True):
    plan_html = f' <span class="plan">{plan}</span>' if plan else ""
    row = f'      <div class="facts">\n{facts}{acts(paused) if actions else ""}      </div>\n' if (facts or actions) else ""
    cls = "panel" + (" dim" if dim else "") + (" paused" if paused else "")
    return f'''    <div class="collapse"><section class="{cls}" aria-labelledby="{id_}">
      <header>
        <h3 id="{id_}">{name}{plan_html}</h3>
        <div class="right">{st}{right}</div>
      </header>
{notice}      <div class="cells">
{cells}      </div>
{row}    </section></div>
'''

def provider(id_, key, name, panels, count=1):
    c = f'<span class="chip count">{count} Accounts</span>' if count > 1 else '<span class="count"></span>'
    return f'''  <div class="collapse"><section class="provider" data-accent="{key}" aria-labelledby="{id_}">
    <header><span class="brand">{BRAND[key]}</span><h2 id="{id_}">{name}</h2>{c}</header>
    <div class="stack">
{panels}    </div>
  </section></div>

'''

def notice(tone, icon, text, action=""):
    return f'      <div class="notice {tone}"><span class="text">{I[icon]}{text}</span>{action}</div>\n'

HOLD_HINT = '<span id="hold-hint" class="sr">Press and hold for 1.2 seconds to confirm. With a keyboard, hold Space or Enter.</span>'
kv = lambda k, v: f'        <span class="kv">{k} <b>{v}</b></span>\n'

# ---------- accounts page: the seven real connections ----------
claude = panel("a-claude", "Personal", "Max", status("ok", "12 min ago"), "",
  meter("Session", "5 hours", 49, "Resets in <b>1 h 12 min</b>") +
  meter("Weekly", "all models", 78, "Resets in <b>52 min</b>") +
  meter("Weekly", "Fable", 91, "Resets in <b>52 min</b>"),
  facts=f'        <span class="kv">Reset Grants <span class="pips" aria-label="0 available"><span class="pip spent"></span></span> <b>0</b></span>\n')

codex_personal = panel("a-codex", "Personal", "Pro", status("ok", "12 min ago"), "",
  meter("Weekly", "7 days", 23, "Resets in <b>5 d 18 h</b>", key="weekly") +
  cell("Credits", "balance", value(61068, "credits"), "Not time-bound", fact=True) +
  cell("Reset Credits", "banked", value(3, "", of="full resets"), 'First expires in <b>2 d 16 h</b> <span class="pips" aria-hidden="true" style="margin-left:6px"><span class="pip"></span><span class="pip"></span><span class="pip"></span></span>', fact=True, key="resets",
       extra=f'<div style="margin-top:4px">{hold("off")}{HOLD_HINT}</div>'))

# A second Codex account is synthetic: it shows how several accounts under one provider read.
codex_work = panel("a-codex-2", "Work", "Business", status("paused", "Paused"), chip("Member"),
  meter("Weekly", "7 days", 12, "Resets in <b>1 d 6 h</b> · as of yesterday"),
  notice=notice("neutral", "pause", "Paused. Headroom is not refreshing this account.", '<button class="btn sm" type="button">Resume</button>'), paused=True)

cursor = panel("a-cursor", "Personal", "Pro", status("ok", "12 min ago"), "",
  meter("Included", "$20 plan", 17.02, "<b>24 d</b> left in the cycle", decimals=0) +
  meter("Auto Pool", "billing cycle", 19.02, "Resets with the cycle") +
  meter("API Pool", "billing cycle", 6.48, "Resets with the cycle"),
  facts=kv("On-Demand Spend", "$0.00") + kv("Cycle", "Sep 26 to Oct 26"))

grok = panel("a-grok", "Personal", "X Premium", status("ok", "7 min ago"), "",
  meter("Weekly Pool", "7 days", 0, "Resets in <b>6 d 17 h</b>"),
  facts=kv("On-Demand", "Off") + kv("Prepaid Balance", "0 credits"))

anti = panel("a-ag", "Personal", "Starter", status("ok", "1 min ago"), "",
  meter("Gemini", "weekly", 0, "Resets in <b>7 d</b>") +
  meter("Claude and GPT", "weekly", 0, "Resets in <b>7 d</b>"))

copilot = panel("a-copilot", "Personal", "Pro", status("ok", "7 min ago"), "",
  meter("AI Credits", "monthly", 0.8, "Resets <b>Nov 1</b>", decimals=1),
  facts=kv("Credits Used", "1") + kv("Extra Usage", "0") + kv("Chat", "Unlimited") + kv("Completions", "Unlimited"))

vercel = panel("a-vercel", "Team", "", status("partial", "Partial"), chip("Spend Not Available", "This key cannot read the spend report. It needs a Pro plan."),
  cell("Credit Balance", "", value("4.99", "credits", decimals=2), "<b>0.01</b> used of 5.00", bar(0.2, thin=True, aria="Credits used 0.01 of 5.00")) +
  cell("Credits Used", "lifetime", value("0.01", "credits", decimals=2), "On this gateway key", fact=True))

body = (
  provider("p-claude", "claude", "Claude", claude) +
  provider("p-codex", "codex", "Codex", codex_personal + codex_work, 2) +
  provider("p-cursor", "cursor", "Cursor", cursor) +
  provider("p-grok", "grok", "Grok", grok) +
  provider("p-ag", "antigravity", "Antigravity", anti) +
  provider("p-copilot", "copilot", "Copilot", copilot) +
  provider("p-vercel", "vercel_ai_gateway", "Vercel AI Gateway", vercel)
)
summary = f'''  <p class="summary"><span class="tone bad">{I["alert"].replace('aria-hidden="true"', 'aria-hidden="true" style="width:16px;height:16px;vertical-align:-3px"')} Claude is almost out of its weekly Fable limit</span> · resets in 52 min. Everything else has room. Updated <b>1 to 12 min ago</b>.</p>
'''
key = '''  <footer class="key">
    <span><span class="sw"></span>Room left</span>
    <span><span class="sw warn"></span>Running low, under 30% left</span>
    <span><span class="sw bad"></span>Almost out, under 10% left</span>
    <span><span class="sw unknown"></span>Not reported yet</span>
  </footer>
'''
pathlib.Path("f-panels.html").write_text(head("Headroom · mockup F · accounts") + top() + summary + body + f'  <a class="add" href="f-connect.html">{I["plus"]} Connect Another Account</a>\n' + key + FOOT)

# ---------- states ----------
sk = '<div class="cell"><div class="sk line" style="width:40%"></div><div class="sk big"></div><div class="sk bar"></div><div class="sk line" style="width:60%"></div></div>'
states = head("Headroom · mockup F · states") + top() + f'''  <div class="demo">
    <h2>Status in the Panel Header</h2>
    <div class="row">{status("ok", "2 min ago")}{status("retry", "Refresh Failed · Retrying")}{status("stale", "Not Updated for 3 h")}{status("partial", "Partial")}{status("bad", "Reconnect Needed")}{status("paused", "Paused")}{status("wait", "Waiting for First Refresh")}</div>

    <h2>Reset Credit Action States</h2>
    <div class="row">{hold("idle", sm=False)}{hold("holding", sm=False)}{hold("requesting", sm=False)}{hold("ok", sm=False)}{hold("failed", sm=False)}{hold("off", sm=False)}</div>
    <p class="muted" style="margin:0; font-size:13px">Idle, holding, resetting, reset, failed, switched off. The one on the left works; the second from the right fails on purpose.</p>
    <div class="row">{hold("idle", sm=False)}{hold("idle", sm=False, outcome="failed")}{HOLD_HINT}</div>

    <h2>Buttons</h2>
    <div class="row"><button class="btn primary" type="button">Reconnect</button><button class="btn" type="button">Resume</button><button class="btn quiet" type="button">Refresh</button><button class="btn quiet danger" type="button">Disconnect</button><button class="btn" type="button" disabled>Pause</button></div>

    <h2>Trouble</h2>
{panel("s-retry", "Personal", "Max", status("retry", "Refresh Failed · Retrying"), "", meter("Session", "5 hours", 49, "Resets in <b>1 h 12 min</b> · as of 14 min ago") + cell("Weekly", "all models", value(0, unknown=True), "Not reported in the last refresh", bar(unknown=True, aria="Weekly usage not reported")), notice=notice("neutral", "retry", "Headroom could not refresh this account. It will try again in a few minutes."))}
{panel("s-stale", "Personal", "X Premium", status("stale", "Not Updated for 3 h"), "", meter("Weekly Pool", "7 days", 34, "Resets in <b>4 d 11 h</b> · as of 3 h ago"), notice=notice("warn", "clock", "Grok has not answered for 3 hours. The numbers below are from the last good refresh."))}
{panel("s-bad", "Personal", "Pro", status("bad", "Reconnect Needed"), "", meter("AI Credits", "monthly", 100, "Resets <b>Nov 1</b> · as of 2 days ago"), notice=notice("bad", "alert", "The sign-in for this account has expired. Reconnect to keep tracking it.", '<button class="btn primary sm" type="button">Reconnect</button>'), dim=True)}
    <h2>Loading</h2>
    <section class="panel" aria-busy="true" aria-label="Loading account"><header><div class="sk title"></div><div class="sk line" style="width:96px"></div></header><div class="cells">{sk}{sk}{sk}</div></section>
{panel("s-wait", "Personal", "Pro", status("wait", "Waiting for First Refresh"), "", sk + sk, notice=notice("neutral", "clock", "Connected just now. The first refresh is running."), actions=False)}
    <h2>Page Could Not Load</h2>
{notice("bad", "alert", "Headroom could not load your accounts. Check that it is running and try again.", '<button class="btn sm" type="button">Try Again</button>')}
    <h2>Empty</h2>
    <section class="panel"><div class="empty"><div class="tile">{I["plug"]}</div><h2>No Accounts Connected</h2><p>Connect a provider account and its limits, balances and resets appear here within a minute.</p><div class="actions"><a class="btn primary" href="f-connect.html">Connect an Account</a></div></div></section>
    <h2>Over the Limit</h2>
    <section class="panel"><div class="cells">{cell("Weekly", "7 days", value(112, "%"), '<span class="tone bad">Over the Limit</span> · Resets in <b>1 d 6 h</b>', bar(100, aria="Weekly usage 112%, over the limit", limit=89))}</div></section>
  </div>
''' + FOOT
pathlib.Path("f-states.html").write_text(states)

# ---------- connect ----------
def card(key, name, hint, icon, how):
    return f'''    <button class="card" type="button"><span class="head"><span class="brand lg">{BRAND[key]}</span>{name}</span><span class="hint">{hint}</span><span class="meta">{I[icon]}{how}</span></button>
'''
cards = (
  card("claude", "Claude", "Session, weekly and per-model limits, reset grants.", "terminal", "Signs in once through Claude Code") +
  card("codex", "Codex", "Weekly limit, credits, banked resets.", "terminal", "Signs in once through the Codex CLI") +
  card("cursor", "Cursor", "Included allowance, Auto and API pools, on-demand spend.", "link", "Approve in the browser") +
  card("copilot", "Copilot", "Monthly AI credits, extra usage.", "hash", "Enter a code on GitHub") +
  card("grok", "Grok", "Weekly pool, on-demand cap, prepaid balance.", "terminal", "Signs in once through the Grok CLI") +
  card("antigravity", "Antigravity", "Gemini and third-party weekly quotas.", "link", "Paste the redirect after Google sign-in") +
  card("vercel_ai_gateway", "Vercel AI Gateway", "Credit balance and usage. Spend needs a Pro plan.", "key", "Paste a Gateway API key")
)
steps = f'''
  <div class="demo">
    <h2>Step States</h2>
    <section class="panel step"><div class="title"><h2><span class="brand">{BRAND["copilot"]}</span>Copilot</h2>{status("wait", "Waiting for You · 9:42 left")}</div><p class="secondary" style="margin:0">Open GitHub and enter this code. Headroom finishes on its own once GitHub approves.</p><div class="row"><span class="code">WDJB-MJHT<button class="btn sm" type="button" aria-label="Copy Code">{I["copy"]}</button></span><a class="btn primary" href="#">{I["ext"]}Open GitHub</a><button class="btn quiet" type="button">Cancel</button></div></section>
    <section class="panel step"><div class="title"><h2><span class="brand">{BRAND["antigravity"]}</span>Antigravity</h2>{status("wait", "Waiting for Your Input")}</div><p class="secondary" style="margin:0">Sign in with Google, then paste the full address you were sent to.</p><div class="field"><label for="redirect">Redirect Address</label><input id="redirect" type="url" placeholder="http://localhost:…/callback?code=…"></div><div class="row"><button class="btn primary" type="button">Continue</button><button class="btn quiet" type="button">Cancel</button></div></section>
    <section class="panel step"><div class="title"><h2><span class="brand">{BRAND["vercel_ai_gateway"]}</span>Vercel AI Gateway</h2>{status("wait", "Waiting for Your Input")}</div><div class="field"><label for="apikey">Gateway API Key</label><input id="apikey" type="password" placeholder="vck_…"></div><p class="muted" style="margin:0; font-size:13px">The key is encrypted at rest and never shown again.</p><div class="row"><button class="btn primary" type="button">Connect Vercel AI Gateway</button><button class="btn quiet" type="button">Cancel</button></div></section>
    <section class="panel step"><div class="title"><h2><span class="brand">{BRAND["codex"]}</span>Codex</h2><span class="pill neutral"><span class="spin" aria-hidden="true"></span>Checking</span></div><p class="secondary" style="margin:0">Sign-in accepted. Headroom is checking which limits this account reports.</p></section>
    <section class="panel step"><div class="title"><h2><span class="brand">{BRAND["claude"]}</span>Claude</h2><span class="pill" style="--tone: var(--success)">{I["check"]}Connected</span></div><p class="secondary" style="margin:0">Personal · Max is connected. Its first refresh is running.</p><div class="row"><a class="btn primary" href="f-panels.html">Open Your Accounts</a><a class="btn quiet" href="#">Connect Another</a></div></section>
    <section class="panel step"><div class="title"><h2><span class="brand">{BRAND["cursor"]}</span>Cursor</h2><span class="pill bad">{I["alert"]}Did Not Finish</span></div><p class="secondary" style="margin:0">The approval expired before it was confirmed. Start again when you are ready.</p><div class="row"><button class="btn primary" type="button">Try Again</button><button class="btn quiet" type="button">Cancel</button></div></section>
  </div>
'''
connect = head("Headroom · mockup F · connect") + top("connect") + f'''  <div class="intro">
    <h1>Connect an Account</h1>
    <p>Choose a provider. Headroom signs in once, keeps the sign-in encrypted, and refreshes on its own.</p>
  </div>
  <div class="cards">
{cards}  </div>
{steps}''' + FOOT
pathlib.Path("f-connect.html").write_text(connect)
print("pages ok")
