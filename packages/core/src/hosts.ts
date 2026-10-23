// Host names as BTCortex compares them. A fully qualified name may end with a
// dot ("….onion."), which resolvers accept; a check that missed it would send
// an onion address to the Windows resolver and out directly instead of
// through Tor.

/** A host name as compared: lower case, without the trailing dot of a fully qualified name. */
export function normaliseHostName(host: string): string {
  return host.trim().toLowerCase().replace(/\.+$/, '');
}

/** Whether the host is an onion service, however it is written. */
export function isOnionHost(host: string): boolean {
  return normaliseHostName(host).endsWith('.onion');
}
