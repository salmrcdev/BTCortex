import { describe, expect, it, vi } from 'vitest';
import { LineDecoder } from './line-decoder';

describe('LineDecoder', () => {
  it('splits lines, tolerates CRLF and buffers partial lines across chunks', () => {
    const decoder = new LineDecoder();
    const onOversized = vi.fn();
    expect(decoder.push(Buffer.from('{"a":1}\r\n{"b":'), onOversized)).toEqual(['{"a":1}']);
    expect(decoder.push(Buffer.from('2}\n\n'), onOversized)).toEqual(['{"b":2}']);
    expect(onOversized).not.toHaveBeenCalled();
  });

  it('decodes multi-byte characters split across chunks', () => {
    const decoder = new LineDecoder();
    const bytes = Buffer.from('"Synchronisation • £"\n', 'utf8');
    const splitAt = bytes.indexOf(0xe2) + 1; // inside the bullet's three-byte sequence
    expect(decoder.push(bytes.subarray(0, splitAt), vi.fn())).toEqual([]);
    expect(decoder.push(bytes.subarray(splitAt), vi.fn())).toEqual(['"Synchronisation • £"']);
  });

  it('discards oversized lines and recovers on the next line', () => {
    const decoder = new LineDecoder(8);
    const onOversized = vi.fn();
    expect(decoder.push(Buffer.from('0123456789'), onOversized)).toEqual([]);
    expect(decoder.push(Buffer.from('still the same line\nok\n'), onOversized)).toEqual(['ok']);
    expect(onOversized).toHaveBeenCalledTimes(1);
  });
});
