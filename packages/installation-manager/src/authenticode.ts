import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

// Defence in depth after checksum verification: Windows Authenticode status
// of extracted executables. The OpenPGP signature and checksum remain the
// primary guarantee; publishers' certificates may legitimately change.

const execFileAsync = promisify(execFile);

export interface AuthenticodeResult {
  file: string;
  /** PowerShell's SignatureStatus, for example `Valid`, `NotSigned`, `HashMismatch`. */
  status: string;
  signer: string | undefined;
}

// Paths travel in an environment variable as JSON, never inside the script
// text, so no file name can inject PowerShell code.
const SCRIPT = [
  '$ErrorActionPreference = "Stop"',
  '$paths = $env:BTCORTEX_AUTHENTICODE_FILES | ConvertFrom-Json',
  '@(Get-AuthenticodeSignature -LiteralPath $paths | ForEach-Object {',
  '  [pscustomobject]@{ file = $_.Path; status = [string]$_.Status; signer = if ($_.SignerCertificate) { $_.SignerCertificate.Subject } else { $null } }',
  '}) | ConvertTo-Json -Compress',
].join('\n');

export async function checkAuthenticode(files: readonly string[]): Promise<AuthenticodeResult[]> {
  if (process.platform !== 'win32' || files.length === 0) return [];
  // A PowerShell 7 parent passes incompatible module paths through Node.js.
  // Let Windows PowerShell construct its own module search path instead.
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => name.toUpperCase() !== 'PSMODULEPATH'),
  );
  const { stdout } = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', SCRIPT],
    { env: { ...environment, BTCORTEX_AUTHENTICODE_FILES: JSON.stringify(files) }, windowsHide: true, timeout: 60_000 },
  );
  const parsed: unknown = JSON.parse(stdout.trim() || '[]');
  const list = Array.isArray(parsed) ? parsed : [parsed];
  return list.map((item) => {
    const record = item as { file?: unknown; status?: unknown; signer?: unknown };
    return {
      file: String(record.file),
      status: String(record.status),
      signer: typeof record.signer === 'string' ? record.signer : undefined,
    };
  });
}

/** A valid signature whose certificate subject names the expected publisher. */
export function isTrustedSignature(result: AuthenticodeResult, expectedSigner: string): boolean {
  return result.status === 'Valid' && (result.signer?.includes(`CN=${expectedSigner}`) ?? false);
}
