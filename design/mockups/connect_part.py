# Connect page: a working mock flow. Executed inside gen_f.py, which provides BRAND, I, head, top, FOOT.
PROVIDERS = [
  ("claude", "Claude", "", "terminal", "Sign In", "cli"),
  ("codex", "Codex", "", "terminal", "Sign In", "cli"),
  ("cursor", "Cursor", "", "link", "Approve in Browser", "approve"),
  ("copilot", "Copilot", "", "hash", "Enter Code", "code"),
  ("grok", "Grok", "", "terminal", "Sign In", "cli"),
  ("antigravity", "Antigravity", "", "link", "Paste Redirect", "paste"),
  ("vercel_ai_gateway", "Vercel AI Gateway", "", "key", "API Key", "key"),
]
cards = "".join(
    '    <button class="card" type="button" data-pick="%s" data-flow="%s" data-name="%s"><span class="head"><span class="brand lg">%s</span>%s</span></button>\n'
    % (k, flow, n, BRAND[k], n) for k, n, hint, icon, how, flow in PROVIDERS)
marks = "".join('<template data-mark="%s">%s</template>' % (k, BRAND[k]) for k, *_ in PROVIDERS)
stepper = '''<ol class="stepper" aria-label="Progress">
      <li data-step="1" class="current"><span class="n">1</span>Choose</li>
      <li data-step="2"><span class="n">2</span>Sign In</li>
      <li data-step="3"><span class="n">3</span>Check</li>
      <li data-step="4"><span class="n">4</span>Done</li>
    </ol>'''
flow = '''
  <section class="panel step flow" id="flow" hidden aria-live="polite">
    <div class="title"><h2><span class="brand" data-slot="mark"></span><span data-slot="name">Provider</span></h2><span class="status" data-slot="status"></span></div>
    STEPPER
    <div class="stage" data-stage="cli" hidden>
      <p class="secondary" style="margin:0">Headroom opened the provider's sign-in page in a new tab. Finish there; this page updates on its own.</p>
      <div class="row"><a class="btn primary" href="#" data-go="checking">EXT Open the Sign-in Page Again</a><button class="btn" type="button" data-copy>COPY Copy Link</button><button class="btn quiet" type="button" data-cancel>Cancel</button></div>
    </div>
    <div class="stage" data-stage="code" hidden>
      <p class="secondary" style="margin:0">Open GitHub and enter this code. Headroom finishes on its own once GitHub approves.</p>
      <div class="row"><span class="code">WDJB-MJHT<button class="btn sm" type="button" aria-label="Copy Code" data-copy>COPY</button></span><a class="btn primary" href="#" data-go="checking">EXT Open GitHub</a><button class="btn quiet" type="button" data-cancel>Cancel</button></div>
    </div>
    <div class="stage" data-stage="approve" hidden>
      <p class="secondary" style="margin:0">A Cursor tab opened. Approve Headroom there; this page updates on its own.</p>
      <div class="row"><a class="btn primary" href="#" data-go="checking">EXT Open the Approval Page Again</a><button class="btn quiet" type="button" data-cancel>Cancel</button></div>
    </div>
    <div class="stage" data-stage="paste" hidden>
      <p class="secondary" style="margin:0">Sign in with Google in the tab that opened. When it lands on a page that will not load, copy its address and paste it here.</p>
      <div class="field"><label for="redirect">Address You Landed On</label><input id="redirect" type="url" placeholder="http://localhost:…/callback?code=…"></div>
      <div class="row"><button class="btn primary" type="button" data-go="checking">Continue</button><a class="btn" href="#">EXT Open Google Sign-in Again</a><button class="btn quiet" type="button" data-cancel>Cancel</button></div>
    </div>
    <div class="stage" data-stage="key" hidden>
      <div class="field"><label for="apikey">Gateway API Key</label><input id="apikey" type="password" placeholder="vck_…"></div>
      <p class="muted" style="margin:0; font-size:13px">The key is encrypted at rest and never shown again.</p>
      <div class="row"><button class="btn primary" type="button" data-go="checking">Connect</button><button class="btn quiet" type="button" data-cancel>Cancel</button></div>
    </div>
    <div class="stage" data-stage="checking" hidden>
      <p class="secondary" style="margin:0">Sign-in accepted. Headroom is checking which limits this account reports.</p>
      <div class="sk bar" style="width:40%"></div>
    </div>
    <div class="stage" data-stage="success" hidden>
      <div class="result"><span class="ok">CHECK</span><div><b>Connected</b><p class="secondary" style="margin:2px 0 0"><span data-slot="account">Personal · Max</span> is connected. Its first refresh is running and the account appears on your page within a minute.</p></div></div>
      <div class="row"><a class="btn primary" href="f-panels.html">Open Your Accounts</a><button class="btn quiet" type="button" data-reset>Connect Another</button></div>
    </div>
    <div class="stage" data-stage="failure" hidden>
      <div class="result"><span class="ok bad">ALERT</span><div><b>Did Not Finish</b><p class="secondary" style="margin:2px 0 0" data-slot="reason">The approval expired before it was confirmed. Nothing was saved.</p></div></div>
      <div class="row"><button class="btn primary" type="button" data-retry>Try Again</button><button class="btn quiet" type="button" data-reset>Choose Another Provider</button></div>
    </div>
    <div class="demo-bar"><span class="muted">Mockup only · simulate the provider:</span><button class="btn sm" type="button" data-sim="success">Approve</button><button class="btn sm" type="button" data-sim="expired">Let It Expire</button><button class="btn sm" type="button" data-sim="rejected">Reject the Sign-in</button><button class="btn sm" type="button" data-sim="duplicate">Already Connected</button></div>
  </section>
'''.replace("STEPPER", stepper).replace("EXT", I["ext"]).replace("COPY", I["copy"]).replace("CHECK", I["check"]).replace("ALERT", I["alert"])
TABLE_ROWS = [('claude', 'Claude', 'Personal', 'Max', 'alex@example.com', 'ok', '12 min ago'), ('codex', 'Codex', 'Personal', 'Pro', 'alex@example.com', 'ok', '12 min ago'), ('codex', 'Codex', 'Work', 'Business', 'alex@acme.example', 'paused', 'Paused'), ('cursor', 'Cursor', 'Personal', 'Pro', '', 'ok', '12 min ago'), ('grok', 'Grok', 'Personal', 'X Premium', '', 'ok', '7 min ago'), ('antigravity', 'Antigravity', 'Personal', 'Starter', 'alex@example.com', 'ok', '1 min ago'), ('copilot', 'Copilot', 'Personal', 'Pro', 'alex', 'bad', 'Reconnect Needed'), ('vercel_ai_gateway', 'Vercel AI Gateway', 'Team', '', 'Key ending in 7f3a', 'ok', '12 min ago')]

# Limits per account: tightest window (percent used), its name, and when it resets. Paused/stale rows show the last known value dimmed.
ROOM = {
    ("claude", "Personal"): (78, "Weekly", when("Resets in 52 min", "Today · 15:06")),
    ("codex", "Personal"): (23, "5-hour window", when("Resets in 3 h 10 min", "Today · 17:24")),
    ("codex", "Work"): (41, "Weekly", when("Last known 1 day 5 h ago", "Wed, Oct 1 · 09:14")),
    ("cursor", "Personal"): (85, "Included usage", when("Resets in 12 days", "Wed, Oct 15 · 00:00")),
    ("grok", "Personal"): (0, "Weekly", when("Resets in 3 days 9 h", "Mon, Oct 6 · 00:00")),
    ("antigravity", "Personal"): (0, "Weekly", when("Resets in 2 days 9 h", "Sun, Oct 5 · 00:00")),
    ("copilot", "Personal"): (1, "Premium requests", when("Last known 2 days 5 h ago", "Tue, Sep 30 · 08:30")),
    ("vercel_ai_gateway", "Team"): (None, "Balance", "Prepaid, no reset"),
}

def room(key, name, kind):
    used, window, reset = ROOM[(key, name)]
    if used is None:
        return '<td class="troom"><span class="rtop"><span class="rnum">$4.99 left</span><span class="rwin">%s</span></span><span class="rsub">%s</span></td>' % (window, reset)
    left = 100 - used
    dim = kind in ("paused", "bad")
    tone = "neutral" if dim else tone_of(used)
    b = bar(used, thin=True, aria="%s %d%% used" % (window, used), neutral=dim)
    cls = "troom" + (" dim" if dim else "") + (" unused" if used == 0 else "")
    num = '<span class="rnum %s">%d%% left</span>' % (tone, left)
    return '<td class="%s"><span class="rtop">%s<span class="rwin">%s</span></span>%s<span class="rsub">%s</span></td>' % (cls, num, window, b, reset)

def trow(key, prov, name, plan, who, kind, text):
    kinds = {"ok": ("ok", "Active"), "paused": ("paused", "Paused"), "bad": ("bad", "Disconnected"), "retry": ("retry", "Retrying"), "stale": ("stale", "Out of Date")}
    sk, label = kinds.get(kind, ("ok", "Active"))
    st = '<span class="status-slot"><span class="pill good"><span class="dot"></span>Active</span></span>' if kind == "ok" else status(sk, label)
    exact = {"12 min ago": "Today · 14:02", "7 min ago": "Today · 14:07", "1 min ago": "Today · 14:13"}
    last = {"ok": when(text, exact.get(text, "Today")), "paused": when("1 day 5 h ago", "Wed, Oct 1 · 09:14"), "bad": when("2 days 5 h ago", "Tue, Sep 30 · 08:30"), "retry": when("14 min ago", "Today · 14:00"), "stale": when("3 h ago", "Today · 11:05")}.get(kind, text)
    plan_html = ' <span class="plan"><span class="sep" aria-hidden="true">·</span>%s</span>' % plan if plan else ""
    who_html = '<span class="who">%s</span>' % who if who else '<span class="muted">No identity reported</span>'
    inline = ""
    if kind == "bad": inline = '<button class="btn primary sm" type="button">%sReconnect</button>' % I["unplug"]
    elif kind == "paused": inline = '<button class="btn sm" type="button">%sResume</button>' % I["play"]
    menu_id = "rowmenu-%s-%s" % (key, name.lower().replace(" ", "-"))
    if kind == "bad":
        items = ('<button class="item" role="menuitem" type="button">%sRename</button>'
                 '<button class="item danger" role="menuitem" type="button">%sRemove</button>') % (I["pencil"], I["x"])
    else:
        items = ('<button class="item" role="menuitem" type="button">%s%s</button>'
                 '<button class="item" role="menuitem" type="button">%sReconnect</button>'
                 '<button class="item" role="menuitem" type="button">%sRename</button>'
                 '<button class="item danger" role="menuitem" type="button">%sDisconnect</button>') % (I["play"] if kind == "paused" else I["pause"], "Resume" if kind == "paused" else "Pause", I["unplug"], I["pencil"], I["x"])
    more = ('<span class="menu-anchor rowmenu"><button class="btn quiet sm kebab" type="button" aria-label="More actions for %s" aria-haspopup="menu" aria-expanded="false" aria-controls="%s">%s</button>'
            '<div class="menu" role="menu" id="%s" popover="manual">%s</div></span>') % (name, menu_id, I["dots"], menu_id, items)
    return ('      <tr><td class="tname"><span class="name">%s</span>%s<span class="twho">%s</span></td>%s<td class="tstatus">%s</td><td class="tlast">%s</td>'
            '<td class="tacts"><span class="acts">%s%s</span></td></tr>\n') % (name, plan_html, who_html, room(key, name, kind), st, last, inline, more)

def tgroups(rows):
    out, seen = "", []
    for key, prov, *_ in rows:
        if key not in seen: seen.append(key)
    for key in seen:
        group = [r for r in rows if r[0] == key]
        prov = group[0][1]
        count = ' <span class="muted">%d accounts</span>' % len(group) if len(group) > 1 else ""
        out += '      <tbody class="tgroup">\n      <tr class="tgroup-row"><th scope="rowgroup" colspan="5"><span class="brand">%s</span>%s%s</th></tr>\n' % (BRAND[key], prov, count)
        out += "".join(trow(*r) for r in group)
        out += "      </tbody>\n"
    return out

table = '''
  <section class="panel tablecard" aria-labelledby="connected-title">
    <div class="thead-row"><h2 id="connected-title">Connected Accounts</h2><span class="tally" aria-label="8 accounts: 6 active, 1 paused, 1 disconnected"><span class="tally-item"><span class="tdot good"></span>6 Active</span><span class="tally-item"><span class="tdot quiet"></span>1 Paused</span><span class="tally-item"><span class="tdot bad"></span>1 Disconnected</span><span class="tally-sep" aria-hidden="true"></span><span class="tally-item total">8 Accounts</span></span></div>
    <div class="tscroll"><table class="accounts">
      <thead><tr><th scope="col">Account</th><th scope="col">Limits</th><th scope="col">Status</th><th scope="col">Last Refreshed</th><th scope="col"><span class="sr">Actions</span></th></tr></thead>
''' + tgroups(TABLE_ROWS) + '''    </table></div>
  </section>
'''

connect = head("Headroom · mockup F · connect") + top("connect") + '''  <div class="intro">
    <h1>Connect an Account</h1>
    <p>Choose a provider. You sign in once; Headroom refreshes on its own.</p>
  </div>
  <div class="cards" id="cards">
''' + cards + '''  </div>
''' + marks + flow + table + FOOT
