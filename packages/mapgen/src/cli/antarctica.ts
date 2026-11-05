import { writeFileSync } from 'node:fs';
import { validateMap } from '@brink/map';
import { generateAntarctica } from '../antarctica';
import { mapToJson } from '../grid';

// `pnpm --filter @brink/mapgen map:antarctica <out>`: write the Antarctica theatre (Black Files).
const out = process.argv[2];
if (!out) throw new Error('usage: antarctica <out.map.json>');
const map = generateAntarctica();
const errors = validateMap(map);
if (errors.length) throw new Error(errors.map((e) => `${e.path}: ${e.message}`).join('\n'));
writeFileSync(out, mapToJson(map));
console.log(`wrote ${out}`);
for (const row of map.layers.owner.rows) console.log(row);
