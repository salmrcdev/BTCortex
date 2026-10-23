import { useTranslation } from 'react-i18next';
import type { NodeLifecycleState, NodeStatus } from '@btcortex/contracts';
import { StatusIndicator } from './status-indicator';
import type { StatusTone } from './status-indicator';

const TONES: Record<NodeLifecycleState, StatusTone> = {
  starting: 'working',
  running: 'healthy',
  stopping: 'working',
  stopped: 'inactive',
  unreachable: 'failed',
  unauthorised: 'failed',
  failed: 'failed',
  unknown: 'unknown',
};

/** Node state with icon and label; a running node also says whether it is synchronised. */
export function NodeStateIndicator({ status, className }: { status: NodeStatus; className?: string }) {
  const { t } = useTranslation();
  if (status.state === 'running' && status.snapshot) {
    const synchronising = status.snapshot.blockchain.initialBlockDownload;
    return (
      <StatusIndicator
        tone={synchronising ? 'working' : 'healthy'}
        label={synchronising ? t('nodeState.synchronising') : t('nodeState.synchronised')}
        {...(className ? { className } : {})}
      />
    );
  }
  return (
    <StatusIndicator
      tone={TONES[status.state]}
      label={t(`nodeState.${status.state}`)}
      {...(className ? { className } : {})}
    />
  );
}
