import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * The 8.3 short form of an existing folder, for programs that cannot open
 * paths with non-ASCII characters. It is ASCII only when 8.3 names are
 * enabled on the volume (the default for the system drive); `undefined` when
 * Windows has none. The path travels in an environment variable, so no
 * quoting is involved.
 */
export async function shortFolderPath(path: string): Promise<string | undefined> {
  if (process.platform !== 'win32') return undefined;
  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        '(New-Object -ComObject Scripting.FileSystemObject).GetFolder($env:BTCORTEX_SHORT_PATH).ShortPath',
      ],
      { env: { ...process.env, BTCORTEX_SHORT_PATH: path }, windowsHide: true, timeout: 20_000 },
    );
    const short = stdout.trim();
    return short !== '' && existsSync(short) ? short : undefined;
  } catch {
    return undefined;
  }
}
