# Handoff: picking the build back up

Written 2026-11-06 when the work was stopped on request. Everything below is either live on `main` or saved
in `handoff/brink-wip.bundle` on this branch (`claude/nice-bell-5bv63a`). Nothing else needs to survive.

## 1. What is live

`main` is at **afa5f31**, deployed to https://zacker3310.github.io/brink/ (Pages run green). Ruleset 2.13.0.

Live: six theatres (Pacific, Europe, Middle East and Africa, Indo-Pacific South, the Americas, Antarctica /
First Contact), victory bars that scale with the number of powers, the plan picker and ENTER BATTLE, airborne
operations and right of passage, the diplomacy fixes (staff never makes peace for you, war deals, plain-word
refusals), arena group command engine (no UI yet), the Black Files, balance 2.9, research and cities, leaders,
the war-map overhaul, audio, the front door and `?demo=1`.

## 2. Restore the unshipped work

```bash
git fetch origin claude/nice-bell-5bv63a && git checkout claude/nice-bell-5bv63a
git bundle verify handoff/brink-wip.bundle          # needs afa5f31 (main) present
git fetch handoff/brink-wip.bundle 'refs/heads/*:refs/heads/wip/*'
git branch --list 'wip/*'
```

Every branch below is then available as `wip/<name>`. Commits marked "WIP: interrupted" were saved mid-task:
unverified, gate not run.

## 3. The unshipped branches, in the order to land them

| # | Branch (in the bundle) | What it is | State |
|---|---|---|---|
| 1 | `int-merge-dbf-r6` (79c5625) | Diplomacy rework: war declarations, betrayal, war deals and retreats resolved from one snapshot, order-independent by construction (fuzzer: 0 of 600 seeds differ under renaming; the old code failed 104). Refusals priced: "Add 140 food: ask again". Ruleset 2.15.0. Built on a sibling of main (contains 8b91bc2, not afa5f31). | 3 of 4 final skeptics passed. **Open:** passage price suggestions are sometimes wrong (`GameSession.priceOf` names the first nation by id that carries the deal, even one the seat is at peace with; unnamed-passage text). Some `migrate twice` checks outside `migrate.test.ts` are vacuous (they pass an already-current save, which returns early). |
| 2 | `fix/minor-capitals-r3` (9969968) | Mongolia: redrawn to its real shape (Ulaanbaatar north, 3 hexes from Beijing; Inner Mongolia and Hulunbuir to China) plus front-line mobilization (a minor city with a great power's army within 2 hexes opens fully garrisoned: Pyongyang, Wonsan). No minor capital falls to the AI on turn 1 (seeds 1-20, crises 0 of 56 vs 54 of 56). Ruleset 2.13.0 on its own. | **Refuted on balance:** Russia wins 0 of 100 AI matches (was 9, p = 0.003); Pacific decisive 54% over 100. Pyongyang still falls turn 1 to a *human* China/Russia on Easy (the player's choice, with the Easy edge). |
| 3 | `balance/integrated` (ea348ac, WIP) and lanes `balance/length`, `balance/europe`, `balance/mideast`, `balance/americas`, `balance/indopac` | Balance wave on main afa5f31. Lanes all finished ok: Quick (20-turn) campaigns now decide (e.g. Middle East 0% to 80%, Pacific 20% to 62%); Europe no longer Poland's (UK, France, Russia win); Middle East spread beyond South Africa/Nigeria; Americas spread beyond Colombia (USA was 0 wins); Indo-Pacific India wins, matches faster. Each lane bumped to 2.14.0. | The integrator merged the five lanes and was mid-gate when stopped (WIP commit). Re-run the integrated gate; then a skeptic on unseen seeds 41-80. |
| 4 | `int-staff` (4e765af) then `fix/arena-fog-r4` (5d4e674, WIP; contains `fix/callin-fog-r3` 7c0fb1c) | Arena: group command + the call-in bar (UAV, smoke, EMP, swarm, JDAM, paradrop, gunship) merged as arena rules 4, then fog repairs to rules 8 (cards, films, music and kill credit no longer leak; the fog probe now fires call-ins and catches planted leaks). | Round 4 was fixing, mid-gate: **hidden wrecks** (moves planned on the truth; fix: plan on the side's knowledge, a move stops short at an unknown obstacle; this also closes the old PROGRESS arena defect 3), symmetric EMP jamming of fire support, gunship vs seen helicopters, probe coverage of reach/whyNot/advice. Do not ship the call-in bar before this passes. |
| 5 | `depth/crises` (6ed63db) | Four Opening Crises each for Europe (Suwałki Gap, Baltic Gambit, Black Sea Fleet, Bosphorus Closed), Middle East and Africa, Indo-Pacific South and the Americas. | Built ok; its skeptic had not reported. |
| 6 | `depth/map-terrain` (051eab5) | War map paints each theatre's biome layer (deserts are no longer green), collision-aware labels by zoom. | Mid-way (screenshots and gate). |
| 7 | `depth/arena-biomes` (183c226) | Arena battlefields per theatre (desert, jungle, Europe, Andes/Amazon, ice). | Mid-way. |
| 8 | `war-now` (de1da70, WIP) | Declaring war from plans, operations, the city card and Enter Battle, with a banner; staff plans as at war after a declaration. New `packages/simulation/src/declared.ts`, `apps/web/src/War.tsx`, `war.ts`. | Early and unverified. Probe finding: validation does NOT refuse same-turn moves after a declaration (no relation check; declarations resolve in phase 2, movement in phase 7), so hand-given attacks already work the same turn. The lost turn comes from the **staff** planning with the peace view, and from `forcedTarget()` (packages/ai/src/index.ts) dropping prizes of powers at peace. Contains two `zz-probe*.test.ts` files to delete. |

Recommended landing: (3) balance wave on its own; then a **Pacific convergence** merge of (1) + (2) + (3) with one
Pacific balance pass (Russia winning again, decisive 55-75%, no turn-1 minor falls, passage prices fixed); then
(4) once its fog skeptics are clean; then (5)-(7); then (8). Every one of these bumps RULESET_VERSION: renumber
once at merge, and make every save migration idempotent and its "migrate twice" check really run the steps.

## 4. Requested but not started (no code yet)

- **Energy: "I'm always running out."** Measured earlier: every power's upkeep (~70 energy a turn) exceeds income
  (45-56) from turn 1 and stockpiles hit 0 by about turn 8. The AI was given a sustainability rule
  (`balanceOf`/`upkeepOf` in packages/simulation/src/economy.ts; recruit only what 6 turns of stock can carry,
  fix a deficit first) but the human staff (`autoCommand` in apps/web/src/store.ts spends up to half the bank on
  recruits) and manual recruiting have no such guard, and there is no energy forecast. Plan: measure a human
  seat per theatre; give the staff the AI's rule and a power-plant-first habit; make a shortage a bounded,
  recoverable penalty; add a top-bar forecast ("Energy 120, -18/turn, runs out in 6") and a pre-recruit warning
  with a one-tap fix; re-check every theatre's soak.
- **The 1000-turn world campaign with blocs.** A design workflow was started (four probes, three designs, a
  judged spec) and stopped before results. Probe first: turn time vs map size and nation count (a phone needs
  about 2 s or less per all-AI turn at 16+ powers and 80+ minors; Europe's 46 nations already cost 3-4x a
  Pacific turn), unbounded growth over 1000 turns (a Middle East save is 1.5 MB at turn 7; reports, memories,
  proposals), the 24-tech research tree running out, bloc mechanics (membership, leader, an attack on one,
  shared vision, bloc victory, AI coordination) on top of the existing alliance/Accord/war-deal code, and
  whether `packages/mapgen` can bake a whole-world map from Natural Earth (Europe was baked that way). Compare a
  single world map, linked theatres, and a player-first design; then build in lanes.
- **Per-country wave** (one agent per major power: signature deck, generals, units, leader voice, AI tuned to
  its strategic problem), in batches of about five, after the balance wave lands.

## 5. Running the gates (what bit us)

- Commands and healthy output: `CLAUDE.md`. Ship only when `pnpm check`, the soak and e2e are green; a push to
  `main` deploys (`.github/workflows/pages.yml`).
- `pnpm test` runs two packages at a time on purpose (the Pages runner timed out when all ran at once).
  Use `--force` to bypass turbo's cache after merges.
- E2E here: `cd tests && E2E_PORT=<unique port> PW_CHROMIUM=/opt/pw-browsers/chromium npx playwright test --workers=1 <specs>`.
  One spec that fails to import kills the whole run before any test starts: map JSON must be imported with
  `with { type: 'json' }` (Node's loader; Vite and Vitest did not mind).
- Under load (several agents) whole-match tests and phone specs time out. Rerun alone, or with
  `--testTimeout=1800000`, before calling anything a failure; never call a timeout a pass without the rerun.
- Soaks: per-theatre `SOAK_*_MATCHES` variables (see `AGENTS.md`); `SOAK_MATCHES=20` for a quick run. Judge
  balance on seeds the change was not tuned on (21-40, 41-80).
- Branches that were built on different bases each claimed the same RULESET_VERSION more than once; the
  integrator renumbers. Pacific turn-1 hashes in `packages/scenarios/src/pacific-map.test.ts` must be
  re-pinned on every ruleset bump; prove only the stamp moved by setting it back.
- Method that worked: build in a worktree, then independent skeptics try to refute (fog, rules, balance,
  conventions), repair, repeat. It found real bugs at every merge (an exchange draining recruit money, an
  operation making peace with its own target, fog leaks through cards, films and wrecks, name-order outcomes).
