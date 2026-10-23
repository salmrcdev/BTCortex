import { Copy } from 'lucide-react';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type { NodeWithStatus } from '@btcortex/contracts';
import { Button } from '@/components/ui/button';
import { Label, NativeSelect } from '@/components/ui/form-controls';

// Pieces the developer tools share: the node a tool talks to, and a JSON
// inspector for what the node answered.

export function NodePicker({
  nodes,
  value,
  onChange,
}: {
  nodes: readonly NodeWithStatus[];
  value: string | undefined;
  onChange: (nodeId: string) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  return (
    <div className="max-w-sm space-y-1">
      <Label htmlFor={id}>{t('developer.node')}</Label>
      <NativeSelect
        id={id}
        className="w-full"
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      >
        {nodes.map((node) => (
          <option key={node.profile.id} value={node.profile.id}>
            {node.profile.name} ({t(`networks.${node.profile.network}`)})
          </option>
        ))}
      </NativeSelect>
    </div>
  );
}

export function JsonInspector({ value, label }: { value: unknown; label: string }) {
  const { t } = useTranslation();
  const text = JSON.stringify(value, null, 2);
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        <Button
          variant="ghost"
          onClick={() => {
            void navigator.clipboard.writeText(text).then(() => toast.success(t('developer.copied')));
          }}
        >
          <Copy aria-hidden="true" />
          {t('developer.copy')}
        </Button>
      </div>
      <pre
        tabIndex={0}
        aria-label={label}
        className="max-h-96 overflow-auto rounded-md border bg-muted/40 p-3 font-mono text-[12px] leading-relaxed"
      >
        {text}
      </pre>
    </div>
  );
}
