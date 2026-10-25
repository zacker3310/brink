# Tasks

Indicators: `I`ntent `S`pec `P`lan `B`uild `V`erify `D`eploy `W`atch
`-` skipped, `!` stage failed.

Write FEWER, LARGER tasks. Each one runs the whole loop and may touch 5-15 files;
prefer two or three mega-tasks over six granular ones, and split only when the work
is genuinely independent.

Every task needs at least one backticked path and exactly one `Verification:` line
with a runnable command. `check-tasks-format.sh` enforces that - an unparsed task is
a task the loop silently never runs.

## Phase 1

- [ ] T1.1: <one verb-object title, one mental model>
  - `path/to/file.ext` - what it contains and why
  - Verification: `<runnable command>` exits 0
