import { useNavigate } from '@tanstack/react-router';
import { Check, CircleCheck, CircleX, Info, RefreshCw, TriangleAlert } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { DeploymentProfile, DeploymentProfileId, EnvironmentCheck, OnboardingMode } from '@btcortex/contracts';
import { useErrorFeedback } from '@/components/feedback/confirm-button';
import { ErrorPanel } from '@/components/feedback/error-panel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { RadioCards } from '@/components/ui/radio-cards';
import { Skeleton } from '@/components/ui/skeleton';
import { DiscoveredNodes } from '@/features/nodes/discovered-nodes';
import { ProfileWizard } from '@/features/profiles/profile-page';
import { useProfilesOverview } from '@/features/profiles/queries';
import { toOrchestratorError } from '@/lib/orchestrator';
import { cn } from '@/lib/utils';
import { useEnvironment, useOnboardingActions } from './queries';

// The first-run guide (specification section 25): welcome and a choice of
// beginner or advanced mode, a check of this computer, the existing node or a
// profile to deploy, then the deployment itself with its plan and progress.
// It can be skipped at any step, and nothing is installed before the plan has
// been shown and confirmed.

type Step = 'welcome' | 'computer' | 'choose' | 'install';
const STEPS: readonly Step[] = ['welcome', 'computer', 'choose', 'install'];
/** What a beginner chooses between; the others stay a click away in advanced mode. */
const BEGINNER_PROFILES: readonly DeploymentProfileId[] = ['private-wallet', 'basic-node', 'privacy-node'];

const CHECK_LOOK: Record<EnvironmentCheck['state'], { icon: LucideIcon; className: string }> = {
  ok: { icon: CircleCheck, className: 'text-success' },
  info: { icon: Info, className: 'text-info' },
  warning: { icon: TriangleAlert, className: 'text-warning' },
  problem: { icon: CircleX, className: 'text-danger' },
};

/** The WebView2 version, from the user agent of the window itself. */
export function webViewVersion(userAgent: string): string | undefined {
  return /Edg\/([\d.]+)/.exec(userAgent)?.[1];
}

function StepIndicator({ current }: { current: Step }) {
  const { t } = useTranslation();
  const currentIndex = STEPS.indexOf(current);
  return (
    <ol aria-label={t('welcome.stepsLabel')} className="flex flex-wrap items-center gap-2">
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
            {t(`welcome.steps.${step}`)}
          </span>
          {index < STEPS.length - 1 && <span aria-hidden="true" className="mx-1 h-px w-8 bg-border" />}
        </li>
      ))}
    </ol>
  );
}

function CheckRow({ check }: { check: EnvironmentCheck }) {
  const { t } = useTranslation();
  const look = CHECK_LOOK[check.state];
  return (
    <li className="flex items-start gap-3 border-b py-3 last:border-0">
      <look.icon aria-hidden="true" className={cn('mt-0.5 size-4 shrink-0', look.className)} />
      <div className="min-w-0 space-y-0.5">
        <p className="font-medium">
          <span className="sr-only">{t(`welcome.computer.states.${check.state}`)}: </span>
          {check.title}
        </p>
        <p className="text-muted-foreground">{check.detail}</p>
      </div>
    </li>
  );
}

function ComputerStep({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  const { t } = useTranslation();
  const onError = useErrorFeedback();
  const environment = useEnvironment(true);
  const actions = useOnboardingActions();
  const webView = webViewVersion(navigator.userAgent);
  const report = environment.data;
  const blocked = report?.checks.some((check) => check.state === 'problem') === true;
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle>{t('welcome.computer.title')}</CardTitle>
        <Button
          variant="outline"
          disabled={actions.recheck.isPending || environment.isFetching}
          onClick={() => {
            actions.recheck.mutate(undefined, { onError });
          }}
        >
          <RefreshCw
            aria-hidden="true"
            className={actions.recheck.isPending ? 'motion-safe:animate-spin' : undefined}
          />
          {t('welcome.computer.again')}
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="max-w-prose text-muted-foreground">{t('welcome.computer.description')}</p>
        {environment.isError ? (
          <ErrorPanel
            title={t('welcome.computer.failed')}
            error={toOrchestratorError(environment.error)}
            onRetry={() => void environment.refetch()}
          />
        ) : !report ? (
          <div className="space-y-2" aria-busy="true">
            <p className="text-muted-foreground">{t('welcome.computer.checking')}</p>
            <Skeleton className="h-64" />
          </div>
        ) : (
          <>
            <ul aria-label={t('welcome.computer.results')}>
              {webView !== undefined && (
                <CheckRow
                  check={{
                    id: 'system.webview',
                    area: 'system',
                    state: 'ok',
                    title: t('welcome.computer.webView', { version: webView }),
                    detail: t('welcome.computer.webViewDetail'),
                  }}
                />
              )}
              {report.checks.map((check) => (
                <CheckRow key={check.id} check={check} />
              ))}
            </ul>
            {report.software.length > 0 && (
              <details className="rounded-lg border p-3">
                <summary className="cursor-pointer font-medium">{t('welcome.computer.whereFound')}</summary>
                <ul className="mt-2 space-y-1">
                  {report.software.map((entry) => (
                    <li key={`${entry.id}-${entry.location}`} className="flex flex-wrap gap-x-2">
                      <span>{entry.name}</span>
                      <span className="break-all font-mono text-[13px] text-muted-foreground">{entry.location}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </>
        )}
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={onBack}>
            {t('welcome.back')}
          </Button>
          <Button disabled={!report} onClick={onNext}>
            {blocked ? t('welcome.computer.continueAnyway') : t('welcome.next')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function ChooseStep({
  mode,
  chosen,
  onChoose,
  onBack,
  onNext,
}: {
  mode: OnboardingMode;
  chosen: DeploymentProfileId | undefined;
  onChoose: (profile: DeploymentProfileId) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const { t } = useTranslation();
  const environment = useEnvironment(true);
  const overview = useProfilesOverview();
  const recommended = environment.data?.recommendation.profileId;
  const profiles = (overview.data?.profiles ?? []).filter(
    (profile) => profile.available && (mode === 'advanced' || BEGINNER_PROFILES.includes(profile.id)),
  );
  const selected = chosen ?? recommended;
  return (
    <div className="space-y-6">
      {(environment.data?.connectableNodes ?? 0) > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{t('welcome.choose.existingTitle')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="max-w-prose text-muted-foreground">{t('welcome.choose.existingDescription')}</p>
            <DiscoveredNodes />
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader>
          <CardTitle>{t('welcome.choose.title')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="max-w-prose text-muted-foreground">
            {mode === 'beginner' ? t('welcome.choose.beginner') : t('welcome.choose.advanced')}
          </p>
          {environment.data && (
            <p className="flex items-start gap-2">
              <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-info" />
              <span>{environment.data.recommendation.reason}</span>
            </p>
          )}
          {overview.isError ? (
            <ErrorPanel
              title={t('profiles.unavailableTitle')}
              error={toOrchestratorError(overview.error)}
              onRetry={() => void overview.refetch()}
            />
          ) : !overview.data || selected === undefined ? (
            <Skeleton className="h-48" />
          ) : (
            <RadioCards
              label={t('welcome.choose.title')}
              value={selected}
              onValueChange={onChoose}
              className="md:grid-cols-2"
              options={profiles.map((profile: DeploymentProfile) => ({
                value: profile.id,
                title: `${t('profiles.letter', { letter: profile.letter })} · ${profile.title}`,
                description: profile.summary,
                ...(profile.id === recommended
                  ? { badge: <Badge variant="success">{t('welcome.choose.recommended')}</Badge> }
                  : {}),
              }))}
            />
          )}
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={onBack}>
              {t('welcome.back')}
            </Button>
            <Button disabled={selected === undefined} onClick={onNext}>
              {mode === 'beginner' ? t('welcome.choose.seePlan') : t('welcome.choose.customise')}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export function WelcomePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const onError = useErrorFeedback();
  const actions = useOnboardingActions();
  const environment = useEnvironment(false);
  const overview = useProfilesOverview();
  const [step, setStep] = useState<Step>('welcome');
  const [mode, setMode] = useState<OnboardingMode>('beginner');
  const [chosen, setChosen] = useState<DeploymentProfileId>();
  const profileId = chosen ?? environment.data?.recommendation.profileId;
  const profile = overview.data?.profiles.find((candidate) => candidate.id === profileId);

  const finish = (finishedMode: OnboardingMode | null) => {
    actions.complete.mutate(finishedMode, {
      onSuccess: () => {
        void navigate({ to: '/' });
      },
      onError,
    });
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="font-mono text-xl font-semibold">{t('welcome.title')}</h1>
          <p className="max-w-prose text-muted-foreground">{t('welcome.description')}</p>
        </div>
        <Button
          variant="ghost"
          disabled={actions.complete.isPending}
          onClick={() => {
            finish(null);
          }}
        >
          {t('welcome.skip')}
        </Button>
      </div>
      <StepIndicator current={step} />

      {step === 'welcome' && (
        <Card>
          <CardHeader>
            <CardTitle>{t('welcome.intro.title')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <ul className="list-inside list-disc space-y-1 text-muted-foreground">
              <li>{t('welcome.intro.promiseNothing')}</li>
              <li>{t('welcome.intro.promiseVerified')}</li>
              <li>{t('welcome.intro.promiseSeeds')}</li>
              <li>{t('welcome.intro.promiseExisting')}</li>
            </ul>
            <fieldset className="space-y-2">
              <legend className="mb-2 font-medium">{t('welcome.intro.mode')}</legend>
              <RadioCards
                label={t('welcome.intro.mode')}
                value={mode}
                onValueChange={setMode}
                className="md:grid-cols-2"
                options={(['beginner', 'advanced'] as const).map((value) => ({
                  value,
                  title: t(`welcome.intro.modes.${value}.title`),
                  description: t(`welcome.intro.modes.${value}.description`),
                }))}
              />
            </fieldset>
            <Button
              size="lg"
              onClick={() => {
                setStep('computer');
              }}
            >
              {t('welcome.intro.start')}
            </Button>
          </CardContent>
        </Card>
      )}

      {step === 'computer' && (
        <ComputerStep
          onBack={() => {
            setStep('welcome');
          }}
          onNext={() => {
            setStep('choose');
          }}
        />
      )}

      {step === 'choose' && (
        <ChooseStep
          mode={mode}
          chosen={chosen}
          onChoose={setChosen}
          onBack={() => {
            setStep('computer');
          }}
          onNext={() => {
            setStep('install');
          }}
        />
      )}

      {step === 'install' && (
        <div className="space-y-6">
          {profile ? (
            <ProfileWizard
              key={`${profile.id}-${mode}`}
              profile={profile}
              initialStep={mode === 'beginner' ? 'review' : 'customise'}
            />
          ) : (
            <Skeleton className="h-64" />
          )}
          <Card>
            <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6">
              <p className="max-w-prose text-muted-foreground">{t('welcome.install.finishHint')}</p>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setStep('choose');
                  }}
                >
                  {t('welcome.back')}
                </Button>
                <Button
                  disabled={actions.complete.isPending}
                  onClick={() => {
                    finish(mode);
                  }}
                >
                  {t('welcome.install.finish')}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
