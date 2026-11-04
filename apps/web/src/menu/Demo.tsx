import { useEffect, useState } from 'react';
import { proposeOperations } from '@brink/ai';
import { SKIRMISHES, skirmishRequest } from '../arena/skirmish';
import { useGame } from '../store';
import './front.css';

// The investor demo (?demo=1): a short, hands-off film of the game made by driving the real one
// through its public store actions and test hooks. The title and its war, a campaign opened and an
// operation launched, a turn committed and replayed, then a battle and an air strike under the
// action cam, and an end card. Captions say what is happening. ?fast=1 trims the pauses (the actions
// themselves run at the game's pace), for the e2e.

export type DemoStep = 'title' | 'campaign' | 'operation' | 'resolve' | 'battle' | 'strike' | 'end';

interface Caption {
  step: DemoStep;
  kicker: string;
  line: string;
}

export function demoRequested(search = typeof location === 'undefined' ? '' : location.search): boolean {
  return new URLSearchParams(search).get('demo') === '1';
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Poll until `ok` holds or the time runs out; true if it held. */
async function until(ok: () => boolean, timeout: number, alive: () => boolean): Promise<boolean> {
  const end = Date.now() + timeout;
  while (Date.now() < end && alive()) {
    if (ok()) return true;
    await sleep(150);
  }
  return ok();
}

const click = (testid: string) => {
  const el = document.querySelector<HTMLElement>(`[data-testid="${testid}"]`);
  el?.click();
  return !!el;
};

/** The demo's campaign: the United States on a seed whose opening has a war to show. */
const NATION = 'usa';
const SEED = 1203;

async function script(say: (c: Caption | null) => void, alive: () => boolean, fast: boolean): Promise<void> {
  const hold = (ms: number) => sleep(fast ? Math.min(ms, 600) : ms);
  const g = useGame.getState;

  say({ step: 'title', kicker: 'The Pacific', line: 'Four powers. Every order in secret.' });
  await hold(4500);
  if (!alive()) return;

  say({ step: 'campaign', kicker: 'Campaign', line: 'Choose a nation. Three AI powers want what you hold.' });
  await g().newGame(NATION, SEED, 20, 'normal');
  if (!alive() || !(await until(() => g().screen === 'game' && !!g().view, 30_000, alive))) return;
  // On a phone the first turn opens on the three-step brief: the film goes past it.
  await hold(600);
  click('how-to-close');
  await hold(2500);

  const view = g().view!;
  const op = proposeOperations(view, 1)[0];
  if (op) {
    g().launchOperation(op);
    say({ step: 'operation', kicker: op.codename, line: `Launched: ${op.name}. The staff plans every turn toward it.` });
  } else say({ step: 'operation', kicker: 'Staff plan', line: 'The staff drafts every order. Change any of them.' });
  await until(() => (g().draft ? Object.keys(g().draft!.formations).length > 0 : false), 15_000, alive);
  await hold(4500);
  if (!alive()) return;

  say({ step: 'resolve', kicker: `Turn ${view.turn}`, line: 'Everyone commits at once. Then the world moves.' });
  const turn = view.turn;
  void g().submit();
  await until(() => (g().view?.turn ?? 0) > turn && !g().playback && !g().resolving, fast ? 25_000 : 40_000, alive);
  if (g().playback) g().finishPlayback();
  click('how-to-close');
  await hold(2500);
  if (!alive()) return;

  const s = SKIRMISHES.find((x) => x.id === 'fire-support') ?? SKIRMISHES[0]!;
  say({ step: 'battle', kicker: 'Battle', line: 'Every attack is a battle you fight by hand.' });
  g().fight(skirmishRequest(s, 7));
  await until(() => !!document.querySelector('[data-testid="arena-fight"]'), 60_000, alive);
  await hold(2500);
  click('arena-fight');
  await until(() => !!window.__arena?.ready(), 90_000, alive);
  await hold(1200);
  if (!alive()) return;

  const a = window.__arena?.arena();
  const red = a?.units.filter((u) => u.side === 'red' && u.alive) ?? [];
  const mark = red.find((u) => /t90|bmp|tunguska|msta/.test(u.type)) ?? red[0];
  if (mark && window.__arena) {
    say({ step: 'strike', kicker: 'Air strike', line: 'Strike jets inbound on their armour.' });
    window.__arena.support('blue', 'strike_jet', mark.x, mark.y, 'kill');
    await hold(14_000);
  }
  if (!alive()) return;
  say({ step: 'end', kicker: '', line: '' });
}

export function Demo() {
  const [cap, setCap] = useState<Caption | null>(null);
  // Every step shown so far, in order: the end card carries it (what the e2e checks the film by).
  const [seen, setSeen] = useState<DemoStep[]>([]);
  useEffect(() => {
    let live = true;
    const fast = new URLSearchParams(location.search).get('fast') === '1';
    const say = (c: Caption | null) => {
      setCap(c);
      if (c) setSeen((s) => [...s, c.step]);
    };
    void script(say, () => live, fast).catch(() => say({ step: 'end', kicker: '', line: '' }));
    return () => {
      live = false;
    };
  }, []);
  const leave = (again: boolean) => {
    const url = new URL(location.href);
    if (!again) {
      url.searchParams.delete('demo');
      url.searchParams.delete('fast');
    }
    location.href = url.toString();
  };
  if (cap?.step === 'end') {
    return (
      <div className="demo-end" data-testid="demo-end" data-step="end" data-seen={seen.join(' ')}>
        <p className="home-kicker">The Pacific · Four powers · One turn</p>
        <h1 className="home-logo">Brink</h1>
        <p className="demo-end-sub">A war of nations on the map, every battle fought by hand, on the phone in your pocket. Runs in the browser, plays offline.</p>
        <div className="flex flex-wrap justify-center gap-3">
          <button type="button" className="demo-play" onClick={() => leave(false)} data-testid="demo-play">
            Play now
          </button>
          <button type="button" className="demo-exit static" onClick={() => leave(true)} data-testid="demo-again">
            Watch again
          </button>
        </div>
      </div>
    );
  }
  return (
    <>
      <button type="button" className="demo-exit" onClick={() => leave(false)} data-testid="demo-exit">
        Exit demo
      </button>
      {cap && (
        <div key={cap.step} className="demo-caption" data-testid="demo-caption" data-step={cap.step} aria-live="polite">
          <p className="demo-kicker">{cap.kicker}</p>
          <p className="demo-line">{cap.line}</p>
        </div>
      )}
    </>
  );
}
