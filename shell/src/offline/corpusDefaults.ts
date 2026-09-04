// Mirrors task-launcher/src/tasks/shared/helpers/config.ts (defaultCorpus) so the pack
// downloader fetches the same item bank core-tasks will ask for.
export const DEFAULT_CORPUS: Record<string, string> = {
  'egma-math': 'math-item-bank',
  'matrix-reasoning': 'matrix-reasoning-item-bank',
  'mental-rotation': 'mental-rotation-item-bank',
  'same-different-selection': 'same-different-selection-item-bank',
  trog: 'trog-item-bank',
  'theory-of-mind': 'theory-of-mind-item-bank',
  vocab: 'vocab-item-bank',
  'adult-reasoning': 'adult-reasoning-item-bank',
  'hostile-attribution': 'hostile-attribution-item-bank',
  'child-survey': 'child-survey-item-bank',
};

export const TASKS_WITHOUT_CORPUS = new Set(['hearts-and-flowers', 'memory-game', 'intro']);

export function corpusFor(taskId: string, variantParams: Record<string, unknown>): string | null {
  if (TASKS_WITHOUT_CORPUS.has(taskId)) return null;
  const fromParams = variantParams.corpus;
  if (typeof fromParams === 'string' && fromParams) return fromParams;
  return DEFAULT_CORPUS[taskId] ?? null;
}

/** core-tasks reads adult-reasoning strings from the math item bank. */
export function translationTaskFor(taskId: string) {
  return taskId === 'adult-reasoning' ? 'egma-math' : taskId;
}
