#!/usr/bin/env python3
# Root-only notifier for the SSH login gate. Sends nice Discord embeds (via the
# CO bot) + styled HTML emails (via Brevo SMTP). Called by /usr/local/sbin/ssh-verify.
#   ssh-notify.py code   <code> <who> <ip>
#   ssh-notify.py backup <code> <week>
#   ssh-notify.py alert  <ip>
import sys, json, ssl, smtplib, urllib.request
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from datetime import datetime, timezone

SECRETS = "/home/vpcommunityorganisation/.config/co/secrets.env"
COBOT_ENV = "/home/vpcommunityorganisation/clawd/services/co-discord-bot/.env"
# CO custom emojis (render in embed descriptions + field VALUES only — not titles/footers/field-names)
E_SHIELD = "<:shield:1509040383542431846>"
E_WARN   = "<:warning:1509040360368640151>"
E_ID     = "<:id:1509040427020451840>"
E_SERVER = "<:server:1509040431839576174>"
E_VERIFY = "<:verify:1509040424654864455>"
DISCORD_IDS = ["723199054514749450", "415922272956710912"]
CO_EMAILS = ["dionm@communityorg.co.uk", "evans@communityorg.co.uk"]
PERSONAL_EMAILS = ["dmckew14@outlook.com", "strongevan73@gmail.com"]
SENDER = "USGRP Server <noreply@communityorg.co.uk>"

def envval(path, key):
    try:
        for ln in open(path, encoding="utf-8", errors="ignore"):
            if ln.startswith(key + "="):
                return ln.split("=", 1)[1].strip().strip('"').strip("'")
    except Exception:
        return ""
    return ""

def dm_embed(embed):
    sec = envval(COBOT_ENV, "BOT_WEBHOOK_SECRET")
    if not sec:
        return
    for d in DISCORD_IDS:
        try:
            body = json.dumps({"discord_id": d, "embed": embed}).encode()
            req = urllib.request.Request("http://127.0.0.1:3017/api/send-dm", data=body,
                headers={"Content-Type": "application/json", "x-bot-secret": sec}, method="POST")
            urllib.request.urlopen(req, timeout=5).read()
        except Exception:
            pass

def send_html(to_list, subject, html):
    user = envval(SECRETS, "BREVO_SMTP_USERNAME"); pw = envval(SECRETS, "BREVO_SMTP_PASSWORD")
    if not user:
        return
    msg = MIMEMultipart("alternative")
    msg["From"] = SENDER; msg["To"] = ", ".join(to_list); msg["Subject"] = subject
    msg.attach(MIMEText(html, "html", "utf-8"))
    try:
        s = smtplib.SMTP("smtp-relay.brevo.com", 587, timeout=10)
        s.ehlo(); s.starttls(context=ssl.create_default_context()); s.login(user, pw)
        s.sendmail("noreply@communityorg.co.uk", to_list, msg.as_string()); s.quit()
    except Exception:
        pass

def shell(title, accent, intro, code, rows, foot):
    rowhtml = "".join(
        f'<tr><td style="padding:4px 14px;color:#8a93a6;font-size:13px;white-space:nowrap">{k}</td>'
        f'<td style="padding:4px 14px;color:#e8ecf3;font-size:13px;font-weight:600">{v}</td></tr>'
        for k, v in rows)
    codeblock = (f'<div style="margin:18px 0;text-align:center"><span style="display:inline-block;'
                 f'font-family:Menlo,Consolas,monospace;font-size:30px;letter-spacing:6px;font-weight:700;'
                 f'color:#fff;background:#0e1422;border:1px solid {accent};border-radius:12px;'
                 f'padding:16px 28px">{code}</span></div>') if code else ""
    return f"""<!doctype html><html><body style="margin:0;background:#06080d;padding:28px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
<div style="max-width:520px;margin:0 auto;background:#11151f;border:1px solid #232a3a;border-radius:16px;overflow:hidden">
  <div style="background:linear-gradient(135deg,#1a2240,#0e1422);padding:20px 24px;border-bottom:2px solid {accent}">
    <div style="color:#c9a14a;font-weight:700;letter-spacing:1px;font-size:13px">USGRP · COMMUNITY ORGANISATION</div>
    <div style="color:#fff;font-size:21px;font-weight:700;margin-top:4px">{title}</div>
  </div>
  <div style="padding:22px 24px">
    <p style="color:#c4ccda;font-size:15px;line-height:1.5;margin:0 0 6px">{intro}</p>
    {codeblock}
    <table style="width:100%;border-collapse:collapse;margin-top:8px">{rowhtml}</table>
    <p style="color:#6b7488;font-size:12px;line-height:1.5;margin:18px 0 0">{foot}</p>
  </div>
  <div style="background:#0c1018;padding:12px 24px;color:#5a6275;font-size:11px">CO · Server Access Monitor · co-prod-01</div>
</div></body></html>"""

now = datetime.now(timezone.utc).isoformat()
cmd = sys.argv[1] if len(sys.argv) > 1 else ""

if cmd == "code":
    code, who, ip = sys.argv[2], sys.argv[3], sys.argv[4]
    dm_embed({
        "title": "🔐 Server access code",
        "description": f"{E_SHIELD} A **new-device SSH login** is waiting on `co-prod-01`.\nType this code in the terminal within **45 seconds** to allow it — ignore it to block.",
        "color": 0xF2A100,
        "fields": [
            {"name": "🔢 Code", "value": f"```{code}```", "inline": False},
            {"name": "👤 Login", "value": f"{E_ID} {who}", "inline": True},
            {"name": "🌐 From", "value": f"`{ip}`", "inline": True},
            {"name": "🖥️ Host", "value": f"{E_SERVER} `co-prod-01`", "inline": True},
        ],
        "footer": {"text": "CO · Server Access · expires in 45s"}, "timestamp": now,
    })
    send_html(CO_EMAILS, f"🔐 Server access code: {code}",
        shell("Server access code", "#f2a100",
              f"A new-device SSH login (<b>{who}</b>) is waiting on <b>co-prod-01</b>. Enter this code in the terminal within 45 seconds to allow it. If it wasn't you, ignore this — the session is blocked.",
              code, [("Login", who), ("From IP", ip), ("Host", "co-prod-01")],
              "This is an automated security check. The code is single-use and expires in 45 seconds."))
elif cmd == "backup":
    code, week = sys.argv[2], sys.argv[3]
    send_html(PERSONAL_EMAILS, f"🔑 Your SSH backup code for the week ({week})",
        shell("Your weekly backup code", "#c9a14a",
              "This is your <b>backup login code</b> for the week. Keep it private. Use it at the co-prod-01 login prompt if the normal one-time code can't reach you (e.g. Discord or CO-email is down).",
              code, [("Week", week), ("Rotates", "automatically next Monday"), ("On use", "you'll both be alerted")],
              "Anyone entering this code gets in, so treat it like a password. It's replaced automatically each week."))
elif cmd == "alert":
    ip = sys.argv[2]
    dm_embed({
        "title": "🚨 Backup code used",
        "description": f"{E_WARN} Your **weekly backup code** was just used to log in from `{ip}` on `co-prod-01`.\nThat code is now **dead** — a fresh one has been emailed to your personal inbox.\nIf that **wasn't you or Evan**, treat the server as compromised and rotate access now.",
        "color": 0xED4245,
        "footer": {"text": "CO · Server Access Monitor"}, "timestamp": now,
    })
    send_html(CO_EMAILS, "🚨 ALERT: SSH backup code used",
        shell("Backup code used", "#ed4245",
              f"Your weekly SSH backup code was just used to log in from <b>{ip}</b> on <b>co-prod-01</b>. If this was not you or Evan, treat the server as compromised and rotate access immediately.",
              "", [("From IP", ip), ("Host", "co-prod-01")],
              "You're getting this because a backup code (not the normal one-time code) was used."))
