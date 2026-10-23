import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
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
import { Button } from '@/components/ui/button';
import { toOrchestratorError } from '@/lib/orchestrator';

// Consequential actions ask first and say exactly what will happen
// (specification section 21.3).

export interface ConfirmButtonProps {
  label: string;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  disabled?: boolean;
  /** The confirm button stays disabled, for example while a field is invalid. */
  confirmDisabled?: boolean;
  onConfirm: () => void;
}

/** A button that asks before acting, saying exactly what will happen. */
export function ConfirmButton({
  label,
  title,
  children,
  confirmLabel,
  destructive = false,
  disabled = false,
  confirmDisabled = false,
  onConfirm,
}: ConfirmButtonProps) {
  const { t } = useTranslation();
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline" disabled={disabled}>
          {label}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogTitle>{title}</AlertDialogTitle>
        <AlertDialogDescription asChild>
          <div className="space-y-2">{children}</div>
        </AlertDialogDescription>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
          <AlertDialogAction destructive={destructive} disabled={confirmDisabled} onClick={onConfirm}>
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** The usual reaction to a failed action: a toast with the orchestrator's explanation. */
export function useErrorFeedback() {
  const { t } = useTranslation();
  return (error: unknown) => {
    const failure = toOrchestratorError(error);
    // What to do next, when the orchestrator says: the cause and the first recovery action.
    const next = [failure.appError?.likelyCause, failure.appError?.recoveryActions[0]?.label].filter(Boolean);
    toast.error(t('errors.actionFailed'), {
      description: [failure.appError?.message ?? failure.message, ...next].join(' '),
    });
  };
}
