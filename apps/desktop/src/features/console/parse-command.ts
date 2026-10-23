// Parses a console line the way Bitcoin Core's own console does:
//   getblock "000000000019d6…" 2
//   getblockstats 100 '["height","txs"]'
// The first word is the method. Each argument is JSON when it parses as JSON
// (numbers, true/false/null, "strings", [arrays], {objects}); anything else is
// a plain string, so `getaddressinfo bc1q…` works without quotes.

export interface ParsedCommand {
  method: string;
  params: unknown[];
}

export class CommandSyntaxError extends Error {}

/** Splits the line into words, keeping quoted strings and bracketed JSON together. */
function tokens(line: string): string[] {
  const result: string[] = [];
  let index = 0;
  while (index < line.length) {
    const character = line[index] ?? '';
    if (/\s/.test(character)) {
      index += 1;
      continue;
    }
    const start = index;
    if (character === '"' || character === "'") {
      const quote = character;
      index += 1;
      while (index < line.length && line[index] !== quote) index += line[index] === '\\' ? 2 : 1;
      if (index >= line.length) throw new CommandSyntaxError(`A ${quote} is not closed.`);
      index += 1;
    } else if (character === '[' || character === '{') {
      let depth = 0;
      let inString = false;
      for (; index < line.length; index += 1) {
        const current = line[index];
        if (inString) {
          if (current === '\\') index += 1;
          else if (current === '"') inString = false;
        } else if (current === '"') inString = true;
        else if (current === '[' || current === '{') depth += 1;
        else if (current === ']' || current === '}') {
          depth -= 1;
          if (depth === 0) {
            index += 1;
            break;
          }
        }
      }
      if (depth !== 0) throw new CommandSyntaxError('A bracket is not closed.');
    } else {
      while (index < line.length && !/\s/.test(line[index] ?? '')) index += 1;
    }
    result.push(line.slice(start, index));
  }
  return result;
}

function value(token: string): unknown {
  // Single quotes wrap JSON or text, as in Bitcoin Core's console.
  const text = token.startsWith("'") && token.endsWith("'") ? token.slice(1, -1) : token;
  try {
    return JSON.parse(text);
  } catch {
    if (token.startsWith('[') || token.startsWith('{')) {
      throw new CommandSyntaxError(`This is not valid JSON: ${token}`);
    }
    return text;
  }
}

export function parseCommand(line: string): ParsedCommand {
  const [method, ...rest] = tokens(line.trim());
  if (method === undefined) throw new CommandSyntaxError('Type a method name, for example getblockchaininfo.');
  if (!/^[a-z][a-z0-9]*$/.test(method)) {
    throw new CommandSyntaxError(`"${method}" is not a method name: they are lower-case letters and digits.`);
  }
  return { method, params: rest.map(value) };
}
