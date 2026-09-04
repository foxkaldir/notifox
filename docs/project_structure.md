# Source File Structure

This document describes the TypeScript source files in `src/` and the main responsibility of each one. Tests, build configuration, package metadata, and generated files are intentionally omitted.

Reminder syntax and syntax-error acceptance criteria are defined in [`../test_matrix.md`](../test_matrix.md). Implementation behavior is documented in [`../design_plan.md`](../design_plan.md).

## Processing flow

```text
main.ts
  -> exporter.ts
       -> integrations/obsidian-tasks-plugin.ts
       -> parser.ts
       -> resolver.ts
       -> persistence.ts
  -> persistence.ts
  -> settings.ts
       -> time-zones.ts

types.ts -> shared by the integration, parsing, resolution, cache, and export layers
```

At runtime, `main.ts` initializes the plugin and connects Obsidian events to the exporter. The exporter discovers eligible Tasks lines, parses their reminder fields, resolves them into timestamps, caches scan results, and writes the canonical `reminders.json` output.

The exporter saves updated state through a callback supplied by `main.ts`, which uses `persistence.ts` to serialize `data.json`. Settings edits also return through `main.ts` to trigger exporter reconciliation.

## Files

### `src/main.ts`

The Obsidian plugin entry point and lifecycle coordinator.

- Loads saved settings and scan state when the plugin starts.
- Creates and initializes the incremental exporter.
- Registers the settings tab, regeneration command, vault file events, and document visibility event.
- Stops exporter work when the plugin unloads.
- Owns the plugin's `data.json` and generated `reminders.json` paths.
- Creates and preserves the stable vault identifier.

### `src/exporter.ts`

The central orchestration layer for incremental reminder export.

- Debounces and batches create, modify, delete, rename, settings, startup, and foreground events.
- Reads and validates the Tasks plugin configuration and Notifox time settings before scanning.
- Chooses which Markdown files need scanning using dirty paths, file metadata, hashes, configuration fingerprints, and time-based cache expiry.
- Runs bounded concurrent file reads, then calls task discovery, reminder parsing, and timestamp resolution for each file.
- Updates the in-memory scan index and requests plugin-state persistence through the supplied callback.
- Builds, verifies, repairs, and writes canonical `reminders.json` output only when its bytes need to change.
- Reports regeneration results and deduplicates repeated operational errors shown to the user.

### `src/parser.ts`

The reminder-field grammar parser.

- Parses one-shot time clauses, before/after offsets, optional date anchors, and repeat clauses.
- Recognizes supported units and rejects unsupported or malformed units and syntax.
- Parses exact decimal intervals with integer arithmetic and rounds durations consistently.
- Preserves clause source order where repeat semantics depend on lexical order.
- Returns either a typed `ReminderField` or a structured diagnostic; it does not calculate calendar timestamps.

### `src/resolver.ts`

The calendar and timezone resolution layer.

- Selects the task date used by each reminder clause, including explicit due, scheduled, and start anchors.
- Validates that required task dates exist.
- Converts local dates and times into `Temporal` values in the configured IANA timezone.
- Applies elapsed-time and calendar-day/week intervals, including daylight-saving transitions and nonexistent local times.
- Resolves one-shot reminders and computes the next non-past repeat occurrence.
- Removes expired one-shots, duplicates, and one-shots that collide with the repeat schedule.
- Validates and parses the configured default alert time.

### `src/integrations/obsidian-tasks-plugin.ts`

The integration and discovery layer for the Obsidian Tasks plugin.

- Reads Tasks plugin settings and verifies the required plugin version and emoji task format.
- Builds the effective status-symbol map, including custom statuses, and reads the global task filter.
- Scans Markdown lines for active task items containing a reminder bell.
- Ignores completed, cancelled, non-task, and globally filtered-out items.
- Extracts due, scheduled, and start dates plus the raw reminder-field text.
- Rejects ambiguous reminder fields, invalid spacing, and reminder bells placed after Tasks metadata.
- Passes the extracted field text to the exporter for grammar parsing in `parser.ts`.

### `src/persistence.ts`

The runtime scan cache and compact storage codec for internal plugin state.

- Defines plugin data, per-file scan entries, and the complete scan index.
- Loads valid settings and compact or legacy verbose scan data, recovering an empty index for missing or corrupt caches.
- Serializes internal state to deterministic, minified version 5 tuples with deduplicated fingerprints and base64url hashes.
- Computes configuration fingerprints and decides when cached files need scanning or reparsing.
- Updates cached file results by hashing content, reusing or collecting reminders, and tracking expiry and output changes.
- Produces stable, sorted `reminders.json` content.
- Keeps format versions, codecs, validation, hashing, and reminder comparison helpers private.

### `src/settings.ts`

The user-facing settings model and Obsidian settings tab.

- Defines the persisted Notifox settings and their defaults.
- Renders controls for timezone, default alert time, ntfy topic URL (including optional auth query parameter), and notifox server URL.
- Sends edits back to the plugin so they can be saved and trigger reconciliation.

### `src/time-zones.ts`

Timezone option discovery and display formatting for the settings UI.

- Enumerates runtime-supported IANA timezone names while retaining UTC and the currently configured zone.
- Calculates each zone's current UTC offset.
- Formats readable dropdown labels such as `UTC-07:00 — America/Los_Angeles`.
- Sorts timezone choices by offset and then by name, while keeping unsupported values visible.

### `src/types.ts`

The shared domain model used across the source tree.

- Defines reminder grammar concepts such as anchors, directions, units, intervals, one-shots, and repeats.
- Defines parsed results and structured diagnostics.
- Defines discovered Tasks data and resolver settings.
- Defines resolved reminders and the exported JSON reminder shape.
- Contains types only; it has no runtime behavior.
