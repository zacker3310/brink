import { useState } from 'react';
import { useCoach } from '../coach';
import { readSlot } from '../saves';
import { useGame } from '../store';
import { Archive } from './Archive';
import { Manual } from './Manual';
import { Multiplayer } from './Multiplayer';
import { Setup } from './Setup';
import { Title, type MenuScreen } from './Title';

/** The guided first match: the Commonwealth, on a seed with a clean opening. */
const TUTORIAL_NATION = 'aster';
const TUTORIAL_SEED = 1;

export function Menu() {
  const newGame = useGame((s) => s.newGame);
  const loadGame = useGame((s) => s.loadGame);
  const notify = useGame((s) => s.notify);
  const slots = useGame((s) => s.slots);
  const notices = useGame((s) => s.notices);
  // An invite link (?join=CODE) opens straight into the join form.
  const [joinCode] = useState(() => {
    try {
      return new URLSearchParams(location.search).get('join')?.toUpperCase().slice(0, 5) ?? undefined;
    } catch {
      return undefined;
    }
  });
  const [screen, setScreen] = useState<MenuScreen>(joinCode ? 'multiplayer' : 'title');
  const back = () => setScreen('title');

  const load = (text: string) =>
    void loadGame(text).then((kind) => {
      // A room save reopens its lobby so the saved players can rejoin.
      if (kind === 'room') setScreen('multiplayer');
    });

  return (
    <div key={screen} className="screen-in h-full overflow-y-auto">
      {screen === 'title' && (
        <Title
          slots={slots}
          go={setScreen}
          onTutorial={() => void newGame(TUTORIAL_NATION, TUTORIAL_SEED, 20).then(() => useCoach.getState().begin(1))}
          onContinue={(s) => {
            const text = readSlot(s.slot);
            if (text) load(text);
            else notify('That slot could not be read', 'error');
          }}
        />
      )}
      {screen === 'setup' && <Setup onBack={back} onBegin={newGame} />}
      {screen === 'archive' && <Archive slots={slots} onBack={back} onLoad={load} onError={(t) => notify(t, 'error')} />}
      {screen === 'manual' && <Manual onBack={back} />}
      {screen === 'multiplayer' && <Multiplayer onBack={back} initialCode={joinCode} />}
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
