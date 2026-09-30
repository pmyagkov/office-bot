# Office Bot

Telegram group coordination with persistent polls, random badge duty, self-reported confirmations and statistics. All Telegram content is English. Runs as one long-polling process with SQLite; no public port is needed.

## Daily flow

Monday–Friday, **Europe/Belgrade** (including daylight-saving changes):

- **09:00:** two non-anonymous, single-choice polls: who needs a check-in and who can help.
- **10:00:** Telegram closes both polls. The bot drains queued updates, reconciles identified votes against final totals and chooses one helper uniformly at random. The selected helper is excluded from their own recipients. Names and recipients are frozen before publishing.
- **Confirmation:** only the selected helper can press **I've checked everyone in** on the original group message. The bot records one duty and the individual helper → recipient → confirmation-time relationships, edits the message and removes its button.
- **14:00:** one private reminder if still unconfirmed. It can be recovered later the same day, but not on a later date.

**Every potential helper should open the bot privately and press `/start` once.** Telegram otherwise prevents the private reminder. A blocked/failed DM is visible through `/today`; there is no automatic group fallback.

Group commands: `/today`, `/stats` (this week), `/stats month`, `/history`, `/help`. Other groups cannot access the reports. Stats count only confirmations, distinguish duties from check-ins performed/received, and use the assignment's Belgrade date for period filtering. History uses the actual confirmation timestamp. Public holidays are not excluded. These records are self-reports, not readings from access-control hardware.

## Local setup

Use Node **22.22.3** (see `.nvmrc`).

1. Create a bot with **@BotFather → /newbot**. Keep its token private.
2. Copy `.env.example` to `.env`, put the token there and restrict it: `chmod 600 .env`.
3. Add the bot to the intended group; grant permission to send messages and polls. Administrator status is simplest. Privacy mode can remain enabled: polls, callbacks and explicit bot commands are delivered.
4. Run `npm ci`, then `npm run build`.
5. With all other bot processes stopped, run `npm run discover`, then send `/setup@your_bot_username` in the intended group. Save the reported ID as `TELEGRAM_CHAT_ID`.
6. Start with `npm start`. Never run two pollers for the same token.

The committed example contains no credentials. `.env`, databases, dependencies and design notes are ignored. Production can supply environment variables directly and run `node dist/main.js`.

## Verification without a test Telegram group

`npm run typecheck` and `npm test` run locally and in CI. Tests build the production code first. They never read `.env` or contact Telegram.

The scenario harness adapts the approach from `squash-bot`: real SQLite and handlers, deterministic synthetic updates, controlled clock and grammY API transformers. Unsupported mock methods fail closed. A separate local HTTP simulator verifies actual grammY requests, 403/429 responses, connection loss and subprocess restart with the same SQLite file. External HTTP requests are blocked in the test process. Fixtures use dummy credentials.

Coverage includes DST, weekends, vote changes/retractions, incomplete vote recovery, authorization, duplicate updates, confirmation/edit failure, statistics and DM suppression. Live Telegram rendering is not tested and no artificial messages are sent to the production group.

## Persistence and delivery recovery

The database contains versioned per-day snapshots, unique operation records, reply jobs and the incoming cursor. Incoming changes and cursor advancement commit in one SQLite transaction (WAL, FULL synchronous). A completed assignment snapshot represents one duty plus one relationship per frozen recipient. Never edit database rows manually to reroll a draw.

Telegram does **not** offer idempotency keys for new messages. Before sending, the bot persists an operation. Confirmed sends reuse their saved result. A connection failure or crash during sending becomes **uncertain**, never a blind automatic resend. Explicit 429 rejections retry after Telegram's delay. Permanent rejections remain visible. Edits can safely retry. Missing final votes block selection until the stored ballots match both closed polls. Telegram retains updates for a limited time; lost voter identities cannot be recovered from totals.

If a send is unresolved:

1. Run `npm run operations -- list` to identify its key, for example `assignment:2026-09-30`.
2. **Stop the polling process**, take a backup and inspect the actual group/DM history.
3. If the message exists, record its ID: `npm run operations -- resolve assignment:2026-09-30 --message-id 42 --verified-in-telegram`.
4. A poll also requires `--poll-id ID`. Obtain its poll ID from a forwarded original poll/update; resolving it restores its identity, not missing votes. The bot still verifies final counts.
5. Only if the message definitely does **not** exist, use `npm run operations -- retry KEY --verified-in-telegram`.
6. Restart. The frozen draw remains unchanged. Expired polls and previous-day reminders are not newly sent.

Do not resolve/retry a send while the process is running. The flag is an operator acknowledgement of checking Telegram, not a delivery guarantee. A missing/ambiguous assignment has no working confirmation until its message ID is reconciled. Oversized recipient lists are shortened in the assignment preview and available in full via `/today`; stats/history are bounded, with complete records retained in SQLite.

## Backup and restore

Create a consistent SQLite backup with `npm run backup -- /absolute/path/office-backup.db`; this works while the bot is running. Protect backups like the live database: they contain names and attendance-related records.

To restore, stop the bot, preserve the current database and its WAL/SHM files, replace the database with the chosen backup, remove only the old database's WAL/SHM files, and restart. Restoring an old backup can lose acknowledged updates or delivery results: reconcile messages already sent since that backup **before** allowing the bot to publish again. Application rollback normally keeps the current database and does not restore an old snapshot.

Health: `npm run health` verifies a recent successful polling/scheduler heartbeat and a live process. No public health endpoint exists. Logs contain lifecycle/error categories, never raw Telegram exceptions or tokens.

## Deployment

The private GitHub repository is `pmyagkov/office-bot`. GitHub Actions checks types, runs all tests on the runner and inside the pinned Docker build, verifies container persistence/backup and exercises a deliberately broken release in an isolated Compose project. Only a successful **main** run receives deployment credentials and deploys. PR runs have no deployment secrets. Concurrent releases are serialized by workflow and host locks.

Images are tagged with the full commit SHA, compressed and transferred over SSH with pinned host keys. The remote script checks the image revision, takes a consistent backup, stops the previous poller, starts the new one and waits for health. A failed replacement is stopped before the previous version starts again. Rollback keeps the current database. A first deployment failure leaves the bot stopped. No registry credentials or public ports are needed.

Production paths (regular `nanoclaw` account):

- `~/services/office-bot/releases/<sha>/` — immutable release files.
- `~/services/office-bot/current.sha` — last healthy revision.
- `~/services/office-bot/data/` — SQLite and heartbeat; `data/backups/` contains pre-deploy backups.
- `/opt/nanoclaw/secrets/office-bot/bot.env` — token/group, mode 0600; directory mode 0700.
- `/opt/nanoclaw/deploy.lock` — shared host Docker operation lock.

Repository Actions secrets: `DEPLOY_SSH_KEY` (dedicated restricted key), `DEPLOY_KNOWN_HOSTS` (verified host key), `DEPLOY_HOST`, `DEPLOY_USER`. The Telegram token stays only in the server secret file. The container runs as UID/GID 1000, with read-only root, bounded logs/memory and one writable data mount. The SSH key has forwarding/PTY disabled; the deploy account has Docker access.

To inspect, read `current.sha`, then run Compose using the root project directory, that release's `compose.yaml`, project name `office-bot` and `OFFICE_BOT_IMAGE=office-bot:<sha>`. Use `ps`, `logs --tail 50 bot` and `exec -T bot node dist/cli.js health`. Recovery commands must run with the same data mount **after stopping** the polling service. Backups can run with `exec -T bot node dist/cli.js backup /app/data/backups/manual.db`.

Successful deployment retains the current and previous office-bot images, removes transferred image archives and never prunes unrelated Docker resources. Release metadata and backups are retained; periodically archive old backups according to your retention needs. A missing bot heartbeat marks the container unhealthy; Docker restarts exited processes, while a running bot keeps retrying transient Telegram failures. Check health/logs if Telegram remains unavailable.

## API references

- [Telegram Bot API: polls](https://core.telegram.org/bots/api#sendpoll) — absolute closing deadline and non-anonymous answers.
- [Telegram Bot API: updates](https://core.telegram.org/bots/api#getupdates) — polling offsets and retained updates.
- [grammY API transformers](https://grammy.dev/advanced/transformers) — the mocked boundary used in scenario tests.
