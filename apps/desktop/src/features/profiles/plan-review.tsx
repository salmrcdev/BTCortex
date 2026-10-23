import { CircleCheck, CircleDashed, Info, Lock, ShieldCheck, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { DeploymentPlan } from '@btcortex/contracts';
import { capacityTone, Meter } from '@/components/data/meter';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatBytes } from '@/lib/format';

// Everything specification section 18 asks a profile to show before it is
// deployed: steps, downloads, storage, memory, processors, ports,
// dependencies, warnings, privacy and security implications, resource impact
// and whether Docker or WSL2 is needed.

const GB = 1_000_000_000;
const decimal = (bytes: number) =>
  bytes >= GB ? `${Math.round(bytes / GB).toLocaleString('en-GB')} GB` : formatBytes(bytes);

function TextList({ title, items, icon }: { title: string; items: readonly string[]; icon: ReactNode }) {
  if (items.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2">
          {items.map((item) => (
            <li key={item} className="flex items-start gap-2">
              {icon}
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

export function PlanReview({ plan }: { plan: DeploymentPlan }) {
  const { t } = useTranslation();
  const storageShare = plan.storage.neededBytes / Math.max(plan.storage.freeBytes, 1);
  const memoryShare = plan.memory.recommendedBytes / Math.max(plan.memory.totalBytes, 1);
  return (
    <div className="space-y-4">
      {plan.blockers.length > 0 && (
        <div role="alert" className="rounded-lg border border-danger/40 bg-card p-4">
          <h2 className="flex items-center gap-2 font-semibold">
            <TriangleAlert aria-hidden="true" className="size-4 text-danger" />
            {t('profiles.plan.blockers')}
          </h2>
          <ul className="mt-2 list-inside list-disc space-y-1">
            {plan.blockers.map((blocker) => (
              <li key={blocker}>{blocker}</li>
            ))}
          </ul>
        </div>
      )}
      {plan.warnings.length > 0 && (
        <div className="rounded-lg border border-warning/40 bg-warning/5 p-4">
          <h2 className="flex items-center gap-2 font-semibold">
            <Info aria-hidden="true" className="size-4 text-warning" />
            {t('profiles.plan.warnings')}
          </h2>
          <ul className="mt-2 list-inside list-disc space-y-1">
            {plan.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t('profiles.plan.steps')}</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="space-y-3">
            {plan.steps.map((step, index) => (
              <li key={step.component} className="flex gap-3">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold tabular">
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{step.title}</span>
                    <Badge variant={step.state === 'to-do' ? 'outline' : 'neutral'}>
                      {t(`profiles.plan.stepStates.${step.state}`)}
                    </Badge>
                  </p>
                  <p className="text-muted-foreground">{step.detail}</p>
                </div>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('profiles.plan.downloads')}</CardTitle>
        </CardHeader>
        <CardContent>
          {plan.downloads.length === 0 ? (
            <p className="text-muted-foreground">{t('profiles.plan.noDownloads')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('profiles.plan.downloadName')}</TableHead>
                  <TableHead>{t('profiles.plan.downloadVersion')}</TableHead>
                  <TableHead className="text-right">{t('profiles.plan.downloadSize')}</TableHead>
                  <TableHead>{t('profiles.plan.downloadCheck')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {plan.downloads.map((download) => (
                  <TableRow key={download.component}>
                    <TableCell className="font-medium">{download.name}</TableCell>
                    <TableCell className="tabular">{download.version ?? t('profiles.plan.unknown')}</TableCell>
                    <TableCell className="tabular text-right">
                      {download.bytes === null ? t('profiles.plan.unknown') : formatBytes(download.bytes)}
                    </TableCell>
                    <TableCell className="whitespace-normal text-muted-foreground">{download.verification}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t('profiles.plan.storage', { volume: plan.storage.volume })}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="tabular">
              {t('profiles.plan.storageNeeded', {
                needed: decimal(plan.storage.neededBytes),
                free: decimal(plan.storage.freeBytes),
                kind: t(`profiles.plan.diskKinds.${plan.storage.kind}`),
              })}
            </p>
            <Meter
              value={Math.min(1, storageShare)}
              tone={capacityTone(storageShare)}
              label={t('profiles.plan.storage', { volume: plan.storage.volume })}
              valueText={decimal(plan.storage.neededBytes)}
            />
            <dl className="space-y-1">
              {plan.storage.items.map((item) => (
                <div key={item.label} className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">{item.label}</dt>
                  <dd className="tabular">{decimal(item.bytes)}</dd>
                </div>
              ))}
            </dl>
            <p className="text-xs text-muted-foreground">{t('profiles.plan.storageEstimate')}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t('profiles.plan.memory')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="tabular">
              {t('profiles.plan.memoryNeeded', {
                needed: formatBytes(plan.memory.recommendedBytes),
                total: formatBytes(plan.memory.totalBytes),
              })}
            </p>
            <Meter
              value={Math.min(1, memoryShare)}
              tone={capacityTone(memoryShare)}
              label={t('profiles.plan.memory')}
              valueText={formatBytes(plan.memory.recommendedBytes)}
            />
            <dl className="space-y-1">
              {plan.memory.items.map((item) => (
                <div key={item.label} className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">{item.label}</dt>
                  <dd className="tabular">{formatBytes(item.bytes)}</dd>
                </div>
              ))}
            </dl>
            <p className="tabular">
              <span className="font-medium">{t('profiles.plan.processors')}: </span>
              {t('profiles.plan.processorsValue', {
                logical: plan.processors.logical,
                recommended: plan.processors.recommended,
              })}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('profiles.plan.ports')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-right">{t('profiles.plan.port')}</TableHead>
                <TableHead>{t('profiles.plan.purpose')}</TableHead>
                <TableHead>{t('profiles.plan.reach')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {plan.ports.map((port) => (
                <TableRow key={`${String(port.port)}-${port.purpose}`}>
                  <TableCell className="tabular text-right font-mono text-[13px]">{port.port}</TableCell>
                  <TableCell className="whitespace-normal">{port.purpose}</TableCell>
                  <TableCell>{t(`profiles.plan.reaches.${port.reach}`)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="text-xs text-muted-foreground">{t('profiles.plan.portsNote')}</p>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <TextList
          title={t('profiles.plan.privacy')}
          items={plan.privacy}
          icon={<Lock aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-info" />}
        />
        <TextList
          title={t('profiles.plan.security')}
          items={plan.security}
          icon={<ShieldCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-success" />}
        />
        <TextList
          title={t('profiles.plan.dependencies')}
          items={plan.dependencies}
          icon={<CircleDashed aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
        />
        <TextList
          title={t('profiles.plan.impact')}
          items={[
            ...plan.impact,
            plan.needsDockerOrWsl2 ? t('profiles.plan.dockerNeeded') : t('profiles.plan.dockerNotNeeded'),
          ]}
          icon={<CircleCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
        />
      </div>
    </div>
  );
}
