/** Renderer de bloco gerenciado: recebe os dados extraídos/verificados e devolve o HTML interno do bloco. */
export type ManagedBlockRenderer = (input: {
  data: Record<string, unknown>;
  slug: string;
  topicLabel: string;
  locale: string;
  now: Date;
}) => string;
