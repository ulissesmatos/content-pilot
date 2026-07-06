export const QUEUE = {
  schedulerTick: 'scheduler.tick',
  jobRun: 'job.run',
  postProcess: 'post.process',
  briefGenerate: 'brief.generate',
} as const;

export interface JobRunPayload {
  jobId: string;
  runId: string;
}

export interface PostProcessPayload {
  jobId: string;
  runId: string;
  wpPostId: number;
}

export interface BriefGeneratePayload {
  briefId: string;
  runId: string;
}
