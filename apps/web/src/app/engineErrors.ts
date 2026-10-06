/** User-facing text for typed engine errors (T06 N2: branch on RefitRequiredError.reason). */
import type { EngineErrorInfo } from '../workers/engine.api.ts';
import type { MasterData } from '../master/load.ts';

export function engineErrorText(e: EngineErrorInfo, m?: MasterData): string {
  switch (e.name) {
    case 'RefitRequiredError':
      return e.reason === 'legacy-kind'
        ? 'The stored model is legacy training-v1; refit required.'
        : e.reason === 'master-version-mismatch'
          ? 'Refit required: master data changed since the model was fitted.'
          : e.reason === 'malformed'
            ? 'The stored model snapshot is corrupt. Refit the model.'
            : `Unsupported model kind “${e.kind}”.`;
    case 'InsufficientDataError':
      return `Not enough training data to fit the model: ${e.eligible} eligible veterans (train ${e.train}, holdout ${e.holdout}); the engine needs at least 5 train rows and 1 holdout row.`;
    case 'ModelInputError':
      if (e.code === 'own-unique-skill') return "The target asks for the trainee's own unique skill, which the model doesn't estimate (Q-142).";
      if (e.code === 'duplicate-card') return 'A card is in the deck twice.';
      return `Invalid plan: ${e.message}`;
    case 'UnknownIdError':
      return `Unknown id: ${e.message}${m ? ` (master ${m.version})` : ''}`;
    default:
      return e.message;
  }
}
