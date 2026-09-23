# Notifox Reminders documentation

This directory is the routing index for project knowledge. Start with the
repository [README](../README.md) for product usage, local development, and
release instructions.

## Start here

1. Read the [test matrix](test_matrix.md) before changing reminder syntax,
   parsing, resolution, or syntax diagnostics.
2. Read the relevant sections of the [design plan](design_plan.md) before
   changing runtime behavior or architecture.
3. Use the [source structure](project_structure.md) to locate the TypeScript
   implementation that owns the behavior.

## Sources of truth

|Subject|Canonical source|Scope|
|---|---|---|
|Reminder syntax and syntax errors|[Normative reminder syntax test matrix](test_matrix.md)|Acceptance criteria, explicit timestamps, error identifiers, and fixture conventions. This document wins if another document disagrees about syntax.|
|Runtime behavior and architecture|[Plugin and service design plan](design_plan.md)|Enrollment, resolution behavior, theme-aware reminder highlights and diagnostics, identity, synchronization, persistence, scheduling, delivery, and testing strategy.|
|Exported JSON contract|[`reminders.json` consumer specification](reminders_json.md)|File location, document shape, field semantics, schedules, snapshot replacement, and compatibility.|
|Current TypeScript ownership|[Source file structure](project_structure.md)|Processing flow and responsibilities of files under `src/`.|
|Parser notation|[Canonical reminder grammar](grammar.md)|Compact EBNF, units, numbers, and times. Use the test matrix when this summary is incomplete or conflicts with an accepted case.|
|User and contributor workflow|[Repository README](../README.md)|Settings, usage examples, dependencies, development builds, and releases.|

## Route by task

|Task|Read in this order|
|---|---|
|Change reminder syntax, parsing, timestamps, or syntax diagnostics|[Test matrix](test_matrix.md) → [grammar](grammar.md) → relevant [design plan](design_plan.md) sections → [source structure](project_structure.md)|
|Change enrollment, task discovery, settings, or incremental export|Relevant [design plan](design_plan.md) sections → [source structure](project_structure.md) → affected [test matrix](test_matrix.md) cases|
|Change diagnostic presentation or interaction|[Design plan diagnostics](design_plan.md#11-diagnostics) → [source structure](project_structure.md)|
|Change `reminders.json` generation or build a consumer|[`reminders.json` specification](reminders_json.md) → relevant [design plan](design_plan.md) sections → [source structure](project_structure.md)|
|Add or review tests|[Test matrix](test_matrix.md) for syntax acceptance → [design plan testing strategy](design_plan.md#18-testing-strategy) for implementation coverage|
|Build, test, or release the plugin|[Repository README](../README.md#development)|

Keep this index concise. Add durable detail to the relevant canonical document,
then update its route or one-line scope here when necessary.
