import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkAuthenticode } from './authenticode';

const SIGNED_EXECUTABLE = 'C:\\Windows\\System32\\whoami.exe';
const onWindows = process.platform === 'win32' && existsSync(SIGNED_EXECUTABLE);

describe.skipIf(!onWindows)('Authenticode module isolation', () => {
  it('checks signatures when the parent supplies an incompatible PowerShell module', async () => {
    const root = mkdtempSync(join(tmpdir(), 'btcortex-authenticode-modules-'));
    if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error('Unexpected temporary directory');
    const moduleDirectory = join(root, 'Microsoft.PowerShell.Security');
    const previousModulePath = process.env['PSModulePath'];
    try {
      mkdirSync(moduleDirectory);
      writeFileSync(
        join(moduleDirectory, 'Microsoft.PowerShell.Security.psd1'),
        "@{ ModuleVersion = '1.0.0'; RootModule = 'incompatible.psm1'; FunctionsToExport = @('Get-AuthenticodeSignature') }",
      );
      writeFileSync(
        join(moduleDirectory, 'incompatible.psm1'),
        "throw 'Incompatible module inherited from a different PowerShell edition.'",
      );
      process.env['PSModulePath'] = root;

      const signatures = await checkAuthenticode([SIGNED_EXECUTABLE]);

      expect(signatures).toHaveLength(1);
      expect(signatures[0]).toMatchObject({ file: SIGNED_EXECUTABLE, status: 'Valid' });
      expect(signatures[0]?.signer).toContain('Microsoft Windows');
    } finally {
      if (previousModulePath === undefined) delete process.env['PSModulePath'];
      else process.env['PSModulePath'] = previousModulePath;
      rmSync(root, { recursive: true, force: true });
    }
  });
});
