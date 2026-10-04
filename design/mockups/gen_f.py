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
 "gear": ic('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
 "info": ic('<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>'),
 "bell": ic('<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/>'),
 "x": ic('<path d="M18 6 6 18M6 6l12 12"/>'),
 "pencil": ic('<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>'),
 "eye": ic('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
 "fingerprint": ic('<path d="M12 10a2 2 0 0 0-2 2c0 1.5-.5 3.5-1.5 5"/><path d="M14 13.1c0 2.3-.5 4.2-1.2 5.9"/><path d="M17.3 12c0 2.4-.3 4.5-.9 6"/><path d="M6.1 16.8A10 10 0 0 1 5.6 12a6.4 6.4 0 0 1 12.8 0"/><path d="M8.6 9.4A3.4 3.4 0 0 1 12 8.6"/>'),
 "trash": ic('<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>'),
 "user": ic('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>'),
 "play": ic('<path d="M7 5v14l12-7z"/>'),
 "unplug": ic('<path d="M19 5l-3 3M9.5 14.5 5 19M15 12l-3 3M12 9l3-3M9 12l3 3"/><path d="M7 11.5 12.5 17a3 3 0 0 0 4.2-4.2L11 7.3A3 3 0 0 0 7 11.5z"/>'),
 "dots": ic('<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>'),
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

SETTINGS = f'''  <dialog class="dlg settings" id="settings" aria-labelledby="set-title">
    <div class="dhead"><h2 id="set-title">Settings</h2><button class="btn quiet sm" type="button" data-close aria-label="Close">{I["x"]}</button></div>
    <div class="dbody">
    <section class="dsec"><div class="dsec-head"><h3>Limits</h3></div>
      <div class="srow"><span class="sbody"><b>Show Limits As</b><span class="muted">Used shows how much of a limit is spent. Left shows what remains.</span></span><span class="seg" role="group" aria-label="Show limits as" data-setting="limits"><button type="button" data-value="used" aria-pressed="true">Used</button><button type="button" data-value="left" aria-pressed="false">Left</button></span></div>
      <div class="srow"><span class="sbody"><b>Running Low Under</b><span class="muted">Bars turn amber below this much left. They turn red under 10%.</span></span><span class="seg" role="group" aria-label="Running low threshold" data-setting="warnAt"><button type="button" data-value="30" aria-pressed="true">30%</button><button type="button" data-value="20" aria-pressed="false">20%</button><button type="button" data-value="15" aria-pressed="false">15%</button></span></div>
    </section>
    <section class="dsec"><div class="dsec-head"><h3>Refresh</h3></div>
      <div class="srow"><span class="sbody"><b>Refresh Every</b><span class="muted">How often Headroom checks each provider. Refresh on a panel still works any time.</span></span><span class="seg" role="group" aria-label="Refresh interval" data-setting="refreshEvery"><button type="button" data-value="5" aria-pressed="true">5 min</button><button type="button" data-value="10" aria-pressed="false">10 min</button><button type="button" data-value="15" aria-pressed="false">15 min</button><button type="button" data-value="30" aria-pressed="false">30 min</button></span></div>
    </section>
    <section class="dsec"><div class="dsec-head"><h3>Time</h3></div>
      <div class="srow"><span class="sbody"><b>Times</b><span class="muted">Countdown says “in 52 min”. Exact says “at 15:06”. Hover shows the other.</span></span><span class="seg" role="group" aria-label="Time wording" data-setting="time"><button type="button" data-value="relative" aria-pressed="true">Countdown</button><button type="button" data-value="exact" aria-pressed="false">Exact</button></span></div>
      <div class="srow"><span class="sbody"><b>Clock</b><span class="muted">How exact times are written.</span></span><span class="seg" role="group" aria-label="Clock format" data-setting="clock"><button type="button" data-value="24" aria-pressed="true">24-Hour</button><button type="button" data-value="12" aria-pressed="false">12-Hour</button></span></div>
    </section>
    <section class="dsec"><div class="dsec-head"><h3>Display</h3></div>
      <div class="srow"><span class="sbody"><b>Density</b><span class="muted">Compact fits more accounts on one screen.</span></span><span class="seg" role="group" aria-label="Density" data-setting="density"><button type="button" data-value="comfortable" aria-pressed="true">Comfortable</button><button type="button" data-value="compact" aria-pressed="false">Compact</button></span></div>
    </section>
    <section class="dsec"><div class="dsec-head"><h3>Account Actions</h3></div>
      <label class="srow"><span class="sbody"><b>Allow Account Actions</b><span class="muted">Lets you redeem Codex reset credits with the hold button. Nothing runs on its own.</span></span><span class="switch"><input type="checkbox" role="switch" data-setting="actions"><span class="track"><span class="thumb"></span></span></span></label>
    </section>
    <section class="dsec"><div class="dsec-head"><h3>Notifications</h3></div>
      <label class="srow"><span class="sbody"><b>Running Low</b><span class="muted">When an account drops under the amber threshold.</span></span><span class="switch"><input type="checkbox" role="switch" data-setting="notifyLow" checked><span class="track"><span class="thumb"></span></span></span></label>
      <label class="srow"><span class="sbody"><b>Expiring Resets</b><span class="muted">A few days before a banked Codex reset expires.</span></span><span class="switch"><input type="checkbox" role="switch" data-setting="notifyResets" checked><span class="track"><span class="thumb"></span></span></span></label>
      <label class="srow"><span class="sbody"><b>Refresh Failures</b><span class="muted">When Headroom cannot refresh an account.</span></span><span class="switch"><input type="checkbox" role="switch" data-setting="notifyFail" checked><span class="track"><span class="thumb"></span></span></span></label>
    </section>
    </div>
  </dialog>
'''

def top(page="panels"):
    link = f'<a class="btn primary" href="f-connect.html">{I["plus"]}Connect an Account</a>' if page != "connect" else '<a class="btn" href="f-panels.html">Back to Accounts</a>'
    return f'''  <header class="top">
    <a class="lockup" href="f-panels.html">{LOGO}Headroom</a>
    <nav aria-label="Page">{link}
      <span class="menu-anchor"><button class="bell" type="button" aria-label="Notifications, 2 unread" aria-haspopup="dialog" aria-expanded="false" aria-controls="notifications">{I["bell"]}<span class="badge num" aria-hidden="true">2</span></button>
        <div class="notif" id="notifications" role="dialog" aria-label="Notifications">
          <div class="nhead"><div><h2>Notifications</h2><p class="nsub">2 updates waiting for you</p></div><button class="btn quiet sm" type="button" data-markall>Mark All Read</button></div>
          <ul class="nlist" role="list">
            <li class="nrow unread" style="--index:0" data-tone="bad"><span class="nicon">{I["alert"]}</span><span class="nbody"><span class="ntitle">Claude Is Almost Out of Its Weekly Fable Limit<span class="ndot"></span></span><span class="ndesc">91% used. Resets in 52 min.</span></span><span class="ntime">12 min</span></li>
            <li class="nrow unread" style="--index:1" data-tone="warn"><span class="nicon">{I["clock"]}</span><span class="nbody"><span class="ntitle">Claude Weekly Limit Is Running Low<span class="ndot"></span></span><span class="ndesc">78% used. Resets in 52 min.</span></span><span class="ntime">12 min</span></li>
            <li class="nrow" style="--index:2" data-tone="info"><span class="nicon">{I["reset"]}</span><span class="nbody"><span class="ntitle">A Codex Reset Expires in 3 Days<span class="ndot"></span></span><span class="ndesc">1 of 3 banked full resets expires Oct 5.</span></span><span class="ntime">1 h</span></li>
          </ul>
          <div class="nfoot"><span class="muted">1 read</span><button class="btn quiet sm" type="button" data-clearread>Clear Read</button></div>
        </div></span>
      <span class="menu-anchor"><button class="avatar" type="button" aria-label="Account Menu" aria-haspopup="menu" aria-expanded="false" aria-controls="account-menu">{AVATAR}</button>
        <div class="menu" id="account-menu" role="menu">
          <div class="who">Signed in as<b>alex</b></div>
          <div class="theme"><span class="seg" role="group" aria-label="Appearance"><button type="button" data-scheme="system" aria-pressed="true">System</button><button type="button" data-scheme="light" aria-pressed="false">Light</button><button type="button" data-scheme="dark" aria-pressed="false">Dark</button></span></div>
          <label class="item switchrow"><span class="lbl">{I["eye"]}Hide Details</span><span class="switch"><input type="checkbox" id="privacy" role="switch" checked><span class="track"><span class="thumb"></span></span></span></label>
          <button class="item" role="menuitem" type="button" data-open="settings">{I["gear"]}Settings</button>
          <button class="item" role="menuitem" type="button" data-open="security">{I["user"]}Account</button>
          <button class="item danger" role="menuitem" type="button">{I["out"]}Sign Out</button>
        </div></span></nav>
  </header>
  <dialog class="dlg" id="security" aria-labelledby="sec-title">
    <div class="dhead"><h2 id="sec-title">Account</h2><button class="btn quiet sm" type="button" data-close aria-label="Close">{I["x"]}</button></div>
    <section class="dsec">
      <div class="dsec-head"><h3>Passkeys</h3><button class="btn sm" type="button" data-add-passkey>{I["plus"]}Add Passkey</button></div>
      <ul class="plist" role="list">
        <li><span class="pk">{I["fingerprint"]}</span><span class="pbody"><b>MacBook Touch ID</b><span class="muted">Added Sep 28 · Last used today</span></span><button class="btn quiet sm danger" type="button" data-remove aria-label="Remove MacBook Touch ID">Remove</button></li>
      </ul>
    </section>
    <section class="dsec">
      <div class="dsec-head"><h3>Password</h3></div>
      <form class="pform" data-password>
        <div class="field"><label for="pw-current">Current Password</label><input id="pw-current" type="password" autocomplete="current-password"></div>
        <div class="field"><label for="pw-new">New Password</label><input id="pw-new" type="password" autocomplete="new-password" minlength="12"><span class="muted" style="font-size:12px">At least 12 characters.</span></div>
        <div class="row"><button class="btn primary" type="submit"><span class="label">Change Password</span></button></div>
      </form>
    </section>
  </dialog>
{SETTINGS}'''

def when(text, exact):
    return f'<time class="when" title="{exact}">{text}</time>'

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
    inner = {"good": "", "warn": '<span class="tone warn">Running Low</span> · ', "bad": '<span class="tone bad">Almost Out</span> · '}.get(t, "")
    return f'<span class="tw">{inner}</span>'

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
    html = cell(label, window, value(v, "%", decimals=decimals), tone_word(used) + caption, bar(used, aria=f"{label} {v}% used"), key=key)
    return html.replace('<div class="cell"', f'<div class="cell" data-used="{used}"', 1)

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
          <button class="btn quiet sm" type="button" data-act="pause"><span class="label">{I["play"] if paused else I["pause"]}{"Resume" if paused else "Pause"}</span></button>
          <button class="btn quiet sm" type="button" data-act="refresh"><span class="label">{I["retry"]}Refresh</span></button>
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

def panel(id_, name, plan, st, right, cells, facts="", notice="", dim=False, paused=False, actions=True, who="", since="", lead=""):
    plan_html = f'<span class="plan"><span class="sep" aria-hidden="true">·</span>{plan}</span>' if plan else ""
    ident = f'<div class="ident"><span class="who">{who}</span></div>' if who else ""
    lead_html = f'        <span class="lead">{lead}</span>\n' if lead else ""
    row = f'      <div class="facts">\n{lead_html}{facts}{acts(paused) if actions else ""}      </div>\n' if (facts or actions or lead) else ""
    cls = "panel" + (" dim" if dim else "") + (" paused" if paused else "")
    return f'''    <div class="collapse"><section class="{cls}" aria-labelledby="{id_}">
      <header>
        <div class="titles"><h3 id="{id_}"><span class="name">{name}</span>{plan_html}<button class="rename" type="button" aria-label="Rename this account">{I["pencil"]}</button></h3>{ident}</div>
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
claude = panel("a-claude", "Personal", "Max", status("ok", when("12 min ago", "Today · 14:02")), "", who="alex@example.com", cells=
  meter("Session", "5 hours", 49, "Resets in <b>" + when("1 h 12 min", "Today · 15:26") + "</b>") +
  meter("Weekly", "all models", 78, "Resets in <b>" + when("52 min", "Today · 15:06") + "</b>") +
  meter("Weekly", "Fable", 91, "Resets in <b>" + when("52 min", "Today · 15:06") + "</b>"),
  facts=kv("Reset Grants", "0"))

codex_personal = panel("a-codex", "Personal", "Pro", status("ok", when("12 min ago", "Today · 14:02")), "", who="alex@example.com", cells=
  meter("Weekly", "7 days", 23, "Resets in <b>" + when("5 days 18 h", "Wed, Oct 8 · 08:14") + "</b>", key="weekly") +
  cell("Credits", "balance", value(61068, "credits"), "Not time-bound", fact=True) +
  cell("Reset Credits", "banked", value(3, "", of="full resets"), 'First expires in <b>' + when("2 days 16 h", "Sun, Oct 5 · 06:25") + '</b><span class="info"><button class="infobtn" type="button" aria-label="All reset expiry times" aria-describedby="resets-tip">' + I["info"] + '</button><span class="tip" id="resets-tip" role="tooltip"><b>Banked Resets</b><span>Reset 1 · expires Sunday, Oct 5 at 06:25</span><span>Reset 2 · expires Wed, Oct 22 at 14:39</span><span>Reset 3 · expires Wed, Oct 29 at 13:00</span></span></span>', fact=True, key="resets"),
  lead=hold("off") + HOLD_HINT)

# A second Codex account is synthetic: it shows how several accounts under one provider read.
codex_work = panel("a-codex-2", "Work", "Business", status("paused", "Paused"), "", who="alex@acme.example", cells=
  meter("Weekly", "7 days", 12, "Resets in <b>" + when("1 day 6 h", "Fri, Oct 3 · 20:15") + "</b> · as of " + when("1 day 5 h ago", "Wed, Oct 1 · 09:14")),
  notice=notice("neutral", "pause", "Paused. Headroom is not refreshing this account.", '<button class="btn sm" type="button">Resume</button>'), paused=True)

cursor = panel("a-cursor", "Personal", "Pro", status("ok", when("12 min ago", "Today · 14:02")), "", cells=
  meter("Included", "$20 plan", 17.02, "Cycle ends in <b>" + when("23 days", "Sun, Oct 26 · 10:00") + "</b>", decimals=0) +
  meter("Auto Pool", "billing cycle", 19.02, "Resets with the cycle") +
  meter("API Pool", "billing cycle", 6.48, "Resets with the cycle"),
  facts=kv("On-Demand Spend", "$0.00") + kv("Cycle", when("Sep 26 to Oct 26", "Fri, Sep 26 · 10:00 to Sun, Oct 26 · 10:00")))

grok = panel("a-grok", "Personal", "X Premium", status("ok", when("7 min ago", "Today · 14:07")), "", cells=
  meter("Weekly Pool", "7 days", 0, "Resets in <b>" + when("6 days 17 h", "Thu, Oct 9 · 07:20") + "</b>"),
  facts=kv("On-Demand", "Off") + kv("Prepaid Balance", "0 credits"))

anti = panel("a-ag", "Personal", "Starter", status("ok", when("1 min ago", "Today · 14:13")), "", who="alex@example.com", cells=
  meter("Gemini", "weekly", 0, "Resets in <b>" + when("6 days 23 h", "Thu, Oct 9 · 14:13") + "</b>") +
  meter("Claude and GPT", "weekly", 0, "Resets in <b>" + when("6 days 23 h", "Thu, Oct 9 · 14:13") + "</b>"))

copilot = panel("a-copilot", "Personal", "Pro", status("ok", when("7 min ago", "Today · 14:07")), "", who="alex", cells=
  meter("AI Credits", "monthly", 0.8, "Resets in <b>" + when("29 days", "Sat, Nov 1 · 00:00") + "</b>", decimals=1),
  facts=kv("Credits Used", "1") + kv("Extra Usage", "0") + kv("Chat", "Unlimited") + kv("Completions", "Unlimited"))

vercel = panel("a-vercel", "Team", "", status("ok", when("12 min ago", "Today · 14:02")), "", who="Key ending in 7f3a", cells=
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
summary = ''
# The colour key under the panels was dropped: bar captions already say Running Low / Almost Out.
key = ''
pathlib.Path("f-panels.html").write_text(head("Headroom · mockup F · accounts") + top() + summary + body + f'  <a class="add" href="f-connect.html">{I["plus"]} Connect Another Account</a>\n' + key + FOOT)

# ---------- states ----------
sk = '<div class="cell"><div class="sk line" style="width:40%"></div><div class="sk big"></div><div class="sk bar"></div><div class="sk line" style="width:60%"></div></div>'
states = head("Headroom · mockup F · states") + top() + f'''  <div class="demo">
    <h2>Status in the Panel Header</h2>
    <div class="row">{status("ok", "2 min ago")}{status("retry", "Refresh Failed · Retrying")}{status("stale", "Not Updated for 3 h")}{status("partial", "Partial")}{status("bad", "Disconnected")}{status("paused", "Paused")}{status("wait", "Waiting for First Refresh")}</div>

    <h2>Reset Credit Action States</h2>
    <div class="row">{hold("idle", sm=False)}{hold("holding", sm=False)}{hold("requesting", sm=False)}{hold("ok", sm=False)}{hold("failed", sm=False)}{hold("off", sm=False)}</div>
    <p class="muted" style="margin:0; font-size:13px">Idle, holding, resetting, reset, failed, switched off. The one on the left works; the second from the right fails on purpose.</p>
    <div class="row">{hold("idle", sm=False)}{hold("idle", sm=False, outcome="failed")}{HOLD_HINT}</div>

    <h2>Buttons</h2>
    <div class="row"><button class="btn primary" type="button">Reconnect</button><button class="btn" type="button">Resume</button><button class="btn quiet" type="button">Refresh</button><button class="btn quiet danger" type="button">Disconnect</button><button class="btn" type="button" disabled>Pause</button></div>

    <h2>Trouble</h2>
{panel("s-retry", "Personal", "Max", status("retry", "Refresh Failed · Retrying"), "", meter("Session", "5 hours", 49, "Resets in <b>1 h 12 min</b> · as of 14 min ago") + cell("Weekly", "all models", value(0, unknown=True), "Not reported in the last refresh", bar(unknown=True, aria="Weekly usage not reported")), notice=notice("neutral", "retry", "Headroom could not refresh this account. It will try again in a few minutes."))}
{panel("s-stale", "Personal", "X Premium", status("stale", "Not Updated for 3 h"), "", meter("Weekly Pool", "7 days", 34, "Resets in <b>4 d 11 h</b> · as of 3 h ago"), notice=notice("warn", "clock", "Grok has not answered for 3 hours. The numbers below are from the last good refresh."))}
{panel("s-bad", "Personal", "Pro", status("bad", "Disconnected"), "", meter("AI Credits", "monthly", 100, "Resets in <b>29 days</b> · as of 2 days ago"), notice=notice("bad", "alert", "The sign-in for this account has expired. Reconnect to keep tracking it.", '<button class="btn primary sm" type="button">Reconnect</button>'), dim=True)}
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
# Hold demos on the states page keep their shown state whatever the Account Actions setting is.
states = states.replace('<button class="btn hold', '<button data-demo="1" class="btn hold')
pathlib.Path("f-states.html").write_text(states)

exec(pathlib.Path("connect_part.py").read_text())
pathlib.Path("f-connect.html").write_text(connect)
print("pages ok")
