# Office Bot

Telegram bot for an office group: daily sign-up for badge check-ins, fair rotation of who helps, self-reported confirmations and statistics. One long-polling Node process with SQLite; no public port. All Telegram text is English.

## Daily flow

Monday–Friday, Europe/Belgrade:

- **09:00** — one sign-up message with **🙋 Check me in**, **🛡 On duty** and **❌ Discard**. The choices exclude each other, and the message is edited in place after every press.
- **10:00** — the bot closes sign-up itself, removes the buttons and draws a helper from those on duty. If nobody needs a check-in or nobody is on duty, the same message says so.
- **Assignment** — a new message tags the helper and lists, by **Flipper name**, who to check in. The helper presses **I've checked everyone in**; the same message gets `✅ Confirmed HH:MM`.
- **14:00** — one private reminder if the helper has not confirmed.

**Fair share:** each past day with a draw (last 60 days) gives every volunteer on duty `+1/N` credit and the chosen helper `−1`. The highest balance wins; exact ties are random. Someone who volunteers rarely is not picked more often per attendance than someone who volunteers daily.

## Registration

The helper looks people up in the badge system (Flipper), so everyone who presses **Check me in** registers their Flipper name once: pressing the button without one opens the bot's private chat (or send `/start flipper`, later `/flipper` to change it). **On duty** and **Discard** need no name. Everyone should also press `/start` in the private chat once, otherwise Telegram blocks the reminder.

Group admins register names for others: `/admin` in the private chat lists their commands, `/admin flipper` starts a loop of **Choose person** → name until **Finish**.

## Commands

- Group: `/today`, `/stats` (week), `/stats month`, `/history`, `/test`, `/help`.
- Private chat: `/start`, `/flipper`, `/schedule`, `/cancel`, `/help`, `/admin` (group admins only).

The bot publishes both lists to Telegram as scoped menus, so the group only suggests the group commands. A private-chat command typed in the group is answered once with a link to the bot's private chat, and `/start` or `/help` there lists everything available — the `/admin` line only for admins.

**`/schedule`** stores one choice, **🙋 Check me in** or **🛡 On duty**, and applies it the moment the next sign-up opens: a plan made in the evening lands on the next working morning, weekends and holidays included. It is used once, expires after seven days, and a planned check-in needs a Flipper name. Group membership is checked when the plan is made, not when it is applied — the same way a button press at 09:30 is not re-checked at 10:00.

**`/admin say <text>`** posts in the group through the bot; **`/admin say @username <text>`** writes to one person. Someone the bot cannot reach privately — never pressed Start, or blocked it — is nudged in the group instead, and the admin is told which happened.

Stats count confirmed duties only, by the assignment's Belgrade date. The records are self-reports, not readings from access-control hardware.

## Try it in the real group

`/test` posts a **[TEST]** control panel that walks through sign-up, closing, the reminder, confirmation and stats with labelled messages. Only the starter controls it, it expires after an hour, and its records never touch `/today`, `/stats` or `/history`.

## Local setup

Node **22.22.3** (`.nvmrc`).

1. Create a bot with **@BotFather → /newbot**; keep the token private.
2. `cp .env.example .env`, put the token there, `chmod 600 .env`.
3. Add the bot to the group with permission to send and edit messages (administrator is simplest). Privacy mode can stay on.
4. `npm ci`, `npm run build`.
5. With every other bot process stopped, run `npm run discover` and send `/setup@your_bot_username` in the group; save the reported ID as `TELEGRAM_CHAT_ID`.
6. `npm start`. Never run two pollers for the same token.

## Tests

`npm run typecheck` and `npm test` (builds first) run locally and in CI. Scenario tests use real SQLite and handlers, synthetic updates, a controlled clock and a mocked grammY boundary; a local HTTP simulator covers real requests, 403/429, connection loss and process restarts. Tests never read `.env` or contact Telegram.

## Operations

State lives in SQLite (WAL). A completed draw is frozen: never edit rows to reroll it. `npm run backup -- /abs/path.db` works while the bot runs; `npm run health` checks the heartbeat.

Everything else is in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md): deployment, logs, the step-by-step recovery of an ambiguous (`uncertain`) send with `npm run operations`, backup and restore, rollback (unsafe once a sign-up day exists) and production paths. Pushes to **main** deploy through GitHub Actions after types, tests and a container rollback check pass.

## API references

- [Inline keyboards](https://core.telegram.org/bots/api#inlinekeyboardmarkup) · [KeyboardButtonRequestUsers](https://core.telegram.org/bots/api#keyboardbuttonrequestusers) · [getUpdates](https://core.telegram.org/bots/api#getupdates) · [grammY transformers](https://grammy.dev/advanced/transformers)
