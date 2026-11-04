import { lazy, Suspense, useEffect } from 'react';
import { Game } from './Game';
import { Demo, demoRequested } from './menu/Demo';
import { applyMotion } from './menu/device';
import { Menu } from './menu/Menu';
import { quickBattle } from './menu/quick';
import { OrderReview } from './OrderReview';
import { usePhone } from './phone';
import { PhoneGame } from './PhoneGame';
import { latestSlot, listSlots, readSlot } from './saves';
import { useGame } from './store';

// The battle (three.js, its models and loaders) loads the first time one opens.
const loadArena = () => import('./arena/ArenaScreen');
const ArenaScreen = lazy(() => loadArena().then((m) => ({ default: m.ArenaScreen })));
// Fetch it in the background once the app has settled, so a battle opens at once.
setTimeout(() => void loadArena(), 4000);

// Brink's own motion setting rides on the page root from the first frame.
applyMotion();

/**
 * Launch shortcuts from the installed app's icon menu (manifest `shortcuts`): ?quick=1 opens a
 * Quick Battle, ?continue=1 the latest campaign. The address is cleaned so a reload goes home.
 */
function useLaunchShortcut() {
  useEffect(() => {
    const url = new URL(location.href);
    const quick = url.searchParams.get('quick') === '1';
    const resume = url.searchParams.get('continue') === '1';
    if (!quick && !resume) return;
    url.searchParams.delete('quick');
    url.searchParams.delete('continue');
    history.replaceState(null, '', url.toString());
    const g = useGame.getState();
    if (quick) g.fight(quickBattle());
    else {
      const last = latestSlot(listSlots());
      const text = last ? readSlot(last.slot) : null;
      if (text) void g.loadGame(text);
    }
  }, []);
}

const demo = demoRequested();

export function App() {
  const screen = useGame((s) => s.screen);
  const view = useGame((s) => s.view);
  const battle = useGame((s) => s.battle);
  const endBattle = useGame((s) => s.endBattle);
  const phone = usePhone();
  const review = useGame((s) => s.review);
  useLaunchShortcut();
  return (
    <>
      {screen !== 'game' || !view ? (
        <Menu />
      ) : (
        // The game fades up from the deploy screen.
        <div className="game-in">{phone ? <PhoneGame /> : <Game />}</div>
      )}
      {review && screen === 'game' && view && <OrderReview />}
      {battle && (
        <Suspense fallback={<div className="fixed inset-0 z-50 bg-ink-950" />}>
          <ArenaScreen key={battle.setup.seed} req={battle} onDone={endBattle} />
        </Suspense>
      )}
      {demo && <Demo />}
    </>
  );
}
