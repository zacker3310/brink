import { writeFileSync } from 'node:fs';
import { validateMap } from '@brink/map';
import { generateAmericas } from '../americas';
import { mapToJson } from '../grid';

// `pnpm --filter @brink/mapgen map:americas <out>`: write the Americas from its character grid.
const out = process.argv[2];
if (!out) throw new Error('usage: americas <out.map.json>');
const map = generateAmericas();
const errors = validateMap(map);
if (errors.length) throw new Error(errors.map((e) => `${e.path}: ${e.message}`).join('\n'));
writeFileSync(out, mapToJson(map));
console.log(`wrote ${out}`);
