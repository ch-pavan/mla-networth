const PACKED_INVOCATION = /eval\s*\(\s*function\s*\(\s*h\s*,\s*u\s*,\s*n\s*,\s*t\s*,\s*e\s*,\s*r\s*\)[\s\S]*?\}\s*\(\s*"([A-Za-z0-9]+)"\s*,\s*(\d+)\s*,\s*"([A-Za-z0-9]+)"\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)\s*\)/;
const SAFE_TABLE_ROWS = /^\s*(?:<tr\b[\s\S]*?<\/tr>\s*)+$/i;
const UNSAFE_HTML = /<(?:script|iframe|object|embed|link|meta)\b|\son[a-z]+\s*=/i;

function parseJavaScriptString(source, start) {
  const quote = source[start];
  if (quote !== '"' && quote !== "'") return null;

  let value = "";
  for (let index = start + 1; index < source.length; index += 1) {
    const character = source[index];
    if (character === quote) return { value, end: index + 1 };
    if (character !== "\\") {
      value += character;
      continue;
    }

    const escape = source[index + 1];
    if (escape === undefined) return null;
    index += 1;
    if (escape === "\n") continue;
    if (escape === "\r") {
      if (source[index + 1] === "\n") index += 1;
      continue;
    }

    const simpleEscapes = {
      "0": "\0", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t", v: "\v",
      "\\": "\\", "'": "'", '"': '"', "/": "/",
    };
    if (Object.hasOwn(simpleEscapes, escape)) {
      if (escape === "0" && /\d/.test(source[index + 1] ?? "")) return null;
      value += simpleEscapes[escape];
      continue;
    }

    const hexLength = escape === "x" ? 2 : escape === "u" ? 4 : 0;
    if (!hexLength) return null;
    const hex = source.slice(index + 1, index + 1 + hexLength);
    if (hex.length !== hexLength || !/^[0-9a-f]+$/i.test(hex)) return null;
    value += String.fromCharCode(Number.parseInt(hex, 16));
    index += hexLength;
  }

  return null;
}

function extractDocumentWriteRows(source) {
  const prefix = source.match(/^\s*document\.write\s*\(\s*/);
  if (!prefix) return null;
  const parsed = parseJavaScriptString(source, prefix[0].length);
  if (!parsed || !/^\s*\)\s*;?\s*$/.test(source.slice(parsed.end))) return null;
  return parsed.value;
}

/**
 * Decode the custom base-N byte encoding used by MyNeta's packed table rows.
 *
 * The source wrapper names its arguments (h, u, n, t, e, r). `h` is a series
 * of encoded bytes separated by `n[e]`; characters n[0] through n[e - 1]
 * are the digits, and `t` is subtracted from each decoded byte. The remaining
 * numeric arguments are wrapper noise and never need to be interpreted.
 *
 * This function deliberately parses only data from that invocation. It never
 * evaluates JavaScript received from the source website.
 */
function decodePackedRows(code) {
  const match = code.match(PACKED_INVOCATION);
  if (!match) return null;

  const [, encoded, , alphabet, offsetText, radixText] = match;
  const offset = Number(offsetText);
  const radix = Number(radixText);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 255) return null;
  if (!Number.isSafeInteger(radix) || radix < 2 || radix > 10) return null;
  if (alphabet.length <= radix || new Set(alphabet).size !== alphabet.length) return null;

  const delimiter = alphabet[radix];
  const chunks = encoded.split(delimiter);
  if (chunks.length < 2 || chunks.at(-1) !== "") return null;
  chunks.pop();

  const digitByCharacter = new Map(
    [...alphabet.slice(0, radix)].map((character, digit) => [character, digit]),
  );
  const bytes = new Uint8Array(chunks.length);

  for (let byteIndex = 0; byteIndex < chunks.length; byteIndex += 1) {
    const chunk = chunks[byteIndex];
    if (!chunk) return null;

    let encodedValue = 0;
    for (const character of chunk) {
      const digit = digitByCharacter.get(character);
      if (digit === undefined) return null;
      encodedValue = (encodedValue * radix) + digit;
      if (encodedValue > offset + 255) return null;
    }

    const byte = encodedValue - offset;
    if (!Number.isInteger(byte) || byte < 0 || byte > 255) return null;
    bytes[byteIndex] = byte;
  }

  let statement;
  try {
    statement = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }

  const decoded = extractDocumentWriteRows(statement);
  if (decoded === null) return null;
  if (!SAFE_TABLE_ROWS.test(decoded) || UNSAFE_HTML.test(decoded)) return null;
  return decoded;
}

/**
 * Replace only recognized MyNeta packed table-row scripts with decoded HTML.
 * Unknown or malformed scripts are retained so callers fail their completeness
 * checks instead of silently losing records.
 */
export function deobfuscateMynetaHtml(html) {
  return html.replace(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi, (all, code) => (
    decodePackedRows(code) ?? all
  ));
}
