# Repository Guidance

- `docs/test_matrix.md` is the source of truth for reminder syntax and syntax-error acceptance criteria. Implementation behavior belongs in `docs/design_plan.md`. If other documentation conflicts with the syntax matrix, follow `docs/test_matrix.md` and update the other documentation accordingly.
- Use the minimal whitespace required for markdown table formatting.
- Always add short succinct comments to what each added function is doing for the implementation. Keep these comments up to date. No need for parameters/returns if it's obvious. Tests are fine as is.

# test_matrix.md Guidance
- Use explicit absolute timestamps. No “Valid time,” “Same as,” or equivalence-only substitutes.