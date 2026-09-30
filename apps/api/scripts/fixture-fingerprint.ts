// Recomputes `fingerprint` in test/fixtures/mcqueen.json (01 §5). Run: node scripts/fixture-fingerprint.ts
import { readFileSync, writeFileSync } from 'node:fs';
import { fingerprint } from '@uma/schema';

const path = new URL('../test/fixtures/mcqueen.json', import.meta.url);
const capture = JSON.parse(readFileSync(path, 'utf8'));
capture.fingerprint = await fingerprint(capture.veteran);
writeFileSync(path, JSON.stringify(capture, null, 2) + '\n');
console.log(capture.fingerprint);
