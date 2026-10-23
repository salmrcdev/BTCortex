import { describe, expect, it } from 'vitest';
import type { Topology, TopologyElement, TopologyLink } from '@btcortex/contracts';
import { BOX_HEIGHT, BOX_WIDTH, layoutTopology } from './layout';

const element = (id: string, layer: number): TopologyElement => ({
  id,
  kind: 'bitcoin-node',
  label: id,
  detail: '',
  health: 'healthy',
  route: null,
  layer,
});

const link = (from: string, to: string, protocol: string): TopologyLink => ({
  id: `${from}->${to}:${protocol}`,
  from,
  to,
  protocol,
  port: null,
  protection: 'loopback',
  active: true,
  detail: '',
});

const TOPOLOGY: Topology = {
  checkedAt: '2026-10-23T08:00:00.000Z',
  elements: [
    element('btcortex', 0),
    element('sparrow', 0),
    element('fulcrum', 1),
    element('lnd', 1),
    element('node', 2),
    element('tor', 3),
    element('bitcoin-network', 4),
    element('tor-network', 4),
  ],
  links: [
    link('btcortex', 'node', 'RPC'),
    link('btcortex', 'lnd', 'REST'),
    link('sparrow', 'fulcrum', 'Electrum'),
    link('fulcrum', 'node', 'RPC'),
    link('node', 'bitcoin-network', 'P2P'),
    link('node', 'tor', 'SOCKS5'),
    link('tor', 'node', 'Onion service'),
    link('tor', 'tor-network', 'Tor'),
  ],
};

const overlaps = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  a.x < b.x + BOX_WIDTH && b.x < a.x + BOX_WIDTH && a.y < b.y + BOX_HEIGHT && b.y < a.y + BOX_HEIGHT;

describe('topology layout', () => {
  it('stacks the layers in rows without overlapping boxes or labels on boxes', () => {
    const layout = layoutTopology(TOPOLOGY, 900);
    expect(layout.rows.map((row) => row.layer)).toEqual([0, 1, 2, 3, 4]);
    const boxes = layout.elements;
    for (const [index, a] of boxes.entries()) {
      for (const b of boxes.slice(index + 1)) expect(overlaps(a, b)).toBe(false);
    }
    // A label never sits on a box.
    for (const placed of layout.links) {
      const onBox = boxes.some(
        (box) =>
          placed.label.x > box.x &&
          placed.label.x < box.x + BOX_WIDTH &&
          placed.label.y > box.y &&
          placed.label.y < box.y + BOX_HEIGHT,
      );
      expect(onBox, placed.id).toBe(false);
    }
    // A link that skips the services row passes through a waypoint there: three curves.
    const skipping = layout.links.find((placed) => placed.id === 'btcortex->node:RPC');
    expect(skipping?.path.match(/C/g)).toHaveLength(2);
    // Links in opposite directions between the same two parts are drawn apart.
    const out = layout.links.find((placed) => placed.id === 'node->tor:SOCKS5');
    const back = layout.links.find((placed) => placed.id === 'tor->node:Onion service');
    expect(out?.label).not.toEqual(back?.label);
  });

  it('grows wider than the window rather than squeezing boxes together', () => {
    const many: Topology = {
      ...TOPOLOGY,
      elements: Array.from({ length: 6 }, (_, index) => element(`node-${String(index)}`, 2)),
      links: [],
    };
    const layout = layoutTopology(many, 500);
    expect(layout.width).toBeGreaterThan(500);
    const xs = layout.elements.map((placed) => placed.x).sort((a, b) => a - b);
    for (let index = 1; index < xs.length; index += 1) {
      expect((xs[index] ?? 0) - (xs[index - 1] ?? 0)).toBeGreaterThanOrEqual(BOX_WIDTH);
    }
  });
});
