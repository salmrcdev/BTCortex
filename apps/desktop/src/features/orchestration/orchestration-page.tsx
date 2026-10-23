import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type { Orchestration, OrchestrationPlan, ServiceAction, ServiceInstance } from '@btcortex/contracts';
import { useErrorFeedback } from '@/components/feedback/confirm-button';
import { ErrorPanel } from '@/components/feedback/error-panel';
import { Note } from '@/components/feedback/note';
import { StatusIndicator } from '@/components/status/status-indicator';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatList } from '@/lib/format';
import { toOrchestratorError } from '@/lib/orchestrator';
import { useOrchestration, useOrchestrationActions } from './queries';

// Service orchestration (specification sections 24.1 and 29): every service
// BTCortex runs, in the order they start, with what each needs and what needs
// it. Starting, stopping or restarting one — or everything — first shows the
// plan: what else is started or stopped, in which order, and what is
// affected; nothing happens until the user confirms it.

const EVERYTHING = 'all';

function PlanDialog({
  plan,
  name,
  busy,
  onConfirm,
  onClose,
}: {
  plan: OrchestrationPlan | null;
  name: string;
  busy: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <AlertDialog
      open={plan !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <AlertDialogContent className="max-w-lg">
        {plan && (
          <>
            <AlertDialogTitle>{t(`orchestration.planTitle.${plan.action}`, { name })}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                {plan.blocked !== null ? (
                  <p>{plan.blocked}</p>
                ) : plan.steps.length === 0 ? (
                  <p>{t('orchestration.nothingToDo')}</p>
                ) : (
                  <>
                    <p>{t('orchestration.steps', { count: plan.steps.length })}</p>
                    <ol className="list-decimal space-y-1 pl-5 text-foreground">
                      {plan.steps.map((step) => (
                        <li key={`${step.action}-${step.instanceId}`}>
                          {t(`orchestration.step.${step.action}`, { name: step.name })}
                        </li>
                      ))}
                    </ol>
                  </>
                )}
                {plan.consequences.map((consequence) => (
                  <Note key={consequence} tone="warning">
                    {consequence}
                  </Note>
                ))}
              </div>
            </AlertDialogDescription>
            <AlertDialogFooter>
              <AlertDialogCancel>
                {t(plan.blocked === null ? 'common.cancel' : 'orchestration.close')}
              </AlertDialogCancel>
              {plan.blocked === null && plan.steps.length > 0 && (
                <AlertDialogAction
                  destructive={plan.action === 'stop'}
                  disabled={busy}
                  onClick={(event) => {
                    event.preventDefault();
                    onConfirm();
                  }}
                >
                  {t(`orchestration.confirm.${plan.action}`)}
                </AlertDialogAction>
              )}
            </AlertDialogFooter>
          </>
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Asks for a plan, shows it, and runs it once confirmed. */
function usePlannedActions() {
  const { t } = useTranslation();
  const onError = useErrorFeedback();
  const { plan, run } = useOrchestrationActions();
  const [current, setCurrent] = useState<{ plan: OrchestrationPlan; name: string } | null>(null);
  const ask = (target: string, action: ServiceAction, name: string) => {
    plan.mutate(
      { target, action },
      {
        onSuccess: (result) => {
          setCurrent({ plan: result, name });
        },
        onError,
      },
    );
  };
  const dialog = (
    <PlanDialog
      plan={current?.plan ?? null}
      name={current?.name ?? ''}
      busy={run.isPending}
      onClose={() => {
        setCurrent(null);
      }}
      onConfirm={() => {
        if (!current) return;
        run.mutate(
          { target: current.plan.target, action: current.plan.action },
          {
            onSuccess: (result) => {
              setCurrent(null);
              toast.success(t('orchestration.done', { count: result.done.length }));
            },
            onError: (error) => {
              setCurrent(null);
              onError(error);
            },
          },
        );
      }}
    />
  );
  return { ask, dialog, asking: plan.isPending || run.isPending };
}

function InstanceItem({
  instance,
  overview,
  ask,
  asking,
}: {
  instance: ServiceInstance;
  overview: Orchestration;
  ask: (target: string, action: ServiceAction, name: string) => void;
  asking: boolean;
}) {
  const { t } = useTranslation();
  const nameOf = (id: string) => overview.instances.find((candidate) => candidate.id === id)?.name ?? id;
  const module = overview.modules.find((candidate) => candidate.id === instance.moduleId);
  const [log] = instance.logSources;
  return (
    <li className="grid gap-3 py-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
      <div className="min-w-0 space-y-1">
        <p className="flex flex-wrap items-center gap-2">
          {instance.route === null ? (
            <span className="font-medium">{instance.name}</span>
          ) : (
            <a href={`#${instance.route}`} className="font-medium underline-offset-2 hover:underline">
              {instance.name}
            </a>
          )}
          {module && <Badge variant="outline">{module.name}</Badge>}
        </p>
        <StatusIndicator tone={instance.health} label={t(`orchestration.states.${instance.state}`)} />
        <p className="text-muted-foreground">{instance.summary}</p>
        {instance.requires.length > 0 && (
          <ul className="space-y-0.5">
            {instance.requires.map((requirement) => (
              <li key={requirement.id}>
                {t(requirement.hard ? 'orchestration.needs' : 'orchestration.uses', {
                  name: nameOf(requirement.id),
                  reason: requirement.reason,
                })}
              </li>
            ))}
          </ul>
        )}
        {instance.requiredBy.length > 0 && (
          <p className="text-muted-foreground">
            {t('orchestration.neededBy', { names: formatList(instance.requiredBy.map(nameOf)) })}
          </p>
        )}
        {log !== undefined && (
          <Link to="/logs" search={{ source: log }} className="text-sm underline underline-offset-2">
            {t('orchestration.logs')}
          </Link>
        )}
      </div>
      <div className="flex flex-wrap gap-2 md:justify-end">
        {instance.actions.map((action) => (
          <Button
            key={action}
            variant={action === 'start' ? 'default' : 'outline'}
            disabled={asking}
            onClick={() => {
              ask(instance.id, action, instance.name);
            }}
          >
            {t(`orchestration.actions.${action}`)}
          </Button>
        ))}
      </div>
    </li>
  );
}

function Modules({ overview }: { overview: Orchestration }) {
  const { t } = useTranslation();
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('orchestration.modules')}</CardTitle>
        <CardDescription>{t('orchestration.modulesHint')}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('orchestration.module')}</TableHead>
                <TableHead>{t('orchestration.evidence')}</TableHead>
                <TableHead>{t('orchestration.permissions')}</TableHead>
                <TableHead>{t('orchestration.dependsOn')}</TableHead>
                <TableHead>{t('orchestration.more')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {overview.modules.map((module) => (
                <TableRow key={module.id}>
                  <TableCell className="font-medium">{module.name}</TableCell>
                  <TableCell>{t(`catalogue.status.${module.status}`)}</TableCell>
                  <TableCell>
                    {module.permissions.length === 0
                      ? '—'
                      : formatList(module.permissions.map((permission) => t(`orchestration.permission.${permission}`)))}
                  </TableCell>
                  <TableCell>
                    {module.dependencies.length === 0
                      ? '—'
                      : module.dependencies.map((dependency) => (
                          <span key={dependency.id} className="block">
                            {t(dependency.optional ? 'orchestration.optional' : 'orchestration.required', {
                              id: dependency.id,
                            })}
                          </span>
                        ))}
                  </TableCell>
                  <TableCell>
                    <span className="flex flex-wrap gap-x-3">
                      {module.documentation && (
                        <a
                          href={`#/help?doc=${encodeURIComponent(module.documentation.document)}${
                            module.documentation.section
                              ? `&section=${encodeURIComponent(module.documentation.section)}`
                              : ''
                          }`}
                          className="underline underline-offset-2"
                        >
                          {t('orchestration.help')}
                        </a>
                      )}
                      {module.updates !== null && (
                        <Link to="/updates" className="underline underline-offset-2">
                          {t('orchestration.updates')}
                        </Link>
                      )}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

export function OrchestrationPage() {
  const { t } = useTranslation();
  const overview = useOrchestration();
  const { ask, dialog, asking } = usePlannedActions();
  const data = overview.data;
  const canStart = data?.instances.some((instance) => instance.actions.includes('start')) ?? false;
  const canStop = data?.instances.some((instance) => instance.actions.includes('stop')) ?? false;
  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="font-mono text-xl font-semibold">{t('orchestration.title')}</h1>
          <p className="max-w-prose text-muted-foreground">{t('orchestration.description')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={!canStart || asking}
            onClick={() => {
              ask(EVERYTHING, 'start', t('orchestration.everything'));
            }}
          >
            {t('orchestration.startAll')}
          </Button>
          <Button
            variant="outline"
            disabled={!canStop || asking}
            onClick={() => {
              ask(EVERYTHING, 'stop', t('orchestration.everything'));
            }}
          >
            {t('orchestration.stopAll')}
          </Button>
        </div>
      </div>
      {overview.isError ? (
        <ErrorPanel
          title={t('orchestration.unavailable')}
          error={toOrchestratorError(overview.error)}
          onRetry={() => void overview.refetch()}
        />
      ) : !data ? (
        <Skeleton className="h-64" />
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>{t('orchestration.services')}</CardTitle>
              <CardDescription>{t('orchestration.servicesHint')}</CardDescription>
            </CardHeader>
            <CardContent>
              {data.instances.length === 0 ? (
                <p className="text-muted-foreground">{t('orchestration.none')}</p>
              ) : (
                <ul className="divide-y">
                  {data.instances.map((instance) => (
                    <InstanceItem key={instance.id} instance={instance} overview={data} ask={ask} asking={asking} />
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
          <Modules overview={data} />
        </>
      )}
      {dialog}
    </div>
  );
}
