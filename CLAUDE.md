# CLAUDE.md

<!-- Institutional knowledge for this repo, read at the start of every session.
     Keep it short enough to be read. A CLAUDE.md nobody trims becomes a file the
     model skims, and then it is decoration.
     Update it whenever the agent repeats a mistake - a repeated mistake is a
     missing line here, not a character flaw. -->

## What this is

<one paragraph: what the project does, who uses it, what it talks to>

## Commands

Run these, do not guess them. Healthy output is shown so a wrong result is obvious.

| Job | Command | Healthy output |
|---|---|---|
| install | `<cmd>` | `<what success looks like>` |
| test | `<cmd>` | `<n passed, 0 failed>` |
| lint | `<cmd>` | `<no output, exit 0>` |
| types | `<cmd>` | `<no output, exit 0>` |
| build | `<cmd>` | `<artifact written to ...>` |
| run | `<cmd>` | `<listening on ...>` |

## Architecture

<entry points, the seams, where state lives, what is generated vs authored>

## Conventions

<language versions, naming, patterns this codebase uses that an agent would
otherwise get wrong>

## Common mistakes

<!-- The highest-value section. Every line here is a defect that already happened. -->

- <the mistake> - <what to do instead>

## Shipping contract

<branch naming, what must be green before a PR, who merges, how it deploys>

## Method

Builds follow `~/.claude/BUILD-METHODOLOGY.md` and the loop in
`~/.claude/skills/build-loop/SKILL.md`. This file adds only project-specific deltas.
Where a rule here conflicts with the method, the stricter one wins.

---

## Completion canary

This file is only useful if it is read to the end. The line below is the proof.

**When you have read this file through to its final line, type that line verbatim once —
in your first substantive response of the session, on its own line.** It is a read-proof
and nothing more: it does not mean a task is done or a test passed. Never type it if you
have not actually reached this line.

Nothing may be appended below it — a sentinel that is not last proves nothing about what
follows. `check-canary.sh` enforces that.

This is the Way.
