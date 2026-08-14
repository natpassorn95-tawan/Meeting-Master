<!--
owner: elara (AI Documentation)
audience: developer running Meeting Master in production on a Windows host (Docker Desktop / WSL2)
related: ./Dockerfile, ./docker-compose.yml, ./.env.example, ./windows-service/README.md,
         ../my-it-team/state/adr/ADR-0021-meeting-master-production-supervision.md
-->

# Meeting Master (會議大師) — Docker Handover (Windows)

## 1. What this is

How to run **Meeting Master** in a Docker container on a Windows host. It is a
**single container**: one Express process (`server/index.js`) serves the built
web bundle **and** `/api/*` on **one port (8899)** — no separate web server, no
proxy hop.

## 2. The 3 files

| File | What it does |
|---|---|
| `Dockerfile` | Multi-stage build on `node:20-alpine`. Build stage runs `npm run build` → `dist/`; runtime stage runs the Express server as the non-root `node` user, `EXPOSE 8899`, with a `HEALTHCHECK` that polls `/api/line/status`. It uses the **full** `npm ci` (no `--omit=dev`) because `express` was originally a devDependency. *`express` has since been moved into `dependencies`, so the full install is now belt-and-suspenders — still correct, no change needed.* |
| `.dockerignore` | Keeps `node_modules`, `dist`, `.env`, `data/`, `uploads/`, `.git`, and docs out of the build context. **`.env` is never baked into the image.** |
| `docker-compose.yml` | **The file you actually run.** Builds the image (`meeting-master:local`), maps ports, mounts the `data/` + `uploads/` volumes, loads `env_file: .env`, and sets `restart: unless-stopped`. |

## 3. Prerequisites

- **Docker Desktop** installed and **running** (WSL2 backend).
- This repo cloned on the Windows host.
- A filled-in **`.env` sitting next to `docker-compose.yml`** — copy it from
  `.env.example` and fill it in. `.env` is **not** baked into the image; it is
  read from the host at runtime (`env_file`), so it stays local.

The app boots even with these blank (LINE + scheduler degrade gracefully), but
for **real LINE delivery** you need:

```
LINE_CHANNEL_ACCESS_TOKEN=   # Messaging API channel access token
LINE_CHANNEL_SECRET=         # verifies inbound webhook signatures
PUBLIC_BASE_URL=             # public https origin the deep-link buttons point at
```

## 4. Run it

Commands below are **PowerShell**, but they are identical in bash. Run them from
the folder that holds `docker-compose.yml`.

```powershell
docker compose up -d --build     # build the image + start the container
docker compose ps                # expect STATUS = "Up (healthy)"
docker compose logs -f           # live logs (Ctrl+C to stop tailing)
docker compose down              # stop + remove the container (data is kept)
```

Then open the URL below.

## 5. The URL

```
http://localhost:8898
```

Compose publishes host **8898** → container **8899**. The host port is
deliberately `8898` (not `8899`) to avoid clashing with a local
`npm run dev` server that binds `:8899` on the host.

> On a host where **8899 is free**, change the compose ports line to
> `"8899:8899"` so the port matches everywhere (URL becomes
> `http://localhost:8899`).

## 6. Data persistence

- `./data` (the file store, `data/store.json`) and `./uploads` are
  **bind-mounted** into the container.
- State **survives** container restarts and image rebuilds.
- `docker compose down` **keeps** both folders.
- You only lose data with `docker compose down -v` or by deleting the folders.

## 7. ⚠️ Windows reliability note (important)

`restart: unless-stopped` gives auto-restart-on-crash **and** auto-start-on-boot
— **but only while Docker Desktop is running** and configured to launch at login
(**Settings → "Start Docker Desktop when you log in"**). If Docker Desktop is not
running, the container is not running.

Per **[ADR-0021](../my-it-team/state/adr/ADR-0021-meeting-master-production-supervision.md)**
the **native Windows Service (PM2)** path is the **recommended** production
supervisor on this host until Docker Desktop here is proven stable, because it
removes the Docker Desktop dependency and closes the same auto-restart /
auto-start / memory-guard gap. See **[`windows-service/README.md`](./windows-service/README.md)**.

## 8. Don't run two at once

Docker, PM2, and NSSM all bind **port 8899** and write the **same
`data/store.json`**. Running two supervisors against the same state corrupts it.
**Pick exactly one path per host.**
