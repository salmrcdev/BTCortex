import { describe, expect, it } from 'vitest';
import { CommandSyntaxError, parseCommand } from './parse-command';

describe('parseCommand', () => {
  it('reads the method and JSON or plain arguments like Bitcoin Core’s console', () => {
    expect(parseCommand('getblockchaininfo')).toEqual({ method: 'getblockchaininfo', params: [] });
    expect(parseCommand('  getblock "00ab" 2 ')).toEqual({ method: 'getblock', params: ['00ab', 2] });
    expect(parseCommand('getaddressinfo bc1qexample')).toEqual({ method: 'getaddressinfo', params: ['bc1qexample'] });
    expect(parseCommand('getblockstats 100 ["height", "txs"]')).toEqual({
      method: 'getblockstats',
      params: [100, ['height', 'txs']],
    });
    expect(parseCommand(`getblockstats 100 '["height","txs"]'`)).toEqual({
      method: 'getblockstats',
      params: [100, ['height', 'txs']],
    });
    expect(parseCommand('scantxoutset start [{"desc":"addr(bc1q x)","range":[0, 9]}]')).toEqual({
      method: 'scantxoutset',
      params: ['start', [{ desc: 'addr(bc1q x)', range: [0, 9] }]],
    });
    expect(parseCommand('setban 203.0.113.7 add 3600 false')).toEqual({
      method: 'setban',
      params: ['203.0.113.7', 'add', 3600, false],
    });
  });

  it('explains what is wrong with a line', () => {
    expect(() => parseCommand('')).toThrow(CommandSyntaxError);
    expect(() => parseCommand('GetBlock 1')).toThrow(/lower-case/);
    expect(() => parseCommand('getblock "00ab')).toThrow(/not closed/);
    expect(() => parseCommand('getblockstats 1 [1, 2')).toThrow(/not closed/);
    expect(() => parseCommand('getblockstats 1 [1, 2}')).toThrow(/not closed|not valid JSON/);
  });
});
