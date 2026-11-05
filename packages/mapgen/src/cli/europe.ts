import { writeFileSync } from 'node:fs';
import { validateMap } from '@brink/map';
import { europeMap } from '../europe';
import { mapToJson } from '../grid';

// `pnpm --filter @brink/mapgen map:europe <out>`: write the European theatre's map file.
const out = process.argv[2];
if (!out) throw new Error('usage: europe <out.map.json>');
const map = europeMap();
const errors = validateMap(map);
if (errors.length) throw new Error(errors.map((e) => `${e.path}: ${e.message}`).join('\n'));
writeFileSync(out, mapToJson(map));
console.log(`wrote ${out}`);
