#!/usr/bin/env bash
set -euo pipefail
umask 077
sha=${1:?Expected full Git SHA}
[[ "$sha" =~ ^[0-9a-f]{40}$ ]] || { echo 'Invalid release SHA' >&2; exit 2; }
root=${OFFICE_BOT_ROOT:-$HOME/services/office-bot}
project=${OFFICE_BOT_PROJECT:-office-bot}
prefix=${OFFICE_BOT_IMAGE_PREFIX:-office-bot}
export OFFICE_BOT_ENV_FILE=${OFFICE_BOT_ENV_FILE:-/opt/nanoclaw/secrets/office-bot/bot.env}
release="$root/releases/$sha"
test -r "$OFFICE_BOT_ENV_FILE"
test -f "$release/compose.yaml"
mkdir -p "$root/data/backups"
exec 9>"${OFFICE_BOT_DEPLOY_LOCK:-/opt/nanoclaw/deploy.lock}"
flock -w 600 9

previous=''
if [[ -f "$root/current.sha" ]]; then read -r previous < "$root/current.sha"; fi
if [[ -n "$previous" && ! "$previous" =~ ^[0-9a-f]{40}$ ]]; then echo 'Invalid previous release' >&2; exit 2; fi
docker load -i "$release/image.tar.gz"
revision=$(docker image inspect "$prefix:$sha" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')
[[ "$revision" == "$sha" ]] || { echo 'Image revision mismatch' >&2; exit 2; }

compose() {
  local version=$1
  shift
  OFFICE_BOT_IMAGE="$prefix:$version" docker compose --project-name "$project" --project-directory "$root" -f "$root/releases/$version/compose.yaml" "$@"
}
if [[ -f "$root/data/office.db" ]]; then
  backup_image="$prefix:${previous:-$sha}"
  docker run --rm --network none --user "${OFFICE_BOT_UID:-1000}:${OFFICE_BOT_GID:-1000}" -v "$root/data:/app/data" "$backup_image" node dist/cli.js backup "/app/data/backups/before-$sha-$(date +%s%N).db"
fi

# Stop first: there must never be two Telegram pollers for this token.
if [[ -n "$previous" ]]; then compose "$previous" stop bot; fi
if compose "$sha" up -d --wait --wait-timeout "${OFFICE_BOT_WAIT_SECONDS:-150}" bot; then
  printf '%s\n' "$sha" > "$root/current.sha.tmp"
  mv "$root/current.sha.tmp" "$root/current.sha"
  rm -f "$release/image.tar.gz"
  echo "Deployed $sha"
else
  echo 'New release failed health check; rolling back' >&2
  compose "$sha" down --timeout 45
  if [[ -n "$previous" ]]; then
    compose "$previous" up -d --wait --wait-timeout "${OFFICE_BOT_WAIT_SECONDS:-150}" bot
    echo "Rolled back to $previous" >&2
  fi
  exit 1
fi

# Only remove older images belonging to this bot; retain current and previous.
while IFS= read -r tag; do
  if [[ "$tag" =~ ^[0-9a-f]{40}$ && "$tag" != "$sha" && "$tag" != "$previous" ]]; then
    docker image rm "$prefix:$tag" || true
    rm -f "$root/releases/$tag/image.tar.gz"
  fi
done < <(docker image ls "$prefix" --format '{{.Tag}}')
