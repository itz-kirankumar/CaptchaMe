#!/usr/bin/env bash
# Downloads the GitHub-hosted validation datasets into validation/data/ (git-ignored, never redistributed),
# pinned to the exact commits the published numbers were produced with. Needs only git and GitHub access.
# Datasets on other hosts (Hugging Face, Zenodo, Kaggle, university sites) are listed in validation/MANIFEST.json
# with how to obtain them; they cannot be fetched from a GitHub-only environment.
set -euo pipefail
cd "$(dirname "$0")"
DATA="${DATA_DIR:-data}"; mkdir -p "$DATA"; cd "$DATA"

pin() { # repo dir sha
  local repo="$1" dir="$2" sha="$3"
  if [ ! -d "$dir/.git" ]; then git clone -q --filter=blob:none --no-checkout "https://github.com/$repo.git" "$dir"; fi
  git -C "$dir" fetch -q --depth 1 origin "$sha" 2>/dev/null || git -C "$dir" fetch -q origin
  git -C "$dir" checkout -q "$sha"
  echo "  $repo @ ${sha:0:12}"
}
echo "Fetching pinned datasets into $(pwd)"
pin balabit/Mouse-Dynamics-Challenge   Mouse-Dynamics-Challenge d00d6f779254
pin chrisgdt/delbot-mouse              delbot-mouse             712a00ea9947
pin rakshithca/keystroke-dynamics      cmu-mirror               31fef1a5ee93
pin mintlify/agent-traffic             agent-traffic            ee1bc00a8c11
pin monperrus/crawler-user-agents      crawler-user-agents      a727b3579080
pin microlinkhq/top-user-agents        top-user-agents          4e6907b5de63
pin erfanjaripour/stroop-interference  stroop-interference      cb11fe246ee0

# delbot ships its sessions as a tarball
[ -d delbot-data ] || { mkdir delbot-data && tar xzf delbot-mouse/python/dataset.tar.gz -C delbot-data; }
echo "Done. Next: node validation/run.js"
