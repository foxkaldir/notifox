# Canonical Reminder Grammar

The parser should use a lexer plus recursive-descent parser rather than a single regular expression. Preserve byte and Unicode-scalar source ranges for diagnostics.

```ebnf
field       = "🔔", [ws, clause, {ows, ",", ows, clause}];

clause      = one-shot | repeat;

one-shot    = ["at", ws], time, [ws, "on", ws, anchor]
            | interval, ws, direction,
              [ws, anchor],
              [ws, "at", ws, time];

repeat      = "every", ws, interval,
              [ws, "after", ws, repeat-seed];

repeat-seed = "last" | "previous" | "prev"
            | time, [ws, "on", ws, anchor];

interval    = unit
            | quantity;

quantity    = number, [ws], unit;
direction   = "before" | "after";
anchor      = "due" | "scheduled" | "start";
number      = digits, [".", digits]
            | ".", digits;
```

When the optional repeat suffix is absent, the repeat seed is implicitly `last`.

`ws` is one or more ASCII spaces and `ows` is zero or more. Keywords, units, and meridiems are case-insensitive. Attached and separated unit forms are both accepted because the matrix accepts `30minutes` and `1.5hours` as equivalents.

## Units

|Unit|Full forms|Abbreviations|
|---|---|---|
|Second|`second`, `seconds`|`s`, `sec`, `secs`|
|Minute|`minute`, `minutes`|`m`, `min`, `mins`|
|Hour|`hour`, `hours`|`h`, `hr`, `hrs`|
|Day|`day`, `days`|`d`|
|Week|`week`, `weeks`|`w`, `wk`, `wks`|

`m` always means minutes. Months and years are not supported; their names and common abbreviations (`mo`, `mos`, `y`, `yr`, `yrs`) produce `UNKNOWN_UNIT`.

A bare supported unit or alias is an interval with an implicit quantity of `1`. This applies equally to one-shot offsets and repeat intervals, so `hour before`, `h before`, `every hour after last`, and `every h after last` are valid and equivalent to their explicit-`1` forms.

## Numbers

- Normalize `.5` to exact decimal `0.5`.
- Normalize a bare unit or alias to the exact quantity `1`.
- Reject signs, negatives, trailing decimal points, and exponent notation with `INVALID_NUMBER`.
- Represent interval quantities exactly. When interval resolution produces fractional seconds, round the nonnegative magnitude to the nearest whole second, with an exact half-second rounded up, before applying the one-shot direction or validating a repeat.
- A syntactic zero is allowed for a one-shot offset and leaves the base timestamp unchanged. A syntactically positive one-shot duration that rounds to zero produces `POSITIVE_DURATION_ROUNDS_TO_ZERO`.
- After parsing, normalize and round a repeat interval before comparing it with the configured minimum. With a one-minute minimum, 59 seconds is invalid, while 60 seconds, 1 minute, and a bare `minute` are equivalent boundary values. Return `MINIMUM_REPEAT_INTERVAL` for any rounded value below the boundary, including zero.
- Store parsed quantities as exact base-10 values. Do not use binary floating point for interval multiplication.

## Times

- Accept one- or two-digit 24-hour hours from `0` through `23`.
- Accept meridiem hours from `1` through `12`.
- Minutes and seconds range from `00` through `59`.
- Omitted minutes or seconds are zero where the matrix shows them as optional.
- `12am` is 00:00 and `12pm` is 12:00.
- Reject invalid components with `INVALID_TIME`.
