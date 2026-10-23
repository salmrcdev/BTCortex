import type { Topology, TopologyElement, TopologyLink } from '@btcortex/contracts';

// A layered layout for the topology (a light Sugiyama layout): one row per
// layer from programs at the top to networks at the bottom, a waypoint in
// every row a connection passes through so that it never crosses a box,
// barycentre ordering to keep lines from crossing, and labels in the space
// between rows. Rows stack downwards, so the diagram fits narrow windows.

export const BOX_WIDTH = 200;
export const BOX_HEIGHT = 66;
/** Wide enough for the label a waypoint may carry. */
const WAYPOINT_WIDTH = 84;
const ROW_GAP = 76;
const ITEM_GAP = 28;
const PADDING = 16;
const ROW_LABEL = 22;

export interface Point {
  x: number;
  y: number;
}

export interface PlacedElement extends TopologyElement {
  x: number;
  y: number;
}

export interface PlacedLink extends TopologyLink {
  path: string;
  label: Point;
}

export interface TopologyLayout {
  width: number;
  height: number;
  rows: { layer: number; y: number }[];
  elements: PlacedElement[];
  links: PlacedLink[];
}

interface Item {
  id: string;
  width: number;
  element?: TopologyElement;
  /** For waypoints: the link and its place along it. */
  link?: string;
  x: number;
}

export function layoutTopology(topology: Topology, availableWidth: number): TopologyLayout {
  const layers = [...new Set(topology.elements.map((element) => element.layer))].sort((a, b) => a - b);
  const rowOf = new Map(layers.map((layer, index) => [layer, index]));
  const byId = new Map(topology.elements.map((element) => [element.id, element]));
  const rows: Item[][] = layers.map(() => []);
  for (const element of topology.elements) {
    rows[rowOf.get(element.layer) ?? 0]?.push({ id: element.id, width: BOX_WIDTH, element, x: 0 });
  }

  // Waypoints for links that skip rows; the chain of each link, top to bottom or bottom to top.
  const chains = new Map<string, string[]>();
  for (const link of topology.links) {
    const from = byId.get(link.from);
    const to = byId.get(link.to);
    if (!from || !to) continue;
    const start = rowOf.get(from.layer) ?? 0;
    const end = rowOf.get(to.layer) ?? 0;
    const step = end > start ? 1 : -1;
    const chain = [link.from];
    for (let row = start + step; row !== end; row += step) {
      const id = `${link.id}#${String(row)}`;
      rows[row]?.push({ id, width: WAYPOINT_WIDTH, link: link.id, x: 0 });
      chain.push(id);
    }
    chain.push(link.to);
    chains.set(link.id, chain);
  }

  // Neighbours of every item along the chains.
  const neighbours = new Map<string, Set<string>>();
  for (const chain of chains.values()) {
    chain.forEach((id, index) => {
      const set = neighbours.get(id) ?? new Set<string>();
      if (index > 0) set.add(chain[index - 1] ?? id);
      if (index < chain.length - 1) set.add(chain[index + 1] ?? id);
      neighbours.set(id, set);
    });
  }

  const place = () => {
    for (const row of rows) {
      const total = row.reduce((sum, item) => sum + item.width, 0) + ITEM_GAP * Math.max(0, row.length - 1);
      let x = Math.max(PADDING, (availableWidth - total) / 2);
      for (const item of row) {
        item.x = x + item.width / 2;
        x += item.width + ITEM_GAP;
      }
    }
  };
  place();
  const centre = new Map<string, number>();
  const remember = () => {
    for (const row of rows) for (const item of row) centre.set(item.id, item.x);
  };
  remember();
  // Barycentre passes, down and up, then placement again.
  for (let pass = 0; pass < 4; pass += 1) {
    const order = pass % 2 === 0 ? rows : [...rows].reverse();
    for (const row of order) {
      const weight = (item: Item) => {
        const around = [...(neighbours.get(item.id) ?? [])].map((id) => centre.get(id) ?? 0);
        return around.length === 0 ? item.x : around.reduce((sum, value) => sum + value, 0) / around.length;
      };
      row.sort((a, b) => weight(a) - weight(b));
    }
    place();
    remember();
  }

  const widest = Math.max(
    ...rows.map((row) => row.reduce((sum, item) => sum + item.width, 0) + ITEM_GAP * Math.max(0, row.length - 1)),
    0,
  );
  const width = Math.max(availableWidth, widest + 2 * PADDING);
  if (width > availableWidth) {
    // Too wide for the window: lay out again in the wider area.
    return layoutTopology(topology, width);
  }
  const rowY = (row: number) => PADDING + ROW_LABEL + row * (BOX_HEIGHT + ROW_GAP);
  const height = rowY(layers.length) - ROW_GAP + PADDING;

  const elements: PlacedElement[] = rows.flatMap((row, index) =>
    row.flatMap((item) => (item.element ? [{ ...item.element, x: item.x - BOX_WIDTH / 2, y: rowY(index) }] : [])),
  );
  const itemRow = new Map<string, number>();
  rows.forEach((row, index) => {
    for (const item of row) itemRow.set(item.id, index);
  });

  // Links between the same two elements in opposite directions are drawn side by side.
  const seen = new Map<string, number>();
  const links: PlacedLink[] = [];
  for (const link of topology.links) {
    const chain = chains.get(link.id);
    if (!chain) continue;
    const pair = [link.from, link.to].sort().join('|');
    const nth = seen.get(pair) ?? 0;
    seen.set(pair, nth + 1);
    const nudge = nth === 0 ? 0 : 16 * nth;
    const points: Point[] = chain.map((id, index) => {
      const row = itemRow.get(id) ?? 0;
      const x = (centre.get(id) ?? 0) + nudge;
      const top = rowY(row);
      const isElement = byId.has(id);
      if (!isElement) return { x, y: top + BOX_HEIGHT / 2 };
      const next = chain[index === 0 ? 1 : index - 1];
      const nextRow = next === undefined ? row : (itemRow.get(next) ?? row);
      // Leave a box from its bottom towards lower rows and from its top towards upper ones.
      return { x, y: nextRow > row ? top + BOX_HEIGHT : top };
    });
    let path = '';
    points.forEach((point, index) => {
      if (index === 0) {
        path = `M${String(point.x)},${String(point.y)}`;
        return;
      }
      const previous = points[index - 1] ?? point;
      const bend = (point.y - previous.y) / 2;
      path += ` C${String(previous.x)},${String(previous.y + bend)} ${String(point.x)},${String(point.y - bend)} ${String(point.x)},${String(point.y)}`;
    });
    // The label sits on a waypoint when there is one, otherwise between the two rows.
    const middle = points[Math.floor(points.length / 2)];
    const first = points[0] ?? { x: 0, y: 0 };
    const last = points.at(-1) ?? first;
    const label =
      points.length > 2 && middle
        ? middle
        : { x: (first.x + last.x) / 2, y: first.y + (last.y - first.y) * (nth === 0 ? 0.5 : 0.3) };
    links.push({ ...link, path, label });
  }

  return { width, height, rows: layers.map((layer, index) => ({ layer, y: rowY(index) })), elements, links };
}
