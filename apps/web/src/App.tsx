import { lazy, Suspense } from 'react';
import { Game } from './Game';
import { Menu } from './menu/Menu';
import { OrderReview } from './OrderReview';
import { usePhone } from './phone';
import { PhoneGame } from './PhoneGame';
import { useGame } from './store';

// The battle (three.js, its models and loaders) loads the first time one opens.
const loadArena = () => import('./arena/ArenaScreen');
const ArenaScreen = lazy(() => loadArena().then((m) => ({ default: m.ArenaScreen })));
// Fetch it in the background once the app has settled, so a battle opens at once.
setTimeout(() => void loadArena(), 4000);

export function App() {
  const screen = useGame((s) => s.screen);
  const view = useGame((s) => s.view);
  const battle = useGame((s) => s.battle);
  const endBattle = useGame((s) => s.endBattle);
  const phone = usePhone();
  const review = useGame((s) => s.review);
  return (
    <>
      {screen !== 'game' || !view ? <Menu /> : phone ? <PhoneGame /> : <Game />}
      {review && screen === 'game' && view && <OrderReview />}
      {battle && (
        <Suspense fallback={<div className="fixed inset-0 z-50 bg-ink-950" />}>
          <ArenaScreen key={battle.setup.seed} req={battle} onDone={endBattle} />
        </Suspense>
      )}
    </>
  );
}
