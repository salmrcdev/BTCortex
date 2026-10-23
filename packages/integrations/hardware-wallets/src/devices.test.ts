import { describe, expect, it } from 'vitest';
import { fetchLatestTrezorSuiteVersion, trezorSuiteLocations, trezorSuiteReleaseFiles } from './trezor-suite';
import { identifyUsbDevice } from './usb-identities';
import { attachedDevices } from './windows-devices';
import type { PnpEntity } from './windows-devices';

const entity = (DeviceID: string, extra: Partial<PnpEntity> = {}): PnpEntity => ({
  DeviceID,
  Name: 'TREZOR',
  Status: 'OK',
  ConfigManagerErrorCode: 0,
  PNPClass: 'USBDevice',
  Present: true,
  ...extra,
});

describe('USB identities', () => {
  it('recognises signing devices the way HWI does, and nothing else', () => {
    expect(identifyUsbDevice(0x1209, 0x53c1)).toEqual({
      vendor: 'trezor',
      model: null,
      mode: 'firmware',
      confidence: 'certain',
    });
    expect(identifyUsbDevice(0x1209, 0x53c0)?.mode).toBe('bootloader');
    expect(identifyUsbDevice(0x534c, 0x0001)).toMatchObject({ model: 'Model One', mode: 'legacy-hid' });
    expect(identifyUsbDevice(0x2c97, 0x5011)?.model).toBe('Nano S Plus');
    expect(identifyUsbDevice(0x2c97, 0x0004)?.model).toBe('Nano X');
    // A Ledger model HWI 3.2.0 does not know yet is still a Ledger.
    expect(identifyUsbDevice(0x2c97, 0x8011)).toMatchObject({ vendor: 'ledger', model: null });
    expect(identifyUsbDevice(0x03eb, 0x2403)?.model).toBe('BitBox02');
    expect(identifyUsbDevice(0xd13e, 0xcc10)?.vendor).toBe('coldcard');
    expect(identifyUsbDevice(0x10c4, 0xea60)).toMatchObject({ vendor: 'jade', confidence: 'possible' });
    expect(identifyUsbDevice(0x0e0f, 0x0003)).toBeUndefined();
    // Other Atmel devices share BitBox02's vendor identifier.
    expect(identifyUsbDevice(0x03eb, 0x6124)).toBeUndefined();
  });
});

describe('attached devices', () => {
  it('turns Windows’ entries for one composite device into one device, with its driver state', () => {
    const devices = attachedDevices([
      entity('USB\\VID_1209&PID_53C1\\0123456789ABCDEF', { PNPClass: 'USB', Name: 'Dispositivo USB composito' }),
      entity('USB\\VID_1209&PID_53C1&MI_00\\7&1A2B3C&0&0000', { Name: 'TREZOR' }),
      entity('USB\\VID_1209&PID_53C1&MI_01\\7&1A2B3C&0&0001', { Name: 'TREZOR Debug' }),
      entity('USB\\VID_0E0F&PID_0003\\6&39D724FE&0&5', { Name: 'VMware USB Pointing Device' }),
    ]);
    expect(devices).toEqual([
      {
        vendor: 'trezor',
        model: null,
        mode: 'firmware',
        confidence: 'certain',
        id: '1209:53c1:0123456789ABCDEF',
        vendorId: '1209',
        productId: '53c1',
        windowsName: 'Dispositivo USB composito',
        driver: { ok: true, problemCode: null },
      },
    ]);
  });

  it('reports a driver problem with Windows’ problem code', () => {
    const [device] = attachedDevices([
      entity('USB\\VID_2C97&PID_5011\\0001', { Status: 'Error', ConfigManagerErrorCode: 28, Name: 'Nano S Plus' }),
    ]);
    expect(device).toMatchObject({ vendor: 'ledger', model: 'Nano S Plus', driver: { ok: false, problemCode: 28 } });
  });

  it('lists two identical devices separately and ignores unplugged ones', () => {
    const devices = attachedDevices([
      entity('USB\\VID_1209&PID_53C1\\AAAA'),
      entity('USB\\VID_1209&PID_53C1\\BBBB'),
      entity('USB\\VID_1209&PID_53C0\\CCCC', { Present: false }),
    ]);
    expect(devices.map((device) => device.id)).toEqual(['1209:53c1:AAAA', '1209:53c1:BBBB']);
  });

  it('counts a serial adapter only as the serial port Windows set up, and lists it last', () => {
    const devices = attachedDevices([
      entity('USB\\VID_10C4&PID_EA60\\0001', {
        PNPClass: 'Ports',
        Name: 'Silicon Labs CP210x USB to UART Bridge (COM3)',
      }),
      entity('USB\\VID_1A86&PID_55D4\\0002', { PNPClass: 'USB', Name: 'USB Serial' }),
      entity('USB\\VID_D13E&PID_CC10\\0003', { Name: 'Coldcard' }),
    ]);
    expect(devices.map((device) => `${device.vendor}:${device.confidence}`)).toEqual([
      'coldcard:certain',
      'jade:possible',
    ]);
  });
});

describe('Trezor Suite releases', () => {
  it('names the published installer and its signature', () => {
    expect(trezorSuiteReleaseFiles('26.10.2')).toEqual({
      installerName: 'Trezor-Suite-26.10.2-win-x64.exe',
      installer: 'https://github.com/trezor/trezor-suite/releases/download/v26.10.2/Trezor-Suite-26.10.2-win-x64.exe',
      signature:
        'https://github.com/trezor/trezor-suite/releases/download/v26.10.2/Trezor-Suite-26.10.2-win-x64.exe.asc',
    });
    expect(() => trezorSuiteReleaseFiles('26.10.1-beta')).toThrow();
  });

  it('reads the latest final release and refuses a pre-release', async () => {
    const answer = (body: unknown) => (() => Promise.resolve(Response.json(body))) as unknown as typeof fetch;
    await expect(fetchLatestTrezorSuiteVersion(answer({ tag_name: 'v26.10.2', prerelease: false }))).resolves.toBe(
      '26.10.2',
    );
    await expect(fetchLatestTrezorSuiteVersion(answer({ tag_name: 'v26.11.0', prerelease: true }))).rejects.toThrow();
  });

  it('looks for Suite where its installer puts it, per user first', () => {
    expect(
      trezorSuiteLocations({ LOCALAPPDATA: 'C:\\Users\\Dev\\AppData\\Local', ProgramFiles: 'C:\\Program Files' }),
    ).toEqual([
      'C:\\Users\\Dev\\AppData\\Local\\Programs\\Trezor Suite\\Trezor Suite.exe',
      'C:\\Program Files\\Trezor Suite\\Trezor Suite.exe',
    ]);
  });
});
