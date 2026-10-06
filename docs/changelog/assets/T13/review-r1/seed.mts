// Seeds a LOCAL `wrangler dev` API (not live Cloudflare) with golden roster rows (SYNTHETIC, T08)
// through the real POST /veterans ingest. Veteran #0 gets low-confidence fields for the T13 fix-1
// probe: /epithet (epithet mode source), /stats/gut. Veteran #1 gets /epithet but is later given a
// manual override so the probe can check override semantics survive an epithet fix.
import { readFileSync } from 'node:fs';
import { fingerprint } from '../../../../../packages/schema/src/index.ts';
const ROOT = new URL('../../../../../', import.meta.url).pathname;
const roster = JSON.parse(readFileSync(`${ROOT}/apps/web/fixtures/roster.json`, 'utf8'));
const B = `${process.env.T13_PROBE_BASE ?? 'http://127.0.0.1:8799'}/api/v1`;
const N = Number(process.argv[2] ?? 20);
let n = 0, ok = 0, rejected = 0;
const ulid = (i: number) => `01KGQZ00000000000000FXA${String(i).padStart(3, '0')}`.slice(0, 26);
// pick manual-mode, non-"Independent Learner" veterans first so the epithet fix changes the mode
const rows = [...roster].sort((a, b) => Number(b.trainMode === 'manual') - Number(a.trainMode === 'manual')).slice(0, N);
for (const r of rows) {
  const veteran = {
    characterId: r.characterId, outfitId: r.outfitId, rank: r.rank, rating: r.rating, epithet: n < 2 ? 'Trickster' : r.epithet,
    trainMode: n < 2 ? 'manual' : r.trainMode, stats: r.stats, aptitudes: r.aptitudes, skills: r.skills, sparks: r.sparks,
    deck: r.deck, scenarioId: r.scenarioId, career: r.career,
    parents: r.parents.map((p: Record<string, unknown>) => { const { matchedVeteranId: _m, ...rest } = p; return rest; }),
  };
  const fields: unknown[] = [];
  if (n < 2) {
    fields.push({ path: '/epithet', rawText: 'Indep. Lrnr', value: 'Trickster', confidence: 0.4, status: 'low_confidence', candidates: [{ value: 'Trickster', score: 0.5 }], cropKey: null });
    fields.push({ path: '/stats/gut', rawText: 'OCR 5S9', value: r.stats.gut, confidence: 0.5, status: 'low_confidence', candidates: [{ value: r.stats.gut, score: 0.6 }, { value: r.stats.gut + 1, score: 0.3 }], cropKey: null });
  }
  const cap = { schemaVersion: 1, captureId: ulid(n), capturedAt: r.capturedAt, agentVersion: 'T13-fix1-probe-seed', layoutVersion: 'x', masterVersion: 'global-20260930', fingerprint: await fingerprint(veteran as never), veteran, fields };
  const res = await fetch(`${B}/veterans`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(cap) });
  if (res.ok) ok++; else { rejected++; console.log('ingest', n, res.status, (await res.text()).slice(0, 300)); }
  n++;
}
console.log(JSON.stringify({ attempted: n, accepted: ok, rejected }));
