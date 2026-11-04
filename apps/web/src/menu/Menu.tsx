import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { NATIONS } from '@brink/scenarios';
import { useCoach } from '../coach';
import { Emblem } from '../glyphs';
import { readSlot } from '../saves';
import { useGame } from '../store';
import { Archive } from './Archive';
import { operationName } from './intel';
import { Manual } from './Manual';
import { quickBattle } from './quick';
import { Settings } from './Settings';
import { Setup } from './Setup';
import { Skirmish } from './Skirmish';
import { Title, type MenuScreen } from './Title';

/** The guided first match: the United States, on a seed with a clean opening. */
const TUTORIAL_NATION = 'usa';
const TUTORIAL_SEED = 1;

interface Deploying {
  nation?: string;
  title: string;
  kicker: string;
}

const LINES = ['Establishing command link', 'Satellites tasked over the theatre', 'Orders of battle loaded', 'Rival staffs are already plotting', 'Weather and terrain in'];

/** The wait while the engine builds a world: who you are, the operation, a sweep and a status line. */
function Deploy({ d }: { d: Deploying }) {
  const [line, setLine] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setLine((l) => (l + 1) % LINES.length), 900);
    return () => window.clearInterval(t);
  }, []);
  const spec = NATIONS.find((n) => n.id === d.nation);
  return createPortal(
    <div className="deploy" role="status" aria-live="polite" data-testid="deploying" style={spec ? { ['--deploy' as string]: spec.color } : undefined}>
      <div className="deploy-ring">{spec ? <Emblem color={spec.color} government={spec.government} className="h-14 w-14" /> : null}</div>
      <p className="deploy-kicker">{d.kicker}</p>
      <h2 className="deploy-title">{d.title}</h2>
      <div className="deploy-bar" aria-hidden>
        <i />
      </div>
      <p className="deploy-line">{LINES[line]}…</p>
    </div>,
    document.body,
  );
}

export function Menu() {
  const newGame = useGame((s) => s.newGame);
  const loadGame = useGame((s) => s.loadGame);
  const fight = useGame((s) => s.fight);
  const notify = useGame((s) => s.notify);
  const slots = useGame((s) => s.slots);
  const notices = useGame((s) => s.notices);
  const [screen, setScreen] = useState<MenuScreen>('title');
  const [deploying, setDeploying] = useState<Deploying | null>(null);
  const back = () => setScreen('title');

  /** Run a world-building step behind the deploy screen. The menu unmounts when the game opens. */
  const deploy = async (d: Deploying, work: () => Promise<unknown>) => {
    setDeploying(d);
    try {
      await work();
    } finally {
      // Still here: the engine refused (a toast says why), so the menu comes back.
      if (useGame.getState().screen !== 'game') setDeploying(null);
    }
  };

  const load = (text: string) => void deploy({ title: 'Resuming', kicker: 'Campaign on file' }, () => loadGame(text));

  return (
    <div key={screen} className="vercel vercel-mono screen-in h-full overflow-y-auto bg-black">
      {screen === 'title' && (
        <Title
          slots={slots}
          go={setScreen}
          onTutorial={() => {
            // The coach is on before the first turn opens, so the staff leaves the orders to the player.
            useCoach.getState().begin(1);
            void deploy({ nation: TUTORIAL_NATION, title: 'Boot camp', kicker: 'Guided first turn' }, () => newGame(TUTORIAL_NATION, TUTORIAL_SEED, 20, 'easy'));
          }}
          onQuickBattle={() => fight(quickBattle())}
          onContinue={(s) => {
            const text = readSlot(s.slot);
            if (text) void deploy({ nation: s.nation, title: `Turn ${s.turn}`, kicker: 'Resuming campaign' }, () => loadGame(text));
            else notify('That slot could not be read', 'error');
          }}
        />
      )}
      {screen === 'setup' && (
        <Setup
          onBack={back}
          onBegin={(nation, seed, ...rest) => deploy({ nation, title: operationName(seed), kicker: 'Operation' }, () => newGame(nation, seed, ...rest))}
        />
      )}
      {screen === 'archive' && <Archive slots={slots} onBack={back} onLoad={load} onError={(t) => notify(t, 'error')} />}
      {screen === 'manual' && <Manual onBack={back} />}
      {screen === 'skirmish' && <Skirmish onBack={back} />}
      {screen === 'settings' && <Settings onBack={back} />}
      {deploying && <Deploy d={deploying} />}
      <ul className="pointer-events-none fixed right-4 bottom-4 z-50 flex flex-col items-end gap-1.5" aria-live="polite">
        {notices.map((n) => (
          <li
            key={n.id}
            className={`toast-in border bg-ink-900/95 px-3 py-2 text-xs shadow-xl ${n.tone === 'error' ? 'border-hostile/60 text-hostile' : n.tone === 'warn' ? 'border-signal/60 text-signal' : 'border-line text-muted'}`}
          >
            {n.text}
          </li>
        ))}
      </ul>
    </div>
  );
}
