#!/usr/bin/env python3
"""Build/deploy the Meeting Master (會議大師) LINE rich menu.

Zero push-quota: this only calls the rich-menu / reply-free endpoints, never push.

Usage:
  python3 deploy_richmenu.py            # create + upload image + set as default
  python3 deploy_richmenu.py --force    # deploy even if a v1 menu already exists
  python3 deploy_richmenu.py --list     # list all rich menus
  python3 deploy_richmenu.py --rollback [richMenuId]
                                        # delete that menu (or all v1 menus if omitted)

Token: read from env LINE_CHANNEL_ACCESS_TOKEN, else from ../.env.
LIFF:  if LIFF_ID env/.env is set, the checkin/agenda/create areas use
       https://liff.line.me/<LIFF_ID>/<page>; otherwise they fall back to message
       actions (the webhook replies for free). See TODO markers below.
Tasks: the「任務」area is a POSTBACK (action=aiai_tasks) → Aiai Board tasks,
       independent of LIFF (handled by the webhook, not a LIFF page).
"""
import json, os, sys, urllib.request, urllib.error

API = "https://api.line.me/v2/bot"
DATA_API = "https://api-data.line.me/v2/bot"
MENU_NAME = "meeting-master-main-v1"
HERE = os.path.dirname(os.path.abspath(__file__))
IMG = os.path.join(HERE, "richmenu_main.png")


def load_env():
    """Env vars win; otherwise read ../.env (KEY=VALUE lines)."""
    env = dict(os.environ)
    dotenv = os.path.join(HERE, "..", ".env")
    if os.path.exists(dotenv):
        with open(dotenv, encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                env.setdefault(k.strip(), v.strip())
    return env


ENV = load_env()
TOKEN = ENV.get("LINE_CHANNEL_ACCESS_TOKEN", "").strip()
LIFF_ID = ENV.get("LIFF_ID", "").strip()


def req(method, url, *, data=None, ctype="application/json", parse=True):
    headers = {"Authorization": f"Bearer {TOKEN}"}
    if data is not None:
        headers["Content-Type"] = ctype
    r = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(r, timeout=30) as resp:
            body = resp.read()
    except urllib.error.HTTPError as e:
        raise SystemExit(f"[LINE API] {method} {url} -> {e.code}: {e.read().decode('utf-8', 'replace')}")
    if not parse:
        return body
    return json.loads(body) if body else {}


def liff_or_msg(page, keyword):
    """LIFF URI if configured, else a free message action (webhook replies).
    TODO: once LIFF pages exist, set LIFF_ID and each area routes to
      https://liff.line.me/<LIFF_ID>/{checkin,agenda,create}.
    (Tasks is NOT here — it's a postback handled by the webhook, see build_menu.)"""
    if LIFF_ID:
        return {"type": "uri", "uri": f"https://liff.line.me/{LIFF_ID}/{page}"}
    return {"type": "message", "text": keyword}


# Touch areas — MEASURED to the rendered richmenu_main.png layout (not the
# draft numbers in the task). Header y0–248; Row1 y248–1050 split 2:1 at x1648;
# Row2 y1050–1686 split in three at x841 / x1659. All in-bounds, non-overlapping.
def build_menu():
    return {
        "size": {"width": 2500, "height": 1686},
        "selected": True,
        "name": MENU_NAME,
        "chatBarText": "選單 Menu",
        "areas": [
            {"bounds": {"x": 0,    "y": 248,  "width": 1648, "height": 802},
             "action": {"type": "message", "text": "我的會議"}},                      # Card A
            {"bounds": {"x": 1648, "y": 248,  "width": 852,  "height": 802},
             "action": liff_or_msg("checkin", "報到")},                                # Card B (check-in)
            {"bounds": {"x": 0,    "y": 1050, "width": 841,  "height": 636},
             "action": liff_or_msg("agenda", "議程")},                                 # Agenda
            {"bounds": {"x": 841,  "y": 1050, "width": 818,  "height": 636},
             # Tasks belongs to Aiai Board: a POSTBACK (not LIFF/message) so the
             # webhook resolves LINE userId → email → the user's Aiai Board tasks
             # and replies with a Flex list. See server/aiai-tasks.js.
             "action": {"type": "postback", "data": "action=aiai_tasks", "displayText": "我的任務"}},   # Tasks → Aiai Board
            {"bounds": {"x": 1659, "y": 1050, "width": 841,  "height": 636},
             "action": liff_or_msg("create", "建立會議")},                             # Create
            {"bounds": {"x": 2020, "y": 0,    "width": 480,  "height": 248},
             "action": {"type": "message", "text": "help"}},                           # 說明 pill
        ],
    }


def list_menus():
    return req("GET", f"{API}/richmenu/list").get("richmenus", [])


def cmd_list():
    menus = list_menus()
    if not menus:
        print("(no rich menus)")
        return
    for m in menus:
        print(f"{m['richMenuId']}  name={m.get('name')!r}  bar={m.get('chatBarText')!r}")


def cmd_rollback(menu_id):
    if menu_id:
        ids = [menu_id]
    else:
        ids = [m["richMenuId"] for m in list_menus() if m.get("name") == MENU_NAME]
        if not ids:
            print(f"No menus named {MENU_NAME!r} to roll back.")
            return
    # Clear the default so users don't point at a deleted menu.
    try:
        req("DELETE", f"{API}/user/all/richmenu")
    except SystemExit:
        pass
    for mid in ids:
        req("DELETE", f"{API}/richmenu/{mid}", parse=False)
        print(f"deleted {mid}")


def cmd_deploy(force):
    if not os.path.exists(IMG):
        raise SystemExit(f"Image not found: {IMG} (render richmenu_main.png first)")
    existing = [m for m in list_menus() if m.get("name") == MENU_NAME]
    if existing and not force:
        print(f"⚠ A menu named {MENU_NAME!r} already exists:")
        for m in existing:
            print(f"    {m['richMenuId']}")
        print("Re-run with --force to add a new one, or --rollback to remove the old one first.")
        return
    menu = build_menu()
    rid = req("POST", f"{API}/richmenu", data=json.dumps(menu).encode())["richMenuId"]
    print(f"created richMenuId = {rid}")
    with open(IMG, "rb") as fh:
        req("POST", f"{DATA_API}/richmenu/{rid}/content", data=fh.read(), ctype="image/png", parse=False)
    print("image uploaded")
    req("POST", f"{API}/user/all/richmenu/{rid}", parse=False)
    print("set as default for all users ✓")
    print(f"\nDone. richMenuId: {rid}")
    print(f"Rollback: python3 {os.path.basename(__file__)} --rollback {rid}")
    if not LIFF_ID:
        print("NOTE: LIFF_ID unset — check-in/agenda/tasks/create use message actions (webhook replies).")


def main():
    if not TOKEN:
        raise SystemExit("LINE_CHANNEL_ACCESS_TOKEN not set (env or ../.env).")
    args = sys.argv[1:]
    if "--list" in args:
        cmd_list()
    elif "--rollback" in args:
        rest = [a for a in args if a != "--rollback"]
        cmd_rollback(rest[0] if rest else None)
    else:
        cmd_deploy(force="--force" in args)


if __name__ == "__main__":
    main()
