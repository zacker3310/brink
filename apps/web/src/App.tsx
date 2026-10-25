import { Game } from './Game';
import { Menu } from './Menu';
import { useGame } from './store';

export function App() {
  const screen = useGame((s) => s.screen);
  const view = useGame((s) => s.view);
  return screen === 'game' && view ? <Game /> : <Menu />;
}
