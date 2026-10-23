import { describe, expect, it } from 'vitest';
import { renameWhenReleased } from './rename';

const failure = (code: string) => Object.assign(new Error(code), { code });

describe('renameWhenReleased', () => {
  it('retries while another process still holds the files', async () => {
    let calls = 0;
    await renameWhenReleased('from', 'to', {
      rename: () => {
        calls += 1;
        return calls < 3 ? Promise.reject(failure(calls === 1 ? 'EPERM' : 'EBUSY')) : Promise.resolve();
      },
    });
    expect(calls).toBe(3);
  });

  it('gives up at once on other errors, and after the time limit on lasting locks', async () => {
    await expect(renameWhenReleased('from', 'to', { rename: () => Promise.reject(failure('ENOENT')) })).rejects.toThrow(
      'ENOENT',
    );
    let calls = 0;
    await expect(
      renameWhenReleased('from', 'to', {
        timeoutMs: 250,
        rename: () => {
          calls += 1;
          return Promise.reject(failure('EACCES'));
        },
      }),
    ).rejects.toThrow('EACCES');
    expect(calls).toBeGreaterThan(1);
  });
});
