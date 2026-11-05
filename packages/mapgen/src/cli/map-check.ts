import { checkMapFiles, formatReports } from '../check';

// `pnpm map:check [paths...]`: validate map files (default: the scenarios' maps). Exit 1 on any problem.
const paths = process.argv.slice(2);
if (!paths.length) {
  console.error('usage: map-check <file-or-directory>...');
  process.exit(2);
}
const reports = checkMapFiles(paths);
console.log(formatReports(reports));
if (reports.length === 0 || reports.some((r) => r.errors.length)) process.exit(1);
