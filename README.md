# Notifox Reminders

An Obsidian community plugin that exports valid `🔔` reminder fields from active
Tasks Emoji-format tasks.

The plugin requires Tasks 8.x and honors its Global Filter marker. It writes a
complete nested JSON object to `plugins/notifox-reminders/reminders.json` under the
vault configuration directory. Configure the vault timezone, default alert
time, and ntfy server in the plugin settings. The ntfy server defaults to
`https://ntfy.sh`. The exporter keeps a versioned per-file scan index
in its plugin data, coalesces live file events, and updates only affected notes.
It reconciles metadata when the plugin starts and when Obsidian returns from the
background. Matching path, modification time, and size are trusted during those
reconciliations.

Use **Regenerate reminder JSON** to read and hash every Markdown file when a
same-size edit with a preserved modification time may have escaped metadata
reconciliation. The command still avoids parsing unchanged content. The complete
output remains deterministically sorted, and the plugin does not rewrite
`reminders.json` when its canonical bytes are already current.

Timestamps are UTC RFC 3339 values. Repeating intervals are rounded integer
seconds; day and week durations are therefore 86,400 and 604,800 seconds.
The output includes the ntfy server as the top-level `ntfy-server` property. It
uses the vault name as another top-level key and groups reminder arrays under
vault-relative file-path keys. URI-encode those keys to form
`obsidian://open?vault=<vault>&file=<file>`.
Each reminder stores only its one-based `line` number because the enclosing
vault and file keys supply the rest of its location.

## Local development

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

## Public production build

Publish the contents of this directory as the root of a public GitHub
repository; Obsidian expects `README.md`, `LICENSE`, and `manifest.json` there.

1. Choose an `x.y.z` version. Run
   `npm version x.y.z --no-git-tag-version`, set the same version in
   `manifest.json`, and add `"x.y.z": "1.8.7"` to `versions.json` when the
   minimum supported Obsidian version changes.
2. Run `npm ci`, `npm test`, `npm run lint`, and `npm run build`.
3. Commit and push the source and updated version files.
4. Create a public GitHub release whose tag is exactly `x.y.z`—without a `v`
   prefix—and attach `main.js` and `manifest.json` as individual files.

Users can now install the attached files manually. For easier public beta
distribution before directory approval, use
[BRAT](https://docs.obsidian.md/Plugins/Releasing/Beta-testing+plugins).

## Public production builds with automatic updates

First complete the public production release above. Then sign in to the
[Obsidian Community directory](https://community.obsidian.md), connect the
GitHub account that owns the repository, and submit the plugin for review.

After the initial version is approved, do not resubmit each update. For every
new version:

1. Update the version files and build using the production steps above.
2. Publish a GitHub release with a matching `x.y.z` tag and the two required
   assets: `main.js` and `manifest.json`.
3. Keep the default branch's `manifest.json` on that same latest version.

Obsidian will discover the release and offer it to installed users through its
Community plugins updater. See the official
[submission guide](https://docs.obsidian.md/plugins/releasing/submit-plugin)
for current review and release requirements.
