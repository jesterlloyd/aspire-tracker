// Server-only, zero-dependency plain-text extraction from a .docx buffer.
//
// A .docx is a ZIP container; the body text lives in the `word/document.xml`
// member. This module parses just enough of the ZIP format (End of Central
// Directory -> Central Directory -> Local File Header) and just enough of
// WordprocessingML to recover readable text. Node built-ins only
// (node:zlib, node:buffer) - deliberately NO jszip/mammoth/adm-zip, because the
// only consumer is a server-side text pipeline that must not grow the
// dependency surface for a format we read in exactly one direction.
//
// Never throws. Every malformed-input path returns { ok:false, reason }, so a
// caller can treat an unreadable upload as a normal outcome rather than a 500.
//
// WHAT IT SUPPORTS
//   - Stored (method 0) and deflated (method 8) `word/document.xml` members.
//   - ZIP archives with a trailing comment (the EOCD is scanned backwards).
//   - Paragraph text from <w:t>, honoring xml:space="preserve".
//   - <w:p> paragraph boundaries, <w:br/> line breaks, <w:tab/> tabs.
//   - XML entities: &amp; &lt; &gt; &quot; &apos; and numeric &#NN; / &#xNN;.
//
// HONEST LIMITS (all deliberate; this is a text extractor, not a converter)
//   - Body only. Headers, footers, footnotes, endnotes, comments, and text
//     boxes live in separate ZIP members and are NOT read.
//   - Encrypted / password-protected documents are not supported. They are
//     OLE compound files, not ZIPs, so they surface as 'not_a_zip'.
//   - Zip64 archives are not supported (a >4GB member reads as 'corrupt').
//   - Tables lose their structure: cell text is emitted in document order with
//     paragraph breaks, with no row/column markers.
//   - No formatting, styles, lists, numbering, hyperlink targets, images, or
//     field results are recovered. Tracked-change deletions (<w:delText>) are
//     dropped; insertions are kept.
//   - Runs WITHOUT xml:space="preserve" have their whitespace collapsed and
//     trimmed per the OOXML default, which is why Word emits the attribute
//     whenever spacing matters.
//   - The XML scanner is tag-oriented, not a conforming parser: a raw '>'
//     inside an attribute value would confuse it. WordprocessingML escapes
//     those, so this is safe in practice but is not a general XML parser.
//   - Entry names are read as UTF-8; legacy CP437-encoded names are not
//     transcoded (irrelevant for the fixed ASCII path we look for).

import { inflateRawSync } from 'node:zlib';
import { Buffer } from 'node:buffer';

const EOCD_SIG = 0x06054b50;
const CENTRAL_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;

const EOCD_FIXED_LEN = 22;
const CENTRAL_FIXED_LEN = 46;
const LOCAL_FIXED_LEN = 30;

// Fixed EOCD record plus the largest representable ZIP comment (u16 length).
const EOCD_MAX_SCAN = EOCD_FIXED_LEN + 0xffff;

const DOCUMENT_ENTRY = 'word/document.xml';

const METHOD_STORED = 0;
const METHOD_DEFLATE = 8;

// Zip-bomb ceiling. A real ASPIRE resume or letter is orders of magnitude
// smaller; anything claiming more is refused before a single byte is inflated.
export const MAX_UNCOMPRESSED_BYTES = 20 * 1024 * 1024;

// Property containers. Everything inside them is markup ABOUT text, not text:
// notably <w:tabs><w:tab w:pos=".."/></w:tabs> in <w:pPr>, which would
// otherwise inject a spurious tab for every tab stop the style defines.
const PROPERTY_TAGS = new Set([
  'w:pPr', 'w:rPr', 'w:sectPr', 'w:tblPr', 'w:trPr', 'w:tcPr',
  'w:tblGrid', 'w:numPr', 'w:pPrChange', 'w:rPrChange', 'w:tblPrEx',
]);

const fail = (reason) => ({ ok: false, reason });

// Last EOCD signature in the tail of the buffer. A record whose comment length
// exactly consumes the remaining bytes is authoritative; otherwise the newest
// signature match is used, which tolerates trailing junk after the archive.
function findEocd(buf) {
  const floor = Math.max(0, buf.length - EOCD_MAX_SCAN);
  let fallback = -1;
  for (let i = buf.length - EOCD_FIXED_LEN; i >= floor; i -= 1) {
    if (buf.readUInt32LE(i) !== EOCD_SIG) continue;
    const commentLen = buf.readUInt16LE(i + 20);
    if (i + EOCD_FIXED_LEN + commentLen === buf.length) return i;
    if (fallback < 0) fallback = i;
  }
  return fallback;
}

// Walk the Central Directory for the one member we want. Returns null when the
// directory is well-formed but has no such entry, and throws when the directory
// itself does not parse (callers map that to 'corrupt').
function findCentralEntry(buf, cdOffset, wantedName) {
  let p = cdOffset;
  if (p < 0 || p + CENTRAL_FIXED_LEN > buf.length) throw new Error('bad central directory offset');

  while (p + CENTRAL_FIXED_LEN <= buf.length && buf.readUInt32LE(p) === CENTRAL_SIG) {
    const method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const uncompressedSize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);

    const nameStart = p + CENTRAL_FIXED_LEN;
    const nameEnd = nameStart + nameLen;
    if (nameEnd > buf.length) throw new Error('truncated central directory entry');

    if (buf.toString('utf8', nameStart, nameEnd) === wantedName) {
      return { method, compressedSize, uncompressedSize, localOffset };
    }
    p = nameEnd + extraLen + commentLen;
  }
  if (p === cdOffset) throw new Error('no central directory signature');
  return null;
}

// The Local File Header repeats the name/extra lengths (they may differ from
// the central copy) and its sizes are unreliable when the data-descriptor flag
// is set, so the central directory sizes passed in here are the source of truth.
function readMemberBytes(buf, entry) {
  const { localOffset, method, compressedSize, uncompressedSize } = entry;
  if (localOffset + LOCAL_FIXED_LEN > buf.length) throw new Error('local header out of range');
  if (buf.readUInt32LE(localOffset) !== LOCAL_SIG) throw new Error('bad local header signature');

  const nameLen = buf.readUInt16LE(localOffset + 26);
  const extraLen = buf.readUInt16LE(localOffset + 28);
  const start = localOffset + LOCAL_FIXED_LEN + nameLen + extraLen;
  const end = start + compressedSize;
  if (start > buf.length || end > buf.length) throw new Error('member data out of range');

  // Checked BEFORE inflating. maxOutputLength then backstops a compressed size
  // that lies about how much it expands to.
  if (uncompressedSize > MAX_UNCOMPRESSED_BYTES) throw new Error('uncompressed size over limit');
  if (method === METHOD_STORED && compressedSize > MAX_UNCOMPRESSED_BYTES) {
    throw new Error('stored size over limit');
  }

  const payload = buf.subarray(start, end);
  if (method === METHOD_STORED) return payload;
  if (method === METHOD_DEFLATE) {
    return inflateRawSync(payload, { maxOutputLength: MAX_UNCOMPRESSED_BYTES });
  }
  throw new Error(`unsupported compression method ${method}`);
}

const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeEntities(s) {
  if (!s.includes('&')) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (match, body) => {
    if (body[0] !== '#') return NAMED_ENTITIES[body];
    const code = (body[1] === 'x' || body[1] === 'X')
      ? Number.parseInt(body.slice(2), 16)
      : Number.parseInt(body.slice(1), 10);
    if (!Number.isInteger(code) || code < 0 || code > 0x10ffff) return match;
    return String.fromCodePoint(code);
  });
}

// Collapse 3+ blank-line runs to one blank line, drop trailing whitespace on
// every line, trim the whole. Applied once, at the end, so callers get a stable
// shape regardless of how the authoring tool laid out the paragraphs.
function normalizeText(text) {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function extractTextFromDocumentXml(xml) {
  let out = '';
  let run = null;            // buffered <w:t> character data, null when outside one
  let runPreserve = false;
  const stack = [];          // open element names, for property-container suppression
  let suppressDepth = 0;

  const flushRun = () => {
    if (run === null) return;
    const decoded = decodeEntities(run);
    // Without xml:space="preserve" the OOXML default is collapse-and-trim.
    out += runPreserve ? decoded : decoded.replace(/\s+/g, ' ').trim();
    run = null;
    runPreserve = false;
  };

  const openElement = (name) => {
    stack.push(name);
    if (PROPERTY_TAGS.has(name)) suppressDepth += 1;
  };

  const closeElement = (name) => {
    const at = stack.lastIndexOf(name);
    if (at < 0) return;
    for (let k = stack.length - 1; k >= at; k -= 1) {
      if (PROPERTY_TAGS.has(stack[k])) suppressDepth -= 1;
    }
    stack.length = at;
  };

  const emitTag = (name, { closing, selfClosing, attrs }) => {
    if (suppressDepth > 0) return;
    switch (name) {
      case 'w:t':
        if (closing) flushRun();
        else if (!selfClosing) {
          flushRun();
          run = '';
          runPreserve = /xml:space\s*=\s*(["'])preserve\1/.test(attrs);
        }
        break;
      case 'w:br':
      case 'w:cr':
        if (!closing) { flushRun(); out += '\n'; }
        break;
      case 'w:tab':
        if (!closing) { flushRun(); out += '\t'; }
        break;
      case 'w:p':
        if (closing || selfClosing) { flushRun(); out += '\n'; }
        break;
      default:
        break;
    }
  };

  let i = 0;
  const n = xml.length;
  while (i < n) {
    const lt = xml.indexOf('<', i);
    if (lt < 0) {
      if (run !== null) run += xml.slice(i);
      break;
    }
    if (lt > i && run !== null) run += xml.slice(i, lt);

    if (xml.startsWith('<!--', lt)) {
      const end = xml.indexOf('-->', lt);
      if (end < 0) break;
      i = end + 3;
      continue;
    }
    if (xml.startsWith('<![CDATA[', lt)) {
      const end = xml.indexOf(']]>', lt);
      if (end < 0) break;
      if (run !== null) run += xml.slice(lt + 9, end);   // CDATA is literal, no entity decoding
      i = end + 3;
      continue;
    }
    if (xml.startsWith('<?', lt) || xml.startsWith('<!', lt)) {
      const end = xml.indexOf('>', lt);
      if (end < 0) break;
      i = end + 1;
      continue;
    }

    const gt = xml.indexOf('>', lt);
    if (gt < 0) break;
    const raw = xml.slice(lt + 1, gt);
    i = gt + 1;

    const closing = raw[0] === '/';
    const body = closing ? raw.slice(1) : raw;
    const nameMatch = /^[^\s/>]+/.exec(body);
    if (!nameMatch) continue;
    const name = nameMatch[0];
    const selfClosing = !closing && /\/\s*$/.test(body);
    const attrs = body.slice(name.length);

    // Close tags update the stack BEFORE dispatch so a </w:p> that closes an
    // unterminated property container still emits its paragraph break.
    if (closing) {
      closeElement(name);
      emitTag(name, { closing: true, selfClosing: false, attrs });
    } else {
      emitTag(name, { closing: false, selfClosing, attrs });
      if (!selfClosing) openElement(name);
    }
  }

  flushRun();
  return normalizeText(out);
}

/**
 * Extract plain text from a .docx buffer.
 *
 * @param {Buffer|Uint8Array|ArrayBuffer} buffer raw .docx bytes
 * @returns {Promise<{ok:true,text:string}|{ok:false,reason:'not_a_zip'|'no_document_xml'|'corrupt'|'empty'}>}
 */
export async function extractDocxText(buffer) {
  let buf;
  try {
    if (Buffer.isBuffer(buffer)) buf = buffer;
    else if (buffer instanceof Uint8Array) buf = Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    else if (buffer instanceof ArrayBuffer) buf = Buffer.from(buffer);
    else return fail('not_a_zip');
  } catch {
    return fail('not_a_zip');
  }

  if (buf.length < EOCD_FIXED_LEN) return fail('not_a_zip');

  let eocd;
  try {
    eocd = findEocd(buf);
  } catch {
    return fail('not_a_zip');
  }
  if (eocd < 0) return fail('not_a_zip');

  // An empty archive is well-formed but has nothing to read, and its central
  // directory is zero-length - handled here so it does not look like damage.
  if (buf.readUInt16LE(eocd + 10) === 0) return fail('no_document_xml');

  let entry;
  try {
    entry = findCentralEntry(buf, buf.readUInt32LE(eocd + 16), DOCUMENT_ENTRY);
  } catch {
    return fail('corrupt');
  }
  if (!entry) return fail('no_document_xml');

  let xml;
  try {
    xml = readMemberBytes(buf, entry).toString('utf8');
  } catch {
    return fail('corrupt');
  }

  let text;
  try {
    text = extractTextFromDocumentXml(xml);
  } catch {
    return fail('corrupt');
  }

  if (!text) return fail('empty');
  return { ok: true, text };
}

export default extractDocxText;
