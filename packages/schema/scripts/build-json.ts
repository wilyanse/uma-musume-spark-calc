import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CONTRACTS, contractJsonSchema, type ContractName } from '../src/json-schemas.ts';

const outDir = fileURLToPath(new URL('../json/', import.meta.url));
mkdirSync(outDir, { recursive: true });
for (const f of readdirSync(outDir)) if (f.endsWith('.schema.json')) rmSync(outDir + f);

for (const name of Object.keys(CONTRACTS) as ContractName[]) {
  writeFileSync(
    `${outDir}${name}.schema.json`,
    `${JSON.stringify(contractJsonSchema(name), null, 2)}\n`,
  );
}
console.log(`wrote ${Object.keys(CONTRACTS).length} schemas to ${outDir}`);
