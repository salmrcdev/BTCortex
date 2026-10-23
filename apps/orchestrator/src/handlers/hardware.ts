import { psbtFromQrParts, psbtToQrFrames } from '@btcortex/integration-hardware-wallets';
import { AppFailure } from '@btcortex/contracts';
import type { HardwareService } from '../hardware/hardware-service';
import type { SignerService } from '../nodes/signer-service';
import type { Dispatcher } from '../rpc/dispatcher';

export function registerHardwareHandlers(
  dispatcher: Dispatcher,
  hardware: HardwareService,
  signers: SignerService,
): void {
  dispatcher.register('hardware.overview', () => hardware.overview());
  dispatcher.register('hardware.identify', ({ network }) => hardware.identify(network));
  dispatcher.register('hardware.installHwi', () => ({ jobId: hardware.installHwi() }));
  dispatcher.register('hardware.installTrezorSuite', () => ({ jobId: hardware.installTrezorSuite() }));
  dispatcher.register('hardware.openTrezorSuite', async () => {
    await hardware.openTrezorSuite();
    return { launched: true };
  });
  dispatcher.register('nodes.signers', ({ nodeId }) => signers.status(nodeId));
  dispatcher.register('nodes.signers.enable', ({ nodeId }) => signers.enable(nodeId));
  dispatcher.register('nodes.signers.createWallet', ({ nodeId, name }) => signers.createWallet(nodeId, name));
  dispatcher.register('wallets.signer.detail', ({ nodeId, wallet }) => signers.detail(nodeId, wallet));
  dispatcher.register('wallets.signer.newAddress', async ({ nodeId, wallet, type }) => ({
    address: await signers.newAddress(nodeId, wallet, type),
  }));
  dispatcher.register('wallets.signer.displayAddress', async ({ nodeId, wallet, address }) => {
    await signers.displayAddress(nodeId, wallet, address);
    return { shown: true };
  });
  dispatcher.register('wallets.psbt.create', ({ nodeId, wallet, outputs, feeRateSatPerVb }) =>
    signers.createPsbt(nodeId, wallet, outputs, feeRateSatPerVb),
  );
  dispatcher.register('wallets.psbt.decode', ({ nodeId, psbt, wallet }) => signers.decodePsbt(nodeId, psbt, wallet));
  dispatcher.register('wallets.psbt.sign', ({ nodeId, wallet, psbt }) => signers.signPsbt(nodeId, wallet, psbt));
  dispatcher.register('wallets.psbt.finalize', ({ nodeId, psbt }) => signers.finalizePsbt(nodeId, psbt));
  dispatcher.register('wallets.psbt.broadcast', ({ nodeId, hex }) => signers.broadcast(nodeId, hex));
  dispatcher.register('wallets.qr.encode', ({ psbt }) => {
    try {
      return { frames: psbtToQrFrames(psbt) };
    } catch (error) {
      throw new AppFailure({
        code: 'psbt.unreadable',
        message: error instanceof Error ? error.message : 'This is not a PSBT.',
        component: 'PSBT',
        dataRisk: 'none',
        recoveryActions: [],
      });
    }
  });
  dispatcher.register('wallets.qr.decode', ({ parts }) => psbtFromQrParts(parts));
  dispatcher.register('wallets.psbt.readFile', async ({ path }) => ({ psbt: await signers.readPsbtFile(path) }));
  dispatcher.register('wallets.psbt.writeFile', async ({ path, psbt }) => {
    await signers.writePsbtFile(path, psbt);
    return { written: true };
  });
}
