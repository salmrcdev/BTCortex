import type { PaymentService } from '../payments/payment-service';
import type { Dispatcher } from '../rpc/dispatcher';

export function registerPaymentHandlers(dispatcher: Dispatcher, payments: PaymentService): void {
  dispatcher.register('payments.list', () => payments.list());
  dispatcher.register('payments.add', (params) => payments.add(params));
  dispatcher.register('payments.remove', ({ serverId }) => {
    payments.remove(serverId);
    return { removed: true } as const;
  });
  dispatcher.register('payments.dashboard', ({ serverId, refresh }) => payments.dashboard(serverId, refresh === true));
}
