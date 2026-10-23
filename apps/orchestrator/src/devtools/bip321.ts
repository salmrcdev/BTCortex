import type { ParsedPaymentUri, PaymentInstruction } from '@btcortex/contracts';

// Payment URIs by BIP 321, the compatible successor of BIP 21: a bitcoin:
// scheme in any case, an address that may be empty when a payment
// instruction is given, case-insensitive keys, amounts in decimal BTC,
// label, message and pop not repeated, and the whole URI refused when a
// req- parameter is not understood. Reading one never pays or opens anything.

const SCHEME = 'bitcoin:';
const SATS_PER_BTC = 100_000_000;
const MAX_SATS = 21_000_000 * SATS_PER_BTC;
const SINGLE_KEYS = new Set(['amount', 'label', 'message', 'pop']);
const INSTRUCTIONS: Record<string, PaymentInstruction['kind']> = {
  lightning: 'lightning',
  lno: 'bolt12-offer',
  pay: 'bip351',
  sp: 'silent-payment',
  // On-chain addresses of newer formats go under their human-readable part.
  bc: 'on-chain',
  tb: 'on-chain',
  bcrt: 'on-chain',
};
/** Callback schemes BIP 321 forbids, because they open a browser or another program. */
const FORBIDDEN_CALLBACK_SCHEMES = new Set(['http', 'https', 'file', 'javascript', 'mailto']);

export type ParsedUri = Omit<ParsedPaymentUri, 'addressCheck'>;

/** Decimal BTC with a period and at most eight decimals (BIP 321: *digit ["." *digit]), as satoshis. */
export function parseBtcAmount(text: string): number | null {
  if (!/^\d*(\.\d{0,8})?$/.test(text) || !/\d/.test(text)) return null;
  const [whole = '', fraction = ''] = text.split('.');
  const sats = Number(whole || '0') * SATS_PER_BTC + Number(fraction.padEnd(8, '0'));
  return Number.isSafeInteger(sats) && sats <= MAX_SATS ? sats : null;
}

export function formatBtcAmount(sats: number): string {
  const whole = Math.floor(sats / SATS_PER_BTC);
  const fraction = String(sats % SATS_PER_BTC)
    .padStart(8, '0')
    .replace(/0+$/, '');
  return fraction === '' ? String(whole) : `${String(whole)}.${fraction}`;
}

function callbackScheme(callback: string): string | null {
  return /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(callback)?.[1]?.toLowerCase() ?? null;
}

export function parsePaymentUri(text: string): ParsedUri {
  const result: ParsedUri = {
    problems: [],
    address: null,
    amountSats: null,
    label: null,
    message: null,
    instructions: [],
    proofOfPayment: null,
    ignored: [],
  };
  const uri = text.trim();
  if (uri.slice(0, SCHEME.length).toLowerCase() !== SCHEME) {
    result.problems.push('This is not a payment URI: it does not start with bitcoin:.');
    return result;
  }
  const rest = uri.slice(SCHEME.length);
  const queryStart = rest.indexOf('?');
  const address = queryStart === -1 ? rest : rest.slice(0, queryStart);
  const query = queryStart === -1 ? '' : rest.slice(queryStart + 1);
  if (address !== '') {
    if (/^[0-9A-Za-z]+$/.test(address)) result.address = address;
    else result.problems.push('The address holds characters no Bitcoin address has.');
  }

  const counts = new Map<string, number>();
  for (const part of query.split('&')) {
    if (part === '') continue;
    const separator = part.indexOf('=');
    const rawKey = separator === -1 ? part : part.slice(0, separator);
    const rawValue = separator === -1 ? '' : part.slice(separator + 1);
    let key: string;
    let value: string;
    try {
      key = decodeURIComponent(rawKey).toLowerCase();
      value = decodeURIComponent(rawValue);
    } catch {
      result.problems.push(`The parameter “${rawKey}” is not percent-encoded correctly.`);
      continue;
    }
    const required = key.startsWith('req-');
    const name = required ? key.slice('req-'.length) : key;
    if (SINGLE_KEYS.has(name)) counts.set(name, (counts.get(name) ?? 0) + 1);
    switch (name) {
      case 'amount': {
        const sats = parseBtcAmount(value);
        if (sats === null) {
          result.problems.push(`The amount “${value}” is not decimal BTC with a period and at most eight decimals.`);
        } else result.amountSats = sats;
        break;
      }
      case 'label':
        result.label = value;
        break;
      case 'message':
        result.message = value;
        break;
      case 'pop': {
        const scheme = callbackScheme(value);
        result.proofOfPayment = {
          callback: value,
          required,
          allowedScheme: scheme !== null && !FORBIDDEN_CALLBACK_SCHEMES.has(scheme),
        };
        if (scheme !== null && FORBIDDEN_CALLBACK_SCHEMES.has(scheme)) {
          result.problems.push(`The proof-of-payment callback uses ${scheme}:, which BIP 321 forbids.`);
        }
        break;
      }
      default: {
        const kind = INSTRUCTIONS[name];
        if (kind) result.instructions.push({ key: name, kind, value });
        else if (required) {
          result.problems.push(
            `It requires “${name}”, which BTCortex does not understand, so the whole URI is invalid.`,
          );
        } else result.ignored.push({ key: name, value });
      }
    }
  }
  for (const [name, count] of counts) {
    if (count > 1) result.problems.push(`“${name}” appears ${String(count)} times; BIP 321 allows it once.`);
  }
  if (result.address === null && result.instructions.length === 0 && result.problems.length === 0) {
    result.problems.push('It has neither an address nor a payment instruction.');
  }
  return result;
}

const encode = (value: string) => encodeURIComponent(value);

export function buildPaymentUri(request: {
  address: string;
  amountSats?: number | undefined;
  label?: string | undefined;
  message?: string | undefined;
}): string {
  const parameters = [
    ...(request.amountSats === undefined ? [] : [`amount=${formatBtcAmount(request.amountSats)}`]),
    ...(request.label ? [`label=${encode(request.label)}`] : []),
    ...(request.message ? [`message=${encode(request.message)}`] : []),
  ];
  return `${SCHEME}${request.address}${parameters.length > 0 ? `?${parameters.join('&')}` : ''}`;
}
