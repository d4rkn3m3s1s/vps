export type EmulatorCreateInput = {
  name: string;
  image?: string | undefined;
  metadata?: Record<string, unknown> | undefined;
};

export type EmulatorActionResponse = {
  emulatorId: string;
  jobId: string;
};
