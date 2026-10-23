import { z } from 'zod';

export const OperatingSystemSchema = z.enum(['windows', 'linux', 'macos', 'other']);
export type OperatingSystem = z.infer<typeof OperatingSystemSchema>;

export const SystemInfoSchema = z.object({
  product: z.object({
    name: z.string(),
    version: z.string(),
  }),
  orchestrator: z.object({
    version: z.string(),
    runtime: z.string(),
    processId: z.number().int(),
    startedAt: z.iso.datetime(),
    dataDirectory: z.string(),
    developmentMode: z.boolean(),
  }),
  platform: z.object({
    os: OperatingSystemSchema,
    release: z.string(),
    architecture: z.string(),
    cpuModel: z.string(),
    logicalProcessors: z.number().int().nonnegative(),
    totalMemoryBytes: z.number().int().nonnegative(),
    freeMemoryBytes: z.number().int().nonnegative(),
  }),
});
export type SystemInfo = z.infer<typeof SystemInfoSchema>;
