#!/usr/bin/env bash
set -euo pipefail
sha=${1:?Expected full Git SHA}
[[ "$sha" =~ ^[0-9a-f]{40}$ ]] || exit 2
target=${DEPLOY_TARGET:?Expected SSH target}
bundle=$(mktemp -d)
trap 'rm -rf "$bundle"' EXIT
docker save "office-bot:$sha" | gzip -1 > "$bundle/image.tar.gz"
ssh "$target" "mkdir -p services/office-bot/releases/$sha"
scp "$bundle/image.tar.gz" compose.yaml scripts/remote-deploy.sh "$target:services/office-bot/releases/$sha/"
ssh "$target" "bash services/office-bot/releases/$sha/remote-deploy.sh $sha"
