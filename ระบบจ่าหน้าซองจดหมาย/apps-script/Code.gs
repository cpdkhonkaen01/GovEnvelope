/**
 * Google Apps Script API สำหรับระบบจ่าหน้าซองหนังสือเวียน
 *
 * การตั้งค่าก่อนใช้งาน
 * 1) แก้ SPREADSHEET_ID
 * 2) Services > Add a service > Google Sheets API > Version v4 > Identifier: Sheets
 * 3) Project Settings > Script Properties เพิ่ม WRITE_KEY เป็นรหัสผู้ดูแล
 * 4) Deploy > New deployment > Web app
 * 5) Execute as: Me, Who has access: Anyone
 */
const SPREADSHEET_ID = "1w8u6-05ghH2zpsU8abGiRdaqmcGDBIAaevaaOIQhkvc";
const SHEET_NAME = "Recipients";
const PRINT_JOBS_SHEET_NAME = "PrintJobs";
const WRITE_KEY_PROPERTY = "WRITE_KEY";
const RECIPIENTS_CACHE_KEY = "recipients-v2";
const RECIPIENTS_CACHE_SECONDS = 120;
const CATEGORIES = ["หน่วยงานราชการ", "สหกรณ์และกลุ่มเกษตรกร", "ภาคเอกชน", "บุคคล"];
const RESPONSIBLE_UNITS = ["กสส.1", "กสส.2", "กสส.3", "กสส.4", "กสส.5", "กสส.6", "กสส.7", "กสส.8", "นิคมฯ"];
const COOPERATIVE_TYPES = ["กลุ่มเกษตรกร", "สหกรณ์การเกษตร", "สหกรณ์ออมทรัพย์", "สหกรณ์ประมง", "สหกรณ์ร้านค้า", "สหกรณ์นิคม", "สหกรณ์บริการ", "สหกรณ์เครดิตยูเนี่ยน"];
const REQUIRED_HEADERS = [
  "id", "category", "prefix", "firstName", "lastName", "position",
  "department", "address1", "subdistrict", "district", "province",
  "postalCode", "active", "createdAt", "responsibleUnit", "cooperativeType"
];
const PRINT_JOB_HEADERS = [
  "id", "createdAt", "updatedAt", "completedAt", "envelopePrintedAt",
  "manifestPrintedAt", "recipientCount", "envelopeCount", "status", "dataJson"
];

function doGet(e) {
  const parameters = (e && e.parameter) || {};
  const callback = parameters.callback || parameters.prefix || "";

  try {
    const action = parameters.action || "recipients";
    let payload;

    if (action === "health") {
      payload = {
        ok: true,
        service: "envelope-recipients",
        sheetName: SHEET_NAME,
        readService: "Google Sheets API v4",
        cacheSeconds: RECIPIENTS_CACHE_SECONDS,
        writeEnabled: Boolean(PropertiesService.getScriptProperties().getProperty(WRITE_KEY_PROPERTY))
      };
    } else if (action === "recipients") {
      payload = { ok: true, data: getRecipients() };
    } else if (action === "printJobs") {
      payload = { ok: true, data: getPrintJobs_() };
    } else {
      payload = { ok: false, error: "ไม่รองรับคำสั่ง " + action };
    }

    return createResponse(payload, callback);
  } catch (error) {
    return createResponse({ ok: false, error: error.message }, callback);
  }
}

function doPost(e) {
  try {
    const body = parsePostBody_(e);
    const action = body.action || "createRecipient";
    if (!["createRecipient", "updateRecipient", "deleteRecipient", "savePrintJob", "deletePrintJob"].includes(action)) {
      throw new Error("ไม่รองรับคำสั่งที่ส่งมา");
    }

    verifyWriteKey_(body.adminKey);
    let data;
    if (action === "deleteRecipient") data = deleteRecipient_(body);
    else if (action === "updateRecipient") data = updateRecipient_(body);
    else if (action === "createRecipient") data = appendRecipient_(body);
    else if (action === "savePrintJob") data = savePrintJob_(body.job);
    else data = deletePrintJob_(body.id);
    return createResponse({ ok: true, data: data });
  } catch (error) {
    return createResponse({ ok: false, error: error.message });
  }
}

function parsePostBody_(e) {
  const contents = e && e.postData && e.postData.contents;
  if (!contents) return (e && e.parameter) || {};
  try {
    return JSON.parse(contents);
  } catch (error) {
    return (e && e.parameter) || {};
  }
}

function verifyWriteKey_(providedKey) {
  const configuredKey = PropertiesService.getScriptProperties().getProperty(WRITE_KEY_PROPERTY);
  if (!configuredKey) {
    throw new Error("ยังไม่ได้กำหนด WRITE_KEY ใน Script Properties");
  }
  if (!providedKey || String(providedKey) !== configuredKey) {
    throw new Error("รหัสผู้ดูแลไม่ถูกต้อง");
  }
}

function getSpreadsheet_() {
  if (!SPREADSHEET_ID || SPREADSHEET_ID === "PUT_YOUR_GOOGLE_SHEET_ID_HERE") {
    throw new Error("กรุณากำหนด SPREADSHEET_ID ในไฟล์ Code.gs ก่อน Deploy");
  }
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

function getRecipientsSheet_() {
  const sheet = getSpreadsheet_().getSheetByName(SHEET_NAME);
  if (!sheet) throw new Error("ไม่พบชีตชื่อ " + SHEET_NAME);
  return sheet;
}

function ensureHeaders_(sheet) {
  if (sheet.getLastRow() === 0 || sheet.getLastColumn() === 0) {
    sheet.getRange(1, 1, 1, REQUIRED_HEADERS.length).setValues([REQUIRED_HEADERS]);
  }

  let lastColumn = Math.max(sheet.getLastColumn(), 1);
  let headers = sheet.getRange(1, 1, 1, lastColumn).getDisplayValues()[0]
    .map((header) => String(header).trim());
  const missing = REQUIRED_HEADERS.filter((header) => !headers.includes(header));

  if (missing.length) {
    sheet.getRange(1, headers.length + 1, 1, missing.length).setValues([missing]);
    headers = headers.concat(missing);
  }

  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, headers.length)
    .setFontWeight("bold")
    .setBackground("#2856d9")
    .setFontColor("#ffffff");
  return headers;
}

function getRecipients() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get(RECIPIENTS_CACHE_KEY);
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch (error) {
      cache.remove(RECIPIENTS_CACHE_KEY);
    }
  }

  let values;
  try {
    values = readRecipientsViaSheetsApi_();
  } catch (error) {
    console.warn("Google Sheets API ใช้งานไม่ได้ จึงอ่านด้วย SpreadsheetApp แทน: " + error.message);
    values = readRecipientsViaSpreadsheetApp_();
  }

  const recipients = mapRecipientRows_(values);
  try {
    cache.put(RECIPIENTS_CACHE_KEY, JSON.stringify(recipients), RECIPIENTS_CACHE_SECONDS);
  } catch (error) {
    console.warn("ไม่สามารถเก็บแคชรายชื่อผู้รับได้: " + error.message);
  }
  return recipients;
}

function readRecipientsViaSheetsApi_() {
  const safeSheetName = SHEET_NAME.replace(/'/g, "''");
  const response = Sheets.Spreadsheets.Values.get(
    SPREADSHEET_ID,
    "'" + safeSheetName + "'!A:P",
    {
      majorDimension: "ROWS",
      valueRenderOption: "FORMATTED_VALUE"
    }
  );
  return response.values || [];
}

function readRecipientsViaSpreadsheetApp_() {
  const sheet = getRecipientsSheet_();
  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();
  if (lastRow < 2 || lastColumn < 1) return [];
  return sheet.getRange(1, 1, lastRow, lastColumn).getDisplayValues();
}

function mapRecipientRows_(values) {
  if (!values || values.length < 2) return [];
  const rows = values.slice();
  const headers = rows.shift().map((header) => String(header).trim());
  return rows
    .filter((row) => row.some((cell) => String(cell).trim() !== ""))
    .map((row) => headers.reduce((record, header, index) => {
      if (header) record[header] = String(row[index] || "").trim();
      return record;
    }, {}))
    .filter((record) => !["FALSE", "0", "NO", "N"].includes(
      String(record.active || record["ใช้งาน"] || "TRUE").toUpperCase()
    ));
}

function clearRecipientsCache_() {
  CacheService.getScriptCache().remove(RECIPIENTS_CACHE_KEY);
}

function buildRecipientRecord_(input, createdAt) {
  const category = String(input.category || "").trim();
  const department = String(input.department || "").trim();
  const address1 = String(input.address1 || "").trim();
  const responsibleUnit = String(input.responsibleUnit || "").trim();
  const cooperativeType = String(input.cooperativeType || "").trim();

  if (!CATEGORIES.includes(category)) throw new Error("กรุณาเลือกประเภทผู้รับ");
  if (category === "บุคคล" && !String(input.firstName || "").trim() && !String(input.lastName || "").trim()) {
    throw new Error("ประเภทบุคคลต้องระบุชื่อหรือนามสกุล");
  }
  if (category !== "บุคคล" && !department) throw new Error("กรุณากรอกชื่อหน่วยงาน");
  if (category === "สหกรณ์และกลุ่มเกษตรกร" && !RESPONSIBLE_UNITS.includes(responsibleUnit)) {
    throw new Error("กรุณาเลือก กสส. / นิคมฯ ที่รับผิดชอบ");
  }
  if (cooperativeType && !COOPERATIVE_TYPES.includes(cooperativeType)) {
    throw new Error("ประเภทสหกรณ์ไม่ถูกต้อง");
  }
  if (!address1) throw new Error("กรุณากรอกที่อยู่");

  return {
    id: String(input.id || Utilities.getUuid()).trim(),
    category: category,
    prefix: category === "บุคคล" ? String(input.prefix || "").trim() : "",
    firstName: category === "บุคคล" ? String(input.firstName || "").trim() : "",
    lastName: category === "บุคคล" ? String(input.lastName || "").trim() : "",
    position: String(input.position || "").trim(),
    department: department,
    responsibleUnit: category === "สหกรณ์และกลุ่มเกษตรกร" ? responsibleUnit : "",
    cooperativeType: category === "สหกรณ์และกลุ่มเกษตรกร" ? cooperativeType : "",
    address1: address1,
    subdistrict: String(input.subdistrict || "").trim(),
    district: String(input.district || "").trim(),
    province: String(input.province || "").trim(),
    postalCode: String(input.postalCode || "").trim(),
    active: "TRUE",
    createdAt: createdAt || new Date().toISOString()
  };
}

function appendRecipient_(input) {
  const record = buildRecipientRecord_(input);

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getRecipientsSheet_();
    const headers = ensureHeaders_(sheet);
    const idColumn = headers.indexOf("id") + 1;
    if (idColumn > 0 && sheet.getLastRow() > 1) {
      const duplicate = sheet.getRange(2, idColumn, sheet.getLastRow() - 1, 1)
        .createTextFinder(record.id)
        .matchEntireCell(true)
        .findNext();
      if (duplicate) return record;
    }
    sheet.appendRow(headers.map((header) => record[header] || ""));
    SpreadsheetApp.flush();
    clearRecipientsCache_();
    return record;
  } finally {
    lock.releaseLock();
  }
}

function updateRecipient_(input) {
  const id = String(input.id || "").trim();
  if (!id) throw new Error("ไม่พบรหัสรายการที่ต้องการแก้ไข");

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getRecipientsSheet_();
    const headers = ensureHeaders_(sheet);
    const idColumn = headers.indexOf("id") + 1;
    if (idColumn < 1 || sheet.getLastRow() < 2) throw new Error("ไม่พบรายการผู้รับที่ต้องการแก้ไข");

    const match = sheet.getRange(2, idColumn, sheet.getLastRow() - 1, 1)
      .createTextFinder(id)
      .matchEntireCell(true)
      .findNext();
    if (!match) throw new Error("ไม่พบรายการผู้รับที่ต้องการแก้ไข");

    const rowNumber = match.getRow();
    const rowRange = sheet.getRange(rowNumber, 1, 1, headers.length);
    const existingValues = rowRange.getValues()[0];
    const createdAtIndex = headers.indexOf("createdAt");
    const createdAt = createdAtIndex >= 0 ? existingValues[createdAtIndex] : "";
    const record = buildRecipientRecord_(input, createdAt);
    const updatedValues = headers.map((header, index) => (
      Object.prototype.hasOwnProperty.call(record, header) ? record[header] : existingValues[index]
    ));
    rowRange.setValues([updatedValues]);
    SpreadsheetApp.flush();
    clearRecipientsCache_();
    return record;
  } finally {
    lock.releaseLock();
  }
}

function deleteRecipient_(input) {
  const id = String(input.id || "").trim();
  if (!id) throw new Error("ไม่พบรหัสรายการที่ต้องการลบ");

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getRecipientsSheet_();
    const headers = ensureHeaders_(sheet);
    const idColumn = headers.indexOf("id") + 1;
    if (idColumn < 1 || sheet.getLastRow() < 2) throw new Error("ไม่พบรายการผู้รับที่ต้องการลบ");

    const match = sheet.getRange(2, idColumn, sheet.getLastRow() - 1, 1)
      .createTextFinder(id)
      .matchEntireCell(true)
      .findNext();
    if (!match) throw new Error("ไม่พบรายการผู้รับที่ต้องการลบ");

    sheet.deleteRow(match.getRow());
    SpreadsheetApp.flush();
    clearRecipientsCache_();
    return { id: id, deleted: true };
  } finally {
    lock.releaseLock();
  }
}

function getPrintJobsSheet_() {
  const spreadsheet = getSpreadsheet_();
  const sheet = spreadsheet.getSheetByName(PRINT_JOBS_SHEET_NAME) || spreadsheet.insertSheet(PRINT_JOBS_SHEET_NAME);
  ensurePrintJobHeaders_(sheet);
  return sheet;
}

function ensurePrintJobHeaders_(sheet) {
  if (sheet.getLastRow() === 0 || sheet.getLastColumn() === 0) {
    sheet.getRange(1, 1, 1, PRINT_JOB_HEADERS.length).setValues([PRINT_JOB_HEADERS]);
  } else {
    const currentHeaders = sheet.getRange(1, 1, 1, Math.max(1, sheet.getLastColumn())).getDisplayValues()[0]
      .map((header) => String(header).trim());
    const missing = PRINT_JOB_HEADERS.filter((header) => !currentHeaders.includes(header));
    if (missing.length) {
      sheet.getRange(1, currentHeaders.length + 1, 1, missing.length).setValues([missing]);
    }
  }
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, PRINT_JOB_HEADERS.length)
    .setFontWeight("bold")
    .setBackground("#2856d9")
    .setFontColor("#ffffff");
}

function printJobStatus_(job) {
  if (job.completedAt) return "เสร็จสิ้น";
  if (job.envelopePrintedAt && job.manifestPrintedAt) return "พิมพ์ครบแล้ว";
  if (job.envelopePrintedAt) return "พิมพ์หน้าซองแล้ว";
  if (job.manifestPrintedAt) return "พิมพ์ใบนำส่งแล้ว";
  return "กำลังดำเนินการ";
}

function normalizePrintJob_(input) {
  const job = input && typeof input === "object" ? input : {};
  const id = String(job.id || "").trim();
  if (!id) throw new Error("ไม่พบรหัสชุดงานพิมพ์");
  const recipientIds = Array.isArray(job.recipientIds) ? job.recipientIds.map(String) : [];
  const copiesById = job.copiesById && typeof job.copiesById === "object" ? job.copiesById : {};
  const envelopeCount = recipientIds.reduce((total, recipientId) => {
    const copies = Math.max(1, Math.min(20, Number(copiesById[recipientId]) || 1));
    return total + copies;
  }, 0);
  const now = new Date().toISOString();
  const normalized = Object.assign({}, job, {
    id: id,
    createdAt: String(job.createdAt || now),
    updatedAt: String(job.updatedAt || now),
    recipientIds: recipientIds,
    copiesById: copiesById
  });
  return {
    job: normalized,
    row: [
      id,
      normalized.createdAt,
      normalized.updatedAt,
      String(normalized.completedAt || ""),
      String(normalized.envelopePrintedAt || ""),
      String(normalized.manifestPrintedAt || ""),
      recipientIds.length,
      envelopeCount,
      printJobStatus_(normalized),
      JSON.stringify(normalized)
    ]
  };
}

function getPrintJobs_() {
  const sheet = getPrintJobsSheet_();
  if (sheet.getLastRow() < 2) return [];
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
  const jsonColumn = headers.indexOf("dataJson");
  if (jsonColumn < 0) return [];
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getDisplayValues()
    .map((row) => {
      try {
        return JSON.parse(row[jsonColumn] || "{}");
      } catch (error) {
        return null;
      }
    })
    .filter((job) => job && job.id)
    .sort((first, second) => String(second.updatedAt || "").localeCompare(String(first.updatedAt || "")))
    .slice(0, 100);
}

function savePrintJob_(input) {
  const normalized = normalizePrintJob_(input);
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getPrintJobsSheet_();
    const idColumn = PRINT_JOB_HEADERS.indexOf("id") + 1;
    const lastRow = sheet.getLastRow();
    const match = lastRow > 1
      ? sheet.getRange(2, idColumn, lastRow - 1, 1).createTextFinder(normalized.job.id).matchEntireCell(true).findNext()
      : null;
    if (match) sheet.getRange(match.getRow(), 1, 1, PRINT_JOB_HEADERS.length).setValues([normalized.row]);
    else sheet.appendRow(normalized.row);
    SpreadsheetApp.flush();
    return normalized.job;
  } finally {
    lock.releaseLock();
  }
}

function deletePrintJob_(idValue) {
  const id = String(idValue || "").trim();
  if (!id) throw new Error("ไม่พบรหัสชุดงานพิมพ์");
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getPrintJobsSheet_();
    if (sheet.getLastRow() < 2) return { id: id, deleted: true };
    const idColumn = PRINT_JOB_HEADERS.indexOf("id") + 1;
    const match = sheet.getRange(2, idColumn, sheet.getLastRow() - 1, 1)
      .createTextFinder(id)
      .matchEntireCell(true)
      .findNext();
    if (match) sheet.deleteRow(match.getRow());
    SpreadsheetApp.flush();
    return { id: id, deleted: true };
  } finally {
    lock.releaseLock();
  }
}

function setupPrintJobsSheet() {
  const sheet = getPrintJobsSheet_();
  sheet.autoResizeColumns(1, PRINT_JOB_HEADERS.length);
  SpreadsheetApp.flush();
  return PRINT_JOBS_SHEET_NAME;
}

function createResponse(data, callback) {
  const json = JSON.stringify(data);
  if (callback) {
    if (!/^[A-Za-z_$][0-9A-Za-z_$]*$/.test(callback)) {
      return ContentService
        .createTextOutput(JSON.stringify({ ok: false, error: "ชื่อ callback ไม่ถูกต้อง" }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    return ContentService
      .createTextOutput(callback + "(" + json + ");")
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}

// เรียกใช้ครั้งแรกเพื่อสร้างหัวตารางและข้อมูลตัวอย่าง
function setupRecipientsSheet() {
  const spreadsheet = getSpreadsheet_();
  const sheet = spreadsheet.getSheetByName(SHEET_NAME) || spreadsheet.insertSheet(SHEET_NAME);
  const headers = ensureHeaders_(sheet);
  if (sheet.getLastRow() < 2) {
    const sample = {
      id: "KK001", category: "สหกรณ์และกลุ่มเกษตรกร", prefix: "นาย", firstName: "สมชาย",
      lastName: "ใจดี", position: "ประธานกรรมการ",
      department: "สหกรณ์การเกษตรตัวอย่าง จำกัด", address1: "99 หมู่ 1",
      subdistrict: "ในเมือง", district: "เมืองขอนแก่น", province: "ขอนแก่น",
      postalCode: "40000", active: "TRUE", createdAt: new Date().toISOString(),
      responsibleUnit: "กสส.1", cooperativeType: "สหกรณ์การเกษตร"
    };
    sheet.appendRow(headers.map((header) => sample[header] || ""));
  }
  sheet.autoResizeColumns(1, headers.length);
  SpreadsheetApp.flush();
  clearRecipientsCache_();
}
