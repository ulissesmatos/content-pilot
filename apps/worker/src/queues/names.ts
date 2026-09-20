export const QUEUE = {
  schedulerTick: 'scheduler.tick',
  jobRun: 'job.run',
  postProcess: 'post.process',
  briefGenerate: 'brief.generate',
  autopilotDiscover: 'autopilot.discover',
  imageRegenerate: 'image.regenerate',
  catalogSync: 'catalog.sync',
} as const;

export interface JobRunPayload {
  jobId: string;
  runId: string;
}

export interface PostProcessPayload {
  jobId: string;
  runId: string;
  wpPostId: number;
  retryRunItemId?: string;
}

export interface BriefGeneratePayload {
  briefId: string;
  runId: string;
}

export interface AutopilotDiscoverPayload {
  autopilotConfigId: string;
  runId: string;
}

export interface ImageRegeneratePayload {
  briefId: string;
  runId: string;
  /** 'cover' ou 'inline-N': o slot do relatório de imagens. */
  slotId: string;
  /** Pedido do usuário sobre o que a nova imagem deve mostrar. */
  instruction?: string;
}
