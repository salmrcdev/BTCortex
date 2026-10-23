import { useMutation } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Check, CircleCheck, Info, ShieldCheck, TriangleAlert } from 'lucide-react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { BitcoinNetworkId, Job, NodeImplementation, NodeUsage, SetupPlan } from '@btcortex/contracts';
import { JobProgress } from '@/components/feedback/job-progress';
import { ErrorPanel } from '@/components/feedback/error-panel';
import { NetworkBadge } from '@/components/status/network-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox, FieldError, Input, Label } from '@/components/ui/form-controls';
import { RadioCards } from '@/components/ui/radio-cards';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Breadcrumbs } from '@/components/layout/breadcrumbs';
import { formatBytes } from '@/lib/format';
import { callOrchestrator, toOrchestratorError } from '@/lib/orchestrator';
import { cn } from '@/lib/utils';
import { useJob, useSetupPlan } from '@/features/nodes/queries';

type Step = 'choose' | 'review' | 'install';
const STEPS: readonly Step[] = ['choose', 'review', 'install'];
const STAGE_ORDER = [
  'resolving',
  'fetching-checksums',
  'verifying-signatures',
  'downloading',
  'extracting',
  'verifying-executables',
  'finalising',
  'configuring',
  'registering',
  'starting',
] as const;

function StepIndicator({ current }: { current: Step }) {
  const { t } = useTranslation();
  const labels: Record<Step, string> = {
    choose: t('setup.stepChoose'),
    review: t('setup.stepReview'),
    install: t('setup.stepInstall'),
  };
  const currentIndex = STEPS.indexOf(current);
  return (
    <ol aria-label={t('setup.stepsLabel')} className="flex flex-wrap items-center gap-2">
      {STEPS.map((step, index) => (
        <li key={step} aria-current={step === current ? 'step' : undefined} className="flex items-center gap-2">
          <span
            className={cn(
              'flex size-6 items-center justify-center rounded-full border text-xs font-semibold',
              index < currentIndex && 'border-success bg-success/15',
              index === currentIndex && 'border-primary bg-primary text-primary-foreground',
              index > currentIndex && 'text-muted-foreground',
            )}
          >
            {index < currentIndex ? <Check aria-hidden="true" className="size-3.5" /> : index + 1}
          </span>
          <span className={cn(index === currentIndex ? 'font-medium' : 'text-muted-foreground')}>{labels[step]}</span>
          {index < STEPS.length - 1 && <span aria-hidden="true" className="mx-1 h-px w-8 bg-border" />}
        </li>
      ))}
    </ol>
  );
}

const KNOTS_POINTS = ['rules', 'transactions', 'services', 'expiry'] as const;

/** What following Bitcoin Knots' chain means, and the user's agreement to it. */
function DifferentChain({ accepted, onAccept }: { accepted: boolean; onAccept: (accepted: boolean) => void }) {
  const { t } = useTranslation();
  return (
    <section
      aria-labelledby="knots-chain-title"
      className="space-y-3 rounded-lg border border-warning/50 bg-warning/5 p-4"
    >
      <h2 id="knots-chain-title" className="flex items-center gap-2 font-semibold">
        <TriangleAlert aria-hidden="true" className="size-4 text-warning" />
        {t('setup.knotsChain.title')}
      </h2>
      <ul className="max-w-prose list-disc space-y-1.5 pl-5">
        {KNOTS_POINTS.map((point) => (
          <li key={point}>{t(`setup.knotsChain.${point}`)}</li>
        ))}
      </ul>
      <label className="flex max-w-prose items-start gap-2 font-medium">
        <Checkbox
          checked={accepted}
          onChange={(event) => {
            onAccept(event.currentTarget.checked);
          }}
        />
        <span>{t('setup.knotsChain.accept')}</span>
      </label>
    </section>
  );
}

function PlanReview({ plan }: { plan: SetupPlan }) {
  const { t } = useTranslation();
  const knots = plan.implementation === 'bitcoin-knots';
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>{t('setup.planTitle')}</CardTitle>
          <NetworkBadge network={plan.network} />
        </CardHeader>
        <CardContent>
          <ul className="space-y-2">
            {(
              [
                plan.version
                  ? knots
                    ? t('setup.planVersionKnots', { version: plan.version })
                    : t('setup.planVersion', { version: plan.version })
                  : undefined,
                knots ? t('setup.planVerifyKnots') : t('setup.planVerify'),
                t('setup.planDownload', { size: formatBytes(plan.approximateDownloadBytes) }),
                t('setup.planLocation', { path: plan.dataDirectory }),
                t('setup.planFootprint', { size: formatBytes(plan.estimatedFootprintBytes) }),
                t('setup.planNoAdmin'),
              ] as (string | undefined)[]
            )
              .filter((line): line is string => line !== undefined)
              .map((line) => (
                <li key={line} className="flex items-start gap-2">
                  <ShieldCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-success" />
                  <span>{line}</span>
                </li>
              ))}
          </ul>
          <p className="mt-3 text-xs text-muted-foreground">
            {t('setup.planHardware', {
              memory: formatBytes(plan.hardware.totalMemoryBytes),
              disk: formatBytes(plan.hardware.freeDiskBytes),
              volume: plan.hardware.volumePath,
            })}
          </p>
        </CardContent>
      </Card>

      {plan.blockers.length > 0 && (
        <div role="alert" className="rounded-lg border border-danger/40 bg-card p-4">
          <h2 className="flex items-center gap-2 font-semibold">
            <TriangleAlert aria-hidden="true" className="size-4 text-danger" />
            {t('setup.planBlockers')}
          </h2>
          <ul className="mt-2 list-inside list-disc space-y-1">
            {plan.blockers.map((blocker) => (
              <li key={blocker}>{blocker}</li>
            ))}
          </ul>
        </div>
      )}

      {plan.consequences.length > 0 && (
        <div className="rounded-lg border border-warning/40 bg-warning/5 p-4">
          <h2 className="flex items-center gap-2 font-semibold">
            <Info aria-hidden="true" className="size-4 text-warning" />
            {t('setup.planConsequences')}
          </h2>
          <ul className="mt-2 list-inside list-disc space-y-1">
            {plan.consequences.map((consequence) => (
              <li key={consequence}>{consequence}</li>
            ))}
          </ul>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t('setup.planSettings')}</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('setup.settingOption')}</TableHead>
                <TableHead>{t('setup.settingValue')}</TableHead>
                <TableHead>{t('setup.settingReason')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {plan.settings.map((setting) => (
                <TableRow key={setting.key}>
                  <TableCell className="font-mono text-[13px]">{setting.key}</TableCell>
                  <TableCell className="font-mono text-[13px]">{setting.value}</TableCell>
                  <TableCell className="whitespace-normal text-muted-foreground">{setting.reason}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {plan.existing.dataDirectories.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{t('setup.planExisting')}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1">
              {plan.existing.dataDirectories.map((directory) => (
                <li key={directory.path} className="font-mono text-[13px]">
                  {t('setup.planExistingDirectory', { path: directory.path })}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function SetupProgress({ job }: { job: Job }) {
  const { t } = useTranslation();
  return (
    <JobProgress job={job} stages={STAGE_ORDER.map((stage) => ({ id: stage, label: t(`setup.stages.${stage}`) }))} />
  );
}

export function SetupPage() {
  const { t } = useTranslation();
  const nameId = useId();
  const nameErrorId = useId();
  const [step, setStep] = useState<Step>('choose');
  const [name, setName] = useState<string>(t('setup.nameDefault'));
  const [implementation, setImplementation] = useState<NodeImplementation>('bitcoin-core');
  const [network, setNetwork] = useState<BitcoinNetworkId>('mainnet');
  const [usage, setUsage] = useState<NodeUsage>('wallet-backend');
  const [accepted, setAccepted] = useState(false);
  const [jobId, setJobId] = useState<string>();
  const nameError = name.trim() === '' ? t('setup.nameRequired') : undefined;
  const knots = implementation === 'bitcoin-knots';
  const product = knots ? 'Bitcoin Knots' : 'Bitcoin Core';

  const plan = useSetupPlan(network, usage, step === 'review', implementation);
  const needsAgreement = plan.data?.differentChain === true;
  const job = useJob(jobId);
  const start = useMutation({
    mutationFn: () =>
      callOrchestrator('setup.start', {
        name: name.trim(),
        network,
        usage,
        // Bitcoin Core is the default; Knots is named, with the user's agreement to its chain.
        ...(knots ? { implementation, ...(accepted ? { acceptDifferentChain: true as const } : {}) } : {}),
      }),
    onSuccess: ({ jobId: started }) => {
      setJobId(started);
      setStep('install');
    },
  });

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <Breadcrumbs
        trail={[
          <Link key="nodes" to="/nodes">
            {t('navigation.nodes')}
          </Link>,
        ]}
        current={t('setup.title')}
      />
      <div>
        <h1 className="font-mono text-xl font-semibold">{t('setup.title')}</h1>
        <p className="text-muted-foreground">{t('setup.description')}</p>
      </div>
      <StepIndicator current={step} />

      {step === 'choose' && (
        <form
          className="space-y-6"
          onSubmit={(event) => {
            event.preventDefault();
            if (!nameError) setStep('review');
          }}
        >
          <div className="max-w-sm space-y-1.5">
            <Label htmlFor={nameId}>{t('setup.nameLabel')}</Label>
            <Input
              id={nameId}
              value={name}
              maxLength={80}
              aria-invalid={nameError !== undefined}
              aria-describedby={nameError ? nameErrorId : undefined}
              onChange={(event) => {
                setName(event.target.value);
              }}
            />
            <FieldError id={nameErrorId}>{nameError}</FieldError>
          </div>
          <fieldset className="space-y-2">
            <legend className="mb-2 font-medium">{t('setup.implementationLabel')}</legend>
            <RadioCards<NodeImplementation>
              label={t('setup.implementationLabel')}
              value={implementation}
              onValueChange={(value) => {
                setImplementation(value);
                setAccepted(false);
                // BTCortex sets up no Electrum server for a Knots node.
                if (value === 'bitcoin-knots' && usage === 'electrum-backend') setUsage('wallet-backend');
              }}
              className="sm:grid-cols-2"
              options={[
                {
                  value: 'bitcoin-core',
                  title: 'Bitcoin Core',
                  description: t('setup.implementationCore'),
                  badge: <Badge variant="success">{t('setup.recommended')}</Badge>,
                },
                { value: 'bitcoin-knots', title: 'Bitcoin Knots', description: t('setup.implementationKnots') },
              ]}
            />
          </fieldset>
          <fieldset className="space-y-2">
            <legend className="mb-2 font-medium">{t('setup.networkLabel')}</legend>
            <RadioCards
              label={t('setup.networkLabel')}
              value={network}
              onValueChange={setNetwork}
              className="sm:grid-cols-2"
              options={[
                {
                  value: 'mainnet',
                  title: t('networks.mainnet'),
                  description: t('setup.networkMainnet'),
                  badge: <Badge variant="success">{t('setup.recommended')}</Badge>,
                },
                { value: 'testnet4', title: t('networks.testnet4'), description: t('setup.networkTestnet4') },
                { value: 'signet', title: t('networks.signet'), description: t('setup.networkSignet') },
                { value: 'regtest', title: t('networks.regtest'), description: t('setup.networkRegtest') },
              ]}
            />
          </fieldset>
          <fieldset className="space-y-2">
            <legend className="mb-2 font-medium">{t('setup.usageLabel')}</legend>
            <RadioCards
              label={t('setup.usageLabel')}
              value={usage}
              onValueChange={setUsage}
              className={knots ? 'sm:grid-cols-2' : 'sm:grid-cols-3'}
              options={[
                {
                  value: 'wallet-backend',
                  title: t('setup.usageWallet'),
                  description: t('setup.usageWalletDescription'),
                  badge: <Badge variant="success">{t('setup.recommended')}</Badge>,
                },
                ...(knots
                  ? []
                  : [
                      {
                        value: 'electrum-backend' as const,
                        title: t('setup.usageElectrum'),
                        description: t('setup.usageElectrumDescription'),
                      },
                    ]),
                { value: 'general', title: t('setup.usageGeneral'), description: t('setup.usageGeneralDescription') },
              ]}
            />
            {knots && <p className="max-w-prose text-xs text-muted-foreground">{t('setup.knotsNoElectrum')}</p>}
          </fieldset>
          <Button type="submit" size="lg" disabled={nameError !== undefined}>
            {t('setup.reviewPlan')}
          </Button>
        </form>
      )}

      {step === 'review' && (
        <div className="space-y-4">
          {plan.isError ? (
            <ErrorPanel
              title={t('errors.actionFailed')}
              error={toOrchestratorError(plan.error)}
              onRetry={() => void plan.refetch()}
            />
          ) : !plan.data ? (
            <div className="space-y-3" aria-busy="true">
              <p className="text-muted-foreground">{t('setup.planLoading')}</p>
              <Skeleton className="h-40" />
            </div>
          ) : (
            <>
              <PlanReview plan={plan.data} />
              {needsAgreement && <DifferentChain accepted={accepted} onAccept={setAccepted} />}
            </>
          )}
          {start.isError && <ErrorPanel title={t('errors.actionFailed')} error={toOrchestratorError(start.error)} />}
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setStep('choose');
              }}
            >
              {t('setup.back')}
            </Button>
            <Button
              size="lg"
              disabled={!plan.data?.feasible || (needsAgreement && !accepted) || start.isPending}
              onClick={() => {
                start.mutate();
              }}
            >
              {t('setup.approve')}
            </Button>
          </div>
        </div>
      )}

      {step === 'install' && (
        <Card>
          <CardHeader>
            <CardTitle>{t('setup.progressTitle', { product })}</CardTitle>
            <NetworkBadge network={network} />
          </CardHeader>
          <CardContent className="space-y-4">
            {job.data ? <SetupProgress job={job.data} /> : <Skeleton className="h-24" />}
            {job.data?.state === 'succeeded' && job.data.result && (
              <div role="status" className="space-y-3 rounded-lg border border-success/40 bg-success/5 p-4">
                <p className="flex items-start gap-2">
                  <CircleCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-success" />
                  {t('setup.succeeded', { product })}
                </p>
                {usage === 'electrum-backend' && <p>{t('setup.succeededElectrum')}</p>}
                <div className="flex flex-wrap gap-3">
                  <Button asChild>
                    <Link to="/nodes/$nodeId" params={{ nodeId: job.data.result.nodeId }}>
                      {t('setup.openNode')}
                    </Link>
                  </Button>
                  {usage === 'electrum-backend' && (
                    <Button asChild variant="outline">
                      <Link to="/electrum">{t('setup.openElectrum')}</Link>
                    </Button>
                  )}
                </div>
              </div>
            )}
            {job.data?.state === 'failed' && job.data.error && (
              <ErrorPanel
                title={t('setup.failedTitle')}
                error={toOrchestratorError({ code: -32000, message: job.data.error.message, data: job.data.error })}
                onRetry={() => {
                  start.mutate();
                }}
              />
            )}
            {/* A retry that could not even start says so here, where the user is. */}
            {start.isError && <ErrorPanel title={t('errors.actionFailed')} error={toOrchestratorError(start.error)} />}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
