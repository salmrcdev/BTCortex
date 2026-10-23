import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { z } from 'zod';
import type { Activity } from '@btcortex/contracts';

// Disk and network activity of the whole computer (specification section 19:
// disk performance and network bandwidth). Windows keeps cumulative counters
// for every physical disk and network interface; BTCortex reads them once a
// minute through PowerShell, which needs no administrator rights, and works
// out the rates between two readings, so each value is the average over the
// minute rather than a single moment. The counters are 64-bit, so they travel
// as text and are subtracted as big integers.

const execFileAsync = promisify(execFile);

const COUNTER_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  "$disks = @(Get-CimInstance Win32_PerfRawData_PerfDisk_PhysicalDisk | Where-Object { $_.Name -ne '_Total' } | ForEach-Object { @{ name = $_.Name; idle = [string]$_.PercentIdleTime; base = [string]$_.PercentIdleTime_Base; read = [string]$_.DiskReadBytesPersec; write = [string]$_.DiskWriteBytesPersec; time = [string]$_.Timestamp_PerfTime; frequency = [string]$_.Frequency_PerfTime } })",
  '$interfaces = @(Get-CimInstance Win32_PerfRawData_Tcpip_NetworkInterface | ForEach-Object { @{ name = $_.Name; received = [string]$_.BytesReceivedPersec; sent = [string]$_.BytesSentPersec; time = [string]$_.Timestamp_PerfTime; frequency = [string]$_.Frequency_PerfTime } })',
  'ConvertTo-Json -Compress -Depth 3 @{ disks = $disks; interfaces = $interfaces }',
].join('; ');

const RawCountersSchema = z.object({
  disks: z.array(
    z.object({
      name: z.string(),
      idle: z.string(),
      base: z.string(),
      read: z.string(),
      write: z.string(),
      time: z.string(),
      frequency: z.string(),
    }),
  ),
  interfaces: z.array(
    z.object({ name: z.string(), received: z.string(), sent: z.string(), time: z.string(), frequency: z.string() }),
  ),
});
export type RawCounters = z.infer<typeof RawCountersSchema>;

export const NO_ACTIVITY: Activity = {
  diskBusyPercent: null,
  diskReadBytesPerSecond: null,
  diskWriteBytesPerSecond: null,
  networkInBytesPerSecond: null,
  networkOutBytesPerSecond: null,
};

/** Reads the counters; undefined where Windows does not provide them. */
export async function readRawCounters(): Promise<RawCounters | undefined> {
  if (process.platform !== 'win32') return undefined;
  const { stdout } = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', COUNTER_SCRIPT],
    {
      windowsHide: true,
      timeout: 20_000,
    },
  );
  return RawCountersSchema.parse(JSON.parse(stdout));
}

function big(value: string): bigint | undefined {
  return /^\d+$/.test(value) ? BigInt(value) : undefined;
}

/** Seconds between two readings of one counter set, or undefined when they cannot be compared. */
function elapsedSeconds(
  before: { time: string; frequency: string },
  after: { time: string; frequency: string },
): number | undefined {
  const start = big(before.time);
  const end = big(after.time);
  const frequency = big(after.frequency);
  if (start === undefined || end === undefined || frequency === undefined || frequency === 0n || end <= start) {
    return undefined;
  }
  return Number(end - start) / Number(frequency);
}

/** How much a cumulative counter grew; undefined when it went backwards (a device was reset). */
function growth(before: string, after: string): bigint | undefined {
  const start = big(before);
  const end = big(after);
  return start === undefined || end === undefined || end < start ? undefined : end - start;
}

/** Rates between two readings. Disks and interfaces present in only one of them are left out. */
export function activityBetween(previous: RawCounters, current: RawCounters): Activity {
  let busiest: number | null = null;
  let read = 0;
  let write = 0;
  let disksMeasured = 0;
  for (const disk of current.disks) {
    const before = previous.disks.find((candidate) => candidate.name === disk.name);
    if (!before) continue;
    const seconds = elapsedSeconds(before, disk);
    if (seconds === undefined) continue;
    // % Idle Time counts 100 ns units of idleness against a 100 ns clock of its own.
    const idle = growth(before.idle, disk.idle);
    const clock = growth(before.base, disk.base);
    if (idle !== undefined && clock !== undefined && clock > 0n) {
      const busy = 100 - Math.min(100, (Number(idle) / Number(clock)) * 100);
      busiest = Math.max(busiest ?? 0, busy);
    }
    const bytesRead = growth(before.read, disk.read);
    const bytesWritten = growth(before.write, disk.write);
    if (bytesRead === undefined || bytesWritten === undefined) continue;
    read += Number(bytesRead) / seconds;
    write += Number(bytesWritten) / seconds;
    disksMeasured += 1;
  }

  let received = 0;
  let sent = 0;
  let interfacesMeasured = 0;
  for (const adapter of current.interfaces) {
    const before = previous.interfaces.find((candidate) => candidate.name === adapter.name);
    if (!before) continue;
    const seconds = elapsedSeconds(before, adapter);
    const bytesIn = growth(before.received, adapter.received);
    const bytesOut = growth(before.sent, adapter.sent);
    if (seconds === undefined || bytesIn === undefined || bytesOut === undefined) continue;
    received += Number(bytesIn) / seconds;
    sent += Number(bytesOut) / seconds;
    interfacesMeasured += 1;
  }

  return {
    diskBusyPercent: busiest,
    diskReadBytesPerSecond: disksMeasured > 0 ? read : null,
    diskWriteBytesPerSecond: disksMeasured > 0 ? write : null,
    networkInBytesPerSecond: interfacesMeasured > 0 ? received : null,
    networkOutBytesPerSecond: interfacesMeasured > 0 ? sent : null,
  };
}
