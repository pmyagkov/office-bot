#!/usr/bin/env bash
set -euo pipefail
image=${1:?Expected image}
root=$(mktemp -d)
export OFFICE_BOT_ROOT="$root"
export OFFICE_BOT_PROJECT="office-bot-rollback-$$"
export OFFICE_BOT_IMAGE_PREFIX="office-bot-rollback-$$"
export OFFICE_BOT_ENV_FILE="$root/bot.env"
export OFFICE_BOT_DEPLOY_LOCK="$root/deploy.lock"
export OFFICE_BOT_WAIT_SECONDS=30
export OFFICE_BOT_UID=$(id -u)
export OFFICE_BOT_GID=$(id -g)
good=1111111111111111111111111111111111111111
bad=2222222222222222222222222222222222222222
cleanup() {
  OFFICE_BOT_IMAGE="$OFFICE_BOT_IMAGE_PREFIX:$good" docker compose --project-name "$OFFICE_BOT_PROJECT" --project-directory "$root" -f "$root/releases/$good/compose.yaml" down >/dev/null 2>&1 || true
  docker image rm "$OFFICE_BOT_IMAGE_PREFIX:$good" "$OFFICE_BOT_IMAGE_PREFIX:$bad" >/dev/null 2>&1 || true
  # The test process owns this temporary directory; Docker runs as UID 1000.
  docker run --rm --user 0 --network none -v "$root:/cleanup" "$image" node -e 'require("node:fs").rmSync("/cleanup/data",{recursive:true,force:true})'
  rm -rf "$root"
}
trap cleanup EXIT
mkdir -p "$root/data" "$root/releases/$good" "$root/releases/$bad"
printf 'TELEGRAM_BOT_TOKEN=123456:dummy_dummy_dummy\nTELEGRAM_CHAT_ID=-100123\n' > "$OFFICE_BOT_ENV_FILE"
for sha in "$good" "$bad"; do cp compose.yaml "$root/releases/$sha/compose.yaml"; done
docker build --build-arg "BASE_IMAGE=$image" --build-arg "REVISION=$good" -f test/containers/healthy.Dockerfile -t "$OFFICE_BOT_IMAGE_PREFIX:$good" test/containers
docker build --build-arg "BASE_IMAGE=$image" --build-arg "REVISION=$bad" -f test/containers/broken.Dockerfile -t "$OFFICE_BOT_IMAGE_PREFIX:$bad" test/containers
docker save "$OFFICE_BOT_IMAGE_PREFIX:$good" | gzip -1 > "$root/releases/$good/image.tar.gz"
docker save "$OFFICE_BOT_IMAGE_PREFIX:$bad" | gzip -1 > "$root/releases/$bad/image.tar.gz"
bash scripts/remote-deploy.sh "$good"
before=$(docker ps --filter "label=com.docker.compose.project=$OFFICE_BOT_PROJECT" --format '{{.ID}}')
if bash scripts/remote-deploy.sh "$bad"; then echo 'Broken release unexpectedly succeeded' >&2; exit 1; fi
after=$(docker ps --filter "label=com.docker.compose.project=$OFFICE_BOT_PROJECT" --format '{{.ID}}')
[[ -n "$before" && -n "$after" && "$before" != "$after" ]]
read -r current < "$root/current.sha"
[[ "$current" == "$good" ]]
docker run --rm --network none --user "$OFFICE_BOT_UID:$OFFICE_BOT_GID" -v "$root/data:/app/data" "$image" node --input-type=module -e 'import assert from "node:assert/strict"; import {readdirSync} from "node:fs"; import {openStore} from "./dist/store.js"; const s=openStore("/app/data/office.db"); assert.equal(s.get("sentinel"),"survives rollback"); s.close(); assert.ok(readdirSync("/app/data/backups").some(n=>n.endsWith(".db"))); console.log("Failed-release rollback and data retention verified");'
