import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { identifyUsbDevice } from './usb-identities';
import type { UsbIdentity } from './usb-identities';

// Signing devices attached to this computer, as Windows' Plug and Play
// manager lists them (Win32_PnPEntity): the USB identity, and whether Windows
// has a working driver for it. Reading this list never opens a device.

const execFileAsync = promisify(execFile);

export interface PnpEntity {
  DeviceID: string;
  Name: string | null;
  Status: string | null;
  ConfigManagerErrorCode: number | null;
  PNPClass: string | null;
  Present: boolean | null;
}

export interface DriverState {
  ok: boolean;
  /** Windows' device problem code (Device Manager's "Code 28" and so on), when there is a problem. */
  problemCode: number | null;
}

export interface AttachedDevice extends UsbIdentity {
  /** Stable while the device stays plugged into the same port. */
  id: string;
  vendorId: string;
  productId: string;
  /** What Windows calls it, in the system's language. */
  windowsName: string | null;
  driver: DriverState;
}

const DEVICE_ID = /^(USB|HID)\\VID_([0-9A-F]{4})&PID_([0-9A-F]{4})(&MI_[0-9A-F]{2})?(?:&[^\\]*)?\\(.+)$/i;

/** Groups Windows' entries (a composite device has one per interface) into one entry per signing device. */
export function attachedDevices(entities: readonly PnpEntity[]): AttachedDevice[] {
  interface Group {
    identity: UsbIdentity;
    vendorId: string;
    productId: string;
    parents: { instance: string; name: string | null }[];
    names: (string | null)[];
    problemCode: number | null;
  }
  const groups = new Map<string, Group>();
  for (const entity of entities) {
    if (entity.Present === false) continue;
    const match = DEVICE_ID.exec(entity.DeviceID);
    if (!match?.[1] || !match[2] || !match[3]) continue;
    const vendorId = match[2].toLowerCase();
    const productId = match[3].toLowerCase();
    const identity = identifyUsbDevice(Number.parseInt(vendorId, 16), Number.parseInt(productId, 16));
    if (!identity) continue;
    // A generic serial adapter counts only as the serial port Windows set up for it.
    if (identity.confidence === 'possible' && entity.PNPClass !== 'Ports') continue;
    const groupKey = `${vendorId}:${productId}`;
    const group = groups.get(groupKey) ?? { identity, vendorId, productId, parents: [], names: [], problemCode: null };
    const code = entity.ConfigManagerErrorCode ?? 0;
    if (code !== 0 || (entity.Status !== null && entity.Status !== 'OK')) group.problemCode ??= code === 0 ? -1 : code;
    if (match[1].toUpperCase() === 'USB' && match[4] === undefined) {
      group.parents.push({ instance: match[5] ?? '', name: entity.Name });
    }
    group.names.push(entity.Name);
    groups.set(groupKey, group);
  }
  const devices: AttachedDevice[] = [];
  for (const group of groups.values()) {
    const parents = group.parents.length > 0 ? group.parents : [{ instance: 'device', name: group.names[0] ?? null }];
    for (const parent of parents) {
      devices.push({
        ...group.identity,
        id: `${group.vendorId}:${group.productId}:${parent.instance}`,
        vendorId: group.vendorId,
        productId: group.productId,
        windowsName: parent.name,
        driver: { ok: group.problemCode === null, problemCode: group.problemCode === -1 ? null : group.problemCode },
      });
    }
  }
  // Serial adapters that may be a Jade come last: they are the least certain.
  return devices.sort((a, b) => Number(a.confidence === 'possible') - Number(b.confidence === 'possible'));
}

const QUERY = [
  '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
  "Get-CimInstance Win32_PnPEntity | Where-Object { ($_.DeviceID -like 'USB*VID_*') -or ($_.DeviceID -like 'HID*VID_*') } | Select-Object DeviceID, Name, Status, ConfigManagerErrorCode, PNPClass, Present | ConvertTo-Json -Compress -Depth 2",
].join('; ');

/** Windows' list of USB and HID devices, read through WMI. */
export async function listPnpEntities(): Promise<PnpEntity[]> {
  if (process.platform !== 'win32') return [];
  const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', QUERY], {
    windowsHide: true,
    timeout: 30_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  const text = stdout.trim();
  if (text === '') return [];
  const parsed = JSON.parse(text) as PnpEntity | PnpEntity[];
  return Array.isArray(parsed) ? parsed : [parsed];
}

export async function listAttachedDevices(): Promise<AttachedDevice[]> {
  return attachedDevices(await listPnpEntities());
}
