import { Game } from './Game';
import { Menu } from './menu/Menu';
import { usePhone } from './phone';
import { PhoneGame } from './PhoneGame';
import { useGame } from './store';

export function App() {
  const screen = useGame((s) => s.screen);
  const view = useGame((s) => s.view);
  const phone = usePhone();
  if (screen !== 'game' || !view) return <Menu />;
  return phone ? <PhoneGame /> : <Game />;
}
