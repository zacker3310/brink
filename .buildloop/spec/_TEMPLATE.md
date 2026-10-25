# Spec: <short title>

**id:** <task-id>   **intent:** .buildloop/intent/<id>.md
**policies applied:** <skills that constrained this>
**status:** draft | accepted

## Summary
<What is being built, in a paragraph.>

## Requirements
R1. <requirement>
R2. <requirement>

## Design
<How it works. Components, data flow, interfaces, state. Diagram if it earns
its place.>

## Acceptance criteria
<Each one machine-checkable. "Fast" is not a criterion; "p95 < 200ms on the
existing load test" is.>

AC1. <criterion> | <how it is checked>
AC2. <criterion> | <how it is checked>

## Ordering surface
<none | concurrency | distribution | state-machine | persistence | messaging |
failure — and what specifically. Drives VERIFY triage; see references/verify.md.>

## Policy conflicts
<Anything a skill forbade that the intent wanted, unresolved, for the policy
owner. Do not decide these yourself.>

## Rejected alternatives
<What else was considered and why not. Prevents re-litigating.>
