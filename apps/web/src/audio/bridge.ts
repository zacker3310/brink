// Connects the game's store to the score without touching the screens: the menu plays the theme,
// the war map plays the planning score at the map's tension, and each new turn earns a stinger.
// The arena takes the score over through `battleScore` (index.ts) while a battle is on stage.

import { useGame } from '../store';
import { installTaps, music, stinger } from './index';
import { mapTension, stingerForTurn } from './tension';

let started = false;

export function startAudio(): void {
  if (started) return;
  started = true;
  installTaps();
  let turn = -1;
  let scenario = '';
  let op = useGame.getState().operation;
  const follow = () => {
    const s = useGame.getState();
    const view = s.screen === 'game' ? s.view : null;
    music.setScene(view ? 'planning' : 'menu');
    if (view) music.setLevel(mapTension(view));
    // An operation over with its prize in hand.
    if (op && !s.operation && view) {
      const site = view.sites[op.id.slice(5)];
      if (site?.owner === view.self.id) stinger('operation');
    }
    op = s.operation;
    if (!view) {
      turn = -1;
      return;
    }
    // A new turn of the same campaign: its report's stinger. A load or a new game starts quietly.
    if (view.scenarioId === scenario && view.turn > turn && turn >= 0) {
      const k = stingerForTurn(view, s.report);
      if (k) stinger(k);
    }
    scenario = view.scenarioId;
    turn = view.turn;
  };
  useGame.subscribe((s, prev) => {
    if (s.view !== prev.view || s.screen !== prev.screen || s.operation !== prev.operation) follow();
  });
  follow();
}
