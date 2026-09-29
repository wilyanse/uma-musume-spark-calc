import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { getEngine } from '../workers/client.ts';
import { FIXTURE_MODE } from '../api/mode.ts';

/** Placeholder screen: proves the router, the engine worker (Comlink) and the mode switch are wired. */
export function Placeholder({ title }: { title: string }) {
  const params = useParams();
  const [pong, setPong] = useState<string>('…');

  useEffect(() => {
    let live = true;
    getEngine()
      .ping('web')
      .then((r) => live && setPong(r))
      .catch((e: unknown) => live && setPong(`error: ${String(e)}`));
    return () => {
      live = false;
    };
  }, []);

  return (
    <section>
      <h1>{title}</h1>
      <p>Placeholder screen (T13).</p>
      {Object.keys(params).length > 0 && <p>params: {JSON.stringify(params)}</p>}
      <p>data source: {FIXTURE_MODE ? 'fixtures' : 'api'}</p>
      <p>engine worker: {pong}</p>
    </section>
  );
}
