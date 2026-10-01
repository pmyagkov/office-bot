# Office Bot

Telegram group coordination with a button sign-up, fair-share badge duty, self-reported confirmations and statistics. There are no Telegram polls: the bot itself decides when sign-up closes. All Telegram content is English. Runs as one long-polling process with SQLite; no public port is needed.

## Daily flow

Monday–Friday, **Europe/Belgrade** (including daylight-saving changes):

- **09:00:** one sign-up message with three buttons: **🙋 Check me in**, **🛡 On duty** and **❌ Discard**. The choices are mutually exclusive: pressing one replaces the previous one, and Discard removes the person from both lists. The message lists everyone under **Need check-in** and **On duty** with their Telegram names (plain text, so edits ping nobody) and is **edited in place** after every press; it is never reposted. It states when sign-up closes.
- **10:00:** the bot closes sign-up itself (no Telegram polls are involved), removes the buttons and shows the outcome in the same message's footer: no check-ins needed, nobody on duty, or the selected duty person. If there is at least one request and at least one person on duty, the bot chooses one helper from those on duty. Lists, Flipper names and the draw are frozen before anything is sent.
- **Helper choice (fair share):** among the people on duty the bot prefers whoever has been picked least relative to how often they volunteered. Each past assigned day within the last 60 days (today excluded) gives every volunteer on duty that day a credit of 1/N, where N is the number of volunteers, and the day's helper a debit of 1. The volunteer with the highest balance is chosen; exact ties are broken uniformly at random. Days from before this rule have no recorded volunteers and give no credit.
- **Assignment message:** a new group message tags the helper (`@username`, or a mention link when there is no username) and lists the people to check in by their **Flipper names**, untagged, one per line.
- **Confirmation:** only the selected helper can press **I've checked everyone in** on the assignment message. The bot records one duty and the individual helper → recipient → confirmation-time relationships, then edits the **same message**: the button is removed and `✅ Confirmed HH:MM` is appended.
- **14:00:** one private reminder if still unconfirmed. It can be recovered later the same day, but not on a later date.

**Every potential helper should open the bot privately and press `/start` once.** Telegram otherwise prevents the private reminder. A blocked/failed DM is visible through `/today`; there is no automatic group fallback.

**One-time registration.** The assignment lists people by the names the badge system (Flipper) knows, so everyone who wants to press **Check me in** must register their Flipper name once. Pressing **Check me in** without one records nothing and opens the bot's private chat; **On duty** and **Discard** never need a name. A person registers themselves by sending `/start flipper` (or later `/flipper` to change it) in the private chat and answering with the name exactly as listed in Flipper (1–64 characters, one line). A group administrator can register names for others in the private chat with `/admin flipper`: the bot offers a **Choose person** picker and a **Finish** button, asks for each person's Flipper name (showing the current one), saves it and returns to the picker, until **Finish**. `/admin` alone lists the admin commands; non-administrators of the group get "Not available". Only members of the office group can be picked. The bot does not verify names against the Flipper system; it uses what was entered.

Group commands: `/today`, `/stats` (this week), `/stats month`, `/history`, `/test`, `/help`. Private-chat commands: `/start`, `/flipper`, `/admin` (group administrators only) and `/cancel` while a name is being entered. Other groups cannot access the reports. Stats count only confirmations, distinguish duties from check-ins performed/received, and use the assignment's Belgrade date for period filtering. History uses the actual confirmation timestamp. Public holidays are not excluded. These records are self-reports, not readings from access-control hardware.

## Interactive test in the real group

Send **`/test@altium_office_bot`** (or `/test`) in the configured group. The bot posts an English **[TEST]** control panel mentioning the sender. Only that person can advance or end the run; everyone can press the sign-up buttons, and only the selected helper can confirm the assignment.

1. **Open test sign-up** posts a real sign-up message marked **[TEST]** with the same three buttons. Use at least two different people: one presses **Check me in** (a registered Flipper name is required, exactly as in the daily flow), another presses **On duty**.
2. **Close & choose helper** closes the test sign-up (the starter decides when; there is no 10:00 deadline in a test), chooses the helper and publishes the **[TEST]** assignment with the usual confirmation button. Fair-share history for test draws is kept in the test's own records, not in the real history.
3. **Send test reminder** sends the selected helper one private **[TEST]** reminder immediately. The helper must have opened the bot privately and pressed `/start`. A failure such as a blocked DM is shown in the panel. Do this before confirming if you want to test the reminder.
4. The selected helper presses **I've checked everyone in** on the **[TEST] assignment message**. It is edited to show `✅ Confirmed HH:MM`; the panel then offers **Show test stats**.
5. **Show test stats** posts this week's statistics for the test records only.
6. **End test** deactivates the run and removes its controls. Old sign-up and assignment messages are edited to end with "Test ended."; if Telegram cannot update one, its buttons still stop working immediately, the panel reports cleanup trouble and a new test can start. A run expires after one hour. Messages remain in the group so participants can inspect them.

Only one test runs at a time. Sending `/test` again points to its panel. Repeated steps do not create duplicate sign-ups, assignments or reminders, including after restart. Delivery uncertainty is shown without automatic resending. Test state and statistics are stored separately in SQLite and never affect `/today`, `/stats` or `/history`; only the Flipper names come from the real registry. The daily schedule continues independently. No sign-ups or confirmations are fabricated.

## Local setup

Use Node **22.22.3** (see `.nvmrc`).

1. Create a bot with **@BotFather → /newbot**. Keep its token private.
2. Copy `.env.example` to `.env`, put the token there and restrict it: `chmod 600 .env`.
3. Add the bot to the intended group; grant permission to send and edit its messages. Administrator status is simplest. Privacy mode can remain enabled: button presses (callbacks) and explicit bot commands are delivered.
4. Run `npm ci`, then `npm run build`.
5. With all other bot processes stopped, run `npm run discover`, then send `/setup@your_bot_username` in the intended group. Save the reported ID as `TELEGRAM_CHAT_ID`.
6. Start with `npm start`. Never run two pollers for the same token.

The committed example contains no credentials. `.env`, databases, dependencies and design notes are ignored. Production can supply environment variables directly and run `node dist/main.js`.

## Verification without a test Telegram group

`npm run typecheck` and `npm test` run locally and in CI. Tests build the production code first. They never read `.env` or contact Telegram.

The scenario harness adapts the approach from `squash-bot`: real SQLite and handlers, deterministic synthetic updates, controlled clock and grammY API transformers. Unsupported mock methods fail closed. A separate local HTTP simulator verifies actual grammY requests, 403/429 responses, connection loss and subprocess restart with the same SQLite file. External HTTP requests are blocked in the test process. Fixtures use dummy credentials.

Coverage includes DST, weekends, changing and discarding sign-up choices, Flipper-name registration and the admin dialog, fair-share helper selection, bot-driven closing and restarts around it, authorization, duplicate updates, confirmation/sign-up edit failure, statistics, DM suppression, days stored by the earlier poll-based version and the manual test flow alongside the scheduled sign-up. Automated tests never send messages to the production group. The interactive `/test` command intentionally sends labelled test messages there; live rendering and user interaction can be checked with that command.

## Persistence and delivery recovery

The database contains versioned per-day snapshots, unique operation records, reply jobs and the incoming cursor. Incoming changes and cursor advancement commit in one SQLite transaction (WAL, FULL synchronous). A completed assignment snapshot represents one duty plus one relationship per frozen recipient. Never edit database rows manually to reroll a draw.

Telegram does **not** offer idempotency keys for new messages. Before sending, the bot persists an operation. Confirmed sends reuse their saved result. A connection failure or crash during sending becomes **uncertain**, never a blind automatic resend. Explicit 429 rejections retry after Telegram's delay. Permanent rejections remain visible. Edits can safely retry: a sign-up or assignment message edit that fails is logged (`signup_edit_failed`, `assignment_edit_failed`) and retried on the next tick. Each button press is stored in the same SQLite transaction as the update cursor; Telegram retains unprocessed updates only for a limited time, so a long outage can lose presses made during it.

Operation keys are `signup:<day>` (the sign-up message), `assignment:<day>` (the assignment message) and `reminder:<day>` (the private reminder), for example `signup:2026-09-30`.

If a send is unresolved:

1. Run `npm run operations -- list` to identify its key, for example `signup:2026-09-30` or `assignment:2026-09-30`.
2. **Stop the polling process**, take a backup and inspect the actual group/DM history.
3. If the message exists, record its ID: `npm run operations -- resolve signup:2026-09-30 --message-id 42 --verified-in-telegram`. A positive `--message-id` is the only extra value `resolve` accepts.
4. Only if the message definitely does **not** exist, use `npm run operations -- retry KEY --verified-in-telegram`.
5. Restart. The frozen draw remains unchanged. Previous-day reminders are not newly sent.

Do not resolve/retry a send while the process is running. The flag is an operator acknowledgement of checking Telegram, not a delivery guarantee. A missing/ambiguous sign-up message has no working buttons, and a missing/ambiguous assignment has no working confirmation, until its message ID is reconciled. Oversized recipient lists are shortened in the assignment preview and available in full via `/today`; stats/history are bounded, with complete records retained in SQLite.

## Backup and restore

Create a consistent SQLite backup with `npm run backup -- /absolute/path/office-backup.db`; this works while the bot is running. Protect backups like the live database: they contain names and attendance-related records.

To restore, stop the bot, preserve the current database and its WAL/SHM files, replace the database with the chosen backup, remove only the old database's WAL/SHM files, and restart. Restoring an old backup can lose acknowledged updates or delivery results: reconcile messages already sent since that backup **before** allowing the bot to publish again. Application rollback normally keeps the current database and does not restore an old snapshot; rolling back past the button sign-up is the exception (see [Deployment](#deployment)).

Health: `npm run health` verifies a recent successful polling/scheduler heartbeat and a live process. No public health endpoint exists. Logs contain lifecycle/error categories, never raw Telegram exceptions or tokens.

## Deployment

The private GitHub repository is `pmyagkov/office-bot`. GitHub Actions checks types, runs all tests on the runner and inside the pinned Docker build, verifies container persistence/backup and exercises a deliberately broken release in an isolated Compose project. Only a successful **main** run receives deployment credentials and deploys. PR runs have no deployment secrets. Concurrent releases are serialized by workflow and host locks.

Images are tagged with the full commit SHA, compressed and transferred over SSH with pinned host keys. The remote script checks the image revision, takes a consistent backup, stops the previous poller, starts the new one and waits for health. A failed replacement is stopped before the previous version starts again. Rollback keeps the current database. **Rolling back to a release from before the button sign-up is only safe until the first sign-up day is created** (09:00 on the next working day after deploying): the old code crashes on any day without a `polls` field. After that, stop the bot, take a backup, and either restore the pre-deploy backup from `data/backups/` or delete the `day:` rows without `polls` before starting the old release (see `docs/DEPLOYMENT.md`, "Rollback to the previous release"). A first deployment failure leaves the bot stopped. No registry credentials or public ports are needed.

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

- [Telegram Bot API: inline keyboards](https://core.telegram.org/bots/api#inlinekeyboardmarkup) — the sign-up and confirmation buttons.
- [Telegram Bot API: KeyboardButtonRequestUsers](https://core.telegram.org/bots/api#keyboardbuttonrequestusers) — the admin **Choose person** picker.
- [Telegram Bot API: updates](https://core.telegram.org/bots/api#getupdates) — polling offsets and retained updates.
- [grammY API transformers](https://grammy.dev/advanced/transformers) — the mocked boundary used in scenario tests.
