import { Link } from '@tanstack/react-router';
import { Check, CircleCheck, TriangleAlert } from 'lucide-react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DeploymentProfileIdSchema } from '@btcortex/contracts';
import type {
  BitcoinNetworkId,
  DeploymentChoices,
  DeploymentComponent,
  DeploymentProfile,
  DeploymentTorMode,
} from '@btcortex/contracts';
import { Meter } from '@/components/data/meter';
import { ConfirmButton, useErrorFeedback } from '@/components/feedback/confirm-button';
import { ErrorPanel } from '@/components/feedback/error-panel';
import { Note } from '@/components/feedback/note';
import { NetworkBadge } from '@/components/status/network-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox, FieldError, Input, Label, NativeSelect } from '@/components/ui/form-controls';
import { RadioCards } from '@/components/ui/radio-cards';
import { Skeleton } from '@/components/ui/skeleton';
import { Breadcrumbs } from '@/components/layout/breadcrumbs';
import { useJob, useNodes } from '@/features/nodes/queries';
import { formatPercent } from '@/lib/format';
import { toOrchestratorError } from '@/lib/orchestrator';
import { cn } from '@/lib/utils';
import { DeploymentSteps, deploymentOutcome } from './deployment-steps';
import { PlanReview } from './plan-review';
import { useDeploymentPlan, useDeployProfile, useProfilesOverview } from './queries';

// One profile: customise it, review its plan for this computer, deploy it
// and follow the deployment step by step (specification section 18: users
// must be able to customise a profile before installation).

type Step = 'customise' | 'review' | 'deploy';
const STEPS: readonly Step[] = ['customise', 'review', 'deploy'];
const NETWORKS = ['mainnet', 'testnet4', 'signet', 'regtest'] as const;

function StepIndicator({ current }: { current: Step }) {
  const { t } = useTranslation();
  const currentIndex = STEPS.indexOf(current);
  return (
    <ol aria-label={t('profiles.wizard.stepsLabel')} className="flex flex-wrap items-center gap-2">
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
          <span className={cn(index === currentIndex ? 'font-medium' : 'text-muted-foreground')}>
            {t(`profiles.wizard.${step}`)}
          </span>
          {index < STEPS.length - 1 && <span aria-hidden="true" className="mx-1 h-px w-8 bg-border" />}
        </li>
      ))}
    </ol>
  );
}

function defaultComponents(profile: DeploymentProfile): DeploymentComponent[] {
  return profile.components
    .filter((part) => !part.required && part.chosenByDefault && part.kind !== 'unavailable')
    .map((part) => part.component);
}

function Deployment({
  profile,
  deploymentId,
  jobId,
}: {
  profile: DeploymentProfile;
  deploymentId: string;
  jobId: string;
}) {
  const { t } = useTranslation();
  const overview = useProfilesOverview();
  const job = useJob(jobId);
  const record = overview.data?.deployments.find((candidate) => candidate.id === deploymentId);
  const outcome = record ? deploymentOutcome(record) : 'running';
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('profiles.progress.title', { letter: profile.letter })}</CardTitle>
        {record && <NetworkBadge network={record.network} />}
      </CardHeader>
      <CardContent className="space-y-4">
        {job.data?.state === 'running' && (
          <div className="space-y-2" aria-live="polite">
            <p>{job.data.progress.message}</p>
            {job.data.progress.fraction !== undefined && (
              <Meter
                role="progressbar"
                tone="info"
                value={job.data.progress.fraction}
                label={job.data.progress.message}
                valueText={formatPercent(job.data.progress.fraction)}
              />
            )}
          </div>
        )}
        {record ? <DeploymentSteps record={record} /> : <Skeleton className="h-32" />}
        {outcome === 'done' || outcome === 'attention' ? (
          <div role="status" className="flex items-start gap-2 rounded-lg border border-success/40 bg-success/5 p-4">
            <CircleCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-success" />
            <p>{t('profiles.progress.succeeded')}</p>
          </div>
        ) : outcome === 'failed' ? (
          <div role="alert" className="flex items-start gap-2 rounded-lg border border-danger/40 bg-card p-4">
            <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-danger" />
            <p>{job.data?.error?.message ?? t('profiles.progress.failed')}</p>
          </div>
        ) : null}
        {record?.nodeId != null && record.finishedAt !== null && (
          <Button asChild>
            <Link to="/nodes/$nodeId" params={{ nodeId: record.nodeId }}>
              {t('profiles.progress.openNode')}
            </Link>
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

/** Customise, review and deploy one profile; the first-run guide starts beginners at the review. */
export function ProfileWizard({
  profile,
  initialStep = 'customise',
}: {
  profile: DeploymentProfile;
  initialStep?: 'customise' | 'review';
}) {
  const { t } = useTranslation();
  const formId = useId();
  const nodes = useNodes();
  const deploy = useDeployProfile();
  const feedback = useErrorFeedback();
  const [step, setStep] = useState<Step>(initialStep);
  const [targetKind, setTargetKind] = useState<'new' | 'existing'>('new');
  const [name, setName] = useState<string>(t('profiles.form.nameDefault'));
  const [existingId, setExistingId] = useState<string>();
  const [network, setNetwork] = useState<BitcoinNetworkId>('mainnet');
  const [chosen, setChosen] = useState<DeploymentComponent[]>(() => defaultComponents(profile));
  const [torMode, setTorMode] = useState<DeploymentTorMode>('tor-only');
  const [onionService, setOnionService] = useState(true);
  const [privateBroadcast, setPrivateBroadcast] = useState(true);
  const [started, setStarted] = useState<{ jobId: string; deploymentId: string }>();

  const existing = nodes.data ?? [];
  const existingNode = existing.find((node) => node.profile.id === existingId) ?? existing[0];
  const effectiveNetwork = targetKind === 'existing' && existingNode ? existingNode.profile.network : network;
  const included = (component: DeploymentComponent) =>
    profile.components.some(
      (part) =>
        part.component === component && part.kind !== 'unavailable' && (part.required || chosen.includes(component)),
    );
  const nameError = targetKind === 'new' && name.trim() === '' ? t('profiles.form.nameRequired') : undefined;
  const targetMissing = targetKind === 'existing' && !existingNode;
  const choices: DeploymentChoices = {
    profileId: profile.id,
    network: effectiveNetwork,
    components: chosen,
    target:
      targetKind === 'new'
        ? { kind: 'new', name: name.trim() || t('profiles.form.nameDefault') }
        : { kind: 'existing', nodeId: existingNode?.profile.id ?? '' },
    ...(included('tor') ? { tor: { mode: torMode, onionService, privateBroadcast } } : {}),
  };
  const plan = useDeploymentPlan(choices, step === 'review');

  if (step === 'deploy' && started) {
    return (
      <>
        <StepIndicator current="deploy" />
        <Deployment profile={profile} deploymentId={started.deploymentId} jobId={started.jobId} />
      </>
    );
  }

  return (
    <>
      <StepIndicator current={step} />
      {step === 'customise' && (
        <form
          className="space-y-6"
          onSubmit={(event) => {
            event.preventDefault();
            if (nameError === undefined && !targetMissing) setStep('review');
          }}
        >
          <fieldset className="space-y-3">
            <legend className="mb-2 font-medium">{t('profiles.form.node')}</legend>
            <RadioCards
              label={t('profiles.form.node')}
              value={targetKind}
              onValueChange={setTargetKind}
              className="sm:grid-cols-2"
              options={[
                {
                  value: 'new',
                  title: t('profiles.form.newNode'),
                  description: t('profiles.form.newNodeDescription'),
                },
                {
                  value: 'existing',
                  title: t('profiles.form.existingNode'),
                  description: t('profiles.form.existingNodeDescription'),
                },
              ]}
            />
            {targetKind === 'new' ? (
              <div className="max-w-sm space-y-1.5">
                <Label htmlFor={`${formId}-name`}>{t('profiles.form.name')}</Label>
                <Input
                  id={`${formId}-name`}
                  value={name}
                  maxLength={80}
                  aria-invalid={nameError !== undefined}
                  aria-describedby={nameError ? `${formId}-name-error` : undefined}
                  onChange={(event) => {
                    setName(event.target.value);
                  }}
                />
                <FieldError id={`${formId}-name-error`}>{nameError}</FieldError>
              </div>
            ) : existing.length === 0 ? (
              <p className="text-muted-foreground">{t('profiles.form.noExistingNodes')}</p>
            ) : (
              <div className="max-w-sm space-y-1.5">
                <Label htmlFor={`${formId}-node`}>{t('profiles.form.chooseNode')}</Label>
                <NativeSelect
                  id={`${formId}-node`}
                  className="w-full"
                  value={existingNode?.profile.id}
                  onChange={(event) => {
                    setExistingId(event.target.value);
                  }}
                >
                  {existing.map((node) => (
                    <option key={node.profile.id} value={node.profile.id}>
                      {node.profile.name} ({t(`networks.${node.profile.network}`)})
                    </option>
                  ))}
                </NativeSelect>
              </div>
            )}
          </fieldset>

          {targetKind === 'new' && (
            <fieldset className="space-y-2">
              <legend className="mb-2 font-medium">{t('profiles.form.network')}</legend>
              <RadioCards
                label={t('profiles.form.network')}
                value={network}
                onValueChange={setNetwork}
                className="sm:grid-cols-2"
                options={NETWORKS.map((candidate) => ({
                  value: candidate,
                  title: t(`networks.${candidate}`),
                  description: t(`profiles.form.networks.${candidate}`),
                }))}
              />
            </fieldset>
          )}

          <fieldset className="space-y-2">
            <legend className="mb-2 font-medium">{t('profiles.form.components')}</legend>
            <ul className="space-y-3">
              {profile.components.map((part) => {
                const unavailable = part.kind === 'unavailable';
                const checked = !unavailable && (part.required || chosen.includes(part.component));
                return (
                  <li key={part.component}>
                    <label className={cn('flex items-start gap-3', unavailable && 'opacity-70')}>
                      <Checkbox
                        checked={checked}
                        disabled={part.required || unavailable}
                        onChange={() => {
                          setChosen(
                            checked
                              ? chosen.filter((component) => component !== part.component)
                              : [...chosen, part.component],
                          );
                        }}
                      />
                      <span className="min-w-0 space-y-0.5">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{t(`profiles.components.${part.component}`)}</span>
                          <Badge variant={unavailable ? 'warning' : 'outline'}>
                            {t(`profiles.kinds.${part.kind}`)}
                          </Badge>
                          {part.required && !unavailable && (
                            <span className="text-xs text-muted-foreground">{t('profiles.form.always')}</span>
                          )}
                        </span>
                        <span className="block text-muted-foreground">
                          {part.unavailableReason ?? t(`profiles.componentDescriptions.${part.component}`)}
                        </span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </fieldset>

          {included('tor') && (
            <fieldset className="space-y-3">
              <legend className="mb-2 font-medium">{t('profiles.form.torMode')}</legend>
              <RadioCards
                label={t('profiles.form.torMode')}
                value={torMode}
                onValueChange={setTorMode}
                className="sm:grid-cols-3"
                options={(['tor-only', 'all-traffic', 'onion-peers'] as const).map((mode) => ({
                  value: mode,
                  title: t(`profiles.form.torModes.${mode}`),
                  description: t(`profiles.form.torModeDescriptions.${mode}`),
                }))}
              />
              <label className="flex items-start gap-2">
                <Checkbox
                  checked={onionService}
                  onChange={(event) => {
                    setOnionService(event.target.checked);
                  }}
                />
                {t('profiles.form.onionService')}
              </label>
              <label className="flex items-start gap-2">
                <Checkbox
                  checked={privateBroadcast}
                  onChange={(event) => {
                    setPrivateBroadcast(event.target.checked);
                  }}
                />
                {t('profiles.form.privateBroadcast')}
              </label>
            </fieldset>
          )}

          <Button type="submit" size="lg" disabled={nameError !== undefined || targetMissing}>
            {t('profiles.form.review')}
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
              <p className="text-muted-foreground">{t('profiles.plan.loading')}</p>
              <Skeleton className="h-64" />
            </div>
          ) : (
            <PlanReview plan={plan.data} />
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setStep('customise');
              }}
            >
              {t('profiles.plan.back')}
            </Button>
            <ConfirmButton
              label={t('profiles.plan.deploy')}
              title={t('profiles.plan.confirmTitle', { letter: profile.letter })}
              confirmLabel={t('profiles.plan.confirm')}
              disabled={plan.data?.feasible !== true || plan.isFetching || deploy.isPending}
              onConfirm={() => {
                deploy.mutate(choices, {
                  onSuccess: (result) => {
                    setStarted(result);
                    setStep('deploy');
                  },
                  onError: feedback,
                });
              }}
            >
              <p>{t('profiles.plan.confirmBody')}</p>
              {choices.tor && (
                <p>{t('profiles.plan.confirmTor', { mode: t(`profiles.form.torModes.${choices.tor.mode}`) })}</p>
              )}
            </ConfirmButton>
          </div>
        </div>
      )}
    </>
  );
}

export function ProfilePage({ profileId }: { profileId: string }) {
  const { t } = useTranslation();
  const overview = useProfilesOverview();
  const known = DeploymentProfileIdSchema.safeParse(profileId);
  const profile = known.success ? overview.data?.profiles.find((candidate) => candidate.id === known.data) : undefined;
  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <Breadcrumbs
        trail={[
          <Link key="profiles" to="/profiles">
            {t('navigation.profiles')}
          </Link>,
        ]}
        current={profile ? `${t('profiles.letter', { letter: profile.letter })} · ${profile.title}` : undefined}
      />
      {overview.isError ? (
        <ErrorPanel
          title={t('profiles.unavailableTitle')}
          error={toOrchestratorError(overview.error)}
          onRetry={() => void overview.refetch()}
        />
      ) : !overview.data ? (
        <Skeleton className="h-64" />
      ) : !profile ? (
        <p className="text-muted-foreground">{t('profiles.notFound')}</p>
      ) : (
        <>
          <div>
            <h1 className="font-mono text-xl font-semibold">
              {t('profiles.letter', { letter: profile.letter })} · {profile.title}
            </h1>
            <p className="max-w-3xl text-muted-foreground">{profile.summary}</p>
          </div>
          {profile.available ? (
            <ProfileWizard profile={profile} />
          ) : (
            <Note tone="warning">{profile.unavailableReason ?? t('profiles.unavailable')}</Note>
          )}
        </>
      )}
    </div>
  );
}
