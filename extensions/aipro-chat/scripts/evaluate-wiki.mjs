import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {wikiQualityDataset} from '../tests/fixtures/wiki-quality-corpus.mjs';
import {evaluateWikiRetrieval, gradeWikiAnswers} from './wiki-quality-evaluation.mjs';

process.chdir(fileURLToPath(new URL('../', import.meta.url)));
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--answers')) throw new Error('Usage: npm run eval:wiki -- [--answers capture.json]');
const dataset = wikiQualityDataset();
const report = args.length ? gradeWikiAnswers(dataset, JSON.parse(await readFile(args[1], 'utf8'))) : evaluateWikiRetrieval(dataset);
const output = `verification/wiki-evaluation-${new Date().toISOString().replace(/[:.]/g, '-')}`;
await mkdir(output, {recursive:true});
await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({report: `${output}/report.json`, kind:report.kind, passed:report.passed, cases:report.cases.length, assessed:report.assessed, failed:report.cases.filter(row => row.passed === false).map(row => row.id), actualModel:false}));
process.exitCode = report.passed ? 0 : 1;
