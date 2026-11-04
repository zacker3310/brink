import { describe, expect, it } from 'vitest';
import type { BattleEvent } from '@brink/arena';
import { beatsOf, SWARM } from './film';

// The film's beats: a kamikaze swarm is one beat, its three drones flying in together.

const fire = (unit: string, x: number, overwatch = false): BattleEvent => ({ type: 'fire', unit, weapon: 'kamikaze', kind: 'loiter', calibre: 'fpv', from: { x: 15, y: 44 }, to: { x, y: 10 }, target: null, hit: true, chance: 80, overwatch, seen: true, shooterSeen: true });
const boom = (x: number): BattleEvent => ({ type: 'boom', x, y: 10, size: 1, kind: 'he', seen: true });
const intercept = (x: number): BattleEvent => ({ type: 'intercept', unit: 'support:kamikaze', by: 'r1', x, y: 10, seen: true });

describe('beatsOf: kamikaze swarms', () => {
  it('plays the three drones of a swarm and what each did as one beat', () => {
    const events = [fire('support:kamikaze', 4), boom(4), fire('support:kamikaze', 5), intercept(5), fire('support:kamikaze', 6), boom(6), { type: 'radio', side: 'blue', call: 'splash', unit: 'support:kamikaze' } as BattleEvent];
    const beats = beatsOf(events);
    expect(beats).toHaveLength(1);
    expect(beats[0]!.events).toEqual(events);
  });

  it('starts a new swarm after three drones, and never joins other shots to one', () => {
    const swarm = (x: number) => [fire('support:kamikaze', x), boom(x)];
    const events = [...Array.from({ length: SWARM + 1 }, (_, i) => swarm(i)).flat(), fire('support:himars', 9), boom(9), fire('support:kamikaze', 3)];
    const beats = beatsOf(events);
    expect(beats.map((b) => b.events.filter((e) => e.type === 'fire').length)).toEqual([SWARM, 1, 1, 1]);
  });
});
