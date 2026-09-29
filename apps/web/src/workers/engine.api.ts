/** Surface exposed by the engine worker. T05/T06/T08 replace the stub with @uma/engine calls. */
export interface EngineApi {
  ping(name: string): string;
}

export const engineApi: EngineApi = {
  ping: (name) => `pong:${name}`,
};
