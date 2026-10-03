/** Writes a probe result as Prettier-formatted JSON (repo config), so reruns are byte-stable. */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { format, resolveConfig } from 'prettier';

export async function writeResult(url: URL, value: unknown): Promise<void> {
  const path = fileURLToPath(url);
  const config = (await resolveConfig(path)) ?? {};
  writeFileSync(path, await format(JSON.stringify(value), { ...config, parser: 'json' }));
  console.log(`wrote ${path}`);
}
