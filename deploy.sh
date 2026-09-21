#!/usr/bin/env bash

set -euo pipefail

repo_dir="/f/Code/notifox/obsidian"
plugin_dir="/f/Cloud/mooman219-drive/Documents/Obsidian/.obsidian/plugins/notifox-reminders"
mobile_dir="/f/Cloud/mooman219-drive/Documents/Obsidian/.obsidian_mobile/plugins/notifox-reminders"

cd "$repo_dir"

npm test
npm run lint
npm run build

mkdir -p "$plugin_dir"
cp main.js styles.css "$plugin_dir/"
printf 'Deployed main.js and styles.css to %s\n' "$plugin_dir"

mkdir -p "$mobile_dir"
cp main.js styles.css "$mobile_dir/"
printf 'Deployed main.js and styles.css to %s\n' "$mobile_dir"
