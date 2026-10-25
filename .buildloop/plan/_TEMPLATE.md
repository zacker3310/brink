# Plan: <short title>

**id:** <task-id>   **spec:** .buildloop/spec/<id>.md
**premises checked:** <date of the last `git fetch` staleness check>

## Dependencies
<What must exist first. Packages to add — flag these, do not assume.>

## File operations (in order)
1. CREATE `<path>` — `<exact signatures>`
2. MODIFY `<path>` — `<what changes, which functions>`

## Verification
<The exact commands. Read from package.json / Makefile / pyproject — do not
guess between npm/pnpm/yarn or pytest/make test.>

CHECK:<name> | <command> | <expected>

## Risks
<What could go wrong, and what would tell you it did.>

## Departures
<Filled in during BUILD. If the implementation diverged from this plan, record
it here. A plan that silently diverged is worse than no plan.>
