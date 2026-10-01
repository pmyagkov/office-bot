# Deployment

Adapted from `squash-bot/docs/DEPLOYMENT.md` and `nanoclaw/docs/personal-assistant/deployment.md`. Office Bot shares the nanoclaw host with other services but is deployed differently: image-per-commit over SSH (no registry), SQLite on a bind mount, no public port.

## Quick Reference

Run these from your workstation. `nanoclaw-user` is an SSH alias for `nanoclaw@<host>` defined in `~/.ssh/config` (see nanoclaw's `deployment.md`); the host address is not stored in this repository.

| Action | Command |
|--------|---------|
| SSH to server | `ssh nanoclaw-user` |
| Deployed revision | `cat ~/services/office-bot/current.sha` |
| Container status | `docker ps -a --filter name=office-bot` |
| Bot logs | `docker logs --timestamps --tail 200 office-bot-bot-1` |
| Follow logs | `docker logs -f office-bot-bot-1` |
| Health check | `docker exec office-bot-bot-1 node dist/cli.js health` |
| Unresolved sends | `docker exec office-bot-bot-1 node dist/cli.js operations list` |
| Backup | `docker exec office-bot-bot-1 node dist/cli.js backup /app/data/backups/manual.db` |
| Restart bot | see [Restart](#restart) |

The Compose project is `office-bot`, the service is `bot` and the container is `office-bot-bot-1`.

## Architecture

```
GitHub (push)
  └── verify job (one job, all steps):
        typecheck → tests → docker build → container smoke → isolated rollback test
        └── if main: deploy step
              SSH (restricted key, pinned host key)
              → scripts/deploy.sh <sha>: docker save | gzip → scp → remote-deploy.sh
```

On the server:

```
~/services/office-bot/
  current.sha                  last healthy revision
  data/                        SQLite (office.db, -wal, -shm), heartbeat.json
  data/backups/                before-<sha>-<ts>.db taken on every deploy
  releases/<sha>/              compose.yaml, remote-deploy.sh (image archive removed after success)
/opt/nanoclaw/secrets/office-bot/bot.env   token + chat id, mode 0600 (dir 0700)
/opt/nanoclaw/deploy.lock                  shared host Docker operation lock
```

Key points:

- One container, one long-polling process. **Never run two pollers for the same token**: `remote-deploy.sh` stops the previous release before starting the new one, and so must any manual operation.
- No registry. Images are tagged with the full commit SHA (`office-bot:<sha>`), transferred as an archive and verified against the `org.opencontainers.image.revision` label.
- No public port, nginx or database server. State is one SQLite file in `data/`.
- Container: UID/GID 1000, read-only root, `cap_drop: ALL`, 256 MB, 64 pids, `/tmp` tmpfs, json-file logs (3 × 5 MB).
- Deploys are serialized by the workflow `concurrency` group and the host `flock`.

## CI/CD Pipeline

Defined in `.github/workflows/ci.yml`; runs on push, pull request and manual dispatch. Only a successful run on `main` reaches the deploy step; PR runs have no deploy secrets.

`remote-deploy.sh` on the host:

1. Takes `flock` on `/opt/nanoclaw/deploy.lock`.
2. Loads the image, verifies its revision label.
3. Backs up the existing database using the previous image.
4. **Stops** the previous release, starts the new one and waits for the health check (150 s).
5. On success writes `current.sha`; on failure takes the new release down and starts the previous one again (database is kept, not restored). A first deployment failure leaves the bot stopped.
6. Removes older office-bot images and archives, keeping the current and previous ones.

### Required GitHub Secrets

| Secret | Description |
|--------|-------------|
| `DEPLOY_SSH_KEY` | Dedicated restricted key (forwarding/PTY disabled) |
| `DEPLOY_KNOWN_HOSTS` | Verified host key |
| `DEPLOY_HOST` | Server hostname or IP |
| `DEPLOY_USER` | Deploy account (regular `nanoclaw` user, has Docker access) |

The Telegram token is **not** a GitHub secret; it lives only in `bot.env` on the server.

## Environment Variables

`/opt/nanoclaw/secrets/office-bot/bot.env` (server only, `chmod 600`, not managed by CI):

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `TELEGRAM_BOT_TOKEN` | yes | — | Token from @BotFather |
| `TELEGRAM_CHAT_ID` | yes | — | Office group id (negative integer; find it with `npm run discover`) |

Set by `compose.yaml`, not by `bot.env`: `DATABASE_PATH=/app/data/office.db`, `HEARTBEAT_PATH=/app/data/heartbeat.json`, `TZ=Europe/Belgrade`. The schedule (09:00 open, 10:00 close, 14:00 reminder, Mon–Fri) is hard-coded in `src/config.ts`.

After editing `bot.env`, recreate the container (see [Restart](#restart)); `restart` alone does not re-read `env_file`.

## Logs

Logs are intentionally sparse: lifecycle events and error categories, never raw Telegram exceptions or tokens. Expect:

- `{"event":"started",…}` once per start.
- `{"event":"iteration_failed",…}` when Telegram or the database was unavailable; the loop retries after 2 s.
- `{"event":"stopped"}` on SIGTERM/SIGINT.
- `{"event":"day_closed","day":"<YYYY-MM-DD>","phase":"<phase>","requests":<n>,"onDuty":<n>,"helper":<user id or null>}` once when the bot closes sign-up at 10:00 (also for `[TEST]` runs, which close on the starter's command). `phase` is `assigned`, `empty` (no check-in requests) or `no_helpers` (requests but nobody on duty); `requests` is the number of people who pressed Check me in, `onDuty` the number on duty and `helper` the Telegram user id of the drawn helper (`null` unless `assigned`). **The absence of this line for a working day means sign-up never closed.**
- `{"event":"signup_edit_failed","day":"<YYYY-MM-DD>"}` (stderr) when editing the sign-up message failed. The bot retries on the next tick, so a few are harmless; a steady stream means Telegram rejects the edit (message deleted, bot removed from the group, rate limits).

Sign-up is **one Telegram message edited in place**: pressing a button rewrites its text, and closing at 10:00 removes the buttons and puts the outcome in its footer. The assignment is a separate, second message (also edited in place on confirmation). Failed sends and edits are not raw-logged; read the state to see them:

```bash
ssh nanoclaw-user "docker exec office-bot-bot-1 node -e \"const D=require('better-sqlite3');const db=new D('/app/data/office.db',{readonly:true});for(const r of db.prepare('select key,value from state where key like ? or key like ?').all('day:%','op:%'))console.log(r.key,r.value.slice(0,1500))\""
```

Useful keys in the `state` table:

- `day:<YYYY-MM-DD>`: `phase`, `signup` (`messageId`, `closesAt`, `choices` keyed by Telegram user id with `{user, choice}` where `choice` is `checkin` or `duty`, and `rendered`, the signature of the last text sent), `assignment` (`helper`, `recipients` with frozen `flipperName`, `onDuty`, `messageId`, `confirmedAt`) and `issue`.
- `op:signup:<YYYY-MM-DD>` and `op:assignment:<YYYY-MM-DD>`: the sign-up and assignment sends (status `sent`/`rejected`/`uncertain`, timestamps in UTC); `op:reminder:<YYYY-MM-DD>` is the 14:00 private reminder.
- `flipper:<userId>`: the Flipper name registry, `{name, setBy, at}` (`setBy` is the user who set it, the person themselves or an admin). `conv:<userId>`: the private-chat conversation state while someone is entering a name or running the admin dialog (`null` or absent otherwise; `at` is when it last advanced, and a conversation older than one hour is ignored and cleared on the person's next message). `user:<userId>`: users who pressed `/start`, needed for the private reminder.
- `offset`: the update cursor.

The output contains participant names; treat it as private. Opening the database `readonly` is safe while the bot runs.

Day phases: `open` → `assigned` | `empty` | `no_helpers`. A day still `open` after 10:00 on a working day (`signup.closesAt` in the past) means the close did not run or threw; look for `iteration_failed`. `closing` and `incomplete` exist only on days created by the earlier poll-based version (they carry a `polls` field); the current code skips such a day entirely, but its assignment still counts for stats and history.

## Rollout of the sign-up flow

The release that replaced the two polls with the button sign-up needs these steps:

- **Deploy before 09:00 on a working day** (next: Friday 2026-10-02). Deploying mid-day leaves that day's earlier state as it is: a day created by the old poll flow (it has a `polls` field) is **skipped** by the new code. It is never reopened, closed, edited or reminded, and no sign-up is posted for it; its assignment, if any, still counts for `/stats` and `/history`. The 2026-10-01 day stays `incomplete`, which is acceptable.
- **Everyone must register their Flipper name once** before pressing Check me in: themselves with `/start flipper` (later `/flipper`) in the private chat with the bot, or a group administrator with `/admin flipper`. This includes the people the bot has already seen. On duty and Discard need no registration.
- The bot only receives `message` and `callback_query` updates; no webhook or group setting changes are needed. Telegram polls are not used any more.

## Manual Operations

Set the release first:

```bash
ssh nanoclaw-user
cd ~/services/office-bot
sha=$(cat current.sha)
compose() { OFFICE_BOT_IMAGE="office-bot:$sha" docker compose --project-name office-bot --project-directory ~/services/office-bot -f ~/services/office-bot/releases/$sha/compose.yaml "$@"; }
```

### Restart

```bash
compose up -d --force-recreate bot
```

### Stop (required before recovery commands)

```bash
compose stop bot
```

### Deploy manually

Normally CI does this. From a checkout with Docker and the `DEPLOY_TARGET` SSH alias configured:

```bash
docker build --build-arg REVISION="$(git rev-parse HEAD)" -t "office-bot:$(git rev-parse HEAD)" .
DEPLOY_TARGET=nanoclaw-user bash scripts/deploy.sh "$(git rev-parse HEAD)"
```

### Rollback to the previous release

The previous image is kept on the host. Find its SHA with `docker image ls office-bot`, then:

```bash
compose stop bot
prev=<previous-full-sha>
OFFICE_BOT_IMAGE="office-bot:$prev" docker compose --project-name office-bot --project-directory ~/services/office-bot -f ~/services/office-bot/releases/$prev/compose.yaml up -d --wait bot
printf '%s\n' "$prev" > ~/services/office-bot/current.sha
```

Rollback keeps the current database; it does not restore an old snapshot.

### Unresolved sends

Telegram has no idempotency keys, so an ambiguous send becomes `uncertain` and is never resent blindly. See "Persistence and delivery recovery" in the README for the full procedure (`operations list` → stop the bot → verify in Telegram → `resolve`/`retry --verified-in-telegram` → restart). Operation keys are `signup:<day>`, `assignment:<day>` and `reminder:<day>`; `resolve` takes `--message-id N` and nothing else. Run these through a one-off container with the same data mount while the bot is **stopped**:

```bash
docker run --rm --network none --user 1000:1000 -v ~/services/office-bot/data:/app/data "office-bot:$sha" node dist/cli.js operations list
```

### Backups and restore

Backups are SQLite online backups and are safe while the bot runs. A copy is taken before every deploy into `data/backups/`; take manual ones with the Quick Reference command. Nothing rotates them automatically: archive or delete old files periodically. Backups contain names and attendance records; protect them like the live database.

Restore: stop the bot, keep the current `office.db`, `-wal` and `-shm`, copy the chosen backup to `data/office.db`, delete only the old `-wal`/`-shm`, start the bot. Restoring can lose acknowledged updates or delivery results; reconcile messages sent since that backup **before** letting the bot publish. Never edit rows to reroll a draw.

## Troubleshooting

### Bot didn't post / didn't finalize at 10:00

1. `docker ps -a --filter name=office-bot` — running and `(healthy)`? A restart near 09:00 or 10:00 shows in `Up <time>`.
2. `docker logs --timestamps office-bot-bot-1` — look for `iteration_failed` around the time, a `day_closed` line for the day (none means sign-up never closed) and `signup_edit_failed`.
3. Dump `day:<date>` and `op:` keys (see [Logs](#logs)). Check:
   - `phase`: still `open` after 10:00 means the close did not run; `assigned`/`empty`/`no_helpers` means it did.
   - `signup.messageId`: `null` means the sign-up message was never sent; look at `op:signup:<date>` (`uncertain`/`rejected` needs `operations list`, see [Unresolved sends](#unresolved-sends)).
   - `signup.choices`: who pressed what. Someone's Check me in is missing because they had no Flipper name registered (`flipper:<userId>` absent) or the press arrived while the bot was down for longer than Telegram retains updates.
   - `assignment` (`helper`, `recipients`, `messageId`, `confirmedAt`) and `op:assignment:<date>` status, plus `issue`.
   - The day has a `polls` field: it was created by the earlier poll-based version and is deliberately skipped (see [Rollout](#rollout-of-the-sign-up-flow)).

### Someone cannot press Check me in

Pressing it without a registered Flipper name records nothing and opens the bot's private chat (`t.me/<bot>?start=flipper`). The person sends the name exactly as listed in Flipper, or a group administrator sets it with `/admin flipper` in the bot's private chat. Verify with the `flipper:<userId>` keys (see [Logs](#logs)).

### Container unhealthy or in a restart loop

```bash
docker inspect office-bot-bot-1 --format '{{.RestartCount}} restarts, exit {{.State.ExitCode}}, {{.State.Health.Status}}'
docker exec office-bot-bot-1 node dist/cli.js health
```

Health reads `data/heartbeat.json`; it fails if the file is older than 120 s or the pid is gone. Typical causes: invalid `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID`, a configured webhook, the bot removed from the group, or a second poller using the same token (Telegram `409 Conflict`).

### Disk space

```bash
df -h
docker system df
ls -lh ~/services/office-bot/data/backups
```

Do not run a global `docker system prune`: other services share this host. Remove only old office-bot backups.

## Key Files

| Location | Description |
|----------|-------------|
| `/opt/nanoclaw/secrets/office-bot/bot.env` | Token and chat id (server) |
| `~/services/office-bot/current.sha` | Last healthy revision (server) |
| `~/services/office-bot/data/office.db` | SQLite state (server) |
| `~/services/office-bot/data/backups/` | Pre-deploy and manual backups (server) |
| `Dockerfile`, `compose.yaml` | Image and runtime config (repo) |
| `.github/workflows/ci.yml` | CI and deploy pipeline (repo) |
| `scripts/deploy.sh` | CI side: save, copy, run remote script (repo) |
| `scripts/remote-deploy.sh` | Host side: backup, stop, start, health, rollback (repo) |
| `scripts/container-smoke.sh`, `scripts/test-rollback.sh` | Release verification (repo) |
