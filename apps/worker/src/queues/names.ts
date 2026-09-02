export const QUEUE = {
  schedulerTick: 'scheduler.tick',
  jobRun: 'job.run',
  postProcess: 'post.process',
  briefGenerate: 'brief.generate',
  autopilotDiscover: 'autopilot.discover',
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

export interface AutopilotDiscoverPayload {
  autopilotConfigId: string;
  runId: string;
}
