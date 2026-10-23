import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { NodeWithStatus, TransactionDetail } from '@btcortex/contracts';
import { runningNode } from '@/testing/fixtures';
import { renderPage } from '@/testing/render';
import { replacementPolicy, TransactionAnalysisView } from './transaction-analysis-view';

const der = `30440220${'11'.repeat(32)}0220${'22'.repeat(32)}01`;
const PUBKEY = `02${'ab'.repeat(32)}`;
const TAPSCRIPT = `20${'ee'.repeat(32)}ac`;
const CONTROL = `c0${'99'.repeat(32)}`;

const transaction = {
  txid: 'aa'.repeat(32),
  version: 2,
  lockTime: 850_000,
  sizeBytes: 300,
  weight: 840,
  vsize: 210,
  inputs: [
    {
      previous: { txid: 'bb'.repeat(32), vout: 1 },
      sequence: 0xfffffffd,
      witness: [der, PUBKEY],
      prevout: { valueSats: 50_000, script: { hex: '', asm: '', type: 'witness_v0_keyhash' }, coinbase: false },
    },
    {
      previous: { txid: 'cc'.repeat(32), vout: 0 },
      sequence: 144,
      witness: [`${'cd'.repeat(64)}83`, TAPSCRIPT, CONTROL, '50aa'],
    },
  ],
  outputs: [
    {
      n: 0,
      valueSats: 200,
      script: { hex: `0014${'00'.repeat(20)}`, asm: '', type: 'witness_v0_keyhash' },
      unspent: null,
    },
    { n: 1, valueSats: 0, script: { hex: '6a0568656c6c6f', asm: '', type: 'nulldata' }, unspent: null },
  ],
} as unknown as TransactionDetail;

describe('what a decoded transaction means', () => {
  it('explains lock time, replacement, weight, inputs and outputs worth a remark', async () => {
    const user = userEvent.setup();
    await renderPage(<TransactionAnalysisView transaction={transaction} policy="full" />);
    expect(await screen.findByText('Not valid before block 850,000')).toBeDefined();
    expect(screen.getByText('Signals replaceability (BIP 125) through inputs #0, #1.')).toBeDefined();
    expect(screen.getByText(/every Bitcoin Core since 28.0, replaces unconfirmed transactions/)).toBeDefined();
    expect(screen.getByText(/180 bytes of base data counted four times and 120 bytes of witness/)).toBeDefined();
    expect(screen.getByText('The witness discount saves 90 vB (30% of its size).')).toBeDefined();

    expect(screen.getByText('P2WPKH')).toBeDefined();
    expect(screen.getByText('Taproot, script path')).toBeDefined();
    // The second input's coin is not known, so its type is judged from the witness.
    expect(screen.getByText('Judged from its shape')).toBeDefined();
    expect(screen.getByText(/spendable 144 blocks after the coin it spends was confirmed/)).toBeDefined();
    expect(screen.getByText(/does not sign every input and output/)).toBeDefined();
    expect(screen.getByText(/carries a Taproot annex/)).toBeDefined();

    const [, taprootDetails] = screen.getAllByText('Witness and script');
    if (!taprootDetails) throw new Error('The Taproot input has no details.');
    await user.click(taprootDetails);
    expect(screen.getByText('Script path: leaf version 0xc0, at depth 0 in the script tree.')).toBeDefined();
    expect(screen.getByText('Tapscript')).toBeDefined();

    expect(screen.getByText(/Below the dust limit of 294 sats/)).toBeDefined();
    expect(screen.getByText('Carries data: “hello”')).toBeDefined();
  });

  it('knows each implementation’s replacement policy', () => {
    const node = (implementation: string, version: number | undefined) =>
      ({
        ...runningNode,
        profile: { ...runningNode.profile, implementation },
        status: {
          ...runningNode.status,
          snapshot:
            version === undefined
              ? undefined
              : { ...runningNode.status.snapshot, network: { ...runningNode.status.snapshot?.network, version } },
        },
      }) as unknown as NodeWithStatus;
    expect(replacementPolicy(node('bitcoin-core', 310_100))).toBe('full');
    expect(replacementPolicy(node('bitcoin-core', 270_200))).toBe('opt-in');
    expect(replacementPolicy(node('bitcoin-knots', 290_000))).toBe('knots');
    expect(replacementPolicy(node('bitcoin-core', undefined))).toBe('unknown');
    expect(replacementPolicy(undefined)).toBe('unknown');
  });
});
