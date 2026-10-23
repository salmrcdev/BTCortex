import { getCACertificates, setDefaultCACertificates } from 'node:tls';

/**
 * TLS connections trust the certificate authorities Windows trusts (a root of
 * the user's own, or a company's) together with those Node.js ships with, as
 * the interface says. Node.js on its own knows only its bundled list.
 * Returns how many authorities are trusted, or undefined when the runtime
 * cannot read Windows' store and keeps its own list.
 */
export function trustSystemAuthorities(): number | undefined {
  try {
    const authorities = [...new Set([...getCACertificates('system'), ...getCACertificates('bundled')])];
    setDefaultCACertificates(authorities);
    return authorities.length;
  } catch {
    return undefined;
  }
}
