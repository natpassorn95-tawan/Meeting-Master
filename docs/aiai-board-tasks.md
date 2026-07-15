# Rich-menu「任務」→ My Aiai Board Tasks

One rich-menu button on the Meeting Master LINE OA belongs to **Aiai Board**.
Tapping it returns the tapper's **open Aiai Board work items** in LINE, matched
by email.

```
Tap「任務」 (postback data=action=aiai_tasks)
  → MM webhook resolves LINE userId → email   [identity-service /v1/identities/resolve]
  → fetch that email's open work items          [aiai-boards tasksApi]
  → reply zh-TW Flex carousel (title, 看板, 狀態, 到期/逾期, 開啟工作項目)
```

Everything user-facing is **Traditional Chinese (zh-TW)**, matching the rest of
the OA.

## What was changed

| Repo | Change |
|---|---|
| `meeting-master` | `server/aiai-tasks.js` (identity-resolve + tasks client + Flex builder + orchestration); webhook branch for `action=aiai_tasks` in `server/index.js`; rich-menu「任務」button → **postback** in `richmenu/deploy_richmenu.py`; env vars; unit tests + a local sim script |
| `aiai-boards` | `functions/src/lib/tasks.ts` (reusable `getOpenWorkItemsByEmail`, usable by a future LIFF endpoint too); `functions/src/tasksApi.ts` (HTTP `GET /api/v1/tasks`, API-key protected); export in `functions/src/index.ts`; `functions/.env.example`; unit + emulator tests |

The composite index the query needs (`workItems` collectionGroup: `assigneeUid` +
`state`) **already existed** in `firestore.indexes.json` — no index change.

## Data-matching notes (important)

- Aiai Board assigns work by **`assigneeUid`** (Firebase Auth uid), not email.
  So the endpoint maps `email → uid` via `admin.auth().getUserByEmail()`. **The
  person's identity-service email must equal their Firebase Auth email**, or they
  get `matched:false` ("找不到對應的 Aiai Board 帳號").
- "My Tasks" = **work items** (cards) assigned to me and not `Closed`
  (New/Active/Resolved). Child `tasks` docs are not included (by decision).
- Work items have **no due-date field**. The due date shown is the item's
  **iteration `endDate`** (sprint); items with no iteration show no due date.
  Overdue = past that date and not yet `Resolved`.
- The "開啟工作項目" link is `…/board?board=<b>&item=<id>`. The board web app does
  **not yet honor `?item=`**; today the link opens the board. This was
  **deliberately deferred** (not just unbuilt) for two reasons found in the code:
  1. `useItems(boardId = 'b_itp')` scopes the slide-over to a **single board**, so
     a cross-board `?item=` can't resolve until item-loading is board-aware.
  2. `repo.USE_MOCK = !VITE_FIREBASE_PROJECT_ID` — the data layer is **mock-only**;
     the real Firestore read path is gated to post-P1 (`NOTES-spec-vs-schema.md`).
     So a deep link can't reach a *real* item yet regardless of a bootstrap.
  When the real-data path lands, add this bootstrap (once) to `src/App.tsx` — the
  endpoint already emits the forward-compatible `?item=&board=` URL:
  ```tsx
  // read ?item= on load and open the slide-over (after board-aware loading lands)
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('item');
    if (id) useUiStore.getState().openItem(id);
  }, []);
  ```

## Configure

**aiai-boards** — `functions/.env` (see `.env.example`):
```
TASKS_API_KEY=<a long random secret>
AIAI_BOARD_WEB_URL=https://<your-boards-hosting-domain>
BOARDS_DB=boards
```

**meeting-master** — `.env` (see `.env.example`):
```
IDENTITY_SERVICE_URL=http://localhost:8901        # from Prompt 1
IDENTITY_SERVICE_KEY=<meeting_master identity key>
AIAI_BOARD_TASKS_URL=https://asia-east1-<project>.cloudfunctions.net/tasksApi
AIAI_BOARD_API_KEY=<SAME value as TASKS_API_KEY above>
```

Then redeploy the rich menu so the「任務」button emits the postback:
```
cd richmenu && python3 deploy_richmenu.py --force
```

## Verify

**Automated (run now, no infra):**
```
# Meeting Master — routing, no-mapping, empty, error, Flex validity (≤12 bubbles, non-empty text)
cd meeting-master && npm test        # 13 tests

# Aiai Board — unit only (builds first; excludes the emulator tests):
#   tasks.ts   — email→uid, open-only scoping, overdue calc, board/iteration enrichment, C1 truncation
#   tasksApi   — HTTP auth/validation: 401 (no/bad key, fail-closed), 405, 400 (missing/bad email, bad status), x-api-key
cd aiai-boards/functions && npm test  # 14 tests (6 + 8), in-process fakes
```

**Emulator E2E (needs firebase-tools + Java — see `aiai-boards/docs/RUNBOOK-my-aiai-board-tasks.md`):**
Two integration tests (`test/*.emulator.mjs`), run separately from `npm test`:
- `history-trigger.emulator.mjs` — SoD Close trigger writes history→named `boards` DB (workItem + task paths, exactly 1 row, no default-DB leak) + audit→default DB.
- `tasks.emulator.mjs` — email→uid scoping, open-only, overdue, board enrichment, `matched:false`.
```
cd aiai-boards && firebase emulators:start --only firestore,auth,functions
# another shell:
cd aiai-boards/functions && npm run build
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
GCLOUD_PROJECT=aiai-boards-dev BOARDS_DB=boards npm run test:emulator
```

**Local webhook sim (server running):**
```
cd meeting-master && npm run dev:api
# another shell:
node scripts/simulate-tasks-postback.mjs <your-LINE-userId>
# watch the server log for [webhook] postback + [aiai-tasks] lines
```

## Manual end-to-end test plan (real LINE account)

Do this on staging after both services are deployed and configured.

1. **Prereqs:** identity-service reachable from MM; `tasksApi` deployed; MM `.env`
   filled; rich menu redeployed with `--force`; you have a LINE account that has
   followed the OA.
2. **Register / have an identity mapping:** in the OA, type `註冊` and complete the
   form with the **same email as your Firebase Auth account** in Aiai Board. (This
   fires the Prompt-1 mirror → identity-service.)
3. **Seed yourself a task:** in Aiai Board, assign at least one non-Closed work
   item to your account. Optionally put it in a sprint whose end date is in the
   past (to see the red 逾期 styling) and one with no sprint (no due date).
4. **Tap「任務」** on the rich menu.
   - ✅ Expect a Flex carousel: each card shows title, 看板 name, 狀態, and 到期 (red
     if overdue), with an 開啟工作項目 button.
   - ✅ Tap 開啟工作項目 → opens the board web app.
5. **Empty case:** close/reassign all your items, tap again → "🎉 您目前沒有待辦任務".
6. **No-mapping case:** with a LINE account that never registered an email, tap
   → prompt to register + the registration card.
7. **No Aiai Board account:** register an email that has **no** Firebase user, tap
   → "找不到對應的 Aiai Board 帳號".
8. **Truncation:** assign > 10 items, tap → 10 cards + a "另有 N 項" card.
9. **Resilience:** stop the identity-service or `tasksApi`, tap → a friendly
   apology (no internals leaked), and MM stays up.

## Security (Duke review F-008 — APPROVE-WITH-CONDITIONS)

Reviewed 2026-07-14; no blocker. Applied: **C1** query bound (`.limit(200)` +
`truncated` flag), **C4** masked access log on `tasksApi`, **C5** email-plausibility
reject. Standing conditions:
- **C2 (invariant):** `TASKS_API_KEY` grants read of **any** user's open tasks. It
  must **only** be held by trusted server callers (Meeting Master), which bind
  LINE→email server-side. Any future LIFF/direct caller reusing `lib/tasks.ts`
  must re-derive the email from an authenticated session — never accept it from
  the client. See `state/security/findings/F-008-*` + the rbac-matrix cross-app
  key table. Rotation is owned by Buzz's vault.
- **C3 (prod):** `AIAI_BOARD_TASKS_URL` and `IDENTITY_SERVICE_URL` **must be https
  in production** (dev `http://localhost` is fine) — the Bearer key must not cross
  cleartext.

## Deploy blocker (pre-existing) — FIXED 2026-07-14

`aiai-boards/functions/src/lib/stateMachine.ts` had two pre-existing type errors
against `firebase-admin@12.7.0` (unused `from` param; `admin.firestore(dbId)` —
which also **misrouted the SoD history write** off the named `boards` DB at
runtime). Fixed → `getFirestore(app, dbId)` via a shared `lib/boardsDb.ts` helper,
dead param removed. `npm run typecheck` in `functions/` is now **clean**, so
`firebase deploy` predeploy passes and `tasksApi` can deploy.

Governance: **Duke APPROVED** (no SoD/audit guarantee weakened — the `audit()`
evidence rows are untouched and commit before the history write). **Titus:
CHANGES-REQUESTED (conditional)** — code correct + design-conformant, gated on
**Ophelia** sign-off + an emulator smoke test for the trigger's named-DB write
path (added: `functions/test/history-trigger.emulator.mjs`). The DRY nit Titus
raised (shared `boardsDb()` helper) is done.
