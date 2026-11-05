import { writeFileSync } from 'node:fs';
import { validateMap } from '@brink/map';
import { mapToJson } from '../grid';
import { mideastMap } from '../mideast';

// `pnpm --filter @brink/mapgen map:mideast [out]`: write the Middle East and Africa map from its grid.
const out = process.argv[2] ?? '../scenarios/src/maps/mideast.map.json';
const map = mideastMap();
const errors = validateMap(map);
if (errors.length) throw new Error(errors.map((e) => `${e.path}: ${e.message}`).join('\n'));
writeFileSync(out, mapToJson(map));
console.log(`wrote ${out}: ${map.cols} x ${map.rows}, ${map.nations.length} nations, ${map.sites.length} sites`);
