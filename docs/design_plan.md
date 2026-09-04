# Obsidian Task Reminder Plugin and Service Design Plan

## 1. Purpose

Notifox adds server-backed reminders to tasks recognized by the Obsidian Tasks plugin. A standalone `🔔` field opts a task into reminders. The Obsidian plugin discovers and uploads enrolled task lines; the Rust service is authoritative for parsing, validation, schedule resolution, persistence, and ntfy delivery.

The parser and reminder-expression resolver must satisfy every normative example in [`test_matrix.md`](./test_matrix.md). Row-level parse results, absolute occurrence timestamps, and named syntax-error identifiers are the syntax acceptance contract. Runtime behavior is specified in this design plan and covered by implementation-specific tests.

## 2. Goals

- Support empty, one-shot, offset, multiple, and repeating reminder clauses exactly as specified in the test matrix.
- Support due, scheduled, and start dates with default priority `due > scheduled > start`.
- Preserve the distinction between chronological `last` and lexical `previous`/`prev`.
- Support seconds, minutes, hours, days, and weeks; their documented abbreviations; attached or separated units; leading-decimal fractions; and the documented rounding rules.
- Keep reminder delivery running while Obsidian is closed.
- Synchronize safely from multiple Obsidian devices without allowing a stale device to overwrite a newer file snapshot.
- Produce stable machine-readable syntax diagnostics matching the error IDs in the matrix, plus operational diagnostics defined by the relevant implementation sections.

Month and year intervals are intentionally excluded because their duration depends on the starting date rather than representing a precise number of seconds, consistent with the [WHATWG duration model](https://html.spec.whatwg.org/multipage/common-microsyntaxes.html#durations).
- Use ntfy as a delivery channel, not as the durable scheduler.

## 3. Non-goals for v1

- Tasks formats other than the Tasks Emoji format.
- Absolute reminder dates inside `🔔`.
- Multiple repeat streams in one reminder field.
- Repeat counts, end dates, or cutoffs.
- Inline timezone declarations.
- One-shot symbolic seeds such as `after last`; `last`, `previous`, and `prev` belong to repeat clauses.
- Resolving Markdown merge conflicts between devices.
- Treating a task without a real standalone `🔔` as enrolled.

## 4. Sources of Truth

For reminder syntax and syntax diagnostics, use the following precedence when specifications disagree:

1. An explicitly approved correction in `test_matrix.md`.
2. A row-level expected parse result in `test_matrix.md`.
3. The section-level syntax rules in `test_matrix.md`.
4. The grammar in `reminder_grammar.md`.
5. Implementation details and library defaults.

For lifecycle, schedule materialization, identity, synchronization, persistence, and delivery behavior, this design plan is authoritative; those concerns are intentionally outside the syntax matrix.

Do not add a special case solely to make an internally inconsistent example pass. Correct the specification first and then encode the corrected row as a regression test.

### Fractional-second rounding

Represent interval quantities exactly. When interval resolution produces fractional seconds, round the nonnegative magnitude to the nearest whole second, with an exact half-second rounded up. Apply a one-shot direction only after rounding the magnitude. This makes `55.5s` resolve to 56 seconds and gives symmetric behavior for `before` and `after`.

An explicitly zero one-shot offset remains valid. A syntactically positive one-shot duration that rounds to zero returns `POSITIVE_DURATION_ROUNDS_TO_ZERO`. For repeats, perform the same rounding first and then return `MINIMUM_REPEAT_INTERVAL` when the rounded interval is below the configured minimum.

## 5. System Architecture

```text
Markdown task line
    ↓
Obsidian plugin
  - listens for vault changes
  - obtains Tasks semantic context
  - detects candidate bell fields
  - uploads atomic file snapshots
    ↓ HTTPS + vault bearer token
Rust Notifox service
  - canonical parser and diagnostics
  - date/time resolver
  - durable scheduler and outbox
    ↓ authenticated publish
ntfy
    ↓
subscriber devices and Web Push
```

### Repository responsibilities

- `notifox-obsidian`: TypeScript Obsidian plugin, settings UI, file observation, provisional validation, synchronization, and server diagnostic display.
- `notifox-server`: Rust HTTP API, canonical parser, resolver, persistence, scheduler, outbox, and ntfy client.
- `notifox-ntfy`: ntfy and tunnel deployment plus the future Notifox service container wiring.
- `notifox-spec`: normative Markdown, generated conformance fixtures, and protocol examples shared across repositories.

## 6. Enrollment and Task Discovery

### Bell detection

- A task is enrolled only when its Tasks-parsed description contains one standalone `🔔` outside inline code.
- A code-span bell is literal text and does not enroll the task.
- More than one standalone bell produces `MULTIPLE_REMINDER_FIELDS`.
- `🔔` with no clause is valid and creates one default-time reminder.
- Zero or more whitespace characters may follow the bell and Tasks metadata emoji; `🔔5pm`, `🔔📅2027-04-15`, and `🔔⏬📅 2027-04-15` are valid. Spaces, tabs, and Unicode whitespace within a task line are accepted.
- Removing the bell removes reminder state and all pending occurrences.

### Tasks integration

The plugin uses the Tasks plugin's recognized task data rather than independently reimplementing all Tasks settings. For each candidate line it supplies:

- full raw Markdown line;
- Tasks-parsed description containing the bell field;
- normalized vault-relative path and one-based line number;
- optional Tasks ID;
- Tasks status type;
- due, scheduled, and start dates as optional ISO dates;
- file content hash and previously accepted server revision.

The server remains authoritative for the reminder field. Tasks semantic context is authoritative for whether a line is a task, its configured status type, and its date metadata.

The reminder field must appear at the start of the Tasks emoji group, after the description and before every Tasks metadata field. The exporter reads reminder content from after `🔔` through the first Tasks metadata field, or through the end of the task line when no metadata follows. Metadata boundaries do not require whitespace and include all priority markers (`🔺`, `⏫`, `🔼`, `🔽`, `⏬`). Adjacent bells are still counted as multiple fields. A bell between or after Tasks metadata produces `INVALID_FIELD_POSITION`, preventing the reminder text from breaking Tasks' [field-order behavior](https://publish.obsidian.md/tasks/Editing/Auto-Suggest).

## 7. Canonical Reminder Grammar

The canonical parser grammar, lexical rules, units, numbers, and times are defined in the [Reminder Grammar Specification](reminder_grammar.md).

## 8. Canonical Intermediate Model

The parser returns either a complete field AST or diagnostics; partial schedules are never produced from an invalid field.

```text
ReminderField
  clauses: Vec<Clause>

Clause
  OneShot(OneShotClause)
  Repeat(RepeatClause)

OneShotClause
  kind: Time | Offset
  time: optional LocalTime
  quantity: optional ExactQuantity
  direction: optional Before | After
  anchor: optional Due | Scheduled | Start
  source_index: integer

RepeatClause
  interval: ExactQuantity
  seed: Last | Previous | ExplicitTime
  anchor: optional Due | Scheduled | Start
  source_index: integer
```

The parser enforces at most one repeat clause and requires it to be last.

Repeat-interval validation is a semantic step over the normalized exact quantity. Apply the approved fractional-second rounding rule first, then compare the result with the `minimum_repeat_interval` validation-policy input. This policy is one minute in v1 and is not a user-editable vault setting. A below-minimum interval returns `MINIMUM_REPEAT_INTERVAL` before seed resolution or schedule creation; an interval equal to the minimum is valid.

## 9. Date and Time Resolution

### Anchor selection

- An omitted anchor selects the first available date in this order: due, scheduled, start.
- If none exist, return `NO_VALID_DATE`.
- An explicit missing anchor returns `MISSING_ANCHOR_DATE`, even when another date exists.
- The configured vault IANA timezone and default alert time are required resolution inputs.

### One-shots

- A time one-shot combines its selected date with the explicit time.
- An offset one-shot combines the selected date with its explicit `at` time or the vault default, then applies the duration in the named direction.
- Syntactically zero offsets leave the combined timestamp unchanged; positive offsets that round to zero are invalid.
- Resolve every one-shot before resolving a symbolic repeat seed.
- Sort output chronologically and deduplicate equal instants for the same task.

### Duration arithmetic

- Seconds, minutes, and hours are elapsed durations.
- Integer days and weeks are calendar shifts preserving local wall-clock time.
- A fractional day or week applies its integer calendar part first, then its fractional remainder as elapsed time using 24 hours per day and seven days per week.
- Round fractional-second magnitudes once, using the fractional-second rule in this design plan, before applying direction, resolving the final instant, or deduplicating.

### DST policy

- A nonexistent local time advances to the first valid local time.
- An ambiguous local time uses the earlier occurrence.
- Calendar-day arithmetic preserves local wall-clock time across transitions.
- Elapsed-hour arithmetic preserves elapsed duration and may change the displayed wall-clock hour.

This is an explicit Notifox policy and must not be inherited implicitly from a date-time library's default disambiguation mode.

## 10. Repeat Resolution

- A repeat-only field always creates an implicit one-shot at the default alert time on the default selected date.
- A repeat with no `after` clause implicitly uses `last` as its seed.
- `last` selects the chronologically latest resolved explicit one-shot. If no explicit one-shot exists, use the implicit default one-shot.
- `previous` and `prev` select the one-shot lexically preceding the repeat. If none exists, use the implicit default one-shot.
- An explicit time seed is a boundary and is not itself an alert. The repeat-only implicit default still alerts.
- Occurrence `n` is calculated from the original seed as `seed + n × interval`; never advance from the previous delivered occurrence.
- Repeats have no cutoff in v1 and continue while the task remains active.
- When an explicit one-shot and repeat occurrence resolve to the same instant, emit one notification.

The scheduler stores only the next repeat occurrence, its zero-based or one-based occurrence index, and the immutable original seed. It must not materialize an unbounded series.

## 11. Diagnostics

Canonical reminder-syntax diagnostics use the error IDs and descriptions in `test_matrix.md`. Operational diagnostics are defined by the relevant implementation sections rather than the syntax matrix.

```json
{
  "code": "INVALID_REPEAT_SEED",
  "message": "A repeat seed must be last, previous, prev, or an explicit time.",
  "clauseIndex": 0,
  "range": { "start": 19, "end": 25 }
}
```

Requirements:

- Return stable codes; message wording may improve without breaking clients.
- Return source ranges relative to the reminder field and the full raw line.
- Parsing is atomic: one error invalidates the field and produces no schedule.
- The plugin may show provisional structural errors, but the server response replaces them as canonical.

## 12. Task Identity

- If a Tasks ID exists, identity is `(vault_id, tasks_id)`.
- Otherwise identity is `(vault_id, normalized_path, one_based_line_number)`.
- Paths use `/`, have no leading slash, preserve case, and are interpreted relative to the vault root.
- Moving an ID'd task preserves identity and delivery history.
- Moving an un-ID'd task deletes the old identity and creates a new one.
- Duplicate Tasks IDs invalidate all colliding enrolled tasks with `DUPLICATE_TASK_ID` until the collision is resolved.

## 13. HTTP API

All endpoints use JSON over HTTPS and `Authorization: Bearer <vault-token>`. A token is scoped to exactly one vault.

### `GET /v1/vault`

Returns vault configuration, its revision, and accepted source-file revisions and hashes for reconciliation.

### `PUT /v1/vault/config`

Updates:

```json
{
  "defaultAlertTime": "09:00:00",
  "timeZone": "America/Los_Angeles",
  "ntfyTopic": "notifox-example"
}
```

Require the previously observed configuration revision. A successful change rebuilds affected future schedules atomically.

### `POST /v1/vault/validate`

Accepts one task snapshot and resolution context without persisting it. Returns:

- enrolled/not-enrolled state;
- normalized AST when valid;
- canonical diagnostics when invalid;
- resolved one-shots;
- repeat seed and a bounded occurrence preview.

### `POST /v1/vault/sync`

Accepts an idempotency UUID, device UUID, and an atomic list of file snapshots:

```json
{
  "requestId": "uuid",
  "deviceId": "uuid",
  "files": [
    {
      "path": "Projects/report.md",
      "baseRevision": "opaque-revision-or-null",
      "contentHash": "sha256-hex",
      "deleted": false,
      "tasks": [
        {
          "lineNumber": 42,
          "rawLine": "- [ ] Submit report 🔔 1d before 📅 2027-04-15",
          "description": "Submit report 🔔 1d before",
          "tasksId": null,
          "statusType": "TODO",
          "due": "2027-04-15",
          "scheduled": null,
          "start": null
        }
      ]
    }
  ]
}
```

The response returns accepted file revisions and each enrolled task's state, diagnostics, and schedule preview.

### Concurrency rules

- Replay of the same request ID returns the stored response.
- A different request with identical accepted content is idempotent and does not churn schedules.
- A divergent snapshot based on a stale revision rejects the entire batch with `409 Conflict`.
- A device may delete a path only when it proves knowledge of the currently accepted revision.
- A newly installed device must not delete server-known files merely because they are absent locally.

## 14. Persistence Model

Use SQLite in WAL mode for v1. Apply schema migrations at service startup before accepting traffic.

Core records:

- `vaults`: configuration, configuration revision, hashed bearer-token identity, ntfy topic.
- `source_files`: vault, path, content hash, opaque revision, last accepted device and time.
- `tasks`: stable task key, source location, raw line, status, dates, parsed field, validity, diagnostics, schedule generation.
- `one_shots`: task, resolved instant, delivery state.
- `repeats`: task, original seed, exact interval, next occurrence index, next instant.
- `delivery_history`: logical occurrence identity, scheduled instant, delivered time, ntfy sequence ID.
- `outbox`: pending ntfy publish, retry count, next attempt, last error.
- `idempotency_requests`: vault, request ID, request hash, serialized response, expiry.

Apply a file snapshot, task rebuilds, cancellations, and outbox suppression in one transaction.

## 15. Scheduler and Recovery

- Maintain a wake-up time for the earliest pending one-shot, repeat, or retry.
- On wake-up, claim due work transactionally and write outbox entries before performing network I/O.
- Use database time comparisons in UTC; retain the originating IANA zone and local resolution inputs for rebuilds.
- Newly enrolled, edited, moved, or reopened tasks schedule only future occurrences.
- A repeat whose seed is in the past advances mathematically to its next future occurrence without iterating through every prior occurrence.
- After genuine service downtime, if an already-active and still-eligible task missed one or more occurrences, emit exactly one immediate catch-up representing the chronologically latest missed occurrence, then advance to the next future occurrence.
- Do not catch up when no occurrence was missed, when the task became ineligible before recovery, or when past occurrences are first observed because a task was newly enrolled, edited, moved, or reopened.
- Late delivery never shifts later occurrences.
- DONE, CANCELLED, and NON_TASK states suppress all future occurrences and undelivered outbox entries. TODO, IN_PROGRESS, and ON_HOLD remain eligible.

## 16. ntfy Delivery

Notifox publishes when an occurrence becomes due. Do not pre-schedule the full reminder series in ntfy: ntfy delayed delivery has a configurable limit and defaults to a maximum of three days, which cannot represent longer schedules or indefinite repeats. See [ntfy scheduled delivery](https://docs.ntfy.sh/publish/).

Publish using a server-held ntfy bearer token:

```json
{
  "topic": "vault-topic",
  "title": "Obsidian task reminder",
  "message": "- [ ] Submit report 🔔 1d before 📅 2027-04-15",
  "tags": ["alarm_clock"],
  "sequence_id": "deterministic-occurrence-id"
}
```

- Derive the sequence ID from vault ID, stable task identity, schedule generation, and scheduled instant.
- Retry transient and ambiguous failures with the same sequence ID.
- Use a durable outbox with bounded exponential backoff and jitter.
- A successful publish records delivery history and advances the repeat in one database transaction.
- Permanent authentication or authorization errors stop automatic retry after a bounded threshold and surface an operational error.

ntfy supports bearer tokens and custom sequence IDs for updating and deduplicating notification sequences. See [ntfy publishing and authentication](https://docs.ntfy.sh/publish/).

## 17. Obsidian Plugin Behavior

- Require the Tasks plugin and Tasks Emoji format; disable synchronization with a clear settings error otherwise.
- On startup, scan Markdown files and reconcile snapshots without deleting paths the device has never synchronized.
- Subscribe to vault create, modify, rename, and delete events; debounce writes by path.
- Re-read the complete file after debounce and upload a complete file snapshot, not line deltas.
- On rename, send the new snapshot and a conditional deletion of the old path in one sync batch.
- Cache accepted file revisions and hashes per device.
- Store the vault token using the safest storage available to the Obsidian runtime and never write it into Markdown.
- Show server connection state and per-task canonical errors.
- Keep local validation lightweight and advisory so the TypeScript plugin cannot drift into a second canonical parser.

### Incremental local reminder export

The current local JSON exporter persists a versioned per-file scan index in plugin `data.json`. Top-level `vaultId`, `timeZone`, `defaultAlertTime`, and `ntfyServer` settings remain readable, while the private version 4 persistence format uses compact tuples, a deduplicated configuration-fingerprint table, and unpadded base64url SHA-256 values. `ntfyServer` defaults to `https://ntfy.sh`. Fingerprints and paths are sorted for deterministic bytes, and the complete file is minified without a trailing newline. Missing, corrupt, or incompatible index data causes a safe full scan without discarding valid top-level settings.

Live create and modify events dirty the final Markdown path. Delete dirties the removed path, rename dirties both old and final paths, and folder events cover indexed or current Markdown descendants. A 350 ms quiet-period debounce with a two-second maximum delay coalesces paths; generations preserve events that arrive during processing, and at most four files are read concurrently. Files are queried at processing time so replacement and sync event sequences resolve from final vault state.

Startup and genuine foreground transitions reconcile current Markdown files. New files, changed `(mtime, size)` metadata, mtimes newer than the last scan, expired schedules, and obsolete configuration fingerprints are rescanned; vanished paths are removed. Matching metadata is trusted. The manual regeneration command reads and hashes every Markdown file as recovery for same-path, same-size, preserved-mtime replacement.

The fingerprint covers timezone, default alert time, Tasks Global Filter and status mapping, and exporter schema version. Matching content hashes and fingerprints update metadata without reparsing. Settings-triggered reconciliation is debounced.

`reminders.json` is a JSON object with the configured ntfy base URL in the top-level `ntfy-server` property, followed by a key for the vault name and then vault-relative Markdown paths. Each file maps to a line-sorted reminder array, allowing multiple tasks in one note without repeating the vault or file strings. A reminder contains its one-based `line` number instead of a composite ID because its vault and file are implied by the enclosing keys. The file keys and reminder arrays are sorted, and the output uses two-space indentation with a trailing newline. The exporter builds it from cached per-file results and compares exact bytes with the last successfully read or written output. Startup, settings changes, and foreground reconciliation repair missing, malformed, or externally altered output; unchanged bytes are never written. Index state is persisted before changed output, and a persistent retry flag defers failed writes until the next event, reconciliation, or manual regeneration.

Obsidian exposes vault file access and mutation APIs for plugins; use vault APIs rather than direct filesystem calls. See the [Obsidian Vault API documentation](https://docs.obsidian.md/Plugins/Vault).

## 18. Testing Strategy

### Conformance fixtures

Convert each row in `test_matrix.md` into a machine-readable syntax-conformance fixture under `notifox-spec/fixtures`. Each fixture contains only syntax-facing inputs and expectations:

```text
id
raw reminder field or raw task line
expected field detection
task date and timezone context
expected parse status
expected diagnostic code
expected canonical clauses
expected repeat seed
expected absolute occurrence timestamps
```

The Rust parser and reminder-expression resolver must pass every applicable fixture. The plugin uses the field-discovery and extraction subset. Lifecycle, schedule materialization, sync, and delivery fixtures are maintained separately from the syntax matrix.

### Unit tests

- Lexer and grammar boundaries, including code spans, commas, whitespace, case, aliases, and source ranges.
- Every diagnostic ID in the matrix.
- Exact decimal parsing and interval multiplication.
- Minimum repeat-interval rejection and acceptance immediately below and at the boundary, including equivalent `60s`, `1m`, and bare-unit forms.
- Time formats, meridiems, and invalid ranges.
- Rejection of month and year names and abbreviations with `UNKNOWN_UNIT`.
- Anchor fallback and explicit missing anchors.
- Calendar day/week arithmetic across leap years, DST gaps/overlaps, and elapsed-versus-calendar arithmetic.
- `last` versus `previous`/`prev`, implicit defaults, explicit boundaries, and deduplication.
- Efficient next-occurrence calculation for old seeds.

### Persistence and scheduler tests

- Atomic schedule rebuilds and cancellations.
- Restart recovery: exactly one latest-occurrence catch-up for an eligible existing task with misses, and none for no-miss, newly enrolled, edited, moved, reopened, or ineligible cases.
- No initial backfill for newly enrolled tasks.
- Durable outbox retries and deterministic sequence IDs.
- Suppression when a task becomes inactive before publish.

### API and concurrency tests

- Token scope and revocation.
- Request idempotency.
- Identical-content no-op sync.
- Stale divergent `409` behavior.
- Conditional file deletion and rename.
- Duplicate Tasks IDs.
- Multi-device convergence without stale resurrection.

### End-to-end tests

- Obsidian fixture vault → plugin snapshot → Rust service → SQLite schedule → mock ntfy publish.
- Run syntax and expression-resolution conformance against the normative matrix's explicit fixture timezone, independently of scheduler state.
- Verify notification body, logical occurrence identity, and ordering.

## 19. Implementation Sequence

1. Generate machine-readable syntax-conformance fixtures from the normative matrix.
2. Implement the Rust lexer, parser, diagnostics, exact quantities, and AST.
3. Implement time resolution and repeat calculation until every applicable matrix fixture passes.
4. Add SQLite migrations, task identity, transactional schedule rebuilds, and scheduler recovery.
5. Add the HTTP validation/sync API, vault authentication, idempotency, and revision conflicts.
6. Add the durable ntfy outbox and mock-driven delivery tests.
7. Build the Obsidian plugin's Tasks integration, file snapshots, synchronization, and diagnostic UI.
8. Add the Notifox service to deployment configuration and run full end-to-end acceptance tests.

## 20. Completion Criteria

- Every row in `test_matrix.md` is represented by an automated test and passes.
- Fractional-second boundary cases pass through the general rounding and validation rules without literal-specific special cases.
- Tasks without a standalone bell never create reminder state.
- Invalid syntax returns the exact catalogued syntax error code; invalid reminder fields never partially schedule.
- All repeat calculations derive from the original seed without drift.
- Concurrent sync cannot overwrite a newer divergent file snapshot.
- Restart and ntfy retry tests demonstrate durable, duplicate-resistant delivery.
- The plugin surfaces canonical server diagnostics and can rebuild the complete server state from an authorized vault.
