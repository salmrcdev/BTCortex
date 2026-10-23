import { z } from 'zod';
import { IntegrationStatusSchema, ServiceCapabilitySchema, ServiceHealthSchema, SupportLevelSchema } from './catalogue';
import { InstalledProductSchema } from './installations';

// Service orchestration (specification sections 24.1 and 29): every service
// BTCortex runs, as instances of the integration modules they belong to,
// with what each needs running and what needs it, and starting and stopping
// them in the order their dependencies require.

export const ServiceActionSchema = z.enum(['start', 'stop', 'restart']);
export type ServiceAction = z.infer<typeof ServiceActionSchema>;

export const ServiceInstanceStateSchema = z.enum([
  'running',
  'starting',
  'waiting',
  'stopping',
  'stopped',
  'failed',
  'unknown',
]);
export type ServiceInstanceState = z.infer<typeof ServiceInstanceStateSchema>;

/** What an integration module may do on this computer; shown to the user, granted by being built into BTCortex. */
export const ModulePermissionSchema = z.enum(['processes', 'files', 'network', 'tor', 'node-rpc', 'credentials']);
export type ModulePermission = z.infer<typeof ModulePermissionSchema>;

export const ServiceRequirementSchema = z.object({
  /** The instance needed, for example `tor` or `node:abc`. */
  id: z.string(),
  /** Hard: it cannot work without it; soft: it loses something without it. */
  hard: z.boolean(),
  reason: z.string(),
});
export type ServiceRequirement = z.infer<typeof ServiceRequirementSchema>;

export const ServiceInstanceSchema = z.object({
  id: z.string(),
  /** The integration module, by catalogue id. */
  moduleId: z.string(),
  name: z.string(),
  route: z.string().nullable(),
  state: ServiceInstanceStateSchema,
  health: ServiceHealthSchema,
  summary: z.string(),
  /** What can be done with it now. */
  actions: z.array(ServiceActionSchema),
  requires: z.array(ServiceRequirementSchema),
  /** Instances that need it. */
  requiredBy: z.array(z.string()),
  /** Log sources of the log centre. */
  logSources: z.array(z.string()),
});
export type ServiceInstance = z.infer<typeof ServiceInstanceSchema>;

export const ServiceModuleSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  status: IntegrationStatusSchema,
  level: SupportLevelSchema.nullable(),
  capabilities: z.array(ServiceCapabilitySchema),
  permissions: z.array(ModulePermissionSchema),
  /** Other integrations it needs, by catalogue id. */
  dependencies: z.array(z.object({ id: z.string(), optional: z.boolean(), reason: z.string() })),
  documentation: z.object({ document: z.string(), section: z.string() }).nullable(),
  /** The update centre's product, when BTCortex updates it. */
  updates: InstalledProductSchema.nullable(),
  route: z.string().nullable(),
});
export type ServiceModuleSummary = z.infer<typeof ServiceModuleSummarySchema>;

export const OrchestrationSchema = z.object({
  modules: z.array(ServiceModuleSummarySchema),
  /** In the order they start: what is needed before what needs it. */
  instances: z.array(ServiceInstanceSchema),
});
export type Orchestration = z.infer<typeof OrchestrationSchema>;

/** `all` stands for every instance BTCortex can start or stop. */
export const OrchestrationTargetSchema = z.string().min(1).max(200);

export const OrchestrationPlanSchema = z.object({
  target: z.string(),
  action: ServiceActionSchema,
  /** In the order they are carried out. */
  steps: z.array(z.object({ instanceId: z.string(), name: z.string(), action: ServiceActionSchema })),
  /** What else is affected without being changed, such as a node losing its onion peers. */
  consequences: z.array(z.string()),
  /** Why it cannot be done now, if so. */
  blocked: z.string().nullable(),
});
export type OrchestrationPlan = z.infer<typeof OrchestrationPlanSchema>;

export const OrchestrationRunSchema = z.object({
  plan: OrchestrationPlanSchema,
  /** Steps carried out, in order; a step that fails ends the run. */
  done: z.array(z.string()),
  overview: OrchestrationSchema,
});
export type OrchestrationRun = z.infer<typeof OrchestrationRunSchema>;
