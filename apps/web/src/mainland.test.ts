import { describe, expect, it } from 'vitest';
import { hexKey } from '@brink/map';
import { mainland } from './mainland';

describe('mainland', () => {
  it('is the largest connected piece, never the islands', () => {
    const continent = [hexKey(0, 0), hexKey(1, 0), hexKey(2, 0), hexKey(0, 1)];
    const islands = [hexKey(9, 9), hexKey(12, 4)];
    expect(mainland([...islands, ...continent]).sort()).toEqual([...continent].sort());
  });
  it('is nothing for nothing', () => {
    expect(mainland([])).toEqual([]);
  });
});
