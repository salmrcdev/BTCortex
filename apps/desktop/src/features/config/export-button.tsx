import { useMutation } from '@tanstack/react-query';
import { FileDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useErrorFeedback } from '@/components/feedback/confirm-button';
import { Button } from '@/components/ui/button';
import { chooseFileToSave } from '@/lib/dialogs';
import { callOrchestrator } from '@/lib/orchestrator';

// A copy of bitcoin.conf without secrets (specification section 28): the
// orchestrator writes it, with every secret value hidden, to the file the user
// chose; the window only learns the path.

export function ExportConfigButton({ nodeId, nodeName }: { nodeId: string; nodeName: string }) {
  const { t } = useTranslation();
  const onError = useErrorFeedback();
  const exporting = useMutation({
    mutationFn: (path: string) => callOrchestrator('nodes.config.export', { nodeId, path }),
  });
  const safeName = nodeName.replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '') || 'node';
  return (
    <Button
      variant="outline"
      disabled={exporting.isPending}
      onClick={() => {
        void chooseFileToSave(`${safeName}-settings.conf`, [
          { name: t('config.export.conf'), extensions: ['conf'] },
          { name: t('config.export.text'), extensions: ['txt'] },
        ]).then((path) => {
          if (path === null) return;
          exporting.mutate(path, {
            onSuccess: () => toast.success(t('config.export.saved')),
            onError,
          });
        });
      }}
    >
      <FileDown aria-hidden="true" />
      {t('config.export.button')}
    </Button>
  );
}
