import { useQueryClient } from '@tanstack/react-query';
import { useBlocker } from '@tanstack/react-router';
import { FileText, Info, RotateCw, SlidersHorizontal, TriangleAlert } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type { NodeWithStatus } from '@btcortex/contracts';
import { CopyableValue } from '@/components/data/copyable-value';
import { ErrorPanel } from '@/components/feedback/error-panel';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { NetworkBadge } from '@/components/status/network-badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { formatRelativeTime, formatTimestamp } from '@/lib/format';
import { toOrchestratorError } from '@/lib/orchestrator';
import { useNodeAction } from '@/features/nodes/queries';
import { analyseDraft, optionStates, setOption, unknownSettings } from './config-model';
import { configKeys, useNodeConfig, useSaveNodeConfig } from './queries';
import { RawEditor } from './raw-editor';
import type { LineRequest } from './raw-editor';
import { ReviewDialog } from './review-dialog';
import { SettingsEditor } from './settings-editor';
import { ExportConfigButton } from './export-button';
import { HistoryCard } from './history-card';
import { useErrorFeedback } from '@/components/feedback/confirm-button';

// The node's bitcoin.conf: a graphical and a raw editor over one shared
// draft, live checks, a review before saving, and a restart to apply.

type EditorTab = 'settings' | 'file';

function Notice({ tone, children }: { tone: 'info' | 'warning'; children: ReactNode }) {
  const Icon = tone === 'info' ? Info : TriangleAlert;
  return (
    <div
      role={tone === 'warning' ? 'status' : undefined}
      className={
        tone === 'warning'
          ? 'flex flex-wrap items-center gap-3 rounded-md border border-warning/40 bg-warning/10 px-3 py-2'
          : 'flex flex-wrap items-center gap-3 rounded-md border px-3 py-2'
      }
    >
      <Icon aria-hidden="true" className={tone === 'warning' ? 'size-4 text-warning' : 'size-4 text-info'} />
      {children}
    </div>
  );
}

export function ConfigurationPage({ node }: { node: NodeWithStatus }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { profile, status } = node;
  const nodeId = profile.id;
  const document = useNodeConfig(nodeId);
  const save = useSaveNodeConfig(nodeId);
  const restart = useNodeAction('nodes.restart');
  const [draft, setDraft] = useState<string>();
  // The file as it was when editing started. A refetch while editing must not move the draft onto a newer
  // file: the save would then pass the changed-on-disk check and silently undo the other change.
  const [base, setBase] = useState<{ text: string; revision: string }>();
  const [tab, setTab] = useState<EditorTab>('settings');
  const [lineRequest, setLineRequest] = useState<LineRequest>();
  const [reviewing, setReviewing] = useState(false);
  const tabsRef = useRef<HTMLDivElement>(null);
  const reviewButtonRef = useRef<HTMLButtonElement>(null);

  const saved = document.data?.text ?? '';
  const baseText = base?.text ?? saved;
  const text = draft ?? saved;
  const dirty = draft !== undefined && draft !== baseText;
  const changedOnDisk = base !== undefined && document.data !== undefined && document.data.revision !== base.revision;
  const editable = document.data?.editable ?? false;
  const managed = profile.execution === 'managed';
  const commandLine = document.data?.commandLine;
  const analysis = useMemo(
    () => analyseDraft(baseText, text, profile.network, managed && editable),
    [baseText, text, profile.network, managed, editable],
  );
  const states = useMemo(
    () => optionStates(analysis, commandLine ?? [], managed && editable),
    [analysis, commandLine, managed, editable],
  );
  const unknown = useMemo(() => unknownSettings(analysis.config), [analysis]);

  // Whether a restart is needed changes when the node starts or stops.
  const previousState = useRef(status.state);
  useEffect(() => {
    if (previousState.current !== status.state) {
      previousState.current = status.state;
      void queryClient.invalidateQueries({ queryKey: configKeys.node(nodeId) });
    }
  }, [status.state, nodeId, queryClient]);

  const blocker = useBlocker({ shouldBlockFn: () => dirty, enableBeforeUnload: () => dirty, withResolver: true });

  const showLine = (line: number) => {
    setTab('file');
    setLineRequest((current) => ({ line, nonce: (current?.nonce ?? 0) + 1 }));
  };
  const lineShown = useCallback(() => {
    setLineRequest(undefined);
  }, []);

  const edit = (next: string) => {
    if (draft === undefined && document.data) setBase({ text: document.data.text, revision: document.data.revision });
    setDraft(next);
  };
  const discard = () => {
    setDraft(undefined);
    setBase(undefined);
  };
  /** Back to the editor's active tab, for when the control that had focus has gone. */
  const focusEditor = () => {
    requestAnimationFrame(() => {
      tabsRef.current?.querySelector<HTMLElement>('[role="tab"][data-state="active"]')?.focus();
    });
  };

  const reportFailure = useErrorFeedback();

  const restartNode = () => {
    restart.mutate(nodeId, {
      onSuccess: () => toast.success(t('node.restartRequested', { name: profile.name })),
      onError: reportFailure,
    });
  };

  const submit = (acceptedRisks: string[], restartAfterSave: boolean) => {
    const revision = base?.revision ?? document.data?.revision;
    if (revision === undefined) return;
    save.mutate(
      { text, revision, acceptedRisks },
      {
        onSuccess: (result) => {
          discard();
          setReviewing(false);
          if (restartAfterSave && result.restartRequired) {
            toast.success(t('config.savedRestarting'));
            restartNode();
          } else {
            toast.success(result.restartRequired ? t('config.savedRestartLater') : t('config.saved'));
          }
        },
      },
    );
  };

  if (document.isError) {
    return (
      <ErrorPanel
        title={t('config.unavailable')}
        error={toOrchestratorError(document.error)}
        onRetry={() => void document.refetch()}
      />
    );
  }
  if (!document.data) return <Skeleton className="h-64" />;
  const configuration = document.data;
  const changedCount = analysis.changes.length;

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <p className="max-w-3xl text-muted-foreground">{t('config.intro')}</p>
        {configuration.path && (
          <dl className="flex flex-wrap items-center gap-x-6 gap-y-1">
            <div className="flex min-w-0 items-center gap-2">
              <dt className="text-muted-foreground">{t('config.fileLabel')}</dt>
              <dd className="min-w-0">
                <CopyableValue value={configuration.path} label={t('config.fileLabel')} />
              </dd>
            </div>
            {configuration.modifiedAt && (
              <div className="text-muted-foreground">
                <dd title={formatTimestamp(configuration.modifiedAt)}>
                  {t('config.lastChanged', { time: formatRelativeTime(new Date(configuration.modifiedAt)) })}
                </dd>
              </div>
            )}
            {configuration.exists && <ExportConfigButton nodeId={nodeId} nodeName={profile.name} />}
          </dl>
        )}
        {configuration.readOnlyReason && (
          <Notice tone="info">
            <span>
              <span className="font-medium">{t('config.readOnlyTitle')}:</span> {configuration.readOnlyReason}
            </span>
          </Notice>
        )}
        {configuration.path && !configuration.exists && editable && (
          <Notice tone="info">{t('config.notCreated')}</Notice>
        )}
        {configuration.restartRequired &&
          !dirty &&
          (managed ? (
            <Notice tone="warning">
              <span className="flex-1">{t('config.restartRequired')}</span>
              {/* The same confirmation as on the node's page: wallets and services lose their connection. */}
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" disabled={restart.isPending}>
                    <RotateCw aria-hidden="true" />
                    {t('config.restartNow')}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogTitle>{t('node.restartTitle', { name: profile.name })}</AlertDialogTitle>
                  <AlertDialogDescription>{t('node.restartBody')}</AlertDialogDescription>
                  <div className="mt-3">
                    <NetworkBadge network={profile.network} />
                  </div>
                  <AlertDialogFooter>
                    <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
                    <AlertDialogAction onClick={restartNode}>{t('node.restartConfirm')}</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </Notice>
          ) : (
            // BTCortex cannot restart a node it did not set up, so there is nothing to click.
            <Notice tone="info">
              <span className="flex-1">{t('config.restartRequiredExternal')}</span>
            </Notice>
          ))}
        {changedOnDisk && dirty && (
          <Notice tone="warning">
            <span className="flex-1">{t('config.changedOnDisk')}</span>
          </Notice>
        )}
      </div>

      {configuration.path && (
        <Tabs
          value={tab}
          onValueChange={(value) => {
            setTab(value === 'file' ? 'file' : 'settings');
          }}
        >
          <TabsList ref={tabsRef} aria-label={t('config.tabsLabel')}>
            <TabsTrigger value="settings">
              <SlidersHorizontal aria-hidden="true" />
              {t('config.tabSettings')}
            </TabsTrigger>
            <TabsTrigger value="file">
              <FileText aria-hidden="true" />
              {t('config.tabFile')}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="settings">
            <SettingsEditor
              states={states}
              unknown={unknown}
              network={profile.network}
              readOnly={!editable}
              onChange={(key, values) => {
                edit(setOption(text, key, values, profile.network));
              }}
              onShowLine={showLine}
            />
          </TabsContent>
          <TabsContent value="file">
            <RawEditor
              text={text}
              readOnly={!editable}
              diagnostics={analysis.diagnostics}
              lineRequest={lineRequest}
              onLineShown={lineShown}
              onChange={edit}
              onShowLine={showLine}
            />
          </TabsContent>
        </Tabs>
      )}

      {configuration.path && managed && editable && (
        <HistoryCard nodeId={nodeId} revision={configuration.revision} blocked={dirty} />
      )}

      {dirty && (
        <div className="sticky bottom-0 z-10 -mx-6 flex flex-wrap items-center gap-3 border-t bg-background px-6 py-3">
          <p className="flex-1" aria-live="polite">
            {changedCount > 0 ? t('config.changedCount', { count: changedCount }) : t('config.editedWithoutEffect')}
            {analysis.errorCount > 0 && (
              <span className="ml-3 inline-flex items-center gap-1 text-danger">
                <TriangleAlert aria-hidden="true" className="size-4" />
                {t('config.problemCount', { count: analysis.errorCount })}
              </span>
            )}
          </p>
          <Button
            variant="ghost"
            onClick={() => {
              discard();
              save.reset();
              focusEditor();
            }}
          >
            {t('config.discard')}
          </Button>
          <Button
            ref={reviewButtonRef}
            size="lg"
            onClick={() => {
              save.reset();
              setReviewing(true);
            }}
          >
            {t('config.review')}
          </Button>
        </div>
      )}

      <ReviewDialog
        open={reviewing}
        onOpenChange={setReviewing}
        onReturnFocus={() => {
          const button = reviewButtonRef.current;
          if (button?.isConnected) button.focus();
          else focusEditor();
        }}
        node={node}
        analysis={analysis}
        saving={save.isPending}
        error={save.error ? toOrchestratorError(save.error) : undefined}
        onSave={submit}
        onReload={() => {
          discard();
          setReviewing(false);
          save.reset();
          void document.refetch();
        }}
      />

      <AlertDialog open={blocker.status === 'blocked'}>
        <AlertDialogContent>
          <AlertDialogTitle>{t('config.leaveTitle')}</AlertDialogTitle>
          <AlertDialogDescription>{t('config.leaveBody')}</AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => blocker.reset?.()}>{t('config.stay')}</AlertDialogCancel>
            <AlertDialogAction destructive onClick={() => blocker.proceed?.()}>
              {t('config.leaveConfirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
