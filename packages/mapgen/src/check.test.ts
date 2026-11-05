import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { checkMapFiles, checkMapText, formatReports } from './check';

const MAPS = fileURLToPath(new URL('../../scenarios/src/maps', import.meta.url));

describe('map:check', () => {
  it('passes every map file the game ships', () => {
    const reports = checkMapFiles([MAPS]);
    expect(reports.map((r) => r.file.split('/').pop())).toContain('pacific.map.json');
    for (const r of reports) expect(r.errors, r.file).toEqual([]);
    expect(formatReports(reports)).toMatch(/0 with problems$/);
  });

  it('reports a JSON syntax error and every format problem, with its path', () => {
    expect(checkMapText('bad.json', '{ "format": ').errors[0]!.message).toMatch(/^not valid JSON/);
    const r = checkMapText('x.map.json', JSON.stringify({ format: 'brink-map', version: 1, id: 'X', name: '', cols: 2, rows: 1, layout: 'odd-r', layers: {}, nations: [], sites: [] }));
    expect(r.summary).toBeNull();
    const text = formatReports([r]);
    expect(text).toContain('FAIL  x.map.json');
    expect(text).toContain('id: must be a lowercase id');
    expect(text).toContain('layers.owner: is required');
    expect(text).toMatch(/1 with problems$/);
  });
});
