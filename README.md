# Meeting Master (會議大師)

Standalone app for the Aiai meeting lifecycle. **Phase 1: the full Before-the-
meeting LINE loop** —

```
LINE push notification → 確認 / 請假 (confirmations / leave) → 議程預覽 + 預填意見
```

1. **發送通知 (compose)** — push a meeting-notice Flex bubble to the LINE OA
   (name · time · location), with deep-link buttons into the participant hub.
2. **與會者 (invite hub)** — staff pick their name, then **confirm attendance**,
   **request leave** (出差 / 時間衝突 / 個人事由 / 其他), or **preview the agenda**
   (opening it marks "read") and **pre-fill comments** per topic
   (無意見 / 有意見 / 提問).
3. **主持人後台 (host dashboard)** — live roster: confirmed / on-leave (+reason) /
   no-reply, agenda-read tracking, pre-filled comments per topic, and a
   "remind unread" push (sent ~1h before the meeting).

**Recurring schedules (🗓 定期排程).** Admins define a weekly or monthly meeting
(e.g. *每月第一個週五 14:00*), pick which staff are notified, and choose how far
ahead to send (1h / 1d / 3d / 1w before). A background scheduler materialises the
meeting and auto-sends the LINE notice to the selected recipients
(`multicast` to bound userIds, `broadcast` as the demo fallback) once per
occurrence. **立即發送** test-fires immediately. Auto-sending is gated by
`SCHEDULER_AUTOSEND` (on by default; set `0` to track windows without sending).

**First-time onboarding (👥 成員).** The first time someone adds the LINE OA, the
webhook `follow` event creates a *pending* member and replies with a welcome
message linking to a registration form that collects **Name / Employee ID /
Email**. On submit the member becomes *registered* and their LINE `userId` is
bound onto any matching roster entry — so targeted `multicast`/reminders reach
real people. The 👥 Members view lists everyone and has a **Simulate new
follower** button to demo the whole flow locally (no tunnel needed).

**Admin maintenance (✏️ 會議內容).** Admins edit a meeting's **agenda topics**
(add / edit / reorder / delete) and **attendee roster** (add / edit / delete) in
the web app. Edits preserve existing participant responses (kept by id).

**Language (中文 / EN).** A header toggle switches the whole UI between
Traditional Chinese and English (persisted in `localStorage`); all dates,
weekdays, recurrence rules and labels localise. Data the admin types (names,
titles) is shown as entered. See `src/i18n.jsx`.

**Inside LINE (LIFF).** Set `LIFF_ID` + `VITE_LIFF_ID` to a LIFF app id and the
notice/registration buttons emit `liff.line.me/...` URLs, so 查看議程 / 確認出席 /
請假申請 (and registration) open **inside LINE**, layered over the chat. The web
app then inits the LIFF SDK, reads the user's profile, resolves them to their
registered member, and skips the name-picker. With no `LIFF_ID` it falls back to
plain https links (LINE's in-app browser) and the name-picker — so the demo runs
unchanged in a normal browser. See `src/liff.js` and `server/line.js#deepLink`.

A LINE webhook (`/api/line/webhook`) is wired for real postback/follow events
(needs a public https tunnel + `LINE_CHANNEL_SECRET` to receive from LINE).

> The *during-meeting* QR check-in lives in the sibling `meeting-checkin/` app.
> Meeting Master will fold the full lifecycle (notice → leave → check-in →
> minutes → tracking) in over time.

## Run

```bash
npm install
npm run dev
```

- Web: http://localhost:5273
- API: http://localhost:8899 (proxied at `/api`)

## Config

Set the LINE channel token in `.env` (gitignored — see `.env.example`):

```
LINE_CHANNEL_ACCESS_TOKEN=...
LINE_TEST_USER_ID=        # optional, for "push" mode instead of broadcast
```

## App views (routed by `?view=`)

| URL                                          | View              |
| -------------------------------------------- | ----------------- |
| `/?view=compose`                             | Send notice       |
| `/?view=schedules`                           | Recurring schedules |
| `/?view=manage&m=M202607`                    | Maintain agenda + roster |
| `/?view=members`                             | Member directory + onboarding |
| `/?view=register&u=<lineUserId>`             | New-follower registration form |
| `/?view=host&m=M202607`                      | Host dashboard    |
| `/?view=invite&m=M202607`                    | Participant hub   |
| `/?view=invite&m=M202607&intent=agenda`      | …opened on agenda |

## API

| Method | Path                                              | Purpose                          |
| ------ | ------------------------------------------------- | -------------------------------- |
| GET    | `/api/line/status`                                | OA profile + quota               |
| POST   | `/api/line/notice/preview`                        | Build Flex payload (no send)     |
| GET    | `/api/meetings/:id`                               | Meeting + topics + roster        |
| POST   | `/api/meetings`                                   | Create / upsert meeting          |
| GET    | `/api/meetings/:id/responses`                     | Dashboard: roster + responses    |
| POST   | `/api/meetings/:id/notify`                        | Push notice `{ mode, to? }`      |
| POST   | `/api/meetings/:id/remind-unread`                 | Remind agenda-unread             |
| GET    | `/api/meetings/:id/participant/:pid`              | One participant's state          |
| POST   | `/api/meetings/:id/participant/:pid/rsvp`         | `{ value:yes\|leave, leaveReason }` |
| POST   | `/api/meetings/:id/participant/:pid/agenda-read`  | Mark agenda read                 |
| POST   | `/api/meetings/:id/participant/:pid/comments`     | `{ topicId, stance, text }`      |
| GET    | `/api/schedules`                                  | List recurring schedules         |
| POST   | `/api/schedules`                                  | Create a schedule                |
| PATCH  | `/api/schedules/:id`                              | Edit / enable / disable          |
| DELETE | `/api/schedules/:id`                              | Delete a schedule                |
| POST   | `/api/schedules/:id/run-now`                      | Test-fire: materialise + send    |
| POST   | `/api/line/webhook`                               | Inbound LINE events              |

`mode` is `broadcast` (all OA followers) or `push` (one `userId`). Broadcasting
consumes the OA's monthly quota, so the UI lets you preview before sending.
Set `PUBLIC_BASE_URL` (https) so the notice buttons deep-link correctly.

## Project layout

```
src/App.jsx                    # query-param router + header/nav
src/ui.js                      # shared inline styles
src/api.js                     # fetch client over /api
src/components/Compose.jsx     # notice composer + LINE bubble preview
src/components/HostDashboard.jsx # roster, agenda-read, comment roll-up
src/components/Invite.jsx      # participant hub: confirm / leave / agenda
src/components/BubblePreview.jsx
server/index.js                # Express API + .env loader + routes + webhook
server/line.js                 # Messaging API + Flex builder + signature verify
server/store.js                # in-memory store + seeded mock meeting
vite.config.js                 # dev :5273, /api proxy → :8899
```

## LINE Rich Menu (選單)

A tappable menu on the LINE OA so users self-serve via **free** message replies / LIFF
instead of push quota (rich-menu + reply APIs cost **zero** of the 200/mo push budget).

Files live in [`richmenu/`](richmenu/):
- `render.html` — the "dark violet bento" design (HTML/CSS).
- `richmenu_main.png` — the rendered image, **2500×1686**, < 1 MB.
- `deploy_richmenu.py` — create / upload / set-default / list / rollback (stdlib only).

### Regenerate the image
```bash
cd richmenu
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
  --window-size=2500,1686 --screenshot=richmenu_main.png "file://$PWD/render.html"
```
Edit `render.html` to change the design; the size must stay exactly 2500×1686.

### Deploy / redeploy
```bash
cd richmenu
python3 deploy_richmenu.py          # create menu + upload image + set as default
python3 deploy_richmenu.py --force  # deploy again even if a v1 menu already exists
```
Reads `LINE_CHANNEL_ACCESS_TOKEN` from the env or `../.env`. It **warns** (and stops)
if a menu named `meeting-master-main-v1` already exists — use `--force` to add anyway,
or roll back the old one first. Nothing here sends a push message.

### List / rollback
```bash
python3 deploy_richmenu.py --list                 # list all rich menus + ids
python3 deploy_richmenu.py --rollback <richMenuId> # delete that menu
python3 deploy_richmenu.py --rollback              # delete ALL meeting-master-main-v1 menus + clear default
```

### Swap message actions → LIFF
Today the check-in / agenda / tasks / create buttons use **message actions**
(報到 / 議程 / 任務 / 建立會議) — the webhook replies to each for free. When the LIFF
pages exist, set `LIFF_ID=<your-liff-id>` in `.env` and redeploy — `deploy_richmenu.py`
then routes those four areas to `https://liff.line.me/<LIFF_ID>/{checkin,agenda,tasks,create}`
automatically (see `liff_or_msg()` + the TODO markers). "我的會議" and "說明/help" stay
message actions. The image doesn't change.

Touch areas are matched to the rendered layout: header `y0–248` (help pill top-right),
row 1 `y248–1050` split 2:1 at `x1648` (我的會議 | 報到), row 2 `y1050–1686` split in
three at `x841` / `x1659` (議程 | 任務 | 建立會議).

> Note: the backend is **Node/Express** (not FastAPI); `deploy_richmenu.py` is a
> standalone ops script that talks to the LINE API directly, so it needs no backend deps.

## Next (from the mockup, not built yet)

- During: QR check-in, meeting timer, voice upload → AI minutes, Indonesian mode
- After: minutes output, absence notice, hours statistics, resolution tracking
