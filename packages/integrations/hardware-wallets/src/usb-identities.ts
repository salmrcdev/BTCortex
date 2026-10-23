// USB identities of signing devices, as HWI 3.2.0 recognises them
// (hwilib/devices/*: trezorlib/models.py, ledger.py, bitbox02_lib, ckcc,
// keepkey.py, jadepy). Recognition from the identity alone never opens the
// device, so it cannot disturb Trezor Suite, Sparrow or HWI while they use it.

export type DeviceVendor = 'trezor' | 'ledger' | 'bitbox' | 'coldcard' | 'keepkey' | 'jade';

/**
 * - `firmware`: running its normal firmware.
 * - `bootloader`: waiting for a firmware update, which belongs to the vendor's app.
 * - `legacy-hid`: an old firmware that talks over HID (Trezor Model One before WebUSB).
 */
export type DeviceMode = 'firmware' | 'bootloader' | 'legacy-hid';

export interface UsbIdentity {
  vendor: DeviceVendor;
  /** A model name when the identity tells it; several Trezor models share one identity. */
  model: string | null;
  mode: DeviceMode;
  /**
   * `certain`: only this device uses the identity. `possible`: a common USB
   * serial adapter that the Jade uses, as do many unrelated devices.
   */
  confidence: 'certain' | 'possible';
}

const TREZOR = 0x1209;
const LEDGER = 0x2c97;
const LEDGER_MODELS: Record<number, string> = {
  0x10: 'Nano S',
  0x40: 'Nano X',
  0x50: 'Nano S Plus',
  0x60: 'Stax',
  0x70: 'Flex',
};
const LEDGER_LEGACY: Record<number, string> = { 0x0001: 'Nano S', 0x0004: 'Nano X' };

/** USB serial adapters a Jade can use (jadepy/jade_serial.py). */
const JADE_ADAPTERS = new Set(['10c4:ea60', '1a86:55d4', '0403:6001', '1a86:7523', '303a:4001', '303a:1001']);

function key(vendorId: number, productId: number): string {
  return `${vendorId.toString(16).padStart(4, '0')}:${productId.toString(16).padStart(4, '0')}`;
}

export function identifyUsbDevice(vendorId: number, productId: number): UsbIdentity | undefined {
  if (vendorId === 0x534c && productId === 0x0001) {
    return { vendor: 'trezor', model: 'Model One', mode: 'legacy-hid', confidence: 'certain' };
  }
  if (vendorId === TREZOR && productId === 0x53c1) {
    return { vendor: 'trezor', model: null, mode: 'firmware', confidence: 'certain' };
  }
  if (vendorId === TREZOR && productId === 0x53c0) {
    return { vendor: 'trezor', model: null, mode: 'bootloader', confidence: 'certain' };
  }
  if (vendorId === 0x2b24 && (productId === 0x0001 || productId === 0x0002)) {
    return {
      vendor: 'keepkey',
      model: 'KeepKey',
      mode: productId === 0x0001 ? 'legacy-hid' : 'firmware',
      confidence: 'certain',
    };
  }
  if (vendorId === LEDGER) {
    const model = LEDGER_LEGACY[productId] ?? LEDGER_MODELS[productId >> 8] ?? null;
    return { vendor: 'ledger', model, mode: 'firmware', confidence: 'certain' };
  }
  if (vendorId === 0x03eb && productId === 0x2403) {
    return { vendor: 'bitbox', model: 'BitBox02', mode: 'firmware', confidence: 'certain' };
  }
  if (vendorId === 0xd13e && productId === 0xcc10) {
    return { vendor: 'coldcard', model: 'COLDCARD', mode: 'firmware', confidence: 'certain' };
  }
  if (JADE_ADAPTERS.has(key(vendorId, productId))) {
    return { vendor: 'jade', model: 'Jade', mode: 'firmware', confidence: 'possible' };
  }
  return undefined;
}
