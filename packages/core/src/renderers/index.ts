import { renderGameCodesWidget } from './game-codes-widget';
import type { ManagedBlockRenderer } from './types';

export type { ManagedBlockRenderer } from './types';

/** Registro de renderers de bloco gerenciado. Templates referenciam por rendererId. */
export const managedBlockRenderers: Record<string, ManagedBlockRenderer> = {
  'game-codes-widget': renderGameCodesWidget,
};
