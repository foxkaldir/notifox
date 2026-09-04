# Normative Reminder Syntax Test Matrix

## Scope

This matrix is the acceptance contract for reminder-field syntax, syntax errors, and the observable interpretation of accepted expressions. Absolute timestamps make that interpretation unambiguous without prescribing parser, scheduler, storage, synchronization, or delivery architecture.

A real standalone `🔔` field is required for reminder syntax to be present.

- A task without `🔔` has no reminder field and no syntax diagnostic.
- A bell inside inline code is ignored.
- An empty field, `🔔`, is valid and resolves to the default-time occurrence.
- A repeat-only field may create an implicit default-time one-shot.

The reminder field must appear at the start of the Tasks emoji group: after the task description and before every Tasks metadata field. Its content begins after `🔔` and ends at the first Tasks metadata field or the end of the task line.

## Standard Fixture
Unless overridden:

|Property|Value|
|---|---|
|Timezone|`America/Los_Angeles`|
|Default alert time|`09:00:00`|
|Due date|`2027-04-15`|
|Scheduled date|`2027-04-10`|
|Start date|`2027-04-01`|
|Output ordering|Chronological|
|Omitted seconds|`00`|
|Default selected date|Due, `2027-04-15`|
|Minimum repeat interval|`1 minute`|

## Opt-In and Basic Times

|ID|Reminder state|Expected result|
|---|---|---|
|B01|No `🔔` field|No reminder field detected.|
|B02|`🔔`|`2027-04-15 09:00:00`; empty field uses the default time.|
|B03|`🔔   `|`2027-04-15 09:00:00`; trailing spaces are ignored.|
|B04|`🔔 5pm`|`2027-04-15 17:00:00`.|
|B05|`🔔 at 5pm`|`2027-04-15 17:00:00`; `at` is optional.|
|B06|`🔔 10am, 9am on start`|`2027-04-01 09:00:00`, `2027-04-15 10:00:00`.|
|B07|`🔔 9am, 5pm`|`2027-04-15 09:00:00`, `2027-04-15 17:00:00`.|
|B08|`🔔 5pm, 9am`|`2027-04-15 09:00:00`, `2027-04-15 17:00:00`.|
|B09|`🔔 9am, at 9am`|One deduplicated result at `2027-04-15 09:00:00`.|
|B10|`🔔 AT 2:00 PM`|`2027-04-15 14:00:00`; case-insensitive.|
|B11|`🔔 0:00`|`2027-04-15 00:00:00`.|
|B12|`🔔 00:00`|`2027-04-15 00:00:00`.|
|B13|`🔔 9:30`|`2027-04-15 09:30:00`.|
|B14|`🔔 09:30`|`2027-04-15 09:30:00`.|
|B15|`🔔 14:00`|`2027-04-15 14:00:00`.|
|B16|`🔔 14:00:30`|`2027-04-15 14:00:30`.|
|B17|`🔔 2pm`|`2027-04-15 14:00:00`.|
|B18|`🔔 2:00pm`|`2027-04-15 14:00:00`.|
|B19|`🔔 2:00 PM`|`2027-04-15 14:00:00`.|
|B20|`🔔 2:00:30pm`|`2027-04-15 14:00:30`.|
|B21|`🔔 12am`|`2027-04-15 00:00:00`.|
|B22|`🔔 12pm`|`2027-04-15 12:00:00`.|
|B23|`🔔 1am`|`2027-04-15 01:00:00`.|
|B24|`🔔 11:59:59pm`|`2027-04-15 23:59:59`.|

## Anchor Selection

|ID|Available dates|Reminder|Expected result|
|---|---|---|---|
|A01|Due, scheduled, start|`🔔 5pm`|Due: `2027-04-15 17:00:00`.|
|A02|Scheduled, start; no due|`🔔 5pm`|Scheduled: `2027-04-10 17:00:00`.|
|A03|Start only|`🔔 5pm`|Start: `2027-04-01 17:00:00`.|
|A04|No valid dates|`🔔 5pm`|Invalid: `NO_VALID_DATE`.|
|A05|No valid dates|No bell|No reminder field detected; no syntax diagnostic.|
|A06|All standard dates|`🔔 5pm on due`|`2027-04-15 17:00:00`.|
|A07|All standard dates|`🔔 5pm on scheduled`|`2027-04-10 17:00:00`.|
|A08|All standard dates|`🔔 5pm on start`|`2027-04-01 17:00:00`.|
|A09|Scheduled and start only|`🔔 5pm on due`|Invalid: `MISSING_ANCHOR_DATE`.|
|A10|Due and start only|`🔔 5pm on scheduled`|Invalid: `MISSING_ANCHOR_DATE`.|
|A11|Due and scheduled only|`🔔 5pm on start`|Invalid: `MISSING_ANCHOR_DATE`.|
|A12|All standard dates|`🔔 10am, 9am on start`|Start at `2027-04-01 09:00:00`; due at `2027-04-15 10:00:00`.|
|A13|Scheduled and start only|`🔔`|Scheduled at `2027-04-10 09:00:00`.|
|A14|Start only|`🔔 0min before`|Start at `2027-04-01 09:00:00`.|

### Anchor Selection: Errors

|Error ID|Description|
|---|---|
|MISSING_ANCHOR_DATE|The task is missing the requested anchor, but others are available.|
|NO_VALID_DATE|The task is missing all valid anchors.|

## Unit and Alias Equivalence

|Unit|Full forms|Abbreviations|Equivalent valid examples|
|---|---|---|---|
|Second|`second`, `seconds`|`s`, `sec`, `secs`|`1 second`, `1 seconds`, `1s`, `1 s`, `1sec`, `1 secs`|
|Minute|`minute`, `minutes`|`m`, `min`, `mins`|`1 minute`, `1 minutes`, `1m`, `1 m`, `1min`, `1 mins`|
|Hour|`hour`, `hours`|`h`, `hr`, `hrs`|`1 hour`, `1 hours`, `1h`, `1 h`, `1hr`, `1 hrs`|
|Day|`day`, `days`|`d`|`1 day`, `1 days`, `1d`, `1 d`|
|Week|`week`, `weeks`|`w`, `wk`, `wks`|`1 week`, `1 weeks`, `1w`, `1 wk`, `1wks`|

These are the only supported interval units. Month and year names and their common abbreviations (`mo`, `mos`, `y`, `yr`, `yrs`) produce `UNKNOWN_UNIT`.

A bare supported unit or alias is valid in an offset or repeat interval and implies a quantity of `1` (for example, `hour before` is equivalent to `1 hour before`, and `every h after last` is equivalent to `every 1h after last`).

A repeat interval with no `after` clause implicitly uses `last` as its repeat seed (for example, `every 30m` is equivalent to `every 30m after last`).

|ID|Reminder|Expected result|
|---|---|---|
|U01|`🔔 30 minutes before`|`2027-04-15 08:30:00`.|
|U02|`🔔 30 MIN before`|`2027-04-15 08:30:00`.|
|U03|`🔔 2hrs after`|`2027-04-15 11:00:00`.|
|U04|`🔔 3wks before`|`2027-03-25 09:00:00`.|
|U05|`🔔 2mos after`|Invalid: `UNKNOWN_UNIT`.|
|U06|`🔔 1yrs before`|Invalid: `UNKNOWN_UNIT`.|
|U07|`🔔 30minutes before`|`2027-04-15 08:30:00`.|
|U08|`🔔 1.5hours before`|`2027-04-15 07:30:00`.|

## Numeric Forms and Rounding

|ID|Reminder|Expected result|
|---|---|---|
|N01|`🔔 .5h before`|`2027-04-15 08:30:00`.|
|N02|`🔔 0.5h before`|`2027-04-15 08:30:00`.|
|N03|`🔔 1.25h before`|`2027-04-15 07:45:00`.|
|N04|`🔔 1.25 hours before`|`2027-04-15 07:45:00`.|
|N05|`🔔 0min before`|`2027-04-15 09:00:00`.|
|N06|`🔔 0min after`|`2027-04-15 09:00:00`.|
|N07|`🔔 0.0d before at 2pm`|`2027-04-15 14:00:00`.|
|N08|`🔔 .5s after`|Round to one second: `2027-04-15 09:00:01`.|
|N09|`🔔 .5s before`|Round to one second: `2027-04-15 08:59:59`.|
|N10|`🔔 1.4s after`|Round to one second: `2027-04-15 09:00:01`.|
|N11|`🔔 1.5s after`|Round to two seconds: `2027-04-15 09:00:02`.|
|N12|`🔔 55.5s after`|Round to 56 seconds: `2027-04-15 09:00:56`.|
|N13|`🔔 .4s after`|Invalid: `POSITIVE_DURATION_ROUNDS_TO_ZERO`.|
|N14|`🔔 1.5mo before`|Invalid: `UNKNOWN_UNIT`.|
|N15|`🔔 .5 years after`|Invalid: `UNKNOWN_UNIT`.|
|N16|`🔔 0mo before`|Invalid: `UNKNOWN_UNIT`.|
|N17|`🔔 every 0m after last`|Invalid: `MINIMUM_REPEAT_INTERVAL`.|
|N18|`🔔 every 0.0 days after last`|Invalid: `MINIMUM_REPEAT_INTERVAL`.|
|N19|`🔔 every .4s after last`|Invalid: `MINIMUM_REPEAT_INTERVAL`.|
|N20|`🔔 every .5s after last`|Invalid: `MINIMUM_REPEAT_INTERVAL`.|

### Numeric Forms and Rounding: Special behavior
- When interval resolution produces fractional seconds, round the nonnegative magnitude to the nearest whole second, with an exact half-second rounded up. Apply `before` or `after` only after rounding the magnitude.
- A syntactic zero one-shot offset, such as `0s` or `0.0d`, is valid and leaves the base timestamp unchanged.
- A syntactically positive one-shot offset whose magnitude rounds to zero is invalid with `POSITIVE_DURATION_ROUNDS_TO_ZERO`.
- For repeats, round first and then compare the result with the minimum repeat interval. Any rounded result below that minimum, including zero, is invalid with `MINIMUM_REPEAT_INTERVAL`.
### Numeric Forms and Rounding: Errors

|Error ID|Description|
|---|---|
|POSITIVE_DURATION_ROUNDS_TO_ZERO|A syntactically positive one-shot duration rounds to zero seconds.|
|MINIMUM_REPEAT_INTERVAL|The rounded repeat interval is below the minimum repeat interval.|

## Minimum Repeat Interval

|ID|Reminder|Expected result|
|---|---|---|
|M01|`🔔 every 59s after last`|Invalid: `MINIMUM_REPEAT_INTERVAL`; 59 seconds is below the one-minute minimum.|
|M02|`🔔 every 60s after last`|`2027-04-15 09:00:00`, `2027-04-15 09:01:00`, `2027-04-15 09:02:00`, `2027-04-15 09:03:00`…|
|M03|`🔔 every 1m after last`|`2027-04-15 09:00:00`, `2027-04-15 09:01:00`, `2027-04-15 09:02:00`, `2027-04-15 09:03:00`…|
|M04|`🔔 every minute after last`|`2027-04-15 09:00:00`, `2027-04-15 09:01:00`, `2027-04-15 09:02:00`, `2027-04-15 09:03:00`…|

## One-Shot Offsets

|ID|Reminder|Expected result|
|---|---|---|
|O01|`🔔 30s before`|`2027-04-15 08:59:30`.|
|O02|`🔔 30s after`|`2027-04-15 09:00:30`.|
|O03|`🔔 30min before`|`2027-04-15 08:30:00`.|
|O04|`🔔 30min after`|`2027-04-15 09:30:00`.|
|O05|`🔔 1.5hr before`|`2027-04-15 07:30:00`.|
|O06|`🔔 1.5hr after`|`2027-04-15 10:30:00`.|
|O07|`🔔 2 days before`|`2027-04-13 09:00:00`.|
|O08|`🔔 1 day after`|`2027-04-16 09:00:00`.|
|O09|`🔔 1 week before`|`2027-04-08 09:00:00`.|
|O10|`🔔 1 week after`|`2027-04-22 09:00:00`.|
|O11|`🔔 2mo before`|Invalid: `UNKNOWN_UNIT`.|
|O12|`🔔 2mo after`|Invalid: `UNKNOWN_UNIT`.|
|O13|`🔔 1yr before`|Invalid: `UNKNOWN_UNIT`.|
|O14|`🔔 1yr after`|Invalid: `UNKNOWN_UNIT`.|
|O15|`🔔 .5h after scheduled`|`2027-04-10 09:30:00`.|
|O16|`🔔 1 day before at 2pm`|`2027-04-14 14:00:00`.|
|O17|`🔔 1 day after at 2pm`|`2027-04-16 14:00:00`.|
|O18|`🔔 0.5d before at 2pm`|`2027-04-15 02:00:00`.|
|O19|`🔔 0.5d after at 2pm`|`2027-04-16 02:00:00`.|
|O20|`🔔 1.5d before`|`2027-04-13 21:00:00`.|
|O21|`🔔 1.5d after`|`2027-04-16 21:00:00`.|
|O22|`🔔 1.5wk before`|`2027-04-04 21:00:00`.|
|O23|`🔔 1.5wk after`|`2027-04-25 21:00:00`.|
|O24|`🔔 9am, 1 week before at 9am`|`2027-04-08 09:00:00`, `2027-04-15 09:00:00`.|
|O25|`🔔 1d before due, .5h after scheduled, 5pm on start`|`2027-04-01 17:00:00`, `2027-04-10 09:30:00`, `2027-04-14 09:00:00`.|

## Repeat Seeds and Ordering

|ID|Reminder|Expected result|
|---|---|---|
|R01|`🔔 5pm, 9am, every hour after last`|`2027-04-15 09:00:00`, `2027-04-15 17:00:00`, `2027-04-15 18:00:00`, `2027-04-15 19:00:00`…; repeat seed `2027-04-15 17:00:00`.|
|R02|`🔔 5pm, at 9am, every 1h after prev`|`2027-04-15 09:00:00`, `2027-04-15 10:00:00`, `2027-04-15 11:00:00`…; `2027-04-15 17:00:00` is deduplicated; lexical seed `2027-04-15 09:00:00`.|
|R03|`🔔 9am, 5pm, every 1h after previous`|`2027-04-15 09:00:00`, `2027-04-15 17:00:00`, `2027-04-15 18:00:00`, `2027-04-15 19:00:00`…; lexical seed `2027-04-15 17:00:00`.|
|R04|`🔔 5pm on start, 9am on due, every 1d after last`|`2027-04-01 17:00:00`, `2027-04-15 09:00:00`, `2027-04-16 09:00:00`, `2027-04-17 09:00:00`…|
|R05|`🔔 5pm on due, 9am on start, every 1d after prev`|`2027-04-01 09:00:00`, `2027-04-02 09:00:00`, `2027-04-03 09:00:00`… plus `2027-04-15 17:00:00`; lexical seed `2027-04-01 09:00:00`.|
|R06|`🔔 every 30m after last`|`2027-04-15 09:00:00`, `2027-04-15 09:30:00`, `2027-04-15 10:00:00`, `2027-04-15 10:30:00`…|
|R07|`🔔 every 30m after previous`|`2027-04-15 09:00:00`, `2027-04-15 09:30:00`, `2027-04-15 10:00:00`, `2027-04-15 10:30:00`…|
|R08|`🔔 every 30m after prev`|`2027-04-15 09:00:00`, `2027-04-15 09:30:00`, `2027-04-15 10:00:00`, `2027-04-15 10:30:00`…|
|R09|`🔔 every hour after last`|`2027-04-15 09:00:00`, `2027-04-15 10:00:00`, `2027-04-15 11:00:00`…|
|R10|`🔔 every h after last`|`2027-04-15 09:00:00`, `2027-04-15 10:00:00`, `2027-04-15 11:00:00`…|
|R11|`🔔 every 30 minutes after 3pm`|`2027-04-15 09:00:00`, `2027-04-15 15:30:00`, `2027-04-15 16:00:00`…; boundary `2027-04-15 15:00:00` is not an occurrence.|
|R12|`🔔 every 2mo after 9am on due`|Invalid: `UNKNOWN_UNIT`.|
|R13|`🔔 every 1d after 9am on scheduled`|`2027-04-11 09:00:00`, `2027-04-12 09:00:00`…; the `2027-04-15 09:00:00` due-time collision is deduplicated.|
|R14|`🔔 5pm, every 30m after 3pm`|`2027-04-15 15:30:00`, `2027-04-15 16:00:00`, `2027-04-15 16:30:00`, `2027-04-15 17:00:00`…; the one-shot collision at `2027-04-15 17:00:00` is deduplicated.|
|R15|`🔔 3pm, every 30m after last`|`2027-04-15 15:00:00`, `2027-04-15 15:30:00`, `2027-04-15 16:00:00`…|
|R16|`🔔 3pm, every 30m after 3pm`|`2027-04-15 15:00:00`, `2027-04-15 15:30:00`, `2027-04-15 16:00:00`…|
|R17|`🔔 every .5h after last`|`2027-04-15 09:00:00`, `2027-04-15 09:30:00`, `2027-04-15 10:00:00`…|
|R18|`🔔 every 90s after last`|`2027-04-15 09:00:00`, `2027-04-15 09:01:30`, `2027-04-15 09:03:00`…|
|R19|`🔔 every 1.5d after last`|`2027-04-15 09:00:00`, `2027-04-16 21:00:00`, `2027-04-18 09:00:00`, `2027-04-19 21:00:00`…|
|R20|`🔔 9am, 9am, every 1h after last`|`2027-04-15 09:00:00`, `2027-04-15 10:00:00`, `2027-04-15 11:00:00`…; duplicate `2027-04-15 09:00:00` is deduplicated.|
|R21|`🔔 every 1h after 9am on due` without due|Invalid: `MISSING_ANCHOR_DATE`.|
|R22|`🔔 3pm, every 30m`|`2027-04-15 15:00:00`, `2027-04-15 15:30:00`, `2027-04-15 16:00:00`…|
|R23|`🔔 every 30m`|`2027-04-15 09:00:00`, `2027-04-15 09:30:00`, `2027-04-15 10:00:00`…|
|R24|`🔔 every hour`|`2027-04-15 09:00:00`, `2027-04-15 10:00:00`, `2027-04-15 11:00:00`…|
|R25|`🔔 5pm, 3pm, every 30m`|`2027-04-15 15:00:00`, `2027-04-15 17:00:00`, `2027-04-15 17:30:00`…; implicit `last` seed `2027-04-15 17:00:00`.|

### Repeat Seeds and Ordering: Errors

|Error ID|Description|
|---|---|
|MISSING_ANCHOR_DATE|The task is missing the requested anchor, but others are available.|

## Field Extraction and Invalid Syntax

|ID|Input|Expected result|
|---|---|---|
|E01|`- [ ] Submit 🔔 5pm 📅 2027-04-15`|`2027-04-15 17:00:00`.|
|E02|`- [ ] Submit 🔼 📅 2027-04-15 🔔 5pm`|Invalid: `INVALID_FIELD_POSITION`; the reminder follows Tasks metadata.|
|E03|``- [ ] Document the `🔔 5pm` marker 📅 2027-04-15``|No reminder field detected; the code bell is ignored.|
|E04|``- [ ] `🔔` example 🔔 5pm 📅 2027-04-15``|`2027-04-15 17:00:00`; the code bell is ignored.|
|E05|`🔔 5pm 🔔 6pm`|Invalid: `MULTIPLE_REMINDER_FIELDS`.|
|E06|`🔔5pm`|Invalid: `MISSING_FIELD_SPACE`.|
|E07|`🔔 , 5pm`|Invalid: `EMPTY_CLAUSE`.|
|E08|`🔔 5pm,`|Invalid: `EMPTY_CLAUSE`.|
|E09|`🔔 5pm,, 6pm`|Invalid: `EMPTY_CLAUSE`.|
|E10|`🔔 5pm, , 6pm`|Invalid: `EMPTY_CLAUSE`.|
|E11|`🔔 at`|Invalid: `MISSING_TIME`.|
|E12|`🔔 at 25:00`|Invalid: `INVALID_TIME`.|
|E13|`🔔 24:00`|Invalid: `INVALID_TIME`.|
|E14|`🔔 12:60`|Invalid: `INVALID_TIME`.|
|E15|`🔔 12:00:60`|Invalid: `INVALID_TIME`.|
|E16|`🔔 0pm`|Invalid: `INVALID_TIME`.|
|E17|`🔔 13pm`|Invalid: `INVALID_TIME`.|
|E18|`🔔 1.h before`|Invalid: `INVALID_NUMBER`.|
|E19|`🔔 -1h before`|Invalid: `INVALID_NUMBER`.|
|E20|`🔔 +1h before`|Invalid: `INVALID_NUMBER`.|
|E21|`🔔 1e3s before`|Invalid: `INVALID_NUMBER`.|
|E22|`🔔 hour before`|Valid: implicit quantity `1`; `2027-04-15 08:00:00`.|
|E23|`🔔 2mx before`|Invalid: `UNKNOWN_UNIT`.|
|E24|`🔔 1d sideways`|Invalid: `UNKNOWN_DIRECTION`.|
|E25|`🔔 1d before cancelled`|Invalid: `UNKNOWN_ANCHOR`.|
|E26|`🔔 1d before due at`|Invalid: `MISSING_TIME`.|
|E27|`🔔 every after last`|Invalid: `MISSING_REPEAT_INTERVAL`.|
|E28|`🔔 every 1h before last`|Invalid: `INVALID_REPEAT_DIRECTION`.|
|E29|`🔔 every 1h after latest`|Invalid: `INVALID_REPEAT_SEED`.|
|E30|`🔔 every 1h after last, 5pm`|Invalid: `REPEAT_NOT_FINAL`.|
|E31|`🔔 every 1h after last, every 1d after prev`|Invalid: `MULTIPLE_REPEATS`.|
|E32|`🔔 5pm extra words`|Invalid: `UNEXPECTED_TOKEN`.|
|E33|`🔔 5pm on due on start`|Invalid: `MULTIPLE_ANCHORS`.|
|E34|`🔔 5pm, invalid, 6pm`|Invalid: `UNEXPECTED_TOKEN`.|
|E35|`🔔 every 1.5mo after last`|Invalid: `UNKNOWN_UNIT`.|
|E36|`🔔 second before`|Valid: implicit quantity `1`; `2027-04-15 08:59:59`.|
|E37|`🔔 minute before`|Valid: implicit quantity `1`; `2027-04-15 08:59:00`.|
|E38|`🔔 day before`|Valid: implicit quantity `1`; `2027-04-14 09:00:00`.|
|E39|`🔔 week before`|Valid: implicit quantity `1`; `2027-04-08 09:00:00`.|
|E40|`🔔 month before`|Invalid: `UNKNOWN_UNIT`.|
|E41|`🔔 year before`|Invalid: `UNKNOWN_UNIT`.|
|E42|`🔔 1y after`|Invalid: `UNKNOWN_UNIT`.|
|E43|`- [ ] Submit 🔼 🔔 5pm 📅 2027-04-15`|Invalid: `INVALID_FIELD_POSITION`; the reminder appears between Tasks metadata fields.|
|E44|`- [ ] Submit 🔼 📅 2027-04-15 🔔`|Invalid: `INVALID_FIELD_POSITION`; an empty reminder follows Tasks metadata.|
|E45|`🔔 every 30m after`|Invalid: `INVALID_REPEAT_DIRECTION`.|

### Field Extraction and Invalid Syntax: Errors

|Error ID|Description|
|---|---|
|INVALID_FIELD_POSITION|The reminder field is not at the start of the Tasks emoji group, before all Tasks metadata.|
|MULTIPLE_REMINDER_FIELDS|The task contains more than one standalone reminder field.|
|MISSING_FIELD_SPACE|A nonempty reminder field is not separated from `🔔` by whitespace.|
|EMPTY_CLAUSE|A leading, trailing, or repeated comma creates an empty reminder clause.|
|MISSING_TIME|A clause requires a time after `at`, but none was provided.|
|INVALID_TIME|The time is malformed or contains an hour, minute, second, or meridiem outside its range.|
|INVALID_NUMBER|A quantity is malformed, signed, negative, has a trailing decimal point, or uses exponents.|
|UNKNOWN_UNIT|The interval uses a unit name or abbreviation that is not supported.|
|UNKNOWN_DIRECTION|A one-shot offset does not use the required `before` or `after` direction.|
|UNKNOWN_ANCHOR|A clause names an anchor other than `due`, `scheduled`, or `start`.|
|MISSING_REPEAT_INTERVAL|A repeat clause does not provide a unit or quantity-and-unit interval after `every`.|
|INVALID_REPEAT_DIRECTION|A repeat clause does not use the required `after` keyword before its seed.|
|INVALID_REPEAT_SEED|A repeat seed is neither `last`, `previous`, `prev`, nor a valid time with optional anchor.|
|REPEAT_NOT_FINAL|A repeat clause is followed by another clause.|
|MULTIPLE_REPEATS|The reminder field contains more than one repeat clause.|
|UNEXPECTED_TOKEN|Unrecognized text remains after parsing a clause, invalidating the entire reminder field.|
|MULTIPLE_ANCHORS|A clause specifies more than one date anchor.|

## DST Behavior
Project policy: nonexistent local times advance to the first valid local time; ambiguous times use the earlier occurrence. Timezone ambiguity is described in [MDN’s ZonedDateTime documentation](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Temporal/ZonedDateTime).

|ID|Fixture and reminder|Expected result|
|---|---|---|
|D01|Due `2027-03-14`; `🔔 2:30am`|`2027-03-14 03:00:00 PDT`.|
|D02|Due `2027-11-07`; `🔔 1:30am`|Earlier `2027-11-07 01:30:00 PDT` (`UTC-07:00`).|
|D03|Start `2027-03-13`; `🔔 1d after start`|`2027-03-14 09:00:00 PDT`; 23 elapsed hours.|
|D04|Start `2027-03-13`; `🔔 24h after start`|`2027-03-14 10:00:00 PDT`.|
|D05|Start `2027-11-06`; `🔔 1d after start`|`2027-11-07 09:00:00 PST`; 25 elapsed hours.|
|D06|Start `2027-11-06`; `🔔 24h after start`|`2027-11-07 08:00:00 PST`.|

## Test Fixture Shape

Encode every row as syntax-facing data containing:

```text
id
raw reminder field or raw task line
field detected
task date and timezone context
expected parse status
expected diagnostic code
expected normalized clauses
expected seed
expected absolute occurrence timestamps
```

Do not add lifecycle, identity, synchronization, persistence, delivery, retry, or protocol assertions to this matrix.
