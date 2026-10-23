import { z } from 'zod';
import { ZmqBatchSchema } from './devtools';
import { ElectrumServerStatusSchema } from './electrum';
import { LightningStatusSchema } from './lightning';
import { AlertsChangedSchema } from './monitoring';
import { NodeStatusSchema } from './nodes';
import { JobSchema } from './setup';
import { TorStatusSchema } from './tor';

// Events the orchestrator publishes. The shell relays them to the WebView
// unchanged as the Tauri event `orchestrator-event`.

export const ORCHESTRATOR_EVENT_CHANNEL = 'orchestrator-event';

/** Emitted by the shell itself when the orchestrator process exits or restarts. */
export const ORCHESTRATOR_STATUS_CHANNEL = 'orchestrator-status';

export const OrchestratorEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('orchestrator.ready'),
    at: z.iso.datetime(),
    payload: z.object({ version: z.string() }),
  }),
  z.object({
    type: z.literal('node.status'),
    at: z.iso.datetime(),
    payload: NodeStatusSchema,
  }),
  z.object({
    type: z.literal('nodes.changed'),
    at: z.iso.datetime(),
    payload: z.object({ nodeIds: z.array(z.string()) }),
  }),
  z.object({
    type: z.literal('job.updated'),
    at: z.iso.datetime(),
    payload: JobSchema,
  }),
  z.object({
    type: z.literal('tor.status'),
    at: z.iso.datetime(),
    payload: TorStatusSchema,
  }),
  z.object({
    type: z.literal('electrum.status'),
    at: z.iso.datetime(),
    payload: ElectrumServerStatusSchema,
  }),
  z.object({
    type: z.literal('lightning.status'),
    at: z.iso.datetime(),
    payload: LightningStatusSchema,
  }),
  z.object({
    type: z.literal('alerts.changed'),
    at: z.iso.datetime(),
    payload: AlertsChangedSchema,
  }),
  z.object({
    type: z.literal('zmq.events'),
    at: z.iso.datetime(),
    payload: ZmqBatchSchema,
  }),
]);
export type OrchestratorEvent = z.infer<typeof OrchestratorEventSchema>;
export type OrchestratorEventType = OrchestratorEvent['type'];

export const OrchestratorStatusSchema = z.object({
  state: z.enum(['starting', 'running', 'restarting', 'stopped', 'failed']),
  detail: z.string().optional(),
});
export type OrchestratorStatus = z.infer<typeof OrchestratorStatusSchema>;
