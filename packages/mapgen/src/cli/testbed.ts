import { writeFileSync } from 'node:fs';
import { validateMap } from '@brink/map';
import { mapToJson } from '../grid';
import { generateTestbed } from '../testbed';

// `pnpm --filter @brink/mapgen map:testbed <out>`: write the six-power test map.
const out = process.argv[2];
if (!out) throw new Error('usage: testbed <out.map.json>');
const map = generateTestbed();
const errors = validateMap(map);
if (errors.length) throw new Error(errors.map((e) => `${e.path}: ${e.message}`).join('\n'));
writeFileSync(out, mapToJson(map));
console.log(`wrote ${out}`);
