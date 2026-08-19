import { findTable, parseTable, serializeTable, TableData, TableRange } from './tableParser';

function lines(s: string): string[] {
  return s.split('\n');
}

// --- findTable ---

function testFindTable() {
  const src = lines([
    'some text',
    '',
    '| A | B | C |',
    '|---|---|---|',
    '| 1 | 2 | 3 |',
    '| 4 | 5 | 6 |',
    '',
    'more text',
  ].join('\n'));

  const r = findTable(src, 3);
  assert(r !== null, 'findTable should find table at separator line');
  assert(r!.startLine === 2, `startLine should be 2, got ${r!.startLine}`);
  assert(r!.endLine === 5, `endLine should be 5, got ${r!.endLine}`);

  const r2 = findTable(src, 4);
  assert(r2 !== null, 'findTable should find table from data row');
  assert(r2!.startLine === 2, 'startLine from data row');

  const r3 = findTable(src, 0);
  assert(r3 === null, 'findTable should return null outside table');

  const r4 = findTable(src, 7);
  assert(r4 === null, 'findTable should return null for non-table text');
}

// --- parseTable ---

function testParseTable() {
  const src = lines([
    '| Name | Age | City |',
    '|:-----|----:|:----:|',
    '| Alice | 20 | Tokyo |',
    '| Bob | 25 | Osaka |',
  ].join('\n'));

  const range: TableRange = { startLine: 0, endLine: 3 };
  const t = parseTable(src, range);

  assert(t.headers.length === 3, `headers count should be 3, got ${t.headers.length}`);
  assert(t.headers[0] === 'Name', `header[0] should be Name, got ${t.headers[0]}`);
  assert(t.headers[1] === 'Age', `header[1] should be Age, got ${t.headers[1]}`);
  assert(t.rows.length === 2, `rows count should be 2, got ${t.rows.length}`);
  assert(t.rows[0][0] === 'Alice', `row[0][0] should be Alice, got ${t.rows[0][0]}`);
  assert(t.rows[1][2] === 'Osaka', `row[1][2] should be Osaka, got ${t.rows[1][2]}`);
  assert(t.alignments[0] === 'left', `align[0] should be left, got ${t.alignments[0]}`);
  assert(t.alignments[1] === 'right', `align[1] should be right, got ${t.alignments[1]}`);
  assert(t.alignments[2] === 'center', `align[2] should be center, got ${t.alignments[2]}`);
}

// --- parseTable with Japanese ---

function testParseTableJapanese() {
  const src = lines([
    '| 名前 | 年齢 |',
    '|------|------|',
    '| 太郎 | 20 |',
  ].join('\n'));

  const range: TableRange = { startLine: 0, endLine: 2 };
  const t = parseTable(src, range);

  assert(t.headers[0] === '名前', `header should be 名前, got ${t.headers[0]}`);
  assert(t.rows[0][0] === '太郎', `cell should be 太郎, got ${t.rows[0][0]}`);
}

// --- serializeTable ---

function testSerialize() {
  const data: TableData = {
    headers: ['A', 'B'],
    rows: [['1', '2'], ['3', '4']],
    alignments: ['none', 'none'],
  };
  const out = serializeTable(data);
  const outLines = out.split('\n');

  assert(outLines.length === 4, `should have 4 lines, got ${outLines.length}`);
  assert(outLines[0].startsWith('|'), 'header should start with pipe');
  assert(outLines[1].includes('---'), 'separator should have dashes');
  assert(outLines[2].includes('1'), 'data row should contain 1');
}

// --- roundtrip ---

function testRoundtrip() {
  const original = [
    '| Name  | Score |',
    '|:------|------:|',
    '| Alice |    95 |',
    '| Bob   |    87 |',
  ].join('\n');

  const src = lines(original);
  const range: TableRange = { startLine: 0, endLine: 3 };
  const t = parseTable(src, range);
  const out = serializeTable(t);

  const reparsed = parseTable(lines(out), { startLine: 0, endLine: out.split('\n').length - 1 });
  assert(reparsed.headers[0] === 'Name', 'roundtrip header preserved');
  assert(reparsed.rows[0][1] === '95', 'roundtrip data preserved');
  assert(reparsed.alignments[0] === 'left', 'roundtrip alignment preserved');
  assert(reparsed.alignments[1] === 'right', 'roundtrip alignment preserved');
}

// --- short rows padded ---

function testShortRows() {
  const src = lines([
    '| A | B | C |',
    '|---|---|---|',
    '| 1 |',
  ].join('\n'));

  const range: TableRange = { startLine: 0, endLine: 2 };
  const t = parseTable(src, range);

  assert(t.rows[0].length === 3, `short row should be padded to 3 cols, got ${t.rows[0].length}`);
  assert(t.rows[0][1] === '', 'padded cell should be empty');
}

// --- pipe escape ---

function testPipeEscape() {
  const src = lines([
    '| A | B |',
    '|---|---|',
    '| hello\\|world | test |',
  ].join('\n'));

  const range: TableRange = { startLine: 0, endLine: 2 };
  const t = parseTable(src, range);

  assert(t.rows[0][0] === 'hello|world', `escaped pipe should be parsed, got "${t.rows[0][0]}"`);
  assert(t.rows[0][1] === 'test', `second cell should be test, got "${t.rows[0][1]}"`);

  const out = serializeTable(t);
  assert(out.includes('hello\\|world'), `serialized should escape pipe, got "${out}"`);

  const reparsed = parseTable(lines(out), { startLine: 0, endLine: out.split('\n').length - 1 });
  assert(reparsed.rows[0][0] === 'hello|world', 'roundtrip pipe preserved');
}

// --- runner ---

let passed = 0;
let failed = 0;

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error('FAIL: ' + msg);
    failed++;
  } else {
    passed++;
  }
}

testFindTable();
testParseTable();
testParseTableJapanese();
testSerialize();
testRoundtrip();
testShortRows();
testPipeEscape();

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
