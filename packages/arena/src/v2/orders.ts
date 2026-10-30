import { ABILITIES } from './rules';
import { H, W, type Action, type Point } from './types';

// The shape of an order, checked before the rules look at it: the engine refuses anything else
// (an unknown kind, a facing that is not a number, called fire aimed between cells) without touching
// the battle. Shared by the engine's whyNot and the command log.

const isCell = (p: unknown): p is Point => {
  const q = p as Point | null;
  return typeof q === 'object' && q !== null && Number.isInteger(q.x) && Number.isInteger(q.y) && q.x >= 0 && q.y >= 0 && q.x < W && q.y < H;
};
const isId = (s: unknown): s is string => typeof s === 'string' && s.length > 0;
const isFlag = (v: unknown) => v === undefined || typeof v === 'boolean';

/** The shape of an order: known kind, ids as strings, points on cells of the field, a finite facing. */
export function wellFormed(a: unknown): a is Action {
  if (typeof a !== 'object' || a === null) return false;
  const x = a as Record<string, unknown>;
  switch (x.type) {
    case 'move':
      return isId(x.unit) && isCell(x.to) && isFlag(x.dash);
    case 'face':
      return isId(x.unit) && typeof x.facing === 'number' && Number.isFinite(x.facing);
    case 'fire':
      return isId(x.unit) && isId(x.target) && isId(x.weapon);
    case 'strike':
      return isId(x.unit) && isCell(x.at) && isId(x.weapon) && isFlag(x.smoke);
    case 'support':
      return (x.asset === 'himars' || x.asset === 'tornado') && isCell(x.at);
    case 'overwatch':
    case 'hunker':
    case 'hold':
    case 'dismount':
    case 'split':
      return isId(x.unit);
    case 'smoke':
      return isId(x.unit) && (x.at === undefined || isCell(x.at));
    case 'embark':
      return isId(x.unit) && isId(x.carrier);
    case 'merge':
      return isId(x.unit) && isId(x.with);
    case 'treat':
    case 'repair':
      return isId(x.unit) && isId(x.target);
    case 'breach':
    case 'mine':
      return isId(x.unit) && isCell(x.at);
    case 'ability':
      return typeof x.id === 'string' && Object.hasOwn(ABILITIES, x.id) && (x.unit === undefined || isId(x.unit)) && (x.at === undefined || isCell(x.at));
    default:
      return false;
  }
}
