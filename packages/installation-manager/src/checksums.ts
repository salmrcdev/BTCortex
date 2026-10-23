// Strict parser for sha256sum-style manifests. Both separators are accepted:
// two spaces (text mode, Bitcoin Core's SHA256SUMS) and space-asterisk
// (binary mode, Sparrow's manifest). Duplicate file names are an error, so a
// manifest cannot list one name with two different hashes.

const LINE = /^([0-9a-f]{64}) (?: |\*)(\S(?:.*\S)?)$/;

export function parseChecksumManifest(text: string): Map<string, string> {
  const entries = new Map<string, string>();
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  if (lines.at(-1) === '') lines.pop();
  lines.forEach((line, index) => {
    const match = LINE.exec(line);
    if (!match?.[1] || !match[2]) throw new Error(`Checksum line ${index + 1} is malformed.`);
    if (entries.has(match[2])) throw new Error(`The checksum manifest lists "${match[2]}" twice.`);
    entries.set(match[2], match[1]);
  });
  return entries;
}
