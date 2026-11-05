import { writeFileSync } from 'node:fs';
import { validateMap } from '@brink/map';
import { generateIndoPac } from '../indopac';
import { mapToJson } from '../grid';

// `pnpm --filter @brink/mapgen map:indopac <out>`: write the Indo-Pacific South from its character grid.
const out = process.argv[2];
if (!out) throw new Error('usage: indopac <out.map.json>');
const map = generateIndoPac();
const errors = validateMap(map);
if (errors.length) throw new Error(errors.map((e) => `${e.path}: ${e.message}`).join('\n'));
writeFileSync(out, mapToJson(map));
console.log(`wrote ${out}`);
