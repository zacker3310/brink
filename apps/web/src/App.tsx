import { ArenaScreen } from './arena/ArenaScreen';
import { Game } from './Game';
import { Menu } from './menu/Menu';
import { usePhone } from './phone';
import { PhoneGame } from './PhoneGame';
import { useGame } from './store';

export function App() {
  const screen = useGame((s) => s.screen);
  const view = useGame((s) => s.view);
  const battle = useGame((s) => s.battle);
  const endBattle = useGame((s) => s.endBattle);
  const phone = usePhone();
  return (
    <>
      {screen !== 'game' || !view ? <Menu /> : phone ? <PhoneGame /> : <Game />}
      {battle && <ArenaScreen key={battle.setup.seed} req={battle} onDone={endBattle} />}
    </>
  );
}
