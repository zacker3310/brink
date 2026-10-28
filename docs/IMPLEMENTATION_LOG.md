# Implementation log

Newest first. Each entry: what changed, where, how it was tested, what is left.

## 2026-10-28: Overhaul pass 1 (plan phases A to F)

Audit and plan: `docs/OVERHAUL_PLAN.md`. Rules: `docs/GAME_DESIGN.md`. Ruleset `1.4.0` to `1.5.0`,
save version 1 to 2, world schema 1 to 2.

### A. Save migrations

- `packages/session/src/save.ts`: `migrateSave` runs a chain of per-version migrations (1 to 2 adds
  treaties, facilities and construction queues), then moves an older ruleset onto this build's rules.
  The hash is checked on the save as written, before migration; a newer save or ruleset is refused
  with a reason; tampering is still caught. `compareVersions` for dotted versions.
- Web: loading an upgraded save says which rules it came from (`migratedFrom`).
- Tests (`session.test.ts`): a save shaped exactly as 1.4.0 wrote it loads, resumes and plays on;
  tampering is refused; a newer ruleset is refused.

### B. Treaties

- Contracts: `Treaty` (`nonaggression`, `trade`, `embargo`, with `from` and `until` turns),
  `WorldState.treaties`, `NationView.treaties`, new diplomatic actions and events.
- `packages/simulation/src/diplomacy.ts`: lapse, war, embargo, then mutual offers, in that order;
  `canPropose` shared with validation. `validate.ts`: `checkDiplomacy` (a pact makes war illegal).
  `economy.ts`: trade income in `grossYields`. `rules.ts`: `treatyIn`.
- AI (`packages/ai`): offers trade to anyone it is not fighting, pacts to stronger neighbours it is
  not targeting, answers offers on the same terms, never declares war on a pact partner.
- Web: Diplomacy cards show treaties in force, offers either way, and Offer pact / Offer trade /
  Embargo; the engine's own check runs on the view to hide or disable what is illegal. Debrief and
  report narrate signings and endings.
- Tests (`treaties.test.ts`): signing, binding, one-sided offers, expiry, trade income, war ends
  trade, embargo, nonsensical offers refused, order independence of offers.

### C. Victory paths and campaign lengths

- `packages/simulation/src/victory.ts`: last standing, domination, coalition, supremacy, score at the
  limit, in that order. `supremacyStanding` (public, in the view), `allianceBlocs`, `coalitionShare`.
- Lengths: Quick 20, Standard 30, Epic 45 (`CAMPAIGN_TURNS`); sessions accept 5 to 60 turns.
- Web: setup offers three lengths and spells out the four paths; the World card shows each power's
  standing; the victory banner names coalition partners and treats them as winners.
- Tests: coalition at 60% for two, three allies cannot win by signing (80%), supremacy needs land,
  army and output with stability and a minimum turn, domination comes first, the limit always ends it.

### D. Facilities

- Six facilities (`FACILITIES`): farm, mine, power plant, factory, research lab, fortress; slots by
  site kind; three need research. Build orders reserve with recruits from one budget; construction
  takes industry before units; work at a captured site is lost, standing buildings change hands;
  fortress keeps entrenchment at 60 or more, even through strikes.
- AI builds one at a time, scarcest resource first, paced to two plus one per four turns.
- Web: the city panel lists facilities with cost, effect, build time and why one is unavailable.
- Tests (`facilities.test.ts`): cost and construction, yields, priority over units, refusals,
  shared budget, capture, fortress under bombardment, upkeep.

### E. Order review

- `apps/web/src/OrderReview.tsx`: End Turn (or Ctrl+Enter) opens it on phone and desktop. Lists
  orders by type, units without orders, production and construction with costs, the treasury after
  spending, research, diplomacy and battles; warns about refused orders (the engine's check),
  overspending, resources that run out within two turns, units under half supply, unanswered events.
  Commit submits; Back keeps the draft.
- e2e: every spec commits through the review; the journey checks the review's content and Back.

### F. Gates

- `pnpm check`: green (131 unit tests across packages).
- Soak: zero rejected AI orders; new invariants (facility slots, treaty shape, no trade or pact
  between nations at war); the AI builds and signs in every match. 100 matches: 43 score at the turn
  limit, 38 domination, 19 supremacy; median turn 28; 1,040 facilities built; 2,098 treaties signed.
  Before this pass: 48 at the limit, 52 domination, median turn 29 or 30.
- e2e: journey, phone, tutorial, skirmish green (Chromium; iPhone 14 Pro emulation for phone).

### Outstanding

- **Stalemates.** 43% of AI-only matches still reach the turn limit (48% before this pass).
  The cause is the AI's front-line deadlock, not the new systems. The limit now decides on strategic
  standing (Score), which is a legitimate path, but the AI should break deadlocks itself: concentrate
  force on one sector, use artillery to strip entrenchment before assaults.
- **Naval warfare, air superiority and air defence**: not built (see the plan; needs sea zones).
- **Depots** have facility slots but no city banner to open their panel on the map yet.
- **Difficulty** still uses resource bonuses (Easy, Hard); the brief prefers planning depth.
- **Real-device testing**: everything above ran in Chromium; real Safari on an iPhone is unverified.
