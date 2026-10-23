import { describe, expect, it } from 'vitest';
import type { NodeSnapshot } from '@btcortex/contracts';
import { policyFeatures, readFeeRateDiagram, replacementTerms } from './mempool-service';
import { MetricsHistory } from './metrics-history';

describe('readFeeRateDiagram', () => {
  it('sorts the mempool into fee-rate buckets from Bitcoin Core’s cumulative diagram', () => {
    // Observed on Bitcoin Core 31.1: five transactions of 561 weight units at 40, 15, 7, 3 and 1 sat/vB.
    const { buckets, nextBlockMinimumSatPerVb } = readFeeRateDiagram([
      { weight: 0, fee: 0 },
      { weight: 561, fee: 0.0000564 },
      { weight: 1122, fee: 0.00007755 },
      { weight: 1683, fee: 0.00008742 },
      { weight: 2244, fee: 0.00009165 },
      { weight: 2805, fee: 0.00009306 },
    ]);
    const filled = buckets.filter((bucket) => bucket.virtualBytes > 0).map((bucket) => bucket.minimum);
    expect(filled).toEqual([1, 3, 5, 10, 20]);
    expect(buckets.find((bucket) => bucket.minimum === 20)).toMatchObject({ virtualBytes: 140.25, feeSats: 5640 });
    expect(buckets.reduce((total, bucket) => total + bucket.feeSats, 0)).toBe(9306);
    // Everything fits in one block.
    expect(nextBlockMinimumSatPerVb).toBeNull();
  });

  it('finds the lowest fee rate that still makes the next block', () => {
    const { nextBlockMinimumSatPerVb, buckets } = readFeeRateDiagram([
      { weight: 0, fee: 0 },
      { weight: 2_000_000, fee: 0.1 }, // 20 sat/vB
      { weight: 6_000_000, fee: 0.15 }, // 5 sat/vB
    ]);
    expect(nextBlockMinimumSatPerVb).toBe(5);
    expect(buckets.find((bucket) => bucket.minimum === 200)?.maximum).toBeNull();
  });
});

describe('policyFeatures', () => {
  it('follows Bitcoin Core releases', () => {
    const supported = (version: number) =>
      policyFeatures(version, '/Satoshi:0.0.0/')
        ?.filter((feature) => feature.supported)
        .map((feature) => feature.id);
    expect(supported(270_100)).toEqual([]);
    expect(supported(280_000)).toEqual(['package-relay', 'truc', 'pay-to-anchor']);
    expect(supported(310_100)).toEqual(['package-relay', 'truc', 'pay-to-anchor', 'ephemeral-dust', 'cluster-mempool']);
    expect(policyFeatures(310_100, '/Satoshi:31.1.0/')?.find((feature) => feature.id === 'ephemeral-dust')?.since).toBe(
      '29.0',
    );
  });

  it('does not guess for Bitcoin Knots or other implementations', () => {
    expect(policyFeatures(290_100, '/Satoshi:29.1.0/Knots:20250903/')).toBeNull();
    expect(policyFeatures(10_000, '/btcd:0.24.2/')).toBeNull();
  });
});

describe('replacementTerms', () => {
  it('asks for the replaced fees plus the incremental relay fee for the replacement’s size, rounded up', () => {
    // A 141 vB parent (1 sat/vB) with a 50 sat/vB child: a replacement removes both.
    expect(
      replacementTerms({
        virtualBytes: 141,
        descendantFeeSats: 141 + 5_550,
        descendantCount: 2,
        incrementalRelayFeeBtcPerKvB: 0.000001,
        clusterMempool: true,
      }),
    ).toEqual({
      minimumFeeSats: 5_691 + 15,
      minimumSatPerVb: 40.47,
      replacedFeeSats: 5_691,
      evicts: 1,
      mustImproveDiagram: true,
    });
  });
});

describe('MetricsHistory', () => {
  const snapshot = (takenAt: string, transactions: number): NodeSnapshot =>
    ({
      takenAt,
      blockchain: { blocks: 100 },
      network: { connections: 8 },
      mempool: { transactions, virtualBytes: transactions * 200, minimumFeeBtcPerKvB: 0.000001 },
    }) as NodeSnapshot;

  it('keeps the latest sample of each minute for a day', () => {
    const history = new MetricsHistory();
    history.record(snapshot('2026-10-21T10:00:05.000Z', 1));
    history.record(snapshot('2026-10-21T10:00:45.000Z', 2));
    history.record(snapshot('2026-10-21T10:01:10.000Z', 3));
    expect(history.list().map((point) => [point.at, point.mempoolTransactions])).toEqual([
      ['2026-10-21T10:00:00.000Z', 2],
      ['2026-10-21T10:01:00.000Z', 3],
    ]);
    expect(history.list()[0]?.mempoolMinimumFeeSatPerVb).toBe(0.1);
    history.record(snapshot('2026-10-22T10:00:30.000Z', 4));
    // A day later, only the last 24 hours remain: 10:01 the day before is still inside them.
    expect(history.list().map((point) => point.at)).toEqual(['2026-10-21T10:01:00.000Z', '2026-10-22T10:00:00.000Z']);
  });
});
