import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describeMap, type MapError, type MapFile, validateMap } from '@brink/map';

// `pnpm map:check`: every map file validated, every problem reported with its path in the file.

export interface MapReport {
  file: string;
  errors: MapError[];
  /** One line about the map when it is valid. */
  summary: string | null;
}

/** The map files under the given paths: files as given, directories searched for `*.map.json`. */
export function mapFiles(paths: readonly string[]): string[] {
  const out: string[] = [];
  const walk = (p: string) => {
    if (statSync(p).isDirectory()) {
      for (const e of readdirSync(p).sort()) {
        const q = join(p, e);
        if (statSync(q).isDirectory() || e.endsWith('.map.json')) walk(q);
      }
    } else out.push(p);
  };
  for (const p of paths) walk(p);
  return out;
}

/** Validate one map file's text. A JSON syntax error is reported as a problem, not thrown. */
export function checkMapText(file: string, text: string): MapReport {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (e) {
    return { file, errors: [{ path: '', message: `not valid JSON: ${(e as Error).message}` }], summary: null };
  }
  const errors = validateMap(value);
  return { file, errors, summary: errors.length ? null : describeMap(value as MapFile) };
}

export function checkMapFiles(paths: readonly string[]): MapReport[] {
  return mapFiles(paths).map((f) => checkMapText(f, readFileSync(f, 'utf8')));
}

export function formatReports(reports: readonly MapReport[]): string {
  const lines: string[] = [];
  for (const r of reports) {
    if (!r.errors.length) lines.push(`ok    ${r.file}  (${r.summary})`);
    else {
      lines.push(`FAIL  ${r.file}  (${r.errors.length} problem${r.errors.length === 1 ? '' : 's'})`);
      for (const e of r.errors) lines.push(`      ${e.path || '(file)'}: ${e.message}`);
    }
  }
  const bad = reports.filter((r) => r.errors.length).length;
  lines.push(`${reports.length} map file${reports.length === 1 ? '' : 's'} checked, ${bad} with problems`);
  return lines.join('\n');
}
