import { useNavigate } from '@tanstack/react-router';
import { Globe, LoaderCircle } from 'lucide-react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type { BitcoinNetworkId } from '@btcortex/contracts';
import { ErrorPanel } from '@/components/feedback/error-panel';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label, NativeSelect } from '@/components/ui/form-controls';
import { toOrchestratorError } from '@/lib/orchestrator';
import { useConnectRemote } from './queries';

// A Bitcoin Core node on another computer (specification section 26),
// reached over its RPC interface with a user name and password. The password
// goes to the orchestrator once and is kept with Windows DPAPI; BTCortex tests
// the connection before it saves anything, and refuses plain HTTP outside the
// local network.

const NETWORKS: readonly BitcoinNetworkId[] = ['mainnet', 'testnet4', 'testnet3', 'signet', 'regtest'];
const DEFAULT_PORTS: Record<BitcoinNetworkId, number> = {
  mainnet: 8332,
  testnet3: 18332,
  testnet4: 48332,
  signet: 38332,
  regtest: 18443,
};

export function RemoteNodeCard() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const connect = useConnectRemote();
  const formId = useId();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [network, setNetwork] = useState<BitcoinNetworkId>('mainnet');
  const [address, setAddress] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const endpoint = address.trim();
  const endpointValid = /^https?:\/\/[^\s/]+(?::\d+)?\/?$/i.test(endpoint);
  const complete = name.trim() !== '' && endpointValid && username.trim() !== '' && password !== '';

  if (!open) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-4">
        <div className="flex items-start gap-3">
          <Globe aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
          <div>
            <p className="font-medium">{t('nodes.remote.title')}</p>
            <p className="text-muted-foreground">{t('nodes.remote.summary')}</p>
          </div>
        </div>
        <Button
          variant="outline"
          onClick={() => {
            setOpen(true);
          }}
        >
          {t('nodes.remote.open')}
        </Button>
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('nodes.remote.title')}</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!complete) return;
            connect.mutate(
              {
                name: name.trim(),
                network,
                rpcEndpoint: endpoint.replace(/\/$/, ''),
                username: username.trim(),
                password,
              },
              {
                onSuccess: (profile) => {
                  setPassword('');
                  toast.success(t('nodes.remote.connected', { name: profile.name }));
                  void navigate({ to: '/nodes/$nodeId', params: { nodeId: profile.id } });
                },
              },
            );
          }}
        >
          <p className="text-muted-foreground">{t('nodes.remote.description')}</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor={`${formId}-name`}>{t('nodes.remote.name')}</Label>
              <Input
                id={`${formId}-name`}
                value={name}
                maxLength={60}
                placeholder={t('nodes.remote.namePlaceholder')}
                onChange={(event) => {
                  setName(event.target.value);
                }}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`${formId}-network`}>{t('nodes.remote.network')}</Label>
              <NativeSelect
                id={`${formId}-network`}
                value={network}
                onChange={(event) => {
                  setNetwork(event.target.value as BitcoinNetworkId);
                }}
              >
                {NETWORKS.map((candidate) => (
                  <option key={candidate} value={candidate}>
                    {t(`networks.${candidate}`)}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${formId}-address`}>{t('nodes.remote.address')}</Label>
            <Input
              id={`${formId}-address`}
              value={address}
              spellCheck={false}
              autoComplete="off"
              placeholder={`http://192.168.1.20:${String(DEFAULT_PORTS[network])}`}
              aria-describedby={`${formId}-address-hint`}
              aria-invalid={endpoint !== '' && !endpointValid}
              onChange={(event) => {
                setAddress(event.target.value);
              }}
            />
            <p id={`${formId}-address-hint`} className="text-xs text-muted-foreground">
              {t('nodes.remote.addressHint', { port: DEFAULT_PORTS[network] })}
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor={`${formId}-user`}>{t('nodes.remote.username')}</Label>
              <Input
                id={`${formId}-user`}
                value={username}
                spellCheck={false}
                autoComplete="off"
                onChange={(event) => {
                  setUsername(event.target.value);
                }}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`${formId}-password`}>{t('nodes.remote.password')}</Label>
              <Input
                id={`${formId}-password`}
                type="password"
                value={password}
                autoComplete="off"
                aria-describedby={`${formId}-password-hint`}
                onChange={(event) => {
                  setPassword(event.target.value);
                }}
              />
              <p id={`${formId}-password-hint`} className="text-xs text-muted-foreground">
                {t('nodes.remote.passwordHint')}
              </p>
            </div>
          </div>
          {connect.isError && (
            <ErrorPanel title={t('nodes.remote.failed')} error={toOrchestratorError(connect.error)} />
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" disabled={!complete || connect.isPending}>
              {connect.isPending && <LoaderCircle aria-hidden="true" className="animate-spin" />}
              {connect.isPending ? t('nodes.remote.connecting') : t('nodes.remote.connect')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setOpen(false);
                setPassword('');
                connect.reset();
              }}
            >
              {t('common.cancel')}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
