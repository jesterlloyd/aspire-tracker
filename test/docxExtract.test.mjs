// Functional tests for lib/server/keith/docxExtract.js.
//
// Every fixture is a synthetic .docx built in-process by the tiny ZIP writer
// below - no binary fixtures are committed, and no real ASPIRE document is ever
// involved. The writer emits real (CRC-correct) archives so the assertions test
// the parser, not a convenient shortcut.
// Run: node --test test/docxExtract.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { Buffer } from 'node:buffer';
import { extractDocxText, MAX_UNCOMPRESSED_BYTES } from '../lib/server/keith/docxExtract.js';

// ── Minimal ZIP writer ────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * entries: [{ name, data, method?, truncateBy?, fakeUncompressedSize? }]
 *   method              0 = stored, 8 = deflate (default), anything else is
 *                       written verbatim so the reader's rejection can be tested
 *   truncateBy          drop N bytes off the compressed payload (corrupt stream)
 *   fakeUncompressedSize  lie about the expanded size (zip-bomb guard)
 */
function buildZip(entries, { comment = '' } = {}) {
  const files = entries.map((e) => {
    const raw = Buffer.from(e.data ?? '', 'utf8');
    const method = e.method ?? 8;
    let payload = method === 8 ? deflateRawSync(raw) : raw;
    if (e.truncateBy) payload = payload.subarray(0, payload.length - e.truncateBy);
    return {
      name: Buffer.from(e.name, 'utf8'),
      method,
      payload,
      crc: crc32(raw),
      uncompressedSize: e.fakeUncompressedSize ?? raw.length,
    };
  });

  const chunks = [];
  const central = [];
  let offset = 0;

  for (const f of files) {
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);              // version needed
    local.writeUInt16LE(0, 6);               // flags
    local.writeUInt16LE(f.method, 8);
    local.writeUInt16LE(0, 10);              // mod time
    local.writeUInt16LE(0, 12);              // mod date
    local.writeUInt32LE(f.crc, 14);
    local.writeUInt32LE(f.payload.length, 18);
    local.writeUInt32LE(f.uncompressedSize, 22);
    local.writeUInt16LE(f.name.length, 26);
    local.writeUInt16LE(0, 28);              // extra length
    chunks.push(local, f.name, f.payload);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);                 // version made by
    cd.writeUInt16LE(20, 6);                 // version needed
    cd.writeUInt16LE(0, 8);                  // flags
    cd.writeUInt16LE(f.method, 10);
    cd.writeUInt16LE(0, 12);
    cd.writeUInt16LE(0, 14);
    cd.writeUInt32LE(f.crc, 16);
    cd.writeUInt32LE(f.payload.length, 20);
    cd.writeUInt32LE(f.uncompressedSize, 24);
    cd.writeUInt16LE(f.name.length, 28);
    cd.writeUInt16LE(0, 30);                 // extra length
    cd.writeUInt16LE(0, 32);                 // comment length
    cd.writeUInt16LE(0, 34);                 // disk number start
    cd.writeUInt16LE(0, 36);                 // internal attrs
    cd.writeUInt32LE(0, 38);                 // external attrs
    cd.writeUInt32LE(offset, 42);
    central.push(cd, f.name);

    offset += local.length + f.name.length + f.payload.length;
  }

  const centralBuf = Buffer.concat(central);
  const commentBuf = Buffer.from(comment, 'utf8');
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);                  // this disk
  eocd.writeUInt16LE(0, 6);                  // disk with central directory
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(commentBuf.length, 20);

  return Buffer.concat([...chunks, centralBuf, eocd, commentBuf]);
}

// ── WordprocessingML fixture helpers ──────────────────────────────────────────

const CONTENT_TYPES = '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>';

const docXml = (body) => '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
  + `<w:body>${body}</w:body></w:document>`;

// Every paragraph carries a <w:pPr> and every run a <w:rPr> so the property
// suppression path is exercised by the ordinary fixtures, not just one test.
const para = (inner) => `<w:p><w:pPr><w:pStyle w:val="Normal"/></w:pPr>${inner}</w:p>`;
const run = (inner) => `<w:r><w:rPr><w:sz w:val="22"/></w:rPr>${inner}</w:r>`;
const t = (text, attrs = '') => `<w:t${attrs}>${text}</w:t>`;

const docx = (body, opts = {}) => buildZip([
  { name: '[Content_Types].xml', data: CONTENT_TYPES },
  { name: 'word/document.xml', data: docXml(body), ...opts },
], { comment: opts.comment ?? '' });

// ── Tests ─────────────────────────────────────────────────────────────────────

test('normal document: paragraphs become newline-separated text', async () => {
  const buf = docx([
    para(run(t('ASPIRE cohort summary'))),
    para(run(t('Second paragraph.'))),
    para(run(t('Third paragraph.'))),
  ].join(''));

  const result = await extractDocxText(buf);
  assert.deepEqual(result, {
    ok: true,
    text: 'ASPIRE cohort summary\nSecond paragraph.\nThird paragraph.',
  });
});

test('multiple runs in one paragraph concatenate without an added break', async () => {
  const buf = docx(para(run(t('Placement ', ' xml:space="preserve"')) + run(t('confirmed.'))));
  const result = await extractDocxText(buf);
  assert.deepEqual(result, { ok: true, text: 'Placement confirmed.' });
});

test('xml:space="preserve" keeps leading and trailing spaces; the default collapses them', async () => {
  const buf = docx([
    para(run(t('Anchor'))),
    para(run(t('  spaced  out  ', ' xml:space="preserve"'))),
    para(run(t('   collapsed    and   trimmed   '))),
  ].join(''));

  const result = await extractDocxText(buf);
  // The preserved run keeps its interior and leading spaces; per-line trailing
  // whitespace is stripped by normalization, and the anchor paragraph keeps the
  // preserved leading spaces away from the whole-result trim.
  assert.deepEqual(result, { ok: true, text: 'Anchor\n  spaced  out\ncollapsed and trimmed' });
});

test('<w:br/> emits a newline and <w:tab/> emits a tab inside one paragraph', async () => {
  const buf = docx(para(
    run(t('Line one') + '<w:br/>' + t('Line two'))
    + run(t('Col A') + '<w:tab/>' + t('Col B')),
  ));

  const result = await extractDocxText(buf);
  assert.deepEqual(result, { ok: true, text: 'Line one\nLine twoCol A\tCol B' });
});

test('XML entities decode, including numeric decimal and hex references', async () => {
  const buf = docx(para(run(t(
    'Ben &amp; Jerry&apos;s &lt;tag&gt; &quot;quoted&quot; &#65;&#x42;&#x2014;end',
  ))));

  const result = await extractDocxText(buf);
  assert.deepEqual(result, { ok: true, text: 'Ben & Jerry\'s <tag> "quoted" AB—end' });
});

test('stored (method 0) document.xml reads the same as a deflated one', async () => {
  const body = [para(run(t('Stored entry.'))), para(run(t('Still readable.')))].join('');
  const stored = await extractDocxText(docx(body, { method: 0 }));
  const deflated = await extractDocxText(docx(body));

  assert.deepEqual(stored, { ok: true, text: 'Stored entry.\nStill readable.' });
  assert.deepEqual(stored, deflated);
});

test('an archive comment does not defeat the backwards EOCD scan', async () => {
  const buf = docx(para(run(t('Commented archive.'))), { comment: 'built by a test fixture' });
  const result = await extractDocxText(buf);
  assert.deepEqual(result, { ok: true, text: 'Commented archive.' });
});

test('three or more blank lines collapse to a single blank line', async () => {
  const buf = docx([
    para(run(t('Above'))),
    para(''), para(''), para(''),
    para(run(t('Below'))),
  ].join(''));

  const result = await extractDocxText(buf);
  assert.deepEqual(result, { ok: true, text: 'Above\n\nBelow' });
});

test('property containers do not leak text or inject tab stops', async () => {
  // <w:tabs> inside <w:pPr> is the classic false positive: tab-stop definitions
  // are markup about text, not tabs in the text.
  const buf = docx(
    '<w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="720"/><w:tab w:val="left" w:pos="1440"/></w:tabs></w:pPr>'
    + run(t('No stray tabs.'))
    + '</w:p>'
    + '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>',
  );

  const result = await extractDocxText(buf);
  assert.deepEqual(result, { ok: true, text: 'No stray tabs.' });
});

test('non-w:t content is ignored, including tracked-change deletions', async () => {
  const buf = docx(para(
    '<w:proofErr w:type="spellStart"/>'
    + '<w:del><w:r><w:delText>removed text</w:delText></w:r></w:del>'
    + run(t('kept text'))
    + '<w:bookmarkStart w:id="0" w:name="_top"/>',
  ));

  const result = await extractDocxText(buf);
  assert.deepEqual(result, { ok: true, text: 'kept text' });
});

test('not a zip -> not_a_zip', async () => {
  const cases = [
    Buffer.from('this is plainly not a zip archive, not even close', 'utf8'),
    Buffer.alloc(0),
    Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]),   // %PDF-1.7
    Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),   // OLE (legacy .doc / encrypted)
  ];
  for (const buf of cases) {
    assert.deepEqual(await extractDocxText(buf), { ok: false, reason: 'not_a_zip' });
  }
});

test('non-buffer input -> not_a_zip rather than a throw', async () => {
  for (const input of [null, undefined, 42, 'a string', {}, []]) {
    assert.deepEqual(await extractDocxText(input), { ok: false, reason: 'not_a_zip' });
  }
});

test('a valid zip without word/document.xml -> no_document_xml', async () => {
  const buf = buildZip([
    { name: '[Content_Types].xml', data: CONTENT_TYPES },
    { name: 'word/styles.xml', data: '<styles/>' },
    { name: 'docProps/app.xml', data: '<Properties/>' },
  ]);
  assert.deepEqual(await extractDocxText(buf), { ok: false, reason: 'no_document_xml' });
});

test('an empty zip -> no_document_xml', async () => {
  assert.deepEqual(await extractDocxText(buildZip([])), { ok: false, reason: 'no_document_xml' });
});

test('document.xml with only empty <w:t></w:t> -> empty', async () => {
  const buf = docx([para(run(t(''))), para(run(t('   ')))].join(''));
  assert.deepEqual(await extractDocxText(buf), { ok: false, reason: 'empty' });
});

test('a document with no body text at all -> empty', async () => {
  const buf = docx('<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>');
  assert.deepEqual(await extractDocxText(buf), { ok: false, reason: 'empty' });
});

test('truncated deflate stream -> corrupt, without throwing', async () => {
  const body = [
    para(run(t('A reasonably long paragraph so the deflate stream has real content.'))),
    para(run(t('Another paragraph, likewise, to make truncation meaningful.'))),
  ].join('');
  const buf = docx(body, { truncateBy: 12 });
  assert.deepEqual(await extractDocxText(buf), { ok: false, reason: 'corrupt' });
});

test('garbage bytes where a deflate stream belongs -> corrupt', async () => {
  // Written as stored so the payload lands verbatim, then relabelled method 8
  // in both headers so inflateRawSync is attempted on non-deflate bytes.
  const bad = buildZip([
    { name: 'word/document.xml', data: '  not deflate at all ÿ', method: 0 },
  ]);
  bad.writeUInt16LE(8, 8);                                   // local header method
  const cdStart = bad.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  bad.writeUInt16LE(8, cdStart + 10);                        // central directory method

  assert.deepEqual(await extractDocxText(bad), { ok: false, reason: 'corrupt' });
});

test('unsupported compression method -> corrupt', async () => {
  const buf = docx(para(run(t('bzip2 is not supported'))), { method: 12 });
  assert.deepEqual(await extractDocxText(buf), { ok: false, reason: 'corrupt' });
});

test('an uncompressed size over the 20 MB ceiling is refused before inflating', async () => {
  const buf = docx(para(run(t('tiny payload, enormous claim'))), {
    fakeUncompressedSize: MAX_UNCOMPRESSED_BYTES + 1,
  });
  assert.deepEqual(await extractDocxText(buf), { ok: false, reason: 'corrupt' });
});

test('a corrupt central directory offset -> corrupt', async () => {
  const buf = docx(para(run(t('valid until the directory pointer is wrecked'))));
  const eocd = buf.length - 22;
  buf.writeUInt32LE(0x0000dead, eocd + 16);
  assert.deepEqual(await extractDocxText(buf), { ok: false, reason: 'corrupt' });
});

test('a truncated central directory entry -> corrupt', async () => {
  const buf = docx(para(run(t('cut the directory short'))));
  const cdStart = buf.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  // Claim a filename far longer than the bytes that remain.
  buf.writeUInt16LE(0xfff0, cdStart + 28);
  assert.deepEqual(await extractDocxText(buf), { ok: false, reason: 'corrupt' });
});

test('a local header signature mismatch -> corrupt', async () => {
  // Single-member archive so offset 0 is document.xml's own local header.
  const buf = buildZip([{ name: 'word/document.xml', data: docXml(para(run(t('wrecked')))) }]);
  buf.writeUInt32LE(0x00000000, 0);
  assert.deepEqual(await extractDocxText(buf), { ok: false, reason: 'corrupt' });
});

test('Uint8Array and ArrayBuffer inputs are accepted', async () => {
  const buf = docx(para(run(t('Views accepted.'))));
  const view = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  assert.deepEqual(await extractDocxText(view), { ok: true, text: 'Views accepted.' });

  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  assert.deepEqual(await extractDocxText(ab), { ok: true, text: 'Views accepted.' });
});

test('table cell text is emitted in document order, one paragraph per cell', async () => {
  const cell = (text) => `<w:tc><w:tcPr><w:tcW w:w="4680"/></w:tcPr>${para(run(t(text)))}</w:tc>`;
  const buf = docx(
    '<w:tbl><w:tblPr><w:tblStyle w:val="Grid"/></w:tblPr><w:tblGrid><w:gridCol w:w="4680"/></w:tblGrid>'
    + `<w:tr><w:trPr><w:cantSplit/></w:trPr>${cell('Student')}${cell('Unit')}</w:tr>`
    + `<w:tr>${cell('Rivera')}${cell('6NE')}</w:tr>`
    + '</w:tbl>',
  );

  const result = await extractDocxText(buf);
  assert.deepEqual(result, { ok: true, text: 'Student\nUnit\nRivera\n6NE' });
});
