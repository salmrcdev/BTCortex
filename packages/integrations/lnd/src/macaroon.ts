// What an LND macaroon allows, read from the macaroon itself
// (docs/research/notes/lightning.md, section 2.3). LND's macaroons are
// version 2 binary macaroons; the identifier is a version byte (3) followed
// by the protobuf MacaroonId { bytes nonce = 1; bytes storageId = 2;
// repeated Op ops = 3 }, Op { string entity = 1; repeated string actions = 2 }.
// First-party caveats, such as "time-before 2026-12-31T00:00:00Z", narrow
// the macaroon further. Knowing this without asking the node lets BTCortex
// recommend the read-only macaroon for monitoring and say plainly when a
// macaroon can move funds.

export interface MacaroonPermission {
  entity: string;
  actions: string[];
}

/**
 * `read-only`: reads only. `invoices`: can also create invoices and
 * addresses, but not spend. `admin`: can spend on-chain and over Lightning.
 * `custom`: anything else that writes.
 */
export type MacaroonAccess = 'read-only' | 'invoices' | 'admin' | 'custom';

export interface MacaroonSummary {
  location: string;
  permissions: MacaroonPermission[];
  access: MacaroonAccess;
  /** First-party caveats as written, for example `ipaddr 192.168.1.10`. */
  caveats: string[];
  /** From a `time-before` caveat. */
  expiresAt?: string;
}

export class MacaroonFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MacaroonFormatError';
  }
}

const FIELD_EOS = 0;
const FIELD_LOCATION = 1;
const FIELD_IDENTIFIER = 2;
const FIELD_VERIFICATION_ID = 4;
const FIELD_SIGNATURE = 6;
const LND_IDENTIFIER_VERSION = 3;

class Reader {
  private offset = 0;
  constructor(private readonly bytes: Uint8Array) {}

  get done(): boolean {
    return this.offset >= this.bytes.length;
  }

  byte(): number {
    const value = this.bytes[this.offset];
    if (value === undefined) throw new MacaroonFormatError('The macaroon ends too early.');
    this.offset += 1;
    return value;
  }

  varint(): number {
    let value = 0;
    for (let shift = 0; shift < 35; shift += 7) {
      const next = this.byte();
      value += (next & 0x7f) * 2 ** shift;
      if ((next & 0x80) === 0) return value;
    }
    throw new MacaroonFormatError('The macaroon holds a malformed length.');
  }

  take(length: number): Uint8Array {
    if (this.offset + length > this.bytes.length) throw new MacaroonFormatError('The macaroon ends too early.');
    const slice = this.bytes.subarray(this.offset, this.offset + length);
    this.offset += length;
    return slice;
  }
}

/** One section of fields up to its end marker, as type → value. */
function readSection(reader: Reader): Map<number, Uint8Array> {
  const fields = new Map<number, Uint8Array>();
  for (;;) {
    const type = reader.byte();
    if (type === FIELD_EOS) return fields;
    fields.set(type, reader.take(reader.varint()));
  }
}

const text = (bytes: Uint8Array) => new TextDecoder('utf-8', { fatal: true }).decode(bytes);

/** The protobuf fields of a message, as field number → length-delimited values (other wire types skipped). */
function protobufFields(bytes: Uint8Array): Map<number, Uint8Array[]> {
  const reader = new Reader(bytes);
  const fields = new Map<number, Uint8Array[]>();
  while (!reader.done) {
    const key = reader.varint();
    const field = Math.floor(key / 8);
    const wireType = key % 8;
    if (wireType === 2) {
      const value = reader.take(reader.varint());
      fields.set(field, [...(fields.get(field) ?? []), value]);
    } else if (wireType === 0) {
      reader.varint();
    } else {
      throw new MacaroonFormatError('The macaroon identifier is not one LND writes.');
    }
  }
  return fields;
}

function classify(permissions: readonly MacaroonPermission[]): MacaroonAccess {
  const writes = permissions.filter((permission) => permission.actions.some((action) => action !== 'read'));
  if (writes.length === 0) return 'read-only';
  const writing = new Set(writes.map((permission) => permission.entity));
  if ([...writing].every((entity) => entity === 'invoices' || entity === 'address')) return 'invoices';
  const canWrite = (entity: string) =>
    writes.some((permission) => permission.entity === entity && permission.actions.includes('write'));
  return canWrite('offchain') && canWrite('onchain') ? 'admin' : 'custom';
}

/** Reads a macaroon given as bytes or hex. */
export function describeMacaroon(macaroon: Uint8Array | string): MacaroonSummary {
  let bytes: Uint8Array;
  if (typeof macaroon === 'string') {
    const hex = macaroon.trim();
    if (hex.length === 0 || hex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(hex)) {
      throw new MacaroonFormatError('This is not a macaroon in hex.');
    }
    bytes = Uint8Array.from(Buffer.from(hex, 'hex'));
  } else {
    bytes = macaroon;
  }
  const reader = new Reader(bytes);
  if (reader.byte() !== 2) throw new MacaroonFormatError('This is not a version 2 macaroon, which LND writes.');
  const header = readSection(reader);
  const identifier = header.get(FIELD_IDENTIFIER);
  if (identifier?.[0] !== LND_IDENTIFIER_VERSION) {
    throw new MacaroonFormatError('This macaroon was not baked by LND.');
  }
  const caveats: string[] = [];
  for (;;) {
    const caveat = readSection(reader);
    if (caveat.size === 0) break;
    const id = caveat.get(FIELD_IDENTIFIER);
    // Third-party caveats carry a verification id; LND does not use them, and they say nothing readable.
    if (id && !caveat.has(FIELD_VERIFICATION_ID)) caveats.push(text(id));
  }
  if (reader.byte() !== FIELD_SIGNATURE || reader.take(reader.varint()).length !== 32) {
    throw new MacaroonFormatError('The macaroon has no valid signature field.');
  }

  const permissions = (protobufFields(identifier.subarray(1)).get(3) ?? []).map((op) => {
    const fields = protobufFields(op);
    return {
      entity: text(fields.get(1)?.[0] ?? new Uint8Array()),
      actions: (fields.get(2) ?? []).map(text),
    };
  });
  const timeBefore = caveats.map((caveat) => /^time-before (\S+)$/.exec(caveat)?.[1]).find(Boolean);
  const expires = timeBefore === undefined ? undefined : new Date(timeBefore);
  return {
    location: header.has(FIELD_LOCATION) ? text(header.get(FIELD_LOCATION) ?? new Uint8Array()) : '',
    permissions,
    access: classify(permissions),
    caveats,
    ...(expires && !Number.isNaN(expires.getTime()) ? { expiresAt: expires.toISOString() } : {}),
  };
}
