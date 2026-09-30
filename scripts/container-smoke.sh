#!/usr/bin/env bash
set -euo pipefail
image=${1:?Expected image}
volume="office-bot-smoke-${RANDOM}-$$"
docker volume create "$volume" >/dev/null
trap 'docker volume rm "$volume" >/dev/null' EXIT
docker run --rm --network none -v "$volume:/app/data" "$image" node --input-type=module -e 'import {openStore} from "./dist/store.js"; const s=openStore("/app/data/office.db"); s.set("sentinel",{helper:11,recipients:[22],confirmedAt:"2026-09-30T08:00:00Z"}); await s.backup("/app/data/copy.db"); s.close();'
docker run --rm --network none -v "$volume:/app/data" "$image" node --input-type=module -e 'import assert from "node:assert/strict"; import {openStore} from "./dist/store.js"; for(const p of ["office.db","copy.db"]){const s=openStore(`/app/data/${p}`); assert.deepEqual(s.get("sentinel"),{helper:11,recipients:[22],confirmedAt:"2026-09-30T08:00:00Z"}); s.close();} console.log("Container persistence and backup verified");'
