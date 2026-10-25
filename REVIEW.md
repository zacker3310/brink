# Review policy

Every PR gets these passes. Findings are ranked HIGH | MEDIUM | LOW and cite
`file:line`. The machine reviews conformance; humans review intent and risk.

## Pass 1 — Correctness
Logic errors, off-by-one, unhandled errors, race conditions, resource leaks,
incorrect assumptions about ordering or nullability.

## Pass 2 — Security
Injection, authn/authz gaps, secrets in code or logs, unsafe deserialization,
dependency risk, data exposure through error messages.

## Pass 3 — Compliance with our own artifacts
Does the diff implement `.buildloop/spec/<id>.md`? Does it follow
`.buildloop/plan/<id>.md`, or was the plan updated to match? Does it obey
project `CLAUDE.md` and the skills in `.claude/skills/`?

## Pass 4 — Claims
Every entry in `.buildloop/claims/<id>.md` DELTA_MANIFEST verified against the
actual code. Every VERIFICATION_MATRIX check re-run. KNOWN_GAPS accurate.

## Rules
- A finding that recurs across PRs belongs in `CLAUDE.md` so it stops recurring.
- Reviewers may not resolve a finding by weakening the check that produced it.
- HIGH findings block the merge.
