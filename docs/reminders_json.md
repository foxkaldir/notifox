# reminders.json consumer specification

This document describes the JSON currently emitted by the plugin for other programs to consume. It covers the exported data contract; [design_plan.md](design_plan.md) describes exporter implementation behavior, and [test_matrix.md](test_matrix.md) remains the source of truth for reminder syntax and its interpretation.

## Location and scope

The file is written at `<vault>/<configDir>/plugins/notifox-reminders/reminders.json`, normally `<vault>/.obsidian/plugins/notifox-reminders/reminders.json`. The configuration directory can differ from `.obsidian`.

Each document is a complete snapshot of the exporter's current reminder results for one vault, not a list of changes or notification delivery events. It contains resolved timestamps, reminder text, and an optional Tasks priority. Reminder expressions are not exported. The adjacent `data.json` is internal plugin state and is not part of this interface.

## Document shape

```json
{
  "ntfy-server": "https://ntfy.sh/your-topic",
  "Work Notes": {
    "Projects/Launch.md": [
      {
        "line": 12,
        "text": "Submit launch plan",
        "priority": "high",
        "one-shots": [
          { "timestamp": "2027-04-15T16:00:00Z" },
          { "timestamp": "2027-04-16T00:00:00Z" }
        ]
      },
      {
        "line": 24,
        "text": "Check deployment",
        "one-shots": [
          { "timestamp": "2027-04-15T16:00:00Z" }
        ],
        "repeat": {
          "timestamp": "2027-04-15T16:30:00Z",
          "duration": 1800
        }
      },
      {
        "line": 31,
        "text": "Review metrics",
        "priority": "low",
        "repeat": {
          "timestamp": "2027-04-15T17:00:00Z",
          "duration": 3600
        }
      }
    ]
  }
}
```

This example illustrates a snapshot resolved before the listed occurrences. In `America/Los_Angeles`, `2027-04-15T16:00:00Z` is `2027-04-15 09:00:00` and `2027-04-16T00:00:00Z` is `2027-04-15 17:00:00`.

|Property|Type|Meaning|
|---|---|---|
|`ntfy-server`|string|Configured HTTP(S) ntfy URL including a topic, initially blank. Consumers should validate it before delivery.|
|`<vault name>`|object|One dynamic property named with Obsidian's current vault name. Its value maps note paths to reminder arrays.|
|`<vault name>[<note path>]`|array of reminder objects|Nonempty array for a Markdown note, using its vault-relative path with `/` separators and its extension, such as `Projects/Launch.md`.|

The vault property is a display name, not the internal `vaultId`. Treat vault names and paths as literal, case-preserving strings, not URLs or dotted property expressions. Access them through dictionary/map lookups.

`ntfy-server` is reserved at the top level. The current implementation does not escape a vault with that exact name: its vault object overwrites the server property. Such a document does not satisfy the normal shape above; consumers should reject it as an unsupported name collision.

Notes without exported reminders are omitted. When no reminders remain, the vault object is still present:

```json
{
  "ntfy-server": "https://ntfy.sh/your-topic",
  "Work Notes": {}
}
```

## Reminder fields

|Property|Type|Required|Meaning|
|---|---|---|---|
|`line`|integer greater than zero|Yes|One-based physical line number of the task in the Markdown note.|
|`text`|string|Yes|Trimmed task description before `🔔`, excluding the list marker, checkbox, configured Tasks Global Filter, reminder expression, and trailing Tasks metadata. Markdown formatting and other tags are preserved. May be empty.|
|`priority`|string|No|Explicit Tasks priority: `highest` (🔺), `high` (⏫), `medium` (🔼), `low` (🔽), or `lowest` (⏬). Omitted when no priority emoji exists; no default priority is emitted.|
|`one-shots`|nonempty array of objects|No|Remaining individual occurrences, sorted chronologically and deduplicated by instant within this task. Omitted when none remain.|
|`one-shots[].timestamp`|string|Yes, within each item|An absolute UTC instant.|
|`repeat`|object|No|The repeating portion of this task's schedule. At most one repeat exists per task.|
|`repeat.timestamp`|string|Yes, within `repeat`|The next repeat occurrence at or after the time used to resolve the task. This is an occurrence to deliver, not the original seed or an exclusive start boundary.|
|`repeat.duration`|integer number of seconds, at least 60|Yes, within `repeat`|The parsed interval rounded to whole seconds. This is neither milliseconds nor an ISO duration string.|

A freshly resolved reminder has `one-shots`, `repeat`, or both. Optional fields are omitted rather than emitted as `null`; the exporter does not create empty `one-shots` arrays. Consumers can defensively treat a record with neither schedule field as having no occurrences, since cached state is not strictly validated against all these constraints.

For example, with Global Filter `#task`, `- [ ] #task Submit **launch plan** 🔔 9am ⏫ 📅 2027-04-15` exports `text: "Submit **launch plan**"` and `priority: "high"`. The filter is removed as literal text, case-insensitively. Priority names follow [Tasks priority terminology](https://publish.obsidian.md/tasks/Queries/Grouping).

Timestamps are produced by `Temporal.Instant.toString()` in UTC with a `Z` suffix. Current calculations have whole-second precision, for example `2027-04-15T16:00:00Z`. Parse them as absolute instants rather than interpreting them in the consumer's local timezone or assuming a fixed string length.

## Schedule interpretation

One-shots earlier than the resolver's current time are removed; an occurrence exactly at that time is retained. A task whose one-shots are all past and which has no repeat is omitted. Repeat timestamps advance to the next occurrence at or after that time. The original repeat seed is not exported.

For a fixed elapsed interval, deliver the repeat at `repeat.timestamp`, then at that instant plus `duration` seconds, plus twice `duration`, and so on. For example, `2027-04-15T16:30:00Z` with duration `1800` represents `2027-04-15T16:30:00Z`, `2027-04-15T17:00:00Z`, and `2027-04-15T17:30:00Z`, continuing without an exported end date or count.

The effective schedule is the union of one-shots and repeat occurrences. The resolver removes one-shots that coincide with the repeat sequence. Consumers should also deduplicate equal instants within a task when combining schedules; equal instants belonging to different tasks are separate reminders.

**Calendar-repeat limitation:** the source syntax supports calendar day/week arithmetic. The export reduces these units to nominal seconds (`86400` per day, `604800` per week) and omits the timezone, original unit, and seed. Across daylight-saving changes, repeatedly adding `duration` seconds cannot necessarily reproduce the source calendar schedule. The exported next occurrence is resolved in the configured timezone, but this payload alone is insufficient to reconstruct all later calendar occurrences faithfully. Integrations requiring that fidelity need a richer contract; do not infer the original unit from `duration`.

## Identity and snapshot replacement

Within one snapshot, `(vault name, note path, line)` locates a task. It is not a durable task ID: inserting lines, moving a task, renaming a note, or renaming the vault can change it. Separate vaults can also share a name. A consumer handling multiple producers must associate each snapshot with a producer identity outside this payload.

On accepting a new snapshot, replace that producer's previously stored schedule set. Remove schedules for notes and tasks no longer present, including when the vault object becomes empty. Add or replace schedules for present tasks. Do not merge indefinitely by line number, and do not interpret a changed locator as proof of a newly created task.

The payload includes no Tasks ID, status, source dates, original expression, timezone, default alert time, notification topic/body, authentication credentials, delivery acknowledgments, generation time, sequence number, or wire-format version. Internal persistence/schema version constants are not exported version identifiers. Consumers cannot determine ordering between conflicting snapshots or exactly-once delivery from this file alone.

Only eligible active Tasks tasks (`TODO`, `IN_PROGRESS`, or `ON_HOLD`, according to the Tasks status mapping) with a valid reminder are exported, subject to the Tasks Global Filter. Inactive tasks, missing reminder fields, invalid fields, and unresolvable required dates produce no record. Diagnostics are not included, so absence does not explain why a task was omitted.

## Updates and transport

The plugin writes the complete JSON only when its serialized content changes. Vault events, startup, settings changes, foreground reconciliation, and manual regeneration can cause updates. There is no periodic freshness guarantee or write at every occurrence. Cached timestamps can therefore be in the past when a consumer reads the file. Consumers must maintain their own delivery state and missed-occurrence policy.

Startup and reconciliation can repair missing or externally modified output. Treat this file as generated output; edits are not imported into notes. Configuration or read failures can leave previous results in place, and a snapshot may include cached results for a note whose read failed. The payload has no freshness or error indicator.

The exporter writes through Obsidian's adapter without an explicit temporary-file/atomic-rename protocol. File watchers should read and validate a complete document before replacing accepted state, retain their last accepted snapshot on a read/parse failure, and retry the read.

If the separate **notifox server** setting is nonblank, a successful changed file write is followed by an HTTP `POST` to that HTTP/HTTPS URL with `Content-Type: application/json` and the exact saved JSON as the body. The receiver URL is not the exported `ntfy-server` value and is not included in the payload.

Unchanged content is not POSTed, including after changing the receiver URL or after a failed request. Failed local writes do not POST. Failed POSTs leave the local file intact and have no automatic network retry. A receiver should accept full replacements idempotently; integrations needing guaranteed delivery or ordering must provide that separately.

## Parsing and compatibility

Use a standard JSON parser. The current writer uses two-space indentation and a trailing newline, sorts file keys with JavaScript `localeCompare`, and sorts each note's reminders by ascending line number. Formatting and object property order should not affect consumer behavior; JSON objects are unordered mappings under [RFC 8259](https://www.rfc-editor.org/rfc/rfc8259.html#section-4).

Validate the known field types and schedule values before accepting a snapshot. Additional fields inside reminder objects can be ignored for forward compatibility, but do not guess the meaning of an unfamiliar document shape. Since the wire format has no version field, this document does not promise that future breaking changes can be detected by a version check.

The implementation references for this contract are [`ExportReminder`](../src/types.ts), [`collectFileReminders` and HTTP delivery](../src/exporter.ts), [`canonicalOutput`](../src/persistence.ts), and [schedule resolution](../src/resolver.ts).

After a changed export is successfully written, the plugin shows a notice directing users to Settings → Notifox reminders → ntfy.sh server if at least one reminder exists and the URL lacks a valid topic. Empty exports and unchanged output do not trigger this notice. Exporting and posting continue so reminder updates are preserved. Topic URLs use HTTP(S), a single topic containing letters, digits, underscores or hyphens, and no embedded username/password or fragment. Query parameters, including optional `auth`, are preserved in the URL in data.json, reminders.json, and the JSON POST. For token authentication, `auth` is the base64 encoding of `Bearer YOUR_TOKEN` with trailing `=` removed; URL-encode the result. See [ntfy query authentication](https://docs.ntfy.sh/publish/#query-param).
