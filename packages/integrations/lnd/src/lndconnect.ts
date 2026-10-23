import { describeMacaroon } from './macaroon';
import { certificateFingerprint, formatRestAddress, parseRestAddress } from './rest';

// lndconnect URIs (https://github.com/LN-Zap/lndconnect/blob/master/lnd_connect_uri.md),
// which node packages show for connecting wallets:
// lndconnect://<host>:<port>?[cert=<base64url DER certificate>&]macaroon=<base64url macaroon>.
// The certificate is left out when the node has a publicly trusted one. The
// specification's examples use LND's gRPC port, 10009, while BTCortex speaks
// REST (8080 by default), so a URI with that port is flagged.

const GRPC_PORT = 10_009;

export interface LndConnectDetails {
  restAddress: string;
  /** PEM, when the URI carries the certificate. */
  tlsCertificate?: string;
  /** Hex. */
  macaroon: string;
  /** The URI names LND's gRPC port; REST usually listens on 8080. */
  grpcPort: boolean;
}

function pem(der: Buffer): string {
  const lines = der.toString('base64').match(/.{1,64}/g) ?? [];
  return `-----BEGIN CERTIFICATE-----\n${lines.join('\n')}\n-----END CERTIFICATE-----\n`;
}

export function parseLndConnectUri(uri: string): LndConnectDetails {
  const trimmed = uri.trim();
  if (!/^lndconnect:\/\//i.test(trimmed)) throw new Error('This is not an lndconnect:// address.');
  const query = trimmed.indexOf('?');
  const authority = trimmed.slice('lndconnect://'.length, query < 0 ? undefined : query).replace(/\/+$/, '');
  const parameters = new URLSearchParams(query < 0 ? '' : trimmed.slice(query + 1));
  const endpoint = parseRestAddress(authority);

  const macaroonText = parameters.get('macaroon');
  if (!macaroonText) throw new Error('The lndconnect address carries no macaroon.');
  const macaroon = Buffer.from(macaroonText, 'base64url');
  describeMacaroon(macaroon);

  const certificateText = parameters.get('cert');
  let tlsCertificate: string | undefined;
  if (certificateText) {
    tlsCertificate = pem(Buffer.from(certificateText, 'base64url'));
    certificateFingerprint(tlsCertificate);
  }
  return {
    restAddress: formatRestAddress(endpoint),
    ...(tlsCertificate === undefined ? {} : { tlsCertificate }),
    macaroon: macaroon.toString('hex'),
    grpcPort: endpoint.port === GRPC_PORT,
  };
}
