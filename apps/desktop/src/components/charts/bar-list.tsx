import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatPercent } from '@/lib/format';

// Parts of a whole as a sorted list of bars (dataviz skill: one hue for
// magnitude, 4 px rounded data end, largest first). Every row states its
// label, value and share in text, so the table is also the accessible view.

export interface BarListRow {
  key: string;
  label: string;
  value: number;
  valueText: string;
}

export interface BarListProps {
  caption: string;
  rows: readonly BarListRow[];
  labelHeading: string;
  valueHeading: string;
  shareHeading: string;
}

/** A share that rounds to nothing but is not nothing reads "< 1%", never "0%". */
function share(value: number, total: number): string {
  const fraction = total > 0 ? value / total : 0;
  return fraction > 0 && fraction < 0.005 ? `< ${formatPercent(0.01)}` : formatPercent(fraction);
}

export function BarList({ caption, rows, labelHeading, valueHeading, shareHeading }: BarListProps) {
  const sorted = [...rows].sort((a, b) => b.value - a.value);
  const largest = Math.max(1, ...sorted.map((row) => row.value));
  const total = sorted.reduce((sum, row) => sum + row.value, 0);
  return (
    <Table>
      <TableCaption className="text-left">{caption}</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead>{labelHeading}</TableHead>
          {/* The bars repeat the sizes beside them, so assistive technology skips them. */}
          <TableHead className="w-2/5" aria-hidden="true" />
          <TableHead className="text-right">{valueHeading}</TableHead>
          <TableHead className="text-right">{shareHeading}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sorted.map((row) => (
          <TableRow key={row.key}>
            <TableCell>{row.label}</TableCell>
            <TableCell aria-hidden="true">
              <div
                className="h-2 rounded-r-[4px] bg-chart-1"
                style={{ width: row.value > 0 ? `max(2px, ${((row.value / largest) * 100).toFixed(2)}%)` : 0 }}
              />
            </TableCell>
            <TableCell className="tabular text-right">{row.valueText}</TableCell>
            <TableCell className="tabular text-right text-muted-foreground">{share(row.value, total)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
