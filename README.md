# Notifox Reminders

An Obsidian community plugin that exports valid `🔔` reminder fields from active
Tasks Emoji-format tasks.

## Settings

Open **Settings → Notifox Reminders** to configure these options. The reminder
examples below use the timezone and default alert time from
[`docs/test_matrix.md`](docs/test_matrix.md), the reminder syntax reference.

|Setting|What it does|Example setting|
|---|---|---|
|Timezone|IANA timezone used to interpret task dates and local reminder times. Initially uses your device's timezone, or UTC if unavailable.|`America/Los_Angeles`|
|Default alert time|Time used by an empty `🔔`, offsets without `at`, and the implicit one-shot in a repeat-only field. Defaults to `09:00:00`.|`09:00:00`|
|ntfy.sh server|Base URL of the ntfy server included in the reminder export. Defaults to `https://ntfy.sh`.|`https://ntfy.sh`|
|notifox server|URL that receives the complete `reminders.json` via POST after each changed export. Blank disables POSTs (default).|`https://example.com/reminders`|

## Usage

Write an incomplete [Markdown task](https://help.obsidian.md/syntax#Task%20lists)
with a description, `🔔`, and at least one Tasks date. Keep the reminder before
all Tasks metadata. Replace `#task` with your Tasks Global Filter marker, or omit
it if no filter is configured. Examples use `America/Los_Angeles` and `09:00:00`.

|Rule|Behavior|
|---|---|
|Date selection|Uses due (`📅`), then scheduled (`⏳`), then start (`🛫`); an explicitly named anchor must exist.|
|Emoji spacing|Zero or more whitespace characters may follow emoji: `🔔📅2027-04-15`, `🔔⏬📅 2027-04-15`, and `🔔5pm 📅2027-04-15` are valid.|
|Multiple alerts|Separate clauses with commas; matching timestamps are deduplicated.|
|Intervals|Seconds, minutes, hours, days, and weeks support abbreviations and fractions; months and years are unsupported.|
|Repeats|One repeat clause, placed last; minimum interval is one minute after rounding to whole seconds.|
|Repeat seeds|`last` (also the default) uses the latest one-shot timestamp; `prev`/`previous` uses the preceding written one-shot.|
|Task recurrence|Tasks' `🔁` recurrence is separate from repeating reminder alerts.|

|Feature|Full task line|Reminders (local time)|
|---|---|---|
|Default time|`- [ ] #task Pay the design invoice in [[April budget]] #finance 🔔 ⏫ ➕ 2027-04-01 📅 2027-04-15`|`2027-04-15 09:00:00`|
|Multiple times|`- [ ] #task Review [[Launch checklist]] with the team #work 🔔 9am, 5pm 🔼 🛫 2027-04-01 ⏳ 2027-04-10 📅 2027-04-15`|`2027-04-15 09:00:00`; `2027-04-15 17:00:00`|
|Scheduled fallback; seconds|`- [ ] #task Join the rehearsal using [[Demo meeting link]] #work 🔔 14:00:30 🔼 🛫 2027-04-01 ⏳ 2027-04-10`|`2027-04-10 14:00:30`|
|Start fallback; fractional offset|`- [ ] #task Prepare the workshop materials in [[Workshop plan]] #teaching 🔔 1.5hr before 🔼 🛫 2027-04-01`|`2027-04-01 07:30:00`|
|Advance notice at a chosen time|`- [ ] #task Check the signed forms in [[Application checklist]] #admin 🔔 1 day before at 2pm ⏫ ⏳ 2027-04-10 📅 2027-04-15`|`2027-04-14 14:00:00`|
|All three anchors|`- [ ] #task Prepare and submit [[Conference proposal]] #writing 🔔 1d before due, .5h after scheduled, 5pm on start ⏫ ➕ 2027-03-25 🛫 2027-04-01 ⏳ 2027-04-10 📅 2027-04-15`|`2027-04-01 17:00:00`; `2027-04-10 09:30:00`; `2027-04-14 09:00:00`|
|Week offset; recurring task|`- [ ] #task Submit the weekly report from [[Team metrics]] #work 🔔 9am, 1 week before at 9am 🔼 🔁 every week 📅 2027-04-15`|`2027-04-08 09:00:00`; `2027-04-15 09:00:00`|
|Repeat-only shorthand|`- [ ] #task Check whether [[Release deployment]] has finished #ops 🔔 every 30m ⏫ 📅 2027-04-15`|`2027-04-15 09:00:00`; `2027-04-15 09:30:00`; then every 30 minutes.|
|Repeat after previous clause|`- [ ] #task Follow up on [[Vendor approval]] #work 🔔 5pm, 9am, every hour after prev 🔼 📅 2027-04-15`|`2027-04-15 09:00:00`; `2027-04-15 10:00:00`; then hourly, including one alert at `2027-04-15 17:00:00`. With `last`, repeats would begin at `2027-04-15 18:00:00`.|
|Explicit repeat boundary|`- [ ] #task Confirm the delivery slot in [[Office move]] #logistics 🔔 5pm, every 30m after 3pm ⏫ 📅 2027-04-15`|`2027-04-15 15:30:00`; `2027-04-15 16:00:00`; then every 30 minutes. No alert at `2027-04-15 15:00:00`; one at `2027-04-15 17:00:00`.|

## Dependencies

The plugin requires Tasks 8.x and honors its Global Filter marker. It writes a
complete nested JSON object to `plugins/notifox-reminders/reminders.json` under the
vault configuration directory. Configure the vault timezone, default alert
time, and ntfy server in the plugin settings. The ntfy server defaults to
`https://ntfy.sh`.

## Issues

The plugin best effort scans files in the vault for reminders, but may miss some
in rare cases. Use **Regenerate reminder JSON** to read and hash every Markdown
file when a same-size edit with a preserved modification time may have escaped metadata
reconciliation.

---

# Development

## Table of contents

|File|Description|
|---|---|
|[design_plan.md](docs/design_plan.md)|Plugin and service architecture, implementation behavior, synchronization, and reminder delivery.|
|[grammar.md](docs/grammar.md)|Reminder grammar, supported units, and parsing rules.|
|[project_structure.md](docs/project_structure.md)|TypeScript source files, their responsibilities, and the reminder export flow.|
|[reminders_json.md](docs/reminders_json.md)|Consumer contract for reminders.json fields, schedules, snapshot replacement, and delivery.|
|[test_matrix.md](docs/test_matrix.md)|Source of truth for reminder syntax, expected timestamps, and syntax-error acceptance criteria.|

## Development builds

Use a separate test vault; plugin bugs can modify vault data.

```sh
npm ci
npm run dev
```

Copy `main.js` and `manifest.json` into
`<test-vault>/.obsidian/plugins/notifox-reminders/`, then enable **Notifox
Reminders** under **Settings → Community plugins**. After a rebuild, reload the
plugin by toggling it off and on or by running **Reload app without saving**.

Before sharing a build, run the checks and create a minified bundle:

```sh
npm test
npm run lint
npm run build
```

## Production builds

1. **Set the version.** Update npm's version files, then set the same version in
   `manifest.json`. If `minAppVersion` changes, add the new version and its
   minimum supported Obsidian version to `versions.json`.

   ```sh
   npm version x.y.z --no-git-tag-version
   ```

2. **Check and build.** Install locked dependencies, run tests and lint, and
   produce the minified `main.js`. Continue only if every command succeeds.

   ```sh
   npm ci
   npm test
   npm run lint
   npm run build
   ```

3. **Publish the source.** Stage the release's source and version changes
   (including any new source files), review them, then commit and push to the
   repository's default branch so its `manifest.json` matches the release.

   ```sh
   git diff --cached
   git commit -m "Release x.y.z"
   git push
   ```

4. **Publish the release.** Tag the release commit exactly `x.y.z` without a
   `v` prefix, then upload both required files as individual assets.

   ```sh
   git tag x.y.z
   git push origin x.y.z
   gh release create x.y.z main.js manifest.json --verify-tag --title "x.y.z" --generate-notes
   ```

5. **Enable Community plugin updates (once).** Sign in to the
   [Obsidian Community directory](https://community.obsidian.md), link the
   GitHub account that owns the repository, and submit the plugin for review.
   Follow the official [submission guide](https://docs.obsidian.md/plugins/releasing/submit-plugin).
   After approval, repeat steps 1–4 for each update; Obsidian offers new releases
   through its Community plugins updater without resubmission.

Before approval, users can install the release assets manually or use
[BRAT](https://docs.obsidian.md/Plugins/Releasing/Beta-testing+plugins).
