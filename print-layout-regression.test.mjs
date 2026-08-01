import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appSource = await readFile(new URL("../assets/app.js", import.meta.url), "utf8");
const htmlSource = await readFile(new URL("../index.source.html", import.meta.url), "utf8");
const cssSource = await readFile(new URL("../assets/styles.css", import.meta.url), "utf8");

function extractFunction(name, nextMarker) {
  const start = appSource.indexOf(`function ${name}(`);
  const end = appSource.indexOf(nextMarker, start);
  assert.notEqual(start, -1, `ไม่พบฟังก์ชัน ${name}`);
  assert.notEqual(end, -1, `ไม่พบจุดสิ้นสุดของฟังก์ชัน ${name}`);
  const source = appSource.slice(start, end).trim();
  return new Function(`${source}; return ${name};`)();
}

test("มีขนาดพิมพ์ DL, C5 และ A4 แนวนอนครบ", () => {
  for (const value of ["DL", "C5", "A4L"]) {
    assert.match(htmlSource, new RegExp(`<option value="${value}">`));
  }
});

test("ชื่อผู้รับสั้นและชื่อยาวกว่า 80 ตัวอักษรใช้กฎฟอนต์หน้าพิมพ์", () => {
  const fontStyle = extractFunction("manifestRecipientFontStyle", "function paginateManifestRows");
  assert.equal(fontStyle("ชื่อผู้รับสั้น"), "");
  assert.match(fontStyle("ก".repeat(81)), /font-size:9pt/);
});

test("ใบนำส่งแบ่งหน้า 30 แถวสำหรับ 1, 29, 30 และ 31 รายการ", () => {
  const paginate = extractFunction("paginateManifestRows", "window.__ENVELOPE_PRINT_TEST__");
  const expected = new Map([
    [1, [1]],
    [29, [29]],
    [30, [30]],
    [31, [30, 1]],
  ]);
  for (const [count, pageLengths] of expected) {
    const rows = Array.from({ length: count }, (_, index) => index + 1);
    assert.deepEqual(paginate(rows, 30).map((page) => page.length), pageLengths);
  }
});

test("ชุดทดสอบมีที่อยู่ 3–5 บรรทัดและตัวเลือกการแสดงผลครบ", () => {
  assert.match(appSource, /addressLines:[\s\S]*?192 หมู่ 1[\s\S]*?40000/);
  for (const setting of ["showGaruda", "showSender", "showPostagePermit"]) {
    assert.match(appSource, new RegExp(`"${setting}"`));
    assert.match(appSource, new RegExp(`state\\.settings\\.${setting}`));
  }
});

test("รายชื่อบนจอเล็กเปลี่ยนเป็นการ์ดและไม่บังคับความกว้าง 1,390px", () => {
  assert.match(cssSource, /@media\(max-width:1100px\)/);
  assert.match(cssSource, /\.recipient-table\{display:block;width:100%;min-width:0/);
  assert.match(cssSource, /\.recipient-table tbody tr\{display:grid/);
  assert.match(cssSource, /\.recipient-table \.address-cell\{display:none\}/);
});

test("สถานะค่าเริ่มต้นส่วนกลางแจ้งทั้งสำเร็จและใช้ค่าในเครื่อง", () => {
  assert.match(htmlSource, /id="centralDefaultsStatus"/);
  assert.match(appSource, /ใช้ค่าเริ่มต้นส่วนกลาง อัปเดตโดยผู้ดูแลเมื่อ/);
  assert.match(appSource, /ใช้ค่าที่บันทึกไว้ในเครื่องนี้/);
});

test("ใบนำส่งแสดงเลขนำหน้ารายแถวและเลือกแก้เองได้", () => {
  assert.match(appSource, /class=\"tracking-prefix-mode\"/);
  assert.match(appSource, />ค่าหลัก<\/option>/);
  assert.match(appSource, />แก้เอง<\/option>/);
  assert.match(appSource, /class=\"row-prefix-input/);
  assert.match(appSource, /class=\"tracking-country-suffix\">TH/);
  assert.match(appSource, /function savedManifestRowPrefix/);
  assert.doesNotMatch(cssSource, /content:"ปิดใช้งาน"/);
  assert.match(appSource, /other\.value = ""/);
  assert.match(appSource, /input\.disabled = false/);
});

test("ดาวน์โหลด PDF ใบนำส่งจากหน้ากรอกข้อมูลปัจจุบันได้", () => {
  assert.match(htmlSource, /id="downloadCurrentManifestPdf"/);
  assert.match(appSource, /async function downloadCurrentManifestPdf/);
  assert.match(appSource, /buildHistoryManifestPdf\(job\)/);
  assert.match(appSource, /saveHtmlAsPdf\(documentData\.container/);
});

test("ปุ่มจัดการชุดงานเรียงเป็นตารางสองคอลัมน์และประวัติเต็มแถว", () => {
  assert.match(cssSource, /\.hero-actions\{display:grid;max-width:650px;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(cssSource, /\.hero-actions \.history-button\{grid-column:1\/-1\}/);
  assert.ok(htmlSource.indexOf('id="heroPrint"') < htmlSource.indexOf('id="clearPrintJob"'));
});

test("ตัวกรองและรายการประวัติใช้รูปแบบกะทัดรัดแถวเดียว", () => {
  assert.match(cssSource, /\.history-filter-grid input,.history-filter-grid select\{height:38px/);
  assert.match(cssSource, /\.print-history-table td\{height:52px/);
  assert.match(cssSource, /\.print-history-table \.history-actions\{display:flex;flex-wrap:nowrap/);
  assert.doesNotMatch(appSource, /<small>แก้ไขล่าสุด/);
});

test("กรอกเลข 4 ตัวครบแล้วเลื่อนไปช่อง 4 ตัวท้ายของแถวถัดไป", () => {
  assert.match(appSource, /querySelectorAll\(`\.tracking-input\[data-tracking-type="\$\{type\}"\]`\)/);
  assert.match(appSource, /const next = inputs\[inputs\.indexOf\(input\) \+ 1\]/);
});

test("ลำดับผู้รับยึดตามลำดับที่เลือกทั้งในตารางและหน้าพิมพ์", () => {
  assert.match(appSource, /function selectedRecipients\(\)[\s\S]*?return \[\.\.\.state\.selected\]/);
  assert.match(appSource, /function recipientSelectionOrder\(id\)/);
  assert.match(appSource, /class="selection-order-badge"[\s\S]*?ลำดับที่ \$\{selectionOrder\}/);
  assert.match(appSource, /function selectedEnvelopeJobs\(\)[\s\S]*?return selectedRecipients\(\)/);
  assert.match(cssSource, /\.selection-order-badge\{/);
});
