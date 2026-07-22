const CATEGORIES = ["หน่วยงานราชการ", "สหกรณ์และกลุ่มเกษตรกร", "ภาคเอกชน", "บุคคล"];
const defaults = window.ENVELOPE_APP_CONFIG || {};
const supabaseClient = window.supabase?.createClient(
  defaults.supabaseUrl || "",
  defaults.supabasePublishableKey || "",
  { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
);

let savedSettings = {};
try {
  savedSettings = JSON.parse(localStorage.getItem("envelope-app-settings") || "{}");
} catch (error) {
  console.warn("ไม่สามารถอ่านค่าที่บันทึกไว้ได้", error);
}

const GARUDA_STANDARD_VERSION = "15mm-v1";
const POSTAGE_PERMIT_WIDTH_MM = 30;
const POSTAGE_PERMIT_HEIGHT_MM = 15;
const LOCKED_MANIFEST_PERMIT = "ใบอนุญาตเลขที่ 3/2521 ไปรษณีย์เทพารักษ์";
const PRINT_FONT_FILE = "assets/fonts/THSarabunNew.ttf";
const PRINT_HISTORY_STORAGE_KEY = "envelope-print-history-v1";
const CURRENT_PRINT_JOB_STORAGE_KEY = "envelope-current-print-job-v1";
const PASSWORD_SETUP_PENDING_KEY = "envelope-password-setup-pending";
let savedPrintJobs = [];
try {
  const parsedPrintJobs = JSON.parse(localStorage.getItem(PRINT_HISTORY_STORAGE_KEY) || "[]");
  savedPrintJobs = Array.isArray(parsedPrintJobs) ? parsedPrintJobs : [];
} catch (error) {
  console.warn("ไม่สามารถอ่านประวัติชุดงานพิมพ์ได้", error);
}
const RECIPIENT_BLOCK_WIDTH_PERCENT = 68;
const savedGarudaSize = savedSettings.garudaStandardVersion === GARUDA_STANDARD_VERSION
  ? savedSettings.garudaSizeMm
  : defaults.garudaSizeMm;
const PAPER_SIZE_KEYS = ["DL", "C5", "A4L"];
const LAYOUT_SETTING_KEYS = [
  "garudaPlacement", "garudaSizeMm", "senderTopMm", "senderLeftMm", "senderTextOffsetMm", "senderFontPt", "senderLineHeight",
  "recipientFontPt", "recipientTopPercent", "recipientLeftPercent", "recipientLineHeight",
  "postagePermitTopMm", "postagePermitRightMm", "postagePermitFontPt", "postagePermitLineHeight",
];
const initialPaperSize = PAPER_SIZE_KEYS.includes(savedSettings.paperSize)
  ? savedSettings.paperSize
  : (PAPER_SIZE_KEYS.includes(defaults.paperSize) ? defaults.paperSize : "DL");

function normalizeLayoutProfile(source = {}, paperSize = initialPaperSize) {
  const profileDefaults = defaults.paperLayouts?.[paperSize] || {};
  const read = (key) => source[key] ?? profileDefaults[key] ?? defaults[key];
  return {
    garudaPlacement: read("garudaPlacement") === "above" ? "above" : "left",
    garudaSizeMm: clampNumber(read("garudaSizeMm"), 8, 30, 15),
    senderTopMm: clampNumber(read("senderTopMm"), 0, 40, 6),
    senderLeftMm: clampNumber(read("senderLeftMm"), 0, 60, 14),
    senderTextOffsetMm: clampNumber(read("senderTextOffsetMm"), 0, 30, 10),
    senderFontPt: clampNumber(read("senderFontPt"), 7, 20, 9.5),
    senderLineHeight: clampNumber(read("senderLineHeight"), 1, 2.2, 1.45),
    recipientFontPt: clampNumber(read("recipientFontPt"), 8, 24, 12),
    recipientTopPercent: clampNumber(read("recipientTopPercent"), 5, 85, 40),
    recipientLeftPercent: clampNumber(read("recipientLeftPercent"), 5, 80, 42),
    recipientLineHeight: clampNumber(read("recipientLineHeight"), 1, 2.2, 1.5),
    postagePermitTopMm: clampNumber(read("postagePermitTopMm"), 0, 40, 7),
    postagePermitRightMm: clampNumber(read("postagePermitRightMm"), 0, 60, 8),
    postagePermitFontPt: clampNumber(read("postagePermitFontPt"), 6, 14, 8.5),
    postagePermitLineHeight: clampNumber(read("postagePermitLineHeight"), 1, 2, 1.15),
  };
}

const savedPaperLayouts = savedSettings.paperLayouts && typeof savedSettings.paperLayouts === "object"
  ? savedSettings.paperLayouts
  : {};
const legacyLayoutSource = { ...savedSettings, garudaSizeMm: savedGarudaSize };
const initialPaperLayouts = Object.fromEntries(PAPER_SIZE_KEYS.map((paperSize) => {
  const paperDefaults = defaults.paperLayouts?.[paperSize] || {};
  const source = savedPaperLayouts[paperSize]
    ? { ...paperDefaults, ...savedPaperLayouts[paperSize] }
    : (paperSize === initialPaperSize ? { ...paperDefaults, ...legacyLayoutSource } : paperDefaults);
  return [paperSize, normalizeLayoutProfile(source, paperSize)];
}));
const initialLayout = initialPaperLayouts[initialPaperSize];

function resolveAssetUrl(value) {
  if (!value) return "";
  try {
    return new URL(value, document.baseURI).href;
  } catch (error) {
    console.warn("ไม่สามารถอ่านที่อยู่ไฟล์รูปภาพได้", error);
    return value;
  }
}

const state = {
  recipients: [],
  selected: new Set(),
  query: "",
  category: "ทั้งหมด",
  responsibleUnit: "ทั้งหมด",
  cooperativeType: "ทั้งหมด",
  connected: false,
  editingRecipientId: null,
  previewRecipientIndex: 0,
  printJobs: savedPrintJobs,
  currentPrintJobId: localStorage.getItem(CURRENT_PRINT_JOB_STORAGE_KEY) || "",
  adminSession: null,
  historyFilters: { group: "", month: "", date: "" },
  settings: {
    supabaseUrl: defaults.supabaseUrl || "",
    supabaseAdminEmail: String(defaults.supabaseAdminEmail || "").toLowerCase(),
    supabaseRedirectUrl: defaults.supabaseRedirectUrl || "",
    printJobCreator: savedSettings.printJobCreator || "",
    sender: savedSettings.sender || defaults.sender || "สำนักงานสหกรณ์จังหวัดขอนแก่น",
    senderAddress: savedSettings.senderAddress || defaults.senderAddress || "เลขที่ 1/112 หมู่ที่ 13 ถนนหน้าเมือง ตำบลในเมือง\nอำเภอเมือง จังหวัดขอนแก่น 40000",
    documentNumber: savedSettings.documentNumber ?? defaults.documentNumber ?? "",
    paperSize: initialPaperSize,
    envelopeCopiesById: {},
    recipientNameBreaksById: savedSettings.recipientNameBreaksById && typeof savedSettings.recipientNameBreaksById === "object"
      ? { ...savedSettings.recipientNameBreaksById }
      : {},
    manifestRegisteredPrefix: normalizeManifestPrefix(savedSettings.manifestRegisteredPrefix || "", "RJ"),
    manifestEmsPrefix: normalizeManifestPrefix(savedSettings.manifestEmsPrefix || "", "EQ"),
    paperLayouts: initialPaperLayouts,
    garudaImage: resolveAssetUrl(defaults.garudaImage),
    showRecipientDepartment: savedSettings.showRecipientDepartment !== undefined ? Boolean(savedSettings.showRecipientDepartment) : defaults.showRecipientDepartment !== false,
    showRecipientAddress: savedSettings.showRecipientAddress !== undefined ? Boolean(savedSettings.showRecipientAddress) : defaults.showRecipientAddress !== false,
    showSender: savedSettings.showSender !== undefined ? Boolean(savedSettings.showSender) : defaults.showSender !== false,
    showGaruda: savedSettings.showGaruda !== undefined ? Boolean(savedSettings.showGaruda) : defaults.showGaruda !== false,
    showPostagePermit: savedSettings.showPostagePermit !== undefined ? Boolean(savedSettings.showPostagePermit) : defaults.showPostagePermit !== false,
    garudaPlacement: initialLayout.garudaPlacement,
    garudaSizeMm: initialLayout.garudaSizeMm,
    garudaStandardVersion: GARUDA_STANDARD_VERSION,
    senderTopMm: initialLayout.senderTopMm,
    senderLeftMm: initialLayout.senderLeftMm,
    senderTextOffsetMm: initialLayout.senderTextOffsetMm,
    senderFontPt: initialLayout.senderFontPt,
    senderLineHeight: initialLayout.senderLineHeight,
    recipientFontPt: initialLayout.recipientFontPt,
    recipientTopPercent: initialLayout.recipientTopPercent,
    recipientLeftPercent: initialLayout.recipientLeftPercent,
    recipientLineHeight: initialLayout.recipientLineHeight,
    postagePermitText: savedSettings.postagePermitText || defaults.postagePermitText || "ชำระค่าฝากส่งเป็นรายเดือน\nใบอนุญาตเลขที่ xx/xxx\nไปรษณีย์เดชาวุธ",
    postagePermitTopMm: initialLayout.postagePermitTopMm,
    postagePermitRightMm: initialLayout.postagePermitRightMm,
    postagePermitFontPt: initialLayout.postagePermitFontPt,
    postagePermitLineHeight: initialLayout.postagePermitLineHeight,
  },
};

const $ = (selector) => document.querySelector(selector);
function setGroupDisabled(container, disabled) {
  if (!container) return;
  container.querySelectorAll("input, select, textarea").forEach((control) => {
    control.disabled = disabled;
  });
}

const elements = {
  rows: $("#recipientRows"),
  downloadRecipientsCsv: $("#downloadRecipientsCsv"),
  search: $("#searchInput"),
  category: $("#categoryFilter"),
  responsibleUnit: $("#responsibleUnitFilter"),
  responsibleUnitWrap: $("#responsibleUnitFilterWrap"),
  cooperativeType: $("#cooperativeTypeFilter"),
  cooperativeTypeWrap: $("#cooperativeTypeFilterWrap"),
  selectAll: $("#selectAll"),
  heroSelected: $("#heroSelected"),
  sideSelected: $("#sideSelected"),
  notice: $("#noticeText"),
  status: $("#connectionStatus"),
  empty: $("#emptyState"),
  paper: $("#paperSize"),
  recipientFont: $("#recipientFontPt"),
  previewPrevious: $("#previewPrevious"),
  previewNext: $("#previewNext"),
  previewCounter: $("#previewCounter"),
  openRecipientLineBreak: $("#openRecipientLineBreak"),
  showRecipientDepartment: $("#showRecipientDepartment"),
  showRecipientAddress: $("#showRecipientAddress"),
  showSender: $("#showSender"),
  showGaruda: $("#showGaruda"),
  showPostagePermit: $("#showPostagePermit"),
  recipientDialog: $("#recipientDialog"),
  recipientForm: $("#recipientForm"),
  recipientFormMessage: $("#recipientFormMessage"),
  saveRecipient: $("#saveRecipient"),
  deleteRecipientButton: $("#deleteRecipientButton"),
  deleteRecipientDialog: $("#deleteRecipientDialog"),
  deleteRecipientForm: $("#deleteRecipientForm"),
  deleteRecipientName: $("#deleteRecipientName"),
  deleteRecipientPassword: $("#deleteRecipientPassword"),
  deleteRecipientMessage: $("#deleteRecipientMessage"),
  confirmDeleteRecipient: $("#confirmDeleteRecipient"),
  recipientLayoutDialog: $("#recipientLayoutDialog"),
  recipientLayoutForm: $("#recipientLayoutForm"),
  recipientLineBreakDialog: $("#recipientLineBreakDialog"),
  recipientLineBreakForm: $("#recipientLineBreakForm"),
  recipientLineBreakText: $("#recipientLineBreakText"),
  recipientLineBreakMessage: $("#recipientLineBreakMessage"),
  senderDialog: $("#senderDialog"),
  senderForm: $("#senderForm"),
  postagePermitDialog: $("#postagePermitDialog"),
  postagePermitForm: $("#postagePermitForm"),
  mailingManifestDialog: $("#mailingManifestDialog"),
  mailingManifestForm: $("#mailingManifestForm"),
  manifestRows: $("#manifestRows"),
  manifestDate: $("#manifestDate"),
  manifestPermit: $("#manifestPermit"),
  manifestRegisteredPrefix: $("#manifestRegisteredPrefix"),
  manifestEmsPrefix: $("#manifestEmsPrefix"),
  printHistoryDialog: $("#printHistoryDialog"),
  printHistoryList: $("#printHistoryList"),
  historyGroupFilter: $("#historyGroupFilter"),
  historyMonthFilter: $("#historyMonthFilter"),
  historyDateFilter: $("#historyDateFilter"),
  historyJobTotal: $("#historyJobTotal"),
  historyRecipientTotal: $("#historyRecipientTotal"),
  historyEnvelopeTotal: $("#historyEnvelopeTotal"),
  historyResultLabel: $("#historyResultLabel"),
  historySaveStatus: $("#historySaveStatus"),
  historySyncHint: $("#historySyncHint"),
  printJobCreator: $("#printJobCreator"),
  loginScreen: $("#loginScreen"),
  loginGateForm: $("#loginGateForm"),
  loginGatePassword: $("#loginGatePassword"),
  loginGateMessage: $("#loginGateMessage"),
  loginGateButton: $("#loginGateButton"),
  adminAuthButton: $("#adminAuthButton"),
  adminAuthDialog: $("#adminAuthDialog"),
  adminAuthForm: $("#adminAuthForm"),
  adminAuthPassword: $("#adminAuthPassword"),
  adminAuthMessage: $("#adminAuthMessage"),
};

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function recipientEnvelopeCopies(id) {
  return Math.floor(clampNumber(state.settings.envelopeCopiesById?.[id], 1, 20, 1));
}

function setRecipientEnvelopeCopies(id, value) {
  if (!id) return 1;
  const copies = Math.floor(clampNumber(value, 1, 20, 1));
  state.settings.envelopeCopiesById[id] = copies;
  return copies;
}

function syncEnvelopeCopyInputs() {
  document.querySelectorAll("[data-copy-id]").forEach((input) => {
    input.value = setRecipientEnvelopeCopies(input.dataset.copyId, input.value);
  });
}

function selectedEnvelopeJobs() {
  syncEnvelopeCopyInputs();
  return state.recipients
    .filter((item) => state.selected.has(item.id))
    .flatMap((item) => Array.from({ length: recipientEnvelopeCopies(item.id) }, (_, copyIndex) => ({ item, copyIndex })));
}

function printJobTrackingKey(recipientId, copyIndex = 0) {
  return `${recipientId}::${copyIndex}`;
}

function persistPrintHistory() {
  state.printJobs = state.printJobs
    .filter((job) => job && job.id)
    .sort((first, second) => String(second.updatedAt || "").localeCompare(String(first.updatedAt || "")))
    .slice(0, 100);
  localStorage.setItem(PRINT_HISTORY_STORAGE_KEY, JSON.stringify(state.printJobs));
  if (state.currentPrintJobId) localStorage.setItem(CURRENT_PRINT_JOB_STORAGE_KEY, state.currentPrintJobId);
  else localStorage.removeItem(CURRENT_PRINT_JOB_STORAGE_KEY);
}

function currentPrintJob() {
  return state.printJobs.find((job) => job.id === state.currentPrintJobId) || null;
}

function collectManifestTracking() {
  const tracking = {};
  if (elements.manifestRows?.dataset.printJobId !== state.currentPrintJobId) return tracking;
  elements.manifestRows?.querySelectorAll("tr[data-job-key]").forEach((row) => {
    const registered = fullManifestTrackingValue(row.querySelector('[name^="registered-"]'));
    const ems = fullManifestTrackingValue(row.querySelector('[name^="ems-"]'));
    if (registered || ems) tracking[row.dataset.jobKey] = { registered, ems };
  });
  return tracking;
}

function selectedRecipientSnapshots() {
  return state.recipients
    .filter((item) => state.selected.has(item.id))
    .map((item) => ({
      id: item.id,
      name: recipientName(item),
      category: item.category || "",
      prefix: item.prefix || "",
      firstName: item.firstName || "",
      lastName: item.lastName || "",
      position: item.position || "",
      department: item.department || "",
      responsibleUnit: item.responsibleUnit || "",
      cooperativeType: item.cooperativeType || "",
      address1: item.address1 || "",
      subdistrict: item.subdistrict || "",
      district: item.district || "",
      province: item.province || "",
      postalCode: item.postalCode || "",
    }));
}

function createPrintJob() {
  const now = new Date().toISOString();
  const id = `PRINT-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
  const job = {
    id,
    createdAt: now,
    updatedAt: now,
    completedAt: "",
    envelopePrintedAt: "",
    manifestPrintedAt: "",
    manifestDate: localIsoDate(),
    creatorGroup: state.settings.printJobCreator || "",
    paperSize: state.settings.paperSize,
    recipientIds: [],
    recipients: [],
    copiesById: {},
    tracking: {},
  };
  state.currentPrintJobId = id;
  state.printJobs.unshift(job);
  return job;
}

function saveCurrentPrintJobDraft(changes = {}, options = {}) {
  const selectedItems = state.recipients.filter((item) => state.selected.has(item.id));
  let job = currentPrintJob();
  if (job?.completedAt) job = null;
  if (!job && !selectedItems.length && !options.force) return null;
  if (!job) job = createPrintJob();

  const previousTracking = job.tracking && typeof job.tracking === "object" ? job.tracking : {};
  const visibleTracking = collectManifestTracking();
  const now = new Date().toISOString();
  Object.assign(job, {
    updatedAt: now,
    paperSize: state.settings.paperSize,
    recipientIds: selectedItems.map((item) => item.id),
    recipients: selectedRecipientSnapshots(),
    copiesById: Object.fromEntries(selectedItems.map((item) => [item.id, recipientEnvelopeCopies(item.id)])),
    tracking: { ...previousTracking, ...visibleTracking },
    manifestDate: elements.manifestDate?.value || job.manifestDate || localIsoDate(),
    creatorGroup: state.settings.printJobCreator || job.creatorGroup || "",
  }, changes);
  state.printJobs = [job, ...state.printJobs.filter((item) => item.id !== job.id)];
  persistPrintHistory();
  if (elements.historySaveStatus) elements.historySaveStatus.textContent = isAdminSignedIn()
    ? "กำลังบันทึกลง Supabase อัตโนมัติ…"
    : "บันทึกไว้ในเครื่องแล้ว · เข้าสู่ระบบเพื่อสำรองลง Supabase";
  queuePrintJobCloudSave(job);
  return job;
}

function printJobStatus(job) {
  if (job.completedAt) return { label: "เสร็จสิ้น", className: "done" };
  if (job.envelopePrintedAt && job.manifestPrintedAt) return { label: "พิมพ์ครบแล้ว", className: "printed" };
  if (job.envelopePrintedAt) return { label: "พิมพ์หน้าซองแล้ว", className: "printed" };
  if (job.manifestPrintedAt) return { label: "พิมพ์ใบนำส่งแล้ว", className: "printed" };
  return { label: "กำลังดำเนินการ", className: "" };
}

function formatPrintJobDate(value) {
  const date = new Date(value || Date.now());
  return new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function printJobLocalDateKey(value) {
  const date = new Date(value || Date.now());
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function printJobCounts(job) {
  const recipientCount = Array.isArray(job.recipientIds) && job.recipientIds.length
    ? job.recipientIds.length
    : (Array.isArray(job.recipients) ? job.recipients.length : 0);
  const envelopeCount = Object.values(job.copiesById || {}).reduce((sum, value) => sum + Number(value || 0), 0);
  return { recipientCount, envelopeCount };
}

function syncHistoryGroupOptions() {
  if (!elements.historyGroupFilter) return;
  const selected = state.historyFilters.group;
  const groups = [...new Set([
    ...Array.from(elements.printJobCreator?.options || []).map((option) => option.value),
    ...state.printJobs.map((job) => job.creatorGroup || ""),
  ].filter(Boolean))];
  elements.historyGroupFilter.innerHTML = '<option value="">ทุกกลุ่มงาน</option>'
    + groups.map((group) => `<option value="${escapeHtml(group)}">${escapeHtml(group)}</option>`).join("");
  elements.historyGroupFilter.value = groups.includes(selected) ? selected : "";
  state.historyFilters.group = elements.historyGroupFilter.value;
}

function setPrintJobCreatorVisible(visible, options = {}) {
  const wrapper = elements.printJobCreator?.closest(".job-creator-control");
  if (!wrapper) return;
  wrapper.classList.toggle("is-hidden", !visible);
  wrapper.classList.toggle("is-active", visible && Boolean(options.active));
}

function focusPrintJobCreator() {
  setPrintJobCreatorVisible(true, { active: true });
  elements.printJobCreator?.scrollIntoView({ behavior: "smooth", block: "center" });
  window.setTimeout(() => elements.printJobCreator?.focus(), 180);
}

function filteredPrintJobs() {
  const { group, month, date } = state.historyFilters;
  return [...state.printJobs]
    .filter((job) => {
      const dateKey = printJobLocalDateKey(job.createdAt || job.updatedAt);
      if (group && job.creatorGroup !== group) return false;
      if (date && dateKey !== date) return false;
      if (!date && month && !dateKey.startsWith(month)) return false;
      return true;
    })
    .sort((a, b) => String(b.createdAt || b.updatedAt || "").localeCompare(String(a.createdAt || a.updatedAt || "")));
}

function historyTrackingSummary(job) {
  const codes = Object.values(job.tracking || {}).filter(Boolean);
  const registered = codes.map((item) => item.registered).filter(Boolean);
  const ems = codes.map((item) => item.ems).filter(Boolean);
  if (!registered.length && !ems.length) return '<span class="history-muted">ยังไม่มีเลขลงทะเบียน/EMS</span>';
  return `<div class="history-tracking-list">
    ${registered.length ? `<span><b>ลงทะเบียน:</b> ${registered.map((code) => escapeHtml(formatTrackingCode(code, "RJ"))).join(", ")}</span>` : ""}
    ${ems.length ? `<span><b>EMS:</b> ${ems.map((code) => escapeHtml(formatTrackingCode(code, "EQ"))).join(", ")}</span>` : ""}
  </div>`;
}

function historyRecipientDetails(job) {
  const recipients = Array.isArray(job.recipients) ? job.recipients : [];
  if (!recipients.length) return '<span class="history-muted">ไม่มีรายละเอียดรายชื่อ</span>';
  return `<ol class="history-recipient-list">${recipients.map((recipient) => {
    const copies = Math.max(1, Number(job.copiesById?.[recipient.id] || 1));
    const sub = [recipient.department, recipient.postalCode].filter(Boolean).join(" · ");
    return `<li><strong>${escapeHtml(recipient.name || "ไม่ระบุชื่อ")}</strong>${sub ? `<small>${escapeHtml(sub)}</small>` : ""}<em>${copies} ซอง</em></li>`;
  }).join("")}</ol>`;
}

function printJobRecipientEntries(job) {
  const snapshots = new Map((job.recipients || []).map((recipient) => [recipient.id, recipient]));
  const ids = Array.isArray(job.recipientIds) && job.recipientIds.length
    ? job.recipientIds
    : [...snapshots.keys()];
  return ids.flatMap((id) => {
    const snapshot = snapshots.get(id) || {};
    const item = state.recipients.find((recipient) => recipient.id === id) || {
      id,
      category: snapshot.category || "",
      prefix: snapshot.prefix || "",
      firstName: snapshot.firstName || "",
      lastName: snapshot.lastName || "",
      position: snapshot.position || snapshot.name || "ไม่ระบุชื่อผู้รับ",
      department: snapshot.department || "",
      responsibleUnit: snapshot.responsibleUnit || "",
      cooperativeType: snapshot.cooperativeType || "",
      address1: snapshot.address1 || "",
      subdistrict: snapshot.subdistrict || "",
      district: snapshot.district || "",
      province: snapshot.province || "",
      postalCode: snapshot.postalCode || "",
    };
    const copies = Math.max(1, Number(job.copiesById?.[id] || 1));
    return Array.from({ length: copies }, (_, copyIndex) => ({ item, copyIndex }));
  });
}

function safePdfFilename(value = "เอกสาร") {
  return String(value).replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, "-").slice(0, 100);
}

async function waitForPdfAssets(container) {
  if (document.fonts?.ready) await document.fonts.ready;
  await Promise.all([...container.querySelectorAll("img")].map((image) => {
    if (image.complete) return Promise.resolve();
    return new Promise((resolve) => {
      image.addEventListener("load", resolve, { once: true });
      image.addEventListener("error", resolve, { once: true });
    });
  }));
}

async function saveHtmlAsPdf(container, filename, format, orientation) {
  if (typeof window.html2pdf !== "function") throw new Error("โหลดระบบสร้าง PDF ไม่สำเร็จ กรุณาตรวจสอบอินเทอร์เน็ตแล้วรีเฟรชหน้าเว็บ");
  container.style.position = "fixed";
  container.style.left = "-10000px";
  container.style.top = "0";
  container.style.zIndex = "-1";
  document.body.appendChild(container);
  try {
    await waitForPdfAssets(container);
    await window.html2pdf().set({
      margin: 0,
      filename,
      image: { type: "jpeg", quality: 0.98 },
      html2canvas: { scale: 1.6, useCORS: true, allowTaint: false, backgroundColor: "#ffffff", logging: false },
      jsPDF: { unit: "mm", format, orientation, compress: true },
      pagebreak: { mode: ["css", "legacy"] },
    }).from(container).save();
  } finally {
    container.remove();
  }
}

function buildHistoryEnvelopePdf(job) {
  const sizes = { DL: [220, 110], C5: [229, 162], A4L: [297, 210] };
  const [widthMm, heightMm] = sizes[job.paperSize] || sizes.DL;
  const entries = printJobRecipientEntries(job);
  const senderClass = state.settings.garudaPlacement === "left" ? "sender garuda-left" : "sender garuda-above";
  const garudaMarkup = state.settings.showSender && state.settings.garudaImage
    ? `<img class="garuda${state.settings.showGaruda ? "" : " garuda-hidden"}" crossorigin="anonymous" src="${escapeHtml(state.settings.garudaImage)}" alt="ตราครุฑ">`
    : "";
  const senderAddress = escapeHtml(state.settings.senderAddress).replace(/\r?\n/g, "<br>");
  const documentNumber = state.settings.documentNumber ? `<div class="document-number">${escapeHtml(state.settings.documentNumber)}</div>` : "";
  const senderBlock = state.settings.showSender
    ? `<div class="${senderClass}">${garudaMarkup}<div class="sender-content"><strong>${escapeHtml(state.settings.sender)}</strong><div class="sender-address">${senderAddress}</div>${documentNumber}</div></div>`
    : "";
  const permit = state.settings.showPostagePermit
    ? `<div class="postage-permit">${escapeHtml(state.settings.postagePermitText).replace(/\r?\n/g, "<br>")}</div>`
    : "";
  const pages = entries.map(({ item }) => {
    const rawName = recipientEnvelopeName(item);
    const locality = [formatAddressArea("ตำบล", item.subdistrict), formatAddressArea("อำเภอ", item.district)].filter(Boolean).join(" ");
    const province = formatAddressArea("จังหวัด", item.province);
    const department = state.settings.showRecipientDepartment && item.department && rawName !== item.department ? `<p class="organization">${escapeHtml(item.department)}</p>` : "";
    const address = state.settings.showRecipientAddress
      ? `<p>${escapeHtml(item.address1 || "")}</p><p>${escapeHtml(locality)}</p><p>${escapeHtml(province)}</p>${item.postalCode ? `<p class="postal-code"><strong>${escapeHtml(item.postalCode)}</strong></p>` : ""}`
      : "";
    return `<section class="envelope pdf-page">${senderBlock}${permit}<div class="recipient">${recipientEnvelopeBlockHtml(item, { fontPt: state.settings.recipientFontPt })}<div class="recipient-detail">${department}${address}</div></div></section>`;
  }).join("");
  const container = document.createElement("div");
  container.innerHTML = `<style>${printFontFaceCss()}*{box-sizing:border-box}.pdf-envelope-document{margin:0;color:#17223b;font-family:"TH Sarabun New","Noto Sans Thai",Tahoma,sans-serif}.envelope{position:relative;width:${widthMm}mm;height:${heightMm}mm;overflow:hidden;background:#fff}.sender{position:absolute;top:${state.settings.senderTopMm}mm;left:${state.settings.senderLeftMm}mm;width:55%;font-size:${state.settings.senderFontPt}pt;line-height:${state.settings.senderLineHeight};color:#111}.sender-content{min-width:0}.sender-address{margin-top:.7mm}.document-number{margin-top:1.2mm;font-weight:700}.garuda{display:block;width:auto;height:${state.settings.garudaSizeMm}mm;object-fit:contain;object-position:left top}.garuda-hidden{visibility:hidden}.sender.garuda-left{display:flex;align-items:flex-start;gap:3mm}.garuda-left .garuda{flex:0 0 auto}.garuda-left .sender-content{padding-top:${state.settings.senderTextOffsetMm}mm}.garuda-above .garuda{margin:0 0 2mm}.postage-permit{position:absolute;top:${state.settings.postagePermitTopMm}mm;right:${state.settings.postagePermitRightMm}mm;display:flex;width:${POSTAGE_PERMIT_WIDTH_MM}mm;height:${POSTAGE_PERMIT_HEIGHT_MM}mm;align-items:center;justify-content:center;overflow:hidden;padding:1.2mm;border:.35mm solid #111;color:#111;font-size:${state.settings.postagePermitFontPt}pt;font-weight:700;line-height:${state.settings.postagePermitLineHeight};text-align:center}.recipient{position:absolute;left:${state.settings.recipientLeftPercent}%;top:${state.settings.recipientTopPercent}%;width:calc(100% - ${state.settings.recipientLeftPercent}% - 8mm);font-size:${state.settings.recipientFontPt}pt;line-height:${state.settings.recipientLineHeight}}.recipient-heading{display:flex;align-items:baseline;gap:.55em;line-height:inherit}.recipient-greeting{flex:0 0 auto;color:#667085}.recipient-name{display:block;min-width:0;white-space:nowrap}.recipient-name strong{font-weight:900}.recipient-heading.recipient-name-manual{align-items:flex-start}.recipient-heading.recipient-name-manual .recipient-name{white-space:normal}.recipient-detail{margin-left:2.55em}.recipient-position{margin:0;font-weight:900;white-space:nowrap}.recipient p{margin:0;line-height:inherit}.organization{font-weight:700}.pdf-page{break-after:page;page-break-after:always}.pdf-page:last-child{break-after:auto;page-break-after:auto}</style><div class="pdf-envelope-document">${pages}</div>`;
  return { container, format: [widthMm, heightMm], orientation: "landscape" };
}

function buildHistoryManifestPdf(job) {
  const entries = printJobRecipientEntries(job);
  const rows = entries.map(({ item, copyIndex }, index) => {
    const tracking = job.tracking?.[printJobTrackingKey(item.id, copyIndex)] || {};
    return {
      index: index + 1,
      name: manifestRecipientLabel(item),
      destination: item.postalCode || "",
      registered: formatTrackingCode(tracking.registered || "", "RJ"),
      ems: formatTrackingCode(tracking.ems || "", "EQ"),
    };
  });
  const pageSize = 30;
  const pages = [];
  for (let start = 0; start < rows.length; start += pageSize) pages.push(rows.slice(start, start + pageSize));
  if (!pages.length) pages.push([]);
  const permit = LOCKED_MANIFEST_PERMIT;
  const receivingPostOffice = extractReceivingPostOffice(permit);
  const manifestDate = formatThaiLongDate(job.manifestDate || printJobLocalDateKey(job.createdAt || job.updatedAt));
  const pageHtml = pages.map((pageRows, pageIndex) => {
    const displayRows = pageRows.map((row, index) => ({ ...row, index: index + 1 }));
    const blankRows = Array.from({ length: Math.max(0, pageSize - displayRows.length) }, (_, index) => ({
      index: displayRows.length + index + 1, name: "", destination: "", registered: "", ems: "",
    }));
    const bodyRows = [...displayRows, ...blankRows].map((row) => `<tr><td class="center">${row.index}</td><td class="recipient-cell"${manifestRecipientFontStyle(row.name)}><span class="${String(row.name).trim().length > 80 ? "long" : ""}">${escapeHtml(row.name)}</span></td><td class="center">${escapeHtml(row.destination)}</td><td class="center tracking">${escapeHtml(row.registered)}</td><td class="center tracking">${escapeHtml(row.ems)}</td><td></td><td></td></tr>`).join("");
    return `<section class="manifest-page pdf-page">${pages.length > 1 ? `<div class="page-number">-${pageIndex + 1}-</div>` : ""}<h1>ใบนำส่งของทางไปรษณีย์โดยชำระค่าบริการเป็นสินเชื่อ</h1><div class="manifest-meta"><div>วัน/เดือน/ปี…${escapeHtml(manifestDate)}.......</div><div>ชื่อหน่วยงาน ${escapeHtml(state.settings.sender || "สำนักงานสหกรณ์จังหวัดขอนแก่น")}</div><div>${escapeHtml(permit)}</div></div><p class="manifest-intro">ได้ฝากส่งสิ่งของของทางไปรษณีย์โดยชำระค่าบริการเป็นเงินเชื่อดังรายการต่อไปนี้</p><table class="manifest-print-table"><colgroup><col class="col-seq"><col class="col-name"><col class="col-dest"><col class="col-registered"><col class="col-ems"><col class="col-fee"><col class="col-note"></colgroup><thead><tr><th>ลำดับ</th><th>ผู้รับ</th><th>ปลายทาง</th><th>ลงทะเบียน</th><th>EMS</th><th>ค่าบริการ</th><th>หมายเหตุ</th></tr></thead><tbody>${bodyRows}</tbody></table><div class="manifest-footer"><div class="manifest-footer-left"><p>รวม&nbsp;&nbsp; จำนวน ......................${pageRows.length}...................... ฉบับ</p><p>ธรรมดา จำนวน....................-...................... ฉบับ</p></div><div class="manifest-footer-right"><p class="total-line">รวมทั้งสิ้น....................${pageRows.length}....................ฉบับ</p><p class="sign-line"><span>ลงชื่อ</span><span class="sign-dots"></span></p><p class="role-line">ผู้รับผิดชอบในการฝากส่ง</p><p class="check-line">ได้ตรวจสอบและรับฝากไว้ถูกต้องแล้ว</p><p class="signature sign-line"><span>ลงชื่อ</span><span class="sign-dots"></span></p><p class="role-line">เจ้าหน้าที่รับฝาก${receivingPostOffice ? ` ${escapeHtml(receivingPostOffice)}` : ""}</p></div></div></section>`;
  }).join("");
  const container = document.createElement("div");
  container.innerHTML = `<style>${printFontFaceCss()}*{box-sizing:border-box}.pdf-manifest-document{margin:0;color:#111;font-family:"TH Sarabun New","Noto Sans Thai",Tahoma,sans-serif;font-size:13pt}.manifest-page{position:relative;width:210mm;height:297mm;padding:8mm;background:#fff;overflow:hidden}.page-number{position:absolute;top:8mm;right:8mm;font-size:12pt}h1{margin:0 0 2.5mm;text-align:center;font-size:15pt}.manifest-meta{width:max-content;min-width:52.5mm;margin:0 0 2.5mm auto;line-height:1.12;font-size:12.5pt;white-space:nowrap}.manifest-intro{margin:0 0 .8mm 10mm;font-size:12.5pt;line-height:1.08}.manifest-print-table{width:192mm;border-collapse:collapse;table-layout:fixed}.manifest-print-table th,.manifest-print-table td{height:6.25mm;padding:0 1.2mm;border:1px solid #111;vertical-align:middle;line-height:1.04}.manifest-print-table th{text-align:center;font-size:11.5pt;white-space:nowrap}.center{text-align:center}.recipient-cell{overflow:hidden;font-size:12pt;white-space:nowrap}.recipient-cell span{display:block;overflow:hidden}.recipient-cell span.long{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;white-space:normal}.tracking{font-size:12pt;white-space:nowrap}.col-seq{width:9mm}.col-name{width:78mm}.col-dest{width:16mm}.col-registered{width:28mm}.col-ems{width:28mm}.col-fee{width:18mm}.col-note{width:12mm}.manifest-footer{position:relative;height:36mm;margin-top:3mm;line-height:1.18;font-size:14pt}.manifest-footer p{margin:0}.manifest-footer-left{position:absolute;left:9mm;top:1mm;width:82mm}.manifest-footer-left p+p{margin-top:1.6mm}.manifest-footer-right{position:absolute;left:116mm;top:0;width:78mm}.total-line{margin-bottom:1.6mm!important}.sign-line{display:flex;align-items:flex-end}.sign-dots{display:block;width:64mm;height:.9em;border-bottom:1px dotted #111}.role-line{width:64mm;margin-top:.4mm!important;margin-left:10mm;text-align:center}.check-line{margin-top:2.2mm!important}.signature{margin-top:4mm!important}.pdf-page{break-after:page;page-break-after:always}.pdf-page:last-child{break-after:auto;page-break-after:auto}</style><div class="pdf-manifest-document">${pageHtml}</div>`;
  return { container, format: "a4", orientation: "portrait" };
}

async function downloadHistoryPdf(button, type) {
  const jobId = type === "envelope" ? button.dataset.downloadEnvelopePdf : button.dataset.downloadManifestPdf;
  const job = state.printJobs.find((item) => item.id === jobId);
  if (!job) return;
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = "กำลังสร้าง PDF…";
  try {
    const documentData = type === "envelope" ? buildHistoryEnvelopePdf(job) : buildHistoryManifestPdf(job);
    const dateKey = printJobLocalDateKey(job.createdAt || job.updatedAt) || localIsoDate();
    const label = type === "envelope" ? "หน้าซองจดหมาย" : "ใบนำส่งไปรษณีย์";
    const filename = `${safePdfFilename(label)}-${safePdfFilename(dateKey)}-${safePdfFilename(job.creatorGroup || job.id)}.pdf`;
    await saveHtmlAsPdf(documentData.container, filename, documentData.format, documentData.orientation);
    setNotice(`ดาวน์โหลด PDF ${label} จากประวัติเรียบร้อยแล้ว`);
  } catch (error) {
    console.error(error);
    setNotice(`สร้าง PDF ไม่สำเร็จ: ${error.message}`);
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
}

function renderPrintHistory() {
  if (!elements.printHistoryList) return;
  syncHistoryGroupOptions();
  const jobs = filteredPrintJobs();
  const totals = jobs.reduce((result, job) => {
    const counts = printJobCounts(job);
    result.recipients += counts.recipientCount;
    result.envelopes += counts.envelopeCount;
    return result;
  }, { recipients: 0, envelopes: 0 });
  if (elements.historyJobTotal) elements.historyJobTotal.textContent = jobs.length;
  if (elements.historyRecipientTotal) elements.historyRecipientTotal.textContent = totals.recipients;
  if (elements.historyEnvelopeTotal) elements.historyEnvelopeTotal.textContent = totals.envelopes;
  if (elements.historyResultLabel) {
    const labels = [state.historyFilters.group, state.historyFilters.date || state.historyFilters.month].filter(Boolean);
    elements.historyResultLabel.textContent = labels.length ? labels.join(" · ") : "ทั้งหมด";
  }
  if (!jobs.length) {
    const message = state.printJobs.length
      ? "ไม่พบชุดงานที่ตรงกับตัวกรอง กรุณาเปลี่ยนเดือน วันที่ หรือกลุ่มงาน"
      : "ยังไม่มีประวัติ เมื่อเลือกรายชื่อ ระบบจะเริ่มบันทึกชุดงานให้อัตโนมัติ";
    elements.printHistoryList.innerHTML = `<tr><td colspan="7"><div class="history-empty">${message}</div></td></tr>`;
    return;
  }
  elements.printHistoryList.innerHTML = jobs.map((job, index) => {
    const status = printJobStatus(job);
    const { recipientCount, envelopeCount } = printJobCounts(job);
    const printEvents = [
      job.envelopePrintedAt ? `หน้าซอง ${formatPrintJobDate(job.envelopePrintedAt)}` : "",
      job.manifestPrintedAt ? `ใบนำส่ง ${formatPrintJobDate(job.manifestPrintedAt)}` : "",
    ].filter(Boolean);
    return `<tr class="history-item ${job.id === state.currentPrintJobId ? "current" : ""}">
      <td class="history-sequence">${index + 1}</td>
      <td><strong>${escapeHtml(formatPrintJobDate(job.createdAt))}</strong><small>แก้ไขล่าสุด ${escapeHtml(formatPrintJobDate(job.updatedAt))}</small></td>
      <td><strong>${escapeHtml(job.creatorGroup || "ไม่ระบุกลุ่มงาน")}</strong><small>รหัสชุด ${escapeHtml(job.id)}</small></td>
      <td><div class="history-counts"><b>${recipientCount}</b> รายชื่อ · <b>${envelopeCount}</b> ซอง · ${escapeHtml(job.paperSize || "DL")}</div>
        <details class="history-details"><summary>ดูรายชื่อและเลขไปรษณีย์</summary><div class="history-details-content">${historyRecipientDetails(job)}${historyTrackingSummary(job)}</div></details>
      </td>
      <td>${printEvents.length ? printEvents.map((item) => `<span class="history-print-event">${escapeHtml(item)}</span>`).join("") : '<span class="history-muted">ยังไม่ได้พิมพ์</span>'}<small>วันที่ใบนำส่ง ${escapeHtml(job.manifestDate || "-")}</small></td>
      <td><span class="history-status ${status.className}">${status.label}</span></td>
      <td><div class="history-actions">
        <button class="resume" data-resume-job="${escapeHtml(job.id)}" type="button">ดำเนินการต่อ</button>
        ${job.completedAt ? "" : `<button data-complete-job="${escapeHtml(job.id)}" type="button">ทำเครื่องหมายว่าเสร็จ</button>`}
        <button class="delete" data-delete-job="${escapeHtml(job.id)}" type="button">ลบประวัติ</button>
      </div></td>
    </tr>`;
  }).join("");

  elements.printHistoryList.querySelectorAll("[data-resume-job]").forEach((button) => {
    button.addEventListener("click", () => restorePrintJob(button.dataset.resumeJob));
  });
  elements.printHistoryList.querySelectorAll("[data-complete-job]").forEach((button) => {
    button.addEventListener("click", () => completePrintJob(button.dataset.completeJob));
  });
  elements.printHistoryList.querySelectorAll("[data-delete-job]").forEach((button) => {
    button.addEventListener("click", () => requestDeletePrintJob(button));
  });
}

function handleHistoryFilterChange() {
  state.historyFilters.group = elements.historyGroupFilter?.value || "";
  state.historyFilters.month = elements.historyMonthFilter?.value || "";
  state.historyFilters.date = elements.historyDateFilter?.value || "";
  renderPrintHistory();
}

function resetHistoryFilters() {
  state.historyFilters = { group: "", month: "", date: "" };
  if (elements.historyGroupFilter) elements.historyGroupFilter.value = "";
  if (elements.historyMonthFilter) elements.historyMonthFilter.value = "";
  if (elements.historyDateFilter) elements.historyDateFilter.value = "";
  renderPrintHistory();
}

function restorePrintJob(id, options = {}) {
  const job = state.printJobs.find((item) => item.id === id);
  if (!job) return;
  const availableIds = new Set(state.recipients.map((item) => item.id));
  state.currentPrintJobId = job.id;
  state.settings.printJobCreator = job.creatorGroup || state.settings.printJobCreator || "";
  state.selected = new Set((job.recipientIds || []).filter((recipientId) => availableIds.has(recipientId)));
  Object.entries(job.copiesById || {}).forEach(([recipientId, copies]) => setRecipientEnvelopeCopies(recipientId, copies));
  if (PAPER_SIZE_KEYS.includes(job.paperSize)) {
    rememberCurrentPaperLayout();
    state.settings.paperSize = job.paperSize;
    applyPaperLayout(job.paperSize);
  }
  persistSettings();
  persistPrintHistory();
  setPrintJobCreatorVisible(true);
  if (elements.manifestRows?.dataset.printJobId !== job.id) {
    elements.manifestRows.innerHTML = "";
    elements.manifestRows.dataset.printJobId = "";
  }
  render();
  if (!options.keepDialog) elements.printHistoryDialog?.close();
  setNotice(`เปิดชุดงานเดิมแล้ว พบ ${state.selected.size} รายชื่อ สามารถทำต่อได้ทันที`);
}

function completePrintJob(id) {
  const job = state.printJobs.find((item) => item.id === id);
  if (!job) return;
  job.completedAt = new Date().toISOString();
  job.updatedAt = job.completedAt;
  persistPrintHistory();
  queuePrintJobCloudSave(job);
  renderPrintHistory();
  setNotice("ทำเครื่องหมายชุดงานว่าเสร็จสิ้นแล้ว");
}

function requestDeletePrintJob(button) {
  if (button.dataset.confirmDelete !== "true") {
    button.dataset.confirmDelete = "true";
    button.textContent = "กดอีกครั้งเพื่อยืนยันลบ";
    setTimeout(() => {
      if (button.isConnected) {
        button.dataset.confirmDelete = "false";
        button.textContent = "ลบประวัติ";
      }
    }, 3500);
    return;
  }
  deletePrintJob(button.dataset.deleteJob);
}

function deletePrintJob(id) {
  state.printJobs = state.printJobs.filter((job) => job.id !== id);
  if (state.currentPrintJobId === id) {
    state.currentPrintJobId = "";
    state.settings.envelopeCopiesById = {};
  }
  persistPrintHistory();
  renderPrintHistory();
  queuePrintJobCloudDelete(id);
  setNotice("ลบประวัติชุดงานแล้ว");
}

function startNewPrintJob() {
  saveCurrentPrintJobDraft();
  state.currentPrintJobId = "";
  state.selected.clear();
  state.settings.printJobCreator = "";
  state.settings.envelopeCopiesById = {};
  state.previewRecipientIndex = 0;
  if (elements.printJobCreator) elements.printJobCreator.value = "";
  elements.manifestRows.innerHTML = "";
  elements.manifestRows.dataset.printJobId = "";
  elements.manifestDate.value = "";
  persistSettings();
  persistPrintHistory();
  render();
  elements.printHistoryDialog?.close();
  focusPrintJobCreator();
  setNotice("เริ่มชุดงานใหม่แล้ว กรุณาเลือกกลุ่มงานก่อนเลือกรายชื่อผู้รับ");
}

function requirePrintJobCreator() {
  if (state.settings.printJobCreator) return true;
  focusPrintJobCreator();
  setNotice("กรุณาเลือกกลุ่มงานก่อนพิมพ์");
  return false;
}

function handlePrintJobCreatorChange(event) {
  state.settings.printJobCreator = String(event.target.value || "").trim();
  setPrintJobCreatorVisible(true, { active: !state.settings.printJobCreator });
  persistSettings();
  saveCurrentPrintJobDraft({ creatorGroup: state.settings.printJobCreator });
  renderPrintHistory();
  if (!state.settings.printJobCreator) {
    setNotice("กรุณาเลือกผู้สร้างชุดงาน");
    return;
  }
  setNotice(`เลือกผู้สร้างชุดงาน: ${state.settings.printJobCreator}`);
  if (!isAdminSignedIn()) {
    openAdminAuthDialog("เข้าสู่ระบบครั้งเดียว เพื่อให้ระบบบันทึกประวัติลง Supabase อัตโนมัติ");
  }
}

async function openPrintHistory() {
  saveCurrentPrintJobDraft();
  renderPrintHistory();
  elements.printHistoryDialog.showModal();
  await loadPrintJobsFromSupabase();
  renderPrintHistory();
}

function closePrintHistory() {
  if (elements.printHistoryDialog.open) elements.printHistoryDialog.close();
}

function restoreSavedPrintJobOnLoad() {
  const job = currentPrintJob();
  if (!job || job.completedAt) return false;
  restorePrintJob(job.id, { keepDialog: true });
  return true;
}

function captureCurrentLayout() {
  return Object.fromEntries(LAYOUT_SETTING_KEYS.map((key) => [key, state.settings[key]]));
}

function rememberCurrentPaperLayout(paperSize = state.settings.paperSize) {
  state.settings.paperLayouts[paperSize] = normalizeLayoutProfile(captureCurrentLayout(), paperSize);
}

function applyPaperLayout(paperSize) {
  const profile = normalizeLayoutProfile(
    state.settings.paperLayouts[paperSize] || defaults.paperLayouts?.[paperSize] || {},
    paperSize,
  );
  state.settings.paperLayouts[paperSize] = profile;
  LAYOUT_SETTING_KEYS.forEach((key) => {
    state.settings[key] = profile[key];
  });
}

function defaultPaperLayout(paperSize = state.settings.paperSize) {
  return normalizeLayoutProfile(defaults.paperLayouts?.[paperSize] || {}, paperSize);
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#039;", '"': "&quot;",
  }[character]));
}

function formatAddressArea(label, value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const prefixPatterns = {
    ตำบล: /^(?:ตำบล|ต\.)\s*/,
    อำเภอ: /^(?:อำเภอ|อ\.)\s*/,
    จังหวัด: /^(?:จังหวัด|จ\.)\s*/,
  };
  return `${label}${text.replace(prefixPatterns[label], "").trim()}`;
}

function inferCategory(department) {
  const name = String(department || "");
  if (name.includes("สหกรณ์") || name.includes("กลุ่มเกษตรกร")) return "สหกรณ์และกลุ่มเกษตรกร";
  if (/บริษัท|ห้างหุ้นส่วน|จำกัด \(มหาชน\)|เอกชน/.test(name)) return "ภาคเอกชน";
  return "หน่วยงานราชการ";
}

function normalizeCategory(category, department) {
  if (category === "สหกรณ์" || category === "กลุ่มเกษตรกร") return "สหกรณ์และกลุ่มเกษตรกร";
  return CATEGORIES.includes(category) ? category : inferCategory(department);
}

function normalizeRecipient(raw = {}, index = 0) {
  const read = (...keys) => {
    const key = keys.find((name) => raw[name] !== undefined && raw[name] !== null);
    return key ? String(raw[key]).trim() : "";
  };
  const department = read("department", "หน่วยงาน");
  const category = normalizeCategory(read("category", "ประเภท"), department);
  return {
    id: read("id", "รหัส") || `ROW${index + 1}`,
    category,
    prefix: read("prefix", "คำนำหน้า"),
    firstName: read("firstName", "ชื่อ"),
    lastName: read("lastName", "นามสกุล"),
    position: read("position", "ตำแหน่ง"),
    department,
    responsibleUnit: read("responsibleUnit", "กสส.", "กสส", "หน่วยรับผิดชอบ"),
    cooperativeType: read("cooperativeType", "ประเภทสหกรณ์"),
    address1: read("address1", "ที่อยู่"),
    subdistrict: read("subdistrict", "ตำบล"),
    district: read("district", "อำเภอ"),
    province: read("province", "จังหวัด"),
    postalCode: read("postalCode", "รหัสไปรษณีย์"),
  };
}

function recipientName(item) {
  const name = `${item.prefix}${item.firstName} ${item.lastName}`.trim();
  return name || item.position || item.department || "ไม่ระบุชื่อผู้รับ";
}

function recipientEnvelopeName(item) {
  const name = `${item.prefix}${item.firstName} ${item.lastName}`.trim();
  return name || item.position || (state.settings.showRecipientDepartment ? item.department : "") || "ไม่ระบุชื่อผู้รับ";
}

function normalizeRecipientNameBreaks(value = "") {
  return String(value)
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

function compactRecipientName(value = "") {
  return normalizeRecipientNameBreaks(value).replace(/\s+/g, " ").trim();
}

function recipientEnvelopeDisplayName(item) {
  const original = recipientEnvelopeName(item);
  const saved = normalizeRecipientNameBreaks(state.settings.recipientNameBreaksById?.[item.id] || "");
  return saved && compactRecipientName(saved) === compactRecipientName(original) ? saved : original;
}

function recipientEnvelopeNameHtml(item) {
  return escapeHtml(recipientEnvelopeDisplayName(item)).replace(/\n/g, "<br>");
}

function recipientEnvelopeBlockHtml(item, options = {}) {
  const rawName = recipientEnvelopeName(item);
  const displayName = recipientEnvelopeDisplayName(item);
  const manualClass = displayName.includes("\n") ? " recipient-name-manual" : "";
  const fontStyle = options.fontPt ? ` style="font-size:${options.fontPt}pt"` : "";
  const position = item.position && rawName !== item.position
    ? `<p class="recipient-position"><strong>${escapeHtml(item.position)}</strong></p>`
    : "";
  return `<div class="recipient-heading${manualClass}"><span class="recipient-greeting">เรียน</span><span class="recipient-name"${fontStyle}><strong>${recipientEnvelopeNameHtml(item)}</strong></span></div>${position}`;
}

function previewRecipientItems() {
  const selected = state.recipients.filter((item) => state.selected.has(item.id));
  return selected.length ? selected : state.recipients.slice(0, 1);
}

function currentPreviewRecipient() {
  const recipients = previewRecipientItems();
  if (!recipients.length) return null;
  const index = Math.min(Math.max(0, state.previewRecipientIndex), recipients.length - 1);
  return recipients[index] || null;
}

function recipientFullAddress(item) {
  return [
    item.address1,
    formatAddressArea("ตำบล", item.subdistrict),
    formatAddressArea("อำเภอ", item.district),
    formatAddressArea("จังหวัด", item.province),
    item.postalCode,
  ].filter(Boolean).join(" ");
}

function selectedRecipients() {
  return state.recipients.filter((item) => state.selected.has(item.id));
}

function localIsoDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatThaiLongDate(dateValue) {
  const date = dateValue ? new Date(`${dateValue}T00:00:00`) : new Date();
  return new Intl.DateTimeFormat("th-TH-u-ca-buddhist", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

function defaultManifestPermit() {
  return LOCKED_MANIFEST_PERMIT;
}

function extractReceivingPostOffice(permit = "") {
  const text = String(permit || "").trim();
  const match = text.match(/(?:ไปรษณีย์|ปณ\.)\s*([^\s]+)/);
  return match ? `ปณ.${match[1]}` : "";
}

function printFontFaceCss() {
  const fontUrl = new URL(PRINT_FONT_FILE, location.href).href;
  return `@font-face{font-family:"TH Sarabun New";src:url("${fontUrl}") format("truetype");font-weight:400 700;font-style:normal;font-display:block}`;
}

function parseTrackingCode(value = "", defaultPrefix = "") {
  const compact = normalizeTrackingDigits(value);
  const prefix = String(defaultPrefix || "").toUpperCase();
  if (!compact) return ["", "", "", ""];
  const full = compact.match(/^([A-Z]{2})([0-9๐-๙]{8})([0-9๐-๙])([A-Z]{2})$/);
  if (full) return [full[1], full[2], full[3], full[4]];
  const numberOnly = compact.match(/^([0-9๐-๙]{8})([0-9๐-๙])$/);
  if (numberOnly) return [prefix, numberOnly[1], numberOnly[2], "TH"];
  const shortNumber = compact.match(/^([0-9๐-๙]+)$/);
  if (shortNumber) return [prefix, shortNumber[1], "", "TH"];
  return ["", compact, "", ""];
}

function formatTrackingCode(value = "", defaultPrefix = "") {
  const compact = String(value).trim().toUpperCase().replace(/[\s-]/g, "");
  const full = compact.match(/^([A-Z]{2})([0-9๐-๙]{8})([0-9๐-๙])(?:TH)?$/);
  if (full) return `${full[1]} ${full[2]} ${full[3]} TH`;
  const digits = normalizeTrackingDigits(value);
  if (!digits) return "";
  const firstEight = digits.slice(0, 8);
  const checkDigit = digits.slice(8, 9);
  return `${String(defaultPrefix || "").toUpperCase()} ${firstEight}${checkDigit ? ` ${checkDigit}` : ""} TH`;
}

function normalizeTrackingDigits(value = "") {
  return String(value).trim().toUpperCase().replace(/[\s-]/g, "").replace(/^[A-Z]{2}/, "").replace(/[A-Z]{2}$/, "").replace(/[^0-9๐-๙]/g, "").slice(0, 9);
}

function normalizeManifestPrefix(value = "", defaultLetters = "") {
  const compact = String(value).trim().toUpperCase().replace(/[\s-]/g, "").replace(/[^A-Z0-9๐-๙]/g, "");
  const full = compact.match(/^([A-Z]{0,2})([0-9๐-๙]{0,5})/);
  if (full?.[1]) return `${full[1].slice(0, 2)}${full[2].slice(0, 5)}`.slice(0, 7);
  const digits = normalizeTrackingDigits(compact).slice(0, 5);
  return digits ? `${String(defaultLetters || "").toUpperCase().slice(0, 2)}${digits}` : "";
}

function manifestPrefixLetters(type = "") {
  return type === "ems" ? "EQ" : "RJ";
}

function limitManifestPrefixInput(event) {
  const type = event.target === elements.manifestEmsPrefix ? "ems" : "registered";
  const cleaned = normalizeManifestPrefix(event.target.value, manifestPrefixLetters(type));
  if (event.target.value !== cleaned) event.target.value = cleaned;
  event.target.setCustomValidity("");
}

function limitTrackingInput(event) {
  const maxLength = event.target.maxLength > 0 ? event.target.maxLength : 9;
  const cleaned = normalizeTrackingDigits(event.target.value).slice(0, maxLength);
  if (event.target.value !== cleaned) event.target.value = cleaned;
  event.target.setCustomValidity("");
}

function manifestPrefixForInput(input) {
  const prefixInput = input?.dataset.trackingType === "ems"
    ? elements.manifestEmsPrefix
    : elements.manifestRegisteredPrefix;
  const type = input?.dataset.trackingType || "";
  const prefix = normalizeManifestPrefix(prefixInput?.value || "", manifestPrefixLetters(type));
  return /^[A-Z]{2}[0-9๐-๙]{5}$/.test(prefix) ? prefix : "";
}

function fullManifestTrackingValue(input) {
  if (!input) return "";
  const value = normalizeTrackingDigits(input.value);
  const prefix = manifestPrefixForInput(input);
  return prefix && value ? `${prefix}${value.slice(0, 4)}` : value;
}

function manifestTrackingEntryValue(savedValue = "", prefix = "") {
  const digits = normalizeTrackingDigits(savedValue);
  const lockedDigits = normalizeTrackingDigits(prefix).slice(0, 5);
  return lockedDigits.length === 5 && digits.startsWith(lockedDigits) ? digits.slice(5, 9) : digits;
}

function updateManifestRowTrackingState(row, activeInput = null) {
  if (!row) return;
  const registered = row.querySelector('[data-tracking-type="registered"]');
  const ems = row.querySelector('[data-tracking-type="ems"]');
  if (!registered || !ems) return;
  if (activeInput && activeInput.value.trim()) {
    const other = activeInput === registered ? ems : registered;
    other.value = "";
  }
  const hasRegistered = Boolean(registered.value.trim());
  const hasEms = Boolean(ems.value.trim());
  registered.disabled = hasEms;
  ems.disabled = hasRegistered;
  registered.closest("td")?.classList.toggle("tracking-locked", hasEms);
  ems.closest("td")?.classList.toggle("tracking-locked", hasRegistered);
}

function focusNextManifestTrackingInput(input) {
  if (!input || input.maxLength !== 4 || normalizeTrackingDigits(input.value).length !== 4) return;
  const type = input.dataset.trackingType;
  const inputs = [...elements.manifestRows.querySelectorAll(`[data-tracking-type="${type}"]`)];
  const next = inputs.slice(inputs.indexOf(input) + 1).find((candidate) => !candidate.disabled);
  if (next) {
    next.focus();
    next.select();
  }
}

function applyManifestPrefixMode(type) {
  const prefixInput = type === "ems" ? elements.manifestEmsPrefix : elements.manifestRegisteredPrefix;
  const prefix = normalizeManifestPrefix(prefixInput.value, manifestPrefixLetters(type));
  prefixInput.value = prefix;
  state.settings[type === "ems" ? "manifestEmsPrefix" : "manifestRegisteredPrefix"] = prefix;
  elements.manifestRows.querySelectorAll(`[data-tracking-type="${type}"]`).forEach((input) => {
    const previousPrefix = input.dataset.lockedPrefix || "";
    let value = normalizeTrackingDigits(input.value);
    const prefixDigits = normalizeTrackingDigits(prefix).slice(0, 5);
    if (/^[A-Z]{2}[0-9๐-๙]{5}$/.test(prefix)) {
      if (value.length === 9 && value.startsWith(prefixDigits)) value = value.slice(5);
      else if (value.length > 4) value = value.slice(-4);
      input.maxLength = 4;
      input.pattern = "[0-9๐-๙]{4}";
      input.placeholder = "4 ตัวท้าย";
      input.title = `กรอก 4 ตัวท้าย ต่อจาก ${prefix}`;
    } else {
      const previousPrefixDigits = normalizeTrackingDigits(previousPrefix).slice(0, 5);
      if (value && value.length <= 4 && previousPrefixDigits.length === 5) value = `${previousPrefixDigits}${value}`;
      input.maxLength = 9;
      input.pattern = "[0-9๐-๙]{9}";
      input.placeholder = "ตัวเลข 9 หลัก";
      input.title = "กรอกตัวเลข 9 หลัก";
    }
    input.value = value.slice(0, input.maxLength);
    input.dataset.lockedPrefix = prefix;
    updateManifestRowTrackingState(input.closest("tr"));
  });
  persistSettings();
  saveCurrentPrintJobDraft();
}

function manifestRecipientLabel(item) {
  return recipientEnvelopeName(item);
}

function manifestRecipientFontStyle(name = "") {
  const length = String(name).trim().length;
  if (length > 80) return ' style="font-size:8pt!important"';
  if (length > 60) return ' style="font-size:9pt!important"';
  if (length > 50) return ' style="font-size:11pt!important"';
  return "";
}

function envelopeRecipientHeadingFontPt(name = "", fallbackPt = 12) {
  return fallbackPt;
}

function categoryClass(category) {
  if (category === "สหกรณ์และกลุ่มเกษตรกร") return "cooperative";
  if (category === "ภาคเอกชน") return "private";
  if (category === "บุคคล") return "person";
  return "government";
}

function filteredRecipients() {
  const query = state.query.trim().toLocaleLowerCase("th");
  return state.recipients.filter((item) => {
    const text = `${recipientName(item)} ${item.position} ${item.department} ${item.category} ${item.responsibleUnit} ${item.cooperativeType} ${item.province}`.toLocaleLowerCase("th");
    const categoryMatches = state.category === "ทั้งหมด" || item.category === state.category;
    const cooperativeFiltersActive = state.category === "สหกรณ์และกลุ่มเกษตรกร";
    const responsibleUnitMatches = !cooperativeFiltersActive || state.responsibleUnit === "ทั้งหมด" || item.responsibleUnit === state.responsibleUnit;
    const cooperativeTypeMatches = !cooperativeFiltersActive || state.cooperativeType === "ทั้งหมด" || item.cooperativeType === state.cooperativeType;
    return categoryMatches && responsibleUnitMatches && cooperativeTypeMatches && (!query || text.includes(query));
  });
}

function csvCell(value) {
  const text = String(value ?? "").replace(/\r?\n/g, " ").trim();
  return `"${text.replace(/"/g, '""')}"`;
}

function downloadRecipientsCsv() {
  const rows = filteredRecipients();
  if (!rows.length) {
    setNotice("ไม่มีรายชื่อให้ดาวน์โหลด กรุณาล้างตัวกรองหรือโหลดฐานข้อมูลใหม่");
    return;
  }
  const headers = [
    "ลำดับ",
    "ประเภทผู้รับ",
    "กสส. / นิคมฯ",
    "ประเภทสหกรณ์",
    "คำนำหน้า",
    "ชื่อ",
    "นามสกุล",
    "ชื่อผู้รับ / ตำแหน่ง",
    "ตำแหน่ง",
    "ชื่อหน่วยงาน",
    "เลขที่ / หมู่ / ถนน",
    "ตำบล / แขวง",
    "อำเภอ / เขต",
    "จังหวัด",
    "รหัสไปรษณีย์",
    "ที่อยู่เต็ม",
  ];
  const body = rows.map((item, index) => [
    index + 1,
    item.category,
    item.responsibleUnit,
    item.cooperativeType,
    item.prefix,
    item.firstName,
    item.lastName,
    recipientName(item),
    item.position,
    item.department,
    item.address1,
    item.subdistrict,
    item.district,
    item.province,
    item.postalCode,
    recipientFullAddress(item),
  ].map(csvCell).join(","));
  const csv = `\uFEFF${headers.map(csvCell).join(",")}\r\n${body.join("\r\n")}`;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `recipients-${localIsoDate()}.csv`;
  document.body.appendChild(link);
  link.click();
  URL.revokeObjectURL(link.href);
  link.remove();
  setNotice(`ดาวน์โหลดรายชื่อ ${rows.length} รายการ เป็นไฟล์ CSV แล้ว`);
}

function setNotice(message) {
  if (elements.notice) elements.notice.textContent = message;
}

function persistSettings() {
  rememberCurrentPaperLayout();
  const keys = [
    "sender", "senderAddress", "documentNumber", "paperSize", "paperLayouts", "printJobCreator", "recipientNameBreaksById", "showRecipientDepartment", "showRecipientAddress", "showSender", "showGaruda", "showPostagePermit",
    "garudaPlacement", "garudaSizeMm", "garudaStandardVersion", "senderTopMm", "senderLeftMm", "senderTextOffsetMm", "senderFontPt", "senderLineHeight", "recipientFontPt",
    "recipientTopPercent", "recipientLeftPercent", "recipientLineHeight", "manifestRegisteredPrefix", "manifestEmsPrefix",
    "postagePermitText", "postagePermitTopMm", "postagePermitRightMm", "postagePermitFontPt", "postagePermitLineHeight",
  ];
  const saved = Object.fromEntries(keys.map((key) => [key, state.settings[key]]));
  localStorage.setItem("envelope-app-settings", JSON.stringify(saved));
}

function requireSupabase() {
  if (!supabaseClient) throw new Error("ยังไม่ได้ตั้งค่า Supabase หรือโหลดไลบรารีไม่สำเร็จ");
  return supabaseClient;
}

function isAdminSignedIn() {
  const email = String(state.adminSession?.user?.email || "").toLowerCase();
  return Boolean(email && email === state.settings.supabaseAdminEmail);
}

function updateAdminAuthUi() {
  const signedIn = isAdminSignedIn();
  document.body.classList.toggle("app-locked", !signedIn);
  if (elements.loginScreen) elements.loginScreen.setAttribute("aria-hidden", signedIn ? "true" : "false");
  if (signedIn && elements.loginGatePassword) elements.loginGatePassword.value = "";
  if (elements.adminAuthButton) elements.adminAuthButton.textContent = signedIn ? "ออกจากระบบผู้ดูแล" : "เข้าสู่ระบบผู้ดูแล";
  if (elements.historySyncHint) elements.historySyncHint.textContent = signedIn
    ? "เชื่อมต่อแล้ว ระบบบันทึกทุกการเปลี่ยนแปลงลง Supabase ให้เอง"
    : "เข้าสู่ระบบผู้ดูแลครั้งเดียว หลังจากนั้นระบบจะบันทึกทุกการเปลี่ยนแปลงให้เอง";
}

function setLoginGateMessage(message = "", type = "") {
  if (!elements.loginGateMessage) return;
  elements.loginGateMessage.textContent = message;
  elements.loginGateMessage.className = type ? `login-message ${type}` : "login-message";
}

async function signInAdminWithPassword(password) {
  const { data, error } = await requireSupabase().auth.signInWithPassword({
    email: state.settings.supabaseAdminEmail,
    password,
  });
  if (error) throw error;
  state.adminSession = data.session;
  updateAdminAuthUi();
}

async function handleLoginGateSubmit(event) {
  event.preventDefault();
  if (!elements.loginGateForm.reportValidity()) return;
  const password = elements.loginGatePassword.value;
  elements.loginGateButton.disabled = true;
  elements.loginGateButton.textContent = "กำลังเข้าสู่ระบบ…";
  setLoginGateMessage("กำลังตรวจสอบรหัสผ่าน…");
  try {
    await signInAdminWithPassword(password);
    setLoginGateMessage("เข้าสู่ระบบสำเร็จ", "success");
  } catch (error) {
    setLoginGateMessage("รหัสผ่านไม่ถูกต้อง กรุณาลองใหม่อีกครั้ง");
    elements.loginGatePassword.select();
  } finally {
    elements.loginGateButton.disabled = false;
    elements.loginGateButton.textContent = "เข้าสู่ระบบ";
  }
}

function openAdminAuthDialog(message = "") {
  if (!isAdminSignedIn() && elements.loginGatePassword) {
    setLoginGateMessage(message);
    elements.loginGatePassword.focus();
    return;
  }
  elements.adminAuthPassword.value = "";
  elements.adminAuthMessage.textContent = message;
  elements.adminAuthMessage.className = "form-message";
  elements.adminAuthDialog.showModal();
}

function closeAdminAuthDialog() {
  if (elements.adminAuthDialog.open) elements.adminAuthDialog.close();
}

async function requireAdminSession() {
  if (isAdminSignedIn()) return true;
  openAdminAuthDialog("กรุณาเข้าสู่ระบบผู้ดูแลก่อนเพิ่ม แก้ไข หรือลบข้อมูล");
  return false;
}

async function handleAdminAuthSubmit(event) {
  event.preventDefault();
  if (!elements.adminAuthForm.reportValidity()) return;
  const button = $("#adminPasswordLogin");
  const password = elements.adminAuthPassword.value;
  button.disabled = true;
  button.textContent = "กำลังเข้าสู่ระบบ…";
  elements.adminAuthMessage.textContent = "กำลังตรวจสอบรหัสผู้ดูแล…";
  try {
    const { error } = await requireSupabase().auth.signInWithPassword({
      email: state.settings.supabaseAdminEmail,
      password,
    });
    if (error) throw error;
    elements.adminAuthMessage.textContent = "เข้าสู่ระบบสำเร็จ";
    elements.adminAuthMessage.className = "form-message success";
  } catch (error) {
    elements.adminAuthMessage.textContent = "รหัสผู้ดูแลไม่ถูกต้อง กรุณาตรวจสอบแล้วลองใหม่";
    elements.adminAuthMessage.className = "form-message error";
  } finally {
    button.disabled = false;
    button.textContent = "เข้าสู่ระบบ";
  }
}

async function toggleAdminAuth() {
  if (!isAdminSignedIn()) {
    openAdminAuthDialog();
    return;
  }
  await requireSupabase().auth.signOut();
  state.adminSession = null;
  updateAdminAuthUi();
  setNotice("ออกจากระบบผู้ดูแลแล้ว");
}

async function initializeAdminAuth() {
  if (!supabaseClient) {
    updateAdminAuthUi();
    setLoginGateMessage("ยังไม่ได้ตั้งค่า Supabase กรุณาตรวจสอบ config.js");
    return;
  }
  const { data } = await supabaseClient.auth.getSession();
  state.adminSession = data.session;
  updateAdminAuthUi();
  if (!isAdminSignedIn() && elements.loginGatePassword) elements.loginGatePassword.focus();
  localStorage.removeItem(PASSWORD_SETUP_PENDING_KEY);
  if (isAdminSignedIn()) await autoSyncPrintHistory();
  supabaseClient.auth.onAuthStateChange((_event, session) => {
    state.adminSession = session;
    updateAdminAuthUi();
    if (session && isAdminSignedIn()) {
      closeAdminAuthDialog();
      setNotice("เข้าสู่ระบบผู้ดูแลแล้ว ระบบจะบันทึกประวัติอัตโนมัติ");
      setTimeout(() => autoSyncPrintHistory().catch(console.warn), 0);
    }
  });
}

function recipientFromSupabase(row = {}) {
  return {
    id: row.id,
    category: row.category,
    prefix: row.prefix,
    firstName: row.first_name,
    lastName: row.last_name,
    position: row.position,
    department: row.department,
    responsibleUnit: row.responsible_unit,
    cooperativeType: row.cooperative_type,
    address1: row.address1,
    subdistrict: row.subdistrict,
    district: row.district,
    province: row.province,
    postalCode: row.postal_code,
  };
}

function recipientToSupabase(payload = {}) {
  return {
    id: payload.id,
    category: payload.category,
    prefix: payload.prefix || "",
    first_name: payload.firstName || "",
    last_name: payload.lastName || "",
    position: payload.position || "",
    department: payload.department || "",
    responsible_unit: payload.responsibleUnit || "",
    cooperative_type: payload.cooperativeType || "",
    address1: payload.address1 || "",
    subdistrict: payload.subdistrict || "",
    district: payload.district || "",
    province: payload.province || "",
    postal_code: payload.postalCode || "",
    active: true,
  };
}

async function requestRecipients() {
  const { data, error } = await requireSupabase()
    .from("recipients")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data || []).map(recipientFromSupabase);
}

function mergePrintJobs(rows) {
  const byId = new Map(state.printJobs.map((job) => [job.id, job]));
  rows.forEach((job) => {
    if (!job?.id) return;
    const existing = byId.get(job.id);
    if (!existing || String(job.updatedAt || "") > String(existing.updatedAt || "")) byId.set(job.id, job);
  });
  state.printJobs = [...byId.values()];
  persistPrintHistory();
}

async function loadPrintJobsFromSupabase() {
  if (!isAdminSignedIn()) return;
  try {
    const { data, error } = await requireSupabase().from("print_jobs").select("*").order("updated_at", { ascending: false });
    if (error) throw error;
    const rows = (data || []).map((row) => ({
      ...(row.data || {}),
      id: row.id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      completedAt: row.completed_at,
      envelopePrintedAt: row.envelope_printed_at,
      manifestPrintedAt: row.manifest_printed_at,
    }));
    mergePrintJobs(rows);
    if (elements.historySaveStatus) elements.historySaveStatus.textContent = "โหลดประวัติจาก Supabase แล้ว";
  } catch (error) {
    console.warn("ยังโหลดประวัติจาก Supabase ไม่ได้ ใช้ประวัติบนเครื่องแทน", error);
  }
}

async function savePrintJobToSupabase(job) {
  const row = {
    id: job.id,
    data: job,
    created_at: job.createdAt || new Date().toISOString(),
    updated_at: job.updatedAt || new Date().toISOString(),
    completed_at: job.completedAt || null,
    envelope_printed_at: job.envelopePrintedAt || null,
    manifest_printed_at: job.manifestPrintedAt || null,
  };
  const { error } = await requireSupabase().from("print_jobs").upsert(row, { onConflict: "id" });
  if (error) throw error;
}

let printJobCloudTimer;
function queuePrintJobCloudSave(job) {
  if (!job) return;
  if (!isAdminSignedIn()) {
    if (elements.historySaveStatus) elements.historySaveStatus.textContent = "บันทึกไว้ในเครื่องแล้ว · เข้าสู่ระบบเพื่อสำรองลง Supabase";
    return;
  }
  clearTimeout(printJobCloudTimer);
  printJobCloudTimer = setTimeout(async () => {
    try {
      await savePrintJobToSupabase(job);
      if (elements.historySaveStatus) elements.historySaveStatus.textContent = "บันทึกลง Supabase อัตโนมัติแล้ว";
    } catch (error) {
      console.warn("สำรองชุดงานไป Supabase ไม่สำเร็จ", error);
    }
  }, 700);
}

function queuePrintJobCloudDelete(id) {
  if (!isAdminSignedIn() || !id) return;
  requireSupabase().from("print_jobs").delete().eq("id", id).then(({ error }) => {
    if (error) console.warn("ลบประวัติจาก Supabase ไม่สำเร็จ", error);
  });
}

async function autoSyncPrintHistory() {
  if (!isAdminSignedIn()) return;
  try {
    await loadPrintJobsFromSupabase();
    for (const job of state.printJobs) {
      await savePrintJobToSupabase(job);
    }
    renderPrintHistory();
    elements.historySaveStatus.textContent = "บันทึกลง Supabase อัตโนมัติแล้ว";
  } catch (error) {
    console.error(error);
    elements.historySaveStatus.textContent = `บันทึก Supabase ไม่สำเร็จ: ${error.message}`;
  }
}

function renderCooperativeFilterOptions() {
  const showCooperativeFilters = state.category === "สหกรณ์และกลุ่มเกษตรกร";
  elements.responsibleUnitWrap.hidden = !showCooperativeFilters;
  elements.cooperativeTypeWrap.hidden = !showCooperativeFilters;
  if (!showCooperativeFilters) {
    state.responsibleUnit = "ทั้งหมด";
    state.cooperativeType = "ทั้งหมด";
    return;
  }

  const source = state.recipients.filter((item) => item.category === "สหกรณ์และกลุ่มเกษตรกร");
  const responsibleUnits = ["ทั้งหมด", ...new Set(source.map((item) => item.responsibleUnit).filter(Boolean))];
  const cooperativeTypes = ["ทั้งหมด", ...new Set(source.map((item) => item.cooperativeType).filter(Boolean))];

  elements.responsibleUnit.innerHTML = responsibleUnits
    .map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`)
    .join("");
  elements.cooperativeType.innerHTML = cooperativeTypes
    .map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`)
    .join("");

  if (!responsibleUnits.includes(state.responsibleUnit)) state.responsibleUnit = "ทั้งหมด";
  if (!cooperativeTypes.includes(state.cooperativeType)) state.cooperativeType = "ทั้งหมด";
  elements.responsibleUnit.value = state.responsibleUnit;
  elements.cooperativeType.value = state.cooperativeType;
}

function renderRows() {
  const rows = filteredRecipients();
  elements.rows.innerHTML = rows.map((item, index) => {
    const checked = state.selected.has(item.id);
    const classification = [item.responsibleUnit, item.cooperativeType].filter(Boolean).join(" · ");
    const displayName = recipientName(item);
    const positionLine = item.position && item.position !== displayName
      ? `<small class="recipient-position-line">${escapeHtml(item.position)}</small>`
      : "";
    const copies = recipientEnvelopeCopies(item.id);
    return `<tr class="${checked ? "selected-row" : ""}">
      <td class="check-cell"><input class="recipient-check" data-id="${escapeHtml(item.id)}" type="checkbox" ${checked ? "checked" : ""} aria-label="เลือก ${escapeHtml(recipientName(item))}"></td>
      <td class="copy-cell"><input class="copy-input" data-copy-id="${escapeHtml(item.id)}" type="number" min="1" max="20" step="1" value="${copies}" aria-label="จำนวนซองของ ${escapeHtml(recipientName(item))}"></td>
      <td class="sequence-cell"><span class="row-sequence">${index + 1}</span></td>
      <td class="recipient-name-cell"><strong>${escapeHtml(displayName)}</strong>${positionLine}</td>
      <td class="type-cell"><span class="category-badge ${categoryClass(item.category)}">${escapeHtml(item.category)}</span>${classification ? `<small class="recipient-classification">${escapeHtml(classification)}</small>` : ""}</td>
      <td class="department-cell"><span class="department-text">${escapeHtml(item.department || (item.category === "บุคคล" ? "บุคคล" : "ไม่ระบุหน่วยงาน"))}</span></td>
      <td class="address-cell"><span class="address-text">${escapeHtml(recipientFullAddress(item))}</span></td>
      <td class="action-cell"><div class="row-actions"><button class="row-button edit" data-edit-id="${escapeHtml(item.id)}" type="button">แก้ไข</button></div></td>
    </tr>`;
  }).join("");
  elements.empty.hidden = rows.length > 0;
  elements.selectAll.checked = rows.length > 0 && rows.every((item) => state.selected.has(item.id));
  document.querySelectorAll(".recipient-check").forEach((input) => {
    input.addEventListener("change", () => toggleRecipient(input.dataset.id));
  });
  document.querySelectorAll("[data-edit-id]").forEach((button) => {
    button.addEventListener("click", () => openEditRecipientDialog(button.dataset.editId));
  });
  document.querySelectorAll("[data-copy-id]").forEach((input) => {
    input.addEventListener("change", () => {
      const copies = setRecipientEnvelopeCopies(input.dataset.copyId, input.value);
      input.value = copies;
      persistSettings();
      saveCurrentPrintJobDraft();
      renderSummary();
      setNotice(`ตั้งจำนวนซองของรายชื่อนี้เป็น ${copies} ฉบับแล้ว`);
    });
    input.addEventListener("input", () => {
      setRecipientEnvelopeCopies(input.dataset.copyId, input.value);
      saveCurrentPrintJobDraft();
      renderSummary();
    });
  });
}

function renderSummary() {
  const selectedCount = state.selected.size;
  const selectedEnvelopeCount = state.recipients
    .filter((item) => state.selected.has(item.id))
    .reduce((total, item) => total + recipientEnvelopeCopies(item.id), 0);
  elements.heroSelected.textContent = selectedCount;
  elements.sideSelected.textContent = selectedEnvelopeCount;
  elements.paper.value = state.settings.paperSize;
  elements.recipientFont.value = state.settings.recipientFontPt;
  const paperLabels = {
    DL: "ซอง DL",
    C5: "ซอง C5",
    A4L: "กระดาษ A4 แนวนอน",
  };
  elements.showRecipientDepartment.checked = state.settings.showRecipientDepartment;
  elements.showRecipientAddress.checked = state.settings.showRecipientAddress;
  elements.showSender.checked = state.settings.showSender;
  elements.showGaruda.checked = state.settings.showGaruda;
  elements.showPostagePermit.checked = state.settings.showPostagePermit;
  elements.showGaruda.disabled = !state.settings.showSender;
  const envelopePreview = $("#envelopePreview");
  const senderPreviewBlock = $("#senderPreviewBlock");
  const garudaPreview = $("#garudaPreview");
  const senderPreview = $("#senderPreview");
  const postagePermitPreview = $("#postagePermitPreview");
  const previewPaperSizes = {
    DL: [220, 110],
    C5: [229, 162],
    A4L: [297, 210],
  };
  const [previewPaperWidth, previewPaperHeight] = previewPaperSizes[state.settings.paperSize] || previewPaperSizes.DL;
  envelopePreview.style.aspectRatio = `${previewPaperWidth} / ${previewPaperHeight}`;
  envelopePreview.setAttribute("aria-label", `${paperLabels[state.settings.paperSize] || paperLabels.DL} ขนาด ${previewPaperWidth} คูณ ${previewPaperHeight} มิลลิเมตร`);
  $("#previewSizeLabel").textContent = `${paperLabels[state.settings.paperSize] || paperLabels.DL} · ${previewPaperWidth} × ${previewPaperHeight} มม.`;
  const previewScale = (envelopePreview.clientWidth || 480) / previewPaperWidth;
  const ptToPreviewPx = (pt) => pt * (25.4 / 72) * previewScale;
  const senderTop = state.settings.senderTopMm * previewScale;
  const senderLeft = state.settings.senderLeftMm * previewScale;
  const garudaHeight = state.settings.garudaSizeMm * previewScale;
  const senderAddressPreview = escapeHtml(state.settings.senderAddress).replace(/\r?\n/g, "<br>");
  senderPreview.innerHTML = `<strong>${escapeHtml(state.settings.sender)}</strong><div class="sender-address-mini">${senderAddressPreview}</div>${state.settings.documentNumber ? `<div class="sender-document-mini">${escapeHtml(state.settings.documentNumber)}</div>` : ""}`;
  senderPreviewBlock.hidden = !state.settings.showSender;
  senderPreviewBlock.style.display = state.settings.showSender ? "" : "none";
  senderPreviewBlock.style.top = `${senderTop}px`;
  senderPreviewBlock.style.left = `${senderLeft}px`;
  senderPreviewBlock.style.fontSize = `${ptToPreviewPx(state.settings.senderFontPt)}px`;
  senderPreviewBlock.className = `sender-mini-block garuda-${state.settings.garudaPlacement === "left" ? "left" : "above"}`;
  senderPreview.style.paddingTop = state.settings.garudaPlacement === "left" ? `${state.settings.senderTextOffsetMm * previewScale}px` : "0";
  senderPreview.style.paddingLeft = "0";
  senderPreview.style.lineHeight = state.settings.senderLineHeight;
  senderPreviewBlock.style.gap = state.settings.garudaPlacement === "left" ? `${3 * previewScale}px` : "0";
  senderPreview.querySelector(".sender-address-mini").style.marginTop = `${0.7 * previewScale}px`;
  const senderDocumentPreview = senderPreview.querySelector(".sender-document-mini");
  if (senderDocumentPreview) senderDocumentPreview.style.marginTop = `${1.2 * previewScale}px`;
  postagePermitPreview.textContent = state.settings.postagePermitText;
  postagePermitPreview.style.display = state.settings.showPostagePermit ? "flex" : "none";
  postagePermitPreview.style.top = `${state.settings.postagePermitTopMm * previewScale}px`;
  postagePermitPreview.style.right = `${state.settings.postagePermitRightMm * previewScale}px`;
  postagePermitPreview.style.width = `${POSTAGE_PERMIT_WIDTH_MM * previewScale}px`;
  postagePermitPreview.style.height = `${POSTAGE_PERMIT_HEIGHT_MM * previewScale}px`;
  postagePermitPreview.style.padding = `${1.2 * previewScale}px`;
  postagePermitPreview.style.borderWidth = `${Math.max(1, 0.35 * previewScale)}px`;
  postagePermitPreview.style.fontSize = `${ptToPreviewPx(state.settings.postagePermitFontPt)}px`;
  postagePermitPreview.style.lineHeight = state.settings.postagePermitLineHeight;
  const receiverPreview = $("#receiverPreview");
  const selectedPreviewRecipients = state.recipients.filter((item) => state.selected.has(item.id));
  const previewRecipients = previewRecipientItems();
  if (state.previewRecipientIndex >= previewRecipients.length) state.previewRecipientIndex = 0;
  if (state.previewRecipientIndex < 0) state.previewRecipientIndex = Math.max(0, previewRecipients.length - 1);
  const previewRecipient = previewRecipients[state.previewRecipientIndex];
  elements.previewCounter.textContent = selectedPreviewRecipients.length
    ? `${state.previewRecipientIndex + 1} / ${selectedPreviewRecipients.length}`
    : "ตัวอย่าง";
  elements.previewPrevious.disabled = selectedPreviewRecipients.length <= 1;
  elements.previewNext.disabled = selectedPreviewRecipients.length <= 1;
  elements.openRecipientLineBreak.disabled = !previewRecipient;
  if (previewRecipient) {
    const previewLocality = [
      formatAddressArea("ตำบล", previewRecipient.subdistrict),
      formatAddressArea("อำเภอ", previewRecipient.district),
    ].filter(Boolean).join(" ");
    const previewProvince = formatAddressArea("จังหวัด", previewRecipient.province);
    const previewRecipientName = recipientEnvelopeName(previewRecipient);
    const previewDepartmentHtml = state.settings.showRecipientDepartment && previewRecipient.department && previewRecipientName !== previewRecipient.department
      ? `<p class="organization">${escapeHtml(previewRecipient.department)}</p>`
      : "";
    const previewAddressHtml = state.settings.showRecipientAddress
      ? `<p>${escapeHtml(previewRecipient.address1)}</p><p>${escapeHtml(previewLocality)}</p><p>${escapeHtml(previewProvince)}</p>${previewRecipient.postalCode ? `<p class="postal-code">${escapeHtml(previewRecipient.postalCode)}</p>` : ""}`
      : "";
    receiverPreview.innerHTML = `${recipientEnvelopeBlockHtml(previewRecipient)}<div class="recipient-detail">${previewDepartmentHtml}${previewAddressHtml}</div>`;
  } else {
    receiverPreview.innerHTML = '<div class="recipient-heading"><span class="recipient-greeting">เรียน</span><span class="recipient-name"><strong>เลือกผู้รับเพื่อดูตัวอย่าง</strong></span></div>';
  }
  receiverPreview.style.top = `${state.settings.recipientTopPercent}%`;
  receiverPreview.style.left = `${state.settings.recipientLeftPercent}%`;
  receiverPreview.style.width = `${RECIPIENT_BLOCK_WIDTH_PERCENT}%`;
  receiverPreview.style.lineHeight = state.settings.recipientLineHeight;
  const recipientPreviewFontPx = ptToPreviewPx(state.settings.recipientFontPt);
  receiverPreview.style.fontSize = `${recipientPreviewFontPx}px`;
  const receiverGreeting = receiverPreview.querySelector(".recipient-greeting");
  if (receiverGreeting) receiverGreeting.style.fontSize = `${recipientPreviewFontPx}px`;
  const receiverHeading = receiverPreview.querySelector("h1");
  if (receiverHeading) {
    receiverHeading.style.margin = `${1 * previewScale}px 0 0`;
    receiverHeading.style.fontSize = `${recipientPreviewFontPx}px`;
  }
  receiverPreview.querySelectorAll("p").forEach((line) => {
    line.style.margin = `${0.4 * previewScale}px 0`;
    line.style.fontSize = `${recipientPreviewFontPx}px`;
  });
  if (state.settings.showSender && state.settings.garudaImage) {
    garudaPreview.src = state.settings.garudaImage;
    garudaPreview.style.visibility = state.settings.showGaruda ? "visible" : "hidden";
    garudaPreview.style.width = "auto";
    garudaPreview.style.height = `${garudaHeight}px`;
    garudaPreview.style.marginBottom = state.settings.garudaPlacement === "above" ? `${2 * previewScale}px` : "0";
  } else {
    garudaPreview.style.visibility = "hidden";
    garudaPreview.removeAttribute("src");
    if (!state.settings.showSender) senderPreview.innerHTML = "";
  }
}

function render() {
  if (elements.printJobCreator) elements.printJobCreator.value = state.settings.printJobCreator || "";
  elements.category.value = state.category;
  renderCooperativeFilterOptions();
  renderRows();
  renderSummary();
}

function toggleRecipient(id) {
  if (state.selected.has(id)) state.selected.delete(id);
  else state.selected.add(id);
  renderRows();
  renderSummary();
  saveCurrentPrintJobDraft();
}

async function connectToDatabase() {
  if (!supabaseClient) {
    elements.status.className = "status-pill error";
    elements.status.querySelector("span").textContent = "ยังไม่ได้ตั้งค่า Supabase";
    setNotice("กรุณาตรวจสอบค่า Supabase ใน config.js");
    return;
  }

  elements.status.className = "status-pill loading";
  elements.status.querySelector("span").textContent = "กำลังเชื่อมฐานข้อมูล";
  setNotice("กำลังดึงข้อมูลจาก Supabase…");
  try {
    const rows = await requestRecipients();
    state.recipients = rows.map(normalizeRecipient);
    state.selected = new Set([...state.selected].filter((id) => state.recipients.some((item) => item.id === id)));
    state.connected = true;
    elements.status.className = "status-pill connected";
    elements.status.querySelector("span").textContent = "เชื่อม Supabase แล้ว";
    const restoredJob = restoreSavedPrintJobOnLoad();
    if (!restoredJob) render();
    setNotice(restoredJob
      ? `เปิดชุดงานที่ทำค้างไว้แล้ว ${state.selected.size} รายชื่อ`
      : `เชื่อมต่อสำเร็จ พบรายชื่อ ${rows.length} รายการ`);
  } catch (error) {
    console.error(error);
    state.connected = false;
    elements.status.className = "status-pill error";
    elements.status.querySelector("span").textContent = "เชื่อมต่อไม่สำเร็จ";
    setNotice(`เชื่อมต่อไม่สำเร็จ: ${error.message}`);
  }
}

async function openRecipientDialog() {
  if (!(await requireAdminSession())) return;
  state.editingRecipientId = null;
  elements.recipientForm.reset();
  elements.recipientFormMessage.textContent = "";
  elements.recipientFormMessage.className = "form-message";
  $("#recipientDialogTitle").textContent = "เพิ่มรายชื่อผู้รับ";
  $("#recipientDialogInfo").innerHTML = "ข้อมูลจะบันทึกลงฐานข้อมูล <strong>Supabase</strong> โดยตรง";
  elements.saveRecipient.textContent = "บันทึกข้อมูลผู้รับ";
  elements.deleteRecipientButton.hidden = true;
  updateRecipientFormRequirements();
  elements.recipientDialog.showModal();
}

async function openEditRecipientDialog(id) {
  if (!(await requireAdminSession())) return;
  const recipient = state.recipients.find((item) => item.id === id);
  if (!recipient) {
    setNotice("ไม่พบรายการผู้รับที่ต้องการแก้ไข");
    return;
  }

  state.editingRecipientId = id;
  elements.recipientForm.reset();
  elements.recipientFormMessage.textContent = "";
  elements.recipientFormMessage.className = "form-message";
  $("#recipientDialogTitle").textContent = "แก้ไขข้อมูลผู้รับ";
  $("#recipientDialogInfo").innerHTML = "บันทึกการแก้ไขกลับไปยังรายการเดิมในฐานข้อมูล <strong>Supabase</strong>";
  elements.saveRecipient.textContent = "บันทึกการแก้ไข";
  elements.deleteRecipientButton.hidden = false;

  elements.recipientForm.elements.category.value = recipient.category;
  updateRecipientFormRequirements();
  const fields = [
    "prefix", "firstName", "lastName", "position", "department", "responsibleUnit", "cooperativeType", "address1",
    "subdistrict", "district", "province", "postalCode",
  ];
  fields.forEach((name) => {
    elements.recipientForm.elements[name].value = recipient[name] || "";
  });
  elements.recipientDialog.showModal();
}

function updateRecipientFormRequirements() {
  const isPerson = elements.recipientForm.elements.category.value === "บุคคล";
  const isCooperative = elements.recipientForm.elements.category.value === "สหกรณ์และกลุ่มเกษตรกร";
  const department = elements.recipientForm.elements.department;
  const responsibleUnit = elements.recipientForm.elements.responsibleUnit;
  const cooperativeClassificationFields = $("#cooperativeClassificationFields");
  $("#prefixField").hidden = !isPerson;
  $("#personNameFields").hidden = !isPerson;
  cooperativeClassificationFields.hidden = !isCooperative;
  setGroupDisabled(cooperativeClassificationFields, !isCooperative);
  $("#categoryAndPrefixFields").classList.toggle("single", !isPerson);
  if (!isPerson) {
    elements.recipientForm.elements.prefix.value = "";
    elements.recipientForm.elements.firstName.value = "";
    elements.recipientForm.elements.lastName.value = "";
  }
  if (!isCooperative) {
    setGroupDisabled(cooperativeClassificationFields, false);
    responsibleUnit.value = "";
    elements.recipientForm.elements.cooperativeType.value = "";
    setGroupDisabled(cooperativeClassificationFields, true);
  }
  responsibleUnit.required = isCooperative;
  department.required = !isPerson;
  $("#departmentFieldLabel").textContent = isPerson ? "หน่วยงาน (ถ้ามี)" : "ชื่อหน่วยงาน *";
  $("#departmentFieldHint").textContent = isPerson
    ? "เว้นว่างได้สำหรับผู้รับที่เป็นบุคคล"
    : "จำเป็นสำหรับหน่วยงาน องค์กร และกลุ่ม";
}

function closeRecipientDialog() {
  if (elements.recipientDialog.open) elements.recipientDialog.close();
  state.editingRecipientId = null;
}

function fillRecipientLayoutForm() {
  const fields = ["recipientTopPercent", "recipientLeftPercent", "recipientLineHeight"];
  fields.forEach((name) => {
    elements.recipientLayoutForm.elements[name].value = state.settings[name];
  });
}

function openRecipientLayoutSettings() {
  fillRecipientLayoutForm();
  elements.recipientLayoutDialog.showModal();
}

function closeRecipientLayoutSettings() {
  if (elements.recipientLayoutDialog.open) elements.recipientLayoutDialog.close();
}

function openRecipientLineBreakDialog() {
  const recipient = currentPreviewRecipient();
  if (!recipient) {
    setNotice("กรุณาเลือกผู้รับก่อนกำหนดจุดตัดบรรทัด");
    return;
  }
  elements.recipientLineBreakForm.dataset.recipientId = recipient.id;
  elements.recipientLineBreakText.value = recipientEnvelopeDisplayName(recipient);
  elements.recipientLineBreakMessage.textContent = "";
  elements.recipientLineBreakMessage.className = "form-message";
  elements.recipientLineBreakDialog.showModal();
  elements.recipientLineBreakText.focus();
}

function closeRecipientLineBreakDialog() {
  if (elements.recipientLineBreakDialog.open) elements.recipientLineBreakDialog.close();
  elements.recipientLineBreakForm.dataset.recipientId = "";
}

function clearRecipientLineBreak() {
  const recipientId = elements.recipientLineBreakForm.dataset.recipientId;
  const recipient = state.recipients.find((item) => item.id === recipientId);
  if (!recipient) return;
  delete state.settings.recipientNameBreaksById[recipientId];
  persistSettings();
  renderSummary();
  closeRecipientLineBreakDialog();
  setNotice("ยกเลิกการตัดบรรทัดของหน้าปัจจุบันแล้ว");
}

function handleRecipientLineBreakSubmit(event) {
  event.preventDefault();
  const recipientId = elements.recipientLineBreakForm.dataset.recipientId;
  const recipient = state.recipients.find((item) => item.id === recipientId);
  if (!recipient) return;
  const original = recipientEnvelopeName(recipient);
  const formatted = normalizeRecipientNameBreaks(elements.recipientLineBreakText.value);
  if (!formatted || compactRecipientName(formatted) !== compactRecipientName(original)) {
    elements.recipientLineBreakMessage.textContent = "กรุณาคงข้อความเดิมไว้ครบถ้วน และเพิ่มเฉพาะจุดขึ้นบรรทัดใหม่";
    elements.recipientLineBreakMessage.className = "form-message error";
    return;
  }
  if (formatted.includes("\n")) state.settings.recipientNameBreaksById[recipientId] = formatted;
  else delete state.settings.recipientNameBreaksById[recipientId];
  persistSettings();
  renderSummary();
  closeRecipientLineBreakDialog();
  setNotice(formatted.includes("\n") ? "บันทึกจุดตัดบรรทัดของหน้าปัจจุบันแล้ว" : "ตั้งชื่อผู้รับเป็นบรรทัดเดียวแล้ว");
}

function resetRecipientLayout() {
  const profile = defaultPaperLayout();
  elements.recipientLayoutForm.elements.recipientTopPercent.value = profile.recipientTopPercent;
  elements.recipientLayoutForm.elements.recipientLeftPercent.value = profile.recipientLeftPercent;
  elements.recipientLayoutForm.elements.recipientLineHeight.value = profile.recipientLineHeight;
}

function handleRecipientLayoutSubmit(event) {
  event.preventDefault();
  if (!elements.recipientLayoutForm.reportValidity()) return;
  const values = Object.fromEntries(new FormData(elements.recipientLayoutForm).entries());
  state.settings.recipientTopPercent = clampNumber(values.recipientTopPercent, 5, 85, 40);
  state.settings.recipientLeftPercent = clampNumber(values.recipientLeftPercent, 5, 80, 42);
  state.settings.recipientLineHeight = clampNumber(values.recipientLineHeight, 1, 2.2, 1.5);
  persistSettings();
  renderSummary();
  closeRecipientLayoutSettings();
  setNotice("บันทึกตำแหน่งและระยะผู้รับแล้ว");
}

function fillSenderForm() {
  const fields = [
    "sender", "senderAddress", "documentNumber", "garudaPlacement",
    "garudaSizeMm", "senderTopMm", "senderLeftMm", "senderTextOffsetMm", "senderFontPt", "senderLineHeight",
  ];
  fields.forEach((name) => {
    elements.senderForm.elements[name].value = state.settings[name];
  });
}

function openSenderSettings() {
  fillSenderForm();
  elements.senderDialog.showModal();
}

function closeSenderSettings() {
  if (elements.senderDialog.open) elements.senderDialog.close();
}

function resetSenderLayout() {
  const profile = defaultPaperLayout();
  elements.senderForm.elements.garudaPlacement.value = profile.garudaPlacement;
  elements.senderForm.elements.garudaSizeMm.value = profile.garudaSizeMm;
  elements.senderForm.elements.senderTopMm.value = profile.senderTopMm;
  elements.senderForm.elements.senderLeftMm.value = profile.senderLeftMm;
  elements.senderForm.elements.senderTextOffsetMm.value = profile.senderTextOffsetMm;
  elements.senderForm.elements.senderFontPt.value = profile.senderFontPt;
  elements.senderForm.elements.senderLineHeight.value = profile.senderLineHeight;
}

function handleSenderSubmit(event) {
  event.preventDefault();
  if (!elements.senderForm.reportValidity()) return;
  const values = Object.fromEntries(new FormData(elements.senderForm).entries());
  state.settings.sender = String(values.sender || "").trim();
  state.settings.senderAddress = String(values.senderAddress || "").trim();
  state.settings.documentNumber = String(values.documentNumber || "").trim();
  state.settings.garudaPlacement = values.garudaPlacement === "above" ? "above" : "left";
  state.settings.garudaSizeMm = clampNumber(values.garudaSizeMm, 8, 30, 15);
  state.settings.senderTopMm = clampNumber(values.senderTopMm, 0, 40, 6);
  state.settings.senderLeftMm = clampNumber(values.senderLeftMm, 0, 60, 14);
  state.settings.senderTextOffsetMm = clampNumber(values.senderTextOffsetMm, 0, 30, 10);
  state.settings.senderFontPt = clampNumber(values.senderFontPt, 7, 20, 9.5);
  state.settings.senderLineHeight = clampNumber(values.senderLineHeight, 1, 2.2, 1.45);
  persistSettings();
  renderSummary();
  closeSenderSettings();
  setNotice("บันทึกข้อมูลและตำแหน่งผู้ส่งแล้ว");
}

function fillPostagePermitForm() {
  const fields = ["postagePermitText", "postagePermitTopMm", "postagePermitRightMm", "postagePermitFontPt", "postagePermitLineHeight"];
  fields.forEach((name) => {
    elements.postagePermitForm.elements[name].value = state.settings[name];
  });
}

function openPostagePermitSettings() {
  fillPostagePermitForm();
  elements.postagePermitDialog.showModal();
}

function closePostagePermitSettings() {
  if (elements.postagePermitDialog.open) elements.postagePermitDialog.close();
}

function resetPostagePermit() {
  const profile = defaultPaperLayout();
  elements.postagePermitForm.elements.postagePermitText.value = defaults.postagePermitText || "ชำระค่าฝากส่งเป็นรายเดือน\nใบอนุญาตเลขที่ xx/xxx\nไปรษณีย์เดชาวุธ";
  elements.postagePermitForm.elements.postagePermitTopMm.value = profile.postagePermitTopMm;
  elements.postagePermitForm.elements.postagePermitRightMm.value = profile.postagePermitRightMm;
  elements.postagePermitForm.elements.postagePermitFontPt.value = profile.postagePermitFontPt;
  elements.postagePermitForm.elements.postagePermitLineHeight.value = profile.postagePermitLineHeight;
}

function handlePostagePermitSubmit(event) {
  event.preventDefault();
  if (!elements.postagePermitForm.reportValidity()) return;
  const values = Object.fromEntries(new FormData(elements.postagePermitForm).entries());
  state.settings.postagePermitText = String(values.postagePermitText || "").trim();
  state.settings.postagePermitTopMm = clampNumber(values.postagePermitTopMm, 0, 40, 7);
  state.settings.postagePermitRightMm = clampNumber(values.postagePermitRightMm, 0, 60, 8);
  state.settings.postagePermitFontPt = clampNumber(values.postagePermitFontPt, 6, 14, 8.5);
  state.settings.postagePermitLineHeight = clampNumber(values.postagePermitLineHeight, 1, 2, 1.15);
  persistSettings();
  renderSummary();
  closePostagePermitSettings();
  setNotice("บันทึกข้อความกรอบค่าฝากส่งแล้ว");
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function recipientPayloadMatches(row, payload) {
  const fields = [
    "category", "prefix", "firstName", "lastName", "position", "department",
    "responsibleUnit", "cooperativeType", "address1", "subdistrict", "district", "province", "postalCode",
  ];
  return fields.every((field) => String(row[field] || "").trim() === String(payload[field] || "").trim());
}

async function postRecipient(payload) {
  if (!(await requireAdminSession())) throw new Error("กรุณาเข้าสู่ระบบผู้ดูแล");
  const row = recipientToSupabase(payload);
  const query = payload.action === "updateRecipient"
    ? requireSupabase().from("recipients").update(row).eq("id", payload.id)
    : requireSupabase().from("recipients").insert(row);
  const { error } = await query;
  if (error) throw error;
  return requestRecipients();
}

async function handleRecipientSubmit(event) {
  event.preventDefault();
  if (!elements.recipientForm.reportValidity()) return;

  const isEditing = Boolean(state.editingRecipientId);
  const recipientId = state.editingRecipientId;
  const values = Object.fromEntries(new FormData(elements.recipientForm).entries());
  const payload = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, String(value).trim()]));
  if (payload.category !== CATEGORIES[1]) {
    payload.responsibleUnit = "";
    payload.cooperativeType = "";
  }
  if (payload.category === "บุคคล" && !payload.firstName && !payload.lastName) {
    elements.recipientFormMessage.textContent = "ประเภทบุคคลต้องระบุชื่อหรือนามสกุล";
    elements.recipientFormMessage.className = "form-message error";
    elements.recipientForm.elements.firstName.focus();
    return;
  }
  if (payload.category !== "บุคคล" && !payload.department) {
    elements.recipientFormMessage.textContent = "กรุณากรอกชื่อหน่วยงาน";
    elements.recipientFormMessage.className = "form-message error";
    elements.recipientForm.elements.department.focus();
    return;
  }
  payload.action = isEditing ? "updateRecipient" : "createRecipient";
  payload.id = isEditing
    ? recipientId
    : `WEB-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

  elements.saveRecipient.disabled = true;
  elements.saveRecipient.textContent = "กำลังบันทึก…";
  elements.recipientFormMessage.textContent = isEditing
    ? "กำลังบันทึกการแก้ไขไปยัง Supabase…"
    : "กำลังบันทึกข้อมูลไปยัง Supabase…";
  elements.recipientFormMessage.className = "form-message";

  try {
    const rows = await postRecipient(payload);
    state.recipients = rows.map(normalizeRecipient);
    state.category = payload.category;
    state.responsibleUnit = "ทั้งหมด";
    state.cooperativeType = "ทั้งหมด";
    state.selected.add(payload.id);
    render();
    elements.recipientFormMessage.textContent = isEditing ? "แก้ไขข้อมูลเรียบร้อยแล้ว" : "บันทึกข้อมูลเรียบร้อยแล้ว";
    elements.recipientFormMessage.className = "form-message success";
    const savedName = recipientName(normalizeRecipient(payload));
    setNotice(isEditing ? `แก้ไข ${savedName} แล้ว` : `เพิ่ม ${savedName} ลงฐานข้อมูลแล้ว`);
    await delay(500);
    closeRecipientDialog();
  } catch (error) {
    console.error(error);
    elements.recipientFormMessage.textContent = error.message;
    elements.recipientFormMessage.className = "form-message error";
  } finally {
    elements.saveRecipient.disabled = false;
    elements.saveRecipient.textContent = isEditing ? "บันทึกการแก้ไข" : "บันทึกข้อมูลผู้รับ";
  }
}

async function deleteRecipient(id) {
  if (!(await requireAdminSession())) return;
  const recipient = state.recipients.find((item) => item.id === id);
  if (!recipient) {
    setNotice("ไม่พบรายการผู้รับที่ต้องการลบ");
    return;
  }

  const name = recipientName(recipient);
  elements.deleteRecipientName.textContent = name;
  elements.deleteRecipientMessage.textContent = "";
  elements.deleteRecipientMessage.className = "form-message";
  elements.deleteRecipientForm.reset();
  elements.deleteRecipientDialog.dataset.recipientId = id;
  elements.deleteRecipientDialog.showModal();
  elements.deleteRecipientPassword?.focus();
}

async function handleDeleteRecipientSubmit(event) {
  event.preventDefault();
  if (!elements.deleteRecipientForm.reportValidity()) return;

  const id = elements.deleteRecipientDialog.dataset.recipientId || "";
  const recipient = state.recipients.find((item) => item.id === id);
  if (!recipient) {
    elements.deleteRecipientMessage.textContent = "ไม่พบรายการผู้รับที่ต้องการลบ";
    elements.deleteRecipientMessage.className = "form-message error";
    return;
  }

  const name = recipientName(recipient);
  const deletePassword = elements.deleteRecipientPassword.value;
  elements.confirmDeleteRecipient.disabled = true;
  elements.confirmDeleteRecipient.textContent = "กำลังตรวจสอบ…";
  elements.deleteRecipientMessage.textContent = "กำลังตรวจสอบรหัสยืนยันการลบ…";
  elements.deleteRecipientMessage.className = "form-message";
  setNotice("กำลังตรวจสอบรหัสยืนยันการลบ…");

  try {
    try {
      await signInAdminWithPassword(deletePassword);
    } catch (error) {
      elements.deleteRecipientMessage.textContent = "รหัสยืนยันการลบไม่ถูกต้อง กรุณาตรวจสอบแล้วลองใหม่";
      elements.deleteRecipientMessage.className = "form-message error";
      elements.deleteRecipientPassword.select();
      setNotice("รหัสยืนยันการลบไม่ถูกต้อง");
      return;
    }
    elements.confirmDeleteRecipient.textContent = "กำลังลบ…";
    elements.deleteRecipientMessage.textContent = `กำลังลบ ${name} จาก Supabase…`;
    setNotice(`กำลังลบ ${name} จาก Supabase…`);
    const { error } = await requireSupabase().from("recipients").delete().eq("id", id);
    if (error) throw error;
    const rows = await requestRecipients();
    state.recipients = rows.map(normalizeRecipient);
    state.selected.delete(id);
    closeDeleteRecipientDialog();
    closeRecipientDialog();
    render();
    setNotice(`ลบ ${name} ออกจากฐานข้อมูลแล้ว`);
    return;
  } catch (error) {
    console.error(error);
    elements.deleteRecipientMessage.textContent = error.message;
    elements.deleteRecipientMessage.className = "form-message error";
    setNotice(`ลบข้อมูลไม่สำเร็จ: ${error.message}`);
  } finally {
    elements.confirmDeleteRecipient.disabled = false;
    elements.confirmDeleteRecipient.textContent = "ยืนยันลบข้อมูล";
  }
}

function closeDeleteRecipientDialog() {
  if (elements.deleteRecipientDialog.open) elements.deleteRecipientDialog.close();
  elements.deleteRecipientDialog.dataset.recipientId = "";
}

function openManifestDialog() {
  if (!requirePrintJobCreator()) return;
  const jobs = selectedEnvelopeJobs();
  persistSettings();
  if (!jobs.length) {
    setNotice("โปรดเลือกรายชื่อผู้รับอย่างน้อย 1 รายการก่อนพิมพ์ใบนำส่ง");
    return;
  }
  const job = saveCurrentPrintJobDraft({}, { force: true });
  elements.manifestDate.value = job?.manifestDate || localIsoDate();
  elements.manifestPermit.value = defaultManifestPermit();
  elements.manifestRegisteredPrefix.value = state.settings.manifestRegisteredPrefix || "";
  elements.manifestEmsPrefix.value = state.settings.manifestEmsPrefix || "";
  const registeredPrefix = normalizeManifestPrefix(elements.manifestRegisteredPrefix.value, "RJ");
  const emsPrefix = normalizeManifestPrefix(elements.manifestEmsPrefix.value, "EQ");
  elements.manifestRegisteredPrefix.value = registeredPrefix;
  elements.manifestEmsPrefix.value = emsPrefix;
  const registeredUsesPrefix = /^[A-Z]{2}[0-9๐-๙]{5}$/.test(registeredPrefix);
  const emsUsesPrefix = /^[A-Z]{2}[0-9๐-๙]{5}$/.test(emsPrefix);
  elements.manifestRows.dataset.printJobId = job?.id || "";
  elements.manifestRows.innerHTML = jobs.map(({ item, copyIndex }, index) => {
    const name = manifestRecipientLabel(item);
    const jobKey = printJobTrackingKey(item.id, copyIndex);
    const savedTracking = job?.tracking?.[jobKey] || {};
    const savedRegistered = normalizeTrackingDigits(savedTracking.registered || "");
    const savedEms = savedRegistered ? "" : normalizeTrackingDigits(savedTracking.ems || "");
    const registeredValue = manifestTrackingEntryValue(savedRegistered, registeredPrefix);
    const emsValue = manifestTrackingEntryValue(savedEms, emsPrefix);
    return `<tr data-recipient-id="${escapeHtml(item.id)}" data-job-key="${escapeHtml(jobKey)}">
      <td>${index + 1}</td>
      <td><div class="manifest-recipient-name">${escapeHtml(name)}</div></td>
      <td>${escapeHtml(item.postalCode || "")}</td>
      <td><input name="registered-${index}" class="tracking-input" data-tracking-type="registered" data-locked-prefix="${escapeHtml(registeredUsesPrefix ? registeredPrefix : "")}" type="text" inputmode="numeric" autocomplete="off" maxlength="${registeredUsesPrefix ? 4 : 9}" pattern="[0-9๐-๙]{${registeredUsesPrefix ? 4 : 9}}" title="${registeredUsesPrefix ? `กรอก 4 ตัวท้าย ต่อจาก ${escapeHtml(registeredPrefix)}` : "กรอกตัวเลข 9 หลัก"}" placeholder="${registeredUsesPrefix ? "4 ตัวท้าย" : "ตัวเลข 9 หลัก"}" value="${escapeHtml(registeredValue)}" /></td>
      <td><input name="ems-${index}" class="tracking-input" data-tracking-type="ems" data-locked-prefix="${escapeHtml(emsUsesPrefix ? emsPrefix : "")}" type="text" inputmode="numeric" autocomplete="off" maxlength="${emsUsesPrefix ? 4 : 9}" pattern="[0-9๐-๙]{${emsUsesPrefix ? 4 : 9}}" title="${emsUsesPrefix ? `กรอก 4 ตัวท้าย ต่อจาก ${escapeHtml(emsPrefix)}` : "กรอกตัวเลข 9 หลัก"}" placeholder="${emsUsesPrefix ? "4 ตัวท้าย" : "ตัวเลข 9 หลัก"}" value="${escapeHtml(emsValue)}" /></td>
    </tr>`;
  }).join("");
  elements.manifestRows.querySelectorAll(".tracking-input").forEach((input) => {
    input.addEventListener("input", limitTrackingInput);
    input.addEventListener("input", () => {
      updateManifestRowTrackingState(input.closest("tr"), input);
      saveCurrentPrintJobDraft();
      focusNextManifestTrackingInput(input);
    });
  });
  elements.manifestRows.querySelectorAll("tr[data-job-key]").forEach((row) => updateManifestRowTrackingState(row));
  elements.mailingManifestDialog.showModal();
}

function closeManifestDialog() {
  saveCurrentPrintJobDraft();
  if (elements.mailingManifestDialog.open) elements.mailingManifestDialog.close();
}

function printMailingManifest(event) {
  event.preventDefault();
  const jobs = selectedEnvelopeJobs();
  persistSettings();
  if (!jobs.length) {
    closeManifestDialog();
    setNotice("โปรดเลือกรายชื่อผู้รับอย่างน้อย 1 รายการก่อนพิมพ์ใบนำส่ง");
    return;
  }

  const form = new FormData(elements.mailingManifestForm);
  const invalidTrackingInput = [...elements.manifestRows.querySelectorAll(".tracking-input")]
    .find((input) => input.value.trim() && normalizeTrackingDigits(fullManifestTrackingValue(input)).length !== 9);
  if (invalidTrackingInput) {
    const expected = manifestPrefixForInput(invalidTrackingInput) ? "4 ตัวท้าย" : "ตัวเลข 9 หลัก";
    invalidTrackingInput.setCustomValidity(`กรุณากรอก${expected}ให้ครบ`);
    invalidTrackingInput.reportValidity();
    return;
  }
  const manifestDate = formatThaiLongDate(form.get("manifestDate"));
  const permit = LOCKED_MANIFEST_PERMIT;
  const receivingPostOffice = extractReceivingPostOffice(permit);
  const rows = jobs.map(({ item }, index) => {
    const registeredInput = elements.manifestRows.querySelector(`[name="registered-${index}"]`);
    const emsInput = elements.manifestRows.querySelector(`[name="ems-${index}"]`);
    return {
      index: index + 1,
      name: manifestRecipientLabel(item),
      destination: item.postalCode || "",
      registered: formatTrackingCode(fullManifestTrackingValue(registeredInput), "RJ"),
      ems: formatTrackingCode(fullManifestTrackingValue(emsInput), "EQ"),
    };
  });
  const pageSize = 30;
  const pages = [];
  for (let start = 0; start < rows.length; start += pageSize) {
    pages.push(rows.slice(start, start + pageSize));
  }

  const sender = state.settings.sender || "สำนักงานสหกรณ์จังหวัดขอนแก่น";
  const manifestPages = pages.map((pageRows, pageIndex) => {
    const pageDisplayRows = pageRows.map((row, index) => ({ ...row, index: index + 1 }));
    const blankRows = Array.from({ length: Math.max(0, pageSize - pageDisplayRows.length) }, (_, index) => ({
      index: pageDisplayRows.length + index + 1,
      name: "",
      destination: "",
      registered: "",
      ems: "",
    }));
    const allRows = [...pageDisplayRows, ...blankRows];
    const bodyRows = allRows.map((row) => `<tr>
      <td class="center">${row.index}</td>
      <td class="recipient-cell"${manifestRecipientFontStyle(row.name)}><span class="recipient-name-text${String(row.name).trim().length > 80 ? " recipient-name-text-long" : ""}">${escapeHtml(row.name)}</span></td>
      <td class="center">${escapeHtml(row.destination)}</td>
      <td class="center tracking">${escapeHtml(row.registered)}</td>
      <td class="center tracking">${escapeHtml(row.ems)}</td>
      <td></td>
      <td></td>
    </tr>`).join("");
    const pageNumber = pages.length > 1 ? `<div class="page-number">-${pageIndex + 1}-</div>` : "";
    return `<section class="manifest-page">
      ${pageNumber}
      <h1>ใบนำส่งของทางไปรษณีย์โดยชำระค่าบริการเป็นสินเชื่อ</h1>
      <div class="manifest-meta" style="width:max-content;min-width:52.5mm;white-space:nowrap">
        <div>วัน/เดือน/ปี…${escapeHtml(manifestDate)}.......</div>
        <div>ชื่อหน่วยงาน ${escapeHtml(sender)}</div>
        ${permit ? `<div>${escapeHtml(permit)}</div>` : ""}
      </div>
      <p class="manifest-intro">ได้ฝากส่งสิ่งของของทางไปรษณีย์โดยชำระค่าบริการเป็นเงินเชื่อดังรายการต่อไปนี้</p>
      <table class="manifest-print-table">
        <colgroup>
          <col class="col-seq"><col class="col-name"><col class="col-dest">
          <col class="col-registered"><col class="col-ems">
          <col class="col-fee"><col class="col-note">
        </colgroup>
        <thead><tr><th>ลำดับ</th><th>ผู้รับ</th><th>ปลายทาง</th><th>ลงทะเบียน</th><th>EMS</th><th>ค่าบริการ</th><th>หมายเหตุ</th></tr></thead>
        <tbody>${bodyRows}</tbody>
      </table>
      <div class="manifest-footer">
        <div class="manifest-footer-left">
          <p>รวม&nbsp;&nbsp; จำนวน ......................${pageRows.length}...................... ฉบับ</p>
          <p>ธรรมดา จำนวน....................-...................... ฉบับ</p>
        </div>
        <div class="manifest-footer-right">
          <p class="total-line">รวมทั้งสิ้น....................${pageRows.length}....................ฉบับ</p>
          <p class="sign-line"><span>ลงชื่อ</span><span class="sign-dots"></span></p>
          <p class="role-line">ผู้รับผิดชอบในการฝากส่ง</p>
          <p class="check-line">ได้ตรวจสอบและรับฝากไว้ถูกต้องแล้ว</p>
          <p class="signature sign-line"><span>ลงชื่อ</span><span class="sign-dots"></span></p>
          <p class="role-line">เจ้าหน้าที่รับฝาก${receivingPostOffice ? ` ${escapeHtml(receivingPostOffice)}` : ""}</p>
        </div>
      </div>
    </section>`;
  }).join("");

  const popup = window.open("", "_blank");
  if (!popup) {
    setNotice("เบราว์เซอร์บล็อกหน้าพิมพ์ กรุณาอนุญาต Pop-up แล้วลองอีกครั้ง");
    return;
  }
  popup.opener = null;
  popup.document.write(`<!doctype html><html lang="th"><head><meta charset="utf-8"><title>พิมพ์ใบนำส่งไปรษณีย์</title><style>${printFontFaceCss()}@page{size:A4 portrait;margin:8mm}*{box-sizing:border-box}body{margin:0;color:#111;font-family:"TH Sarabun New","Noto Sans Thai",Tahoma,sans-serif;font-size:13pt}.manifest-page{position:relative;width:194mm;min-height:281mm;margin:0 auto;page-break-after:always;background:#fff}.manifest-page:last-child{page-break-after:auto}.page-number{position:absolute;top:0;right:0;font-size:12pt}h1{margin:0 0 2.5mm;text-align:center;font-size:15pt;font-weight:700}.manifest-meta{width:52.5mm;margin:0 0 2.5mm auto;line-height:1.12;font-size:12.5pt;text-align:left}.manifest-intro{margin:0 0 .8mm 10mm;font-size:12.5pt;line-height:1.08}.manifest-print-table{width:192mm;max-width:100%;border-collapse:collapse;table-layout:fixed}.manifest-print-table th,.manifest-print-table td{height:6.25mm;padding:0 1.2mm;border:1px solid #111;vertical-align:middle;line-height:1.04}.manifest-print-table th{text-align:center;font-size:11.5pt;font-weight:700;white-space:nowrap}.center{text-align:center}.recipient-cell{font-size:12pt;overflow:hidden}.recipient-name-text{display:block;overflow:hidden;white-space:nowrap}.recipient-name-text-long{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;white-space:normal}.tracking{font-size:12pt;white-space:nowrap}.col-seq{width:9mm}.col-name{width:78mm}.col-dest{width:16mm}.col-registered{width:28mm}.col-ems{width:28mm}.col-fee{width:18mm}.col-note{width:12mm}.manifest-footer{position:relative;height:36mm;margin-top:3mm;line-height:1.18;font-size:14pt}.manifest-footer p{margin:0}.manifest-footer-left{position:absolute;left:9mm;top:1mm;width:82mm}.manifest-footer-left p+p{margin-top:1.6mm}.manifest-footer-right{position:absolute;left:116mm;top:0;width:78mm;margin-left:0}.manifest-footer-right p{margin:0}.total-line{margin-bottom:1.6mm!important;text-align:left}.sign-line{display:flex;align-items:flex-end;text-align:left}.sign-line span:first-child{flex:0 0 auto}.sign-dots{display:block;width:64mm;height:.9em;border-bottom:1px dotted #111}.role-line{width:64mm;margin-top:.4mm!important;margin-left:10mm;text-align:center}.check-line{margin-top:2.2mm!important;text-align:left}.signature{margin-top:4mm!important}@media screen{body{background:#eef2f7;padding:18px}.manifest-page{padding:0;box-shadow:0 12px 36px rgba(15,23,42,.14)}}</style></head><body>${manifestPages}<script>addEventListener('load',()=>setTimeout(()=>print(),250));<\/script></body></html>`);
  popup.document.close();
  saveCurrentPrintJobDraft({ manifestPrintedAt: new Date().toISOString() });
  closeManifestDialog();
  setNotice(`เตรียมพิมพ์ใบนำส่ง ${jobs.length} รายการแล้ว และบันทึกลงประวัติแล้ว`);
}

function printEnvelopes() {
  if (!requirePrintJobCreator()) return;
  const jobs = selectedEnvelopeJobs();
  persistSettings();
  const selectedCount = state.selected.size;
  if (!jobs.length) {
    setNotice("โปรดเลือกรายชื่อผู้รับอย่างน้อย 1 รายการ");
    return;
  }
  const sizes = {
    DL: ["220mm", "110mm", "ซอง DL"],
    C5: ["229mm", "162mm", "ซอง C5"],
    A4L: ["297mm", "210mm", "กระดาษ A4 แนวนอน"],
  };
  const [width, height, label] = sizes[state.settings.paperSize] || sizes.DL;
  const senderClass = state.settings.garudaPlacement === "left"
    ? "sender garuda-left"
    : "sender garuda-above";
  const garudaMarkup = state.settings.showSender && state.settings.garudaImage
    ? `<img class="garuda${state.settings.showGaruda ? "" : " garuda-hidden"}" src="${state.settings.garudaImage}" alt="${state.settings.showGaruda ? "ตราครุฑ" : ""}">`
    : "";
  const senderAddressHtml = escapeHtml(state.settings.senderAddress).replace(/\r?\n/g, "<br>");
  const documentNumberHtml = state.settings.documentNumber
    ? `<div class="document-number">${escapeHtml(state.settings.documentNumber)}</div>`
    : "";
  const senderBlockHtml = state.settings.showSender
    ? `<div class="${senderClass}">${garudaMarkup}<div class="sender-content"><strong>${escapeHtml(state.settings.sender)}</strong><div class="sender-address">${senderAddressHtml}</div>${documentNumberHtml}</div></div>`
    : "";
  const senderTopMm = clampNumber(state.settings.senderTopMm, 0, 40, 6);
  const senderLeftMm = clampNumber(state.settings.senderLeftMm, 0, 60, 14);
  const senderTextOffsetMm = clampNumber(state.settings.senderTextOffsetMm, 0, 30, 10);
  const senderFontPt = clampNumber(state.settings.senderFontPt, 7, 20, 9.5);
  const senderLineHeight = clampNumber(state.settings.senderLineHeight, 1, 2.2, 1.45);
  const garudaSizeMm = clampNumber(state.settings.garudaSizeMm, 8, 30, 15);
  const postagePermitTopMm = clampNumber(state.settings.postagePermitTopMm, 0, 40, 7);
  const postagePermitRightMm = clampNumber(state.settings.postagePermitRightMm, 0, 60, 8);
  const postagePermitFontPt = clampNumber(state.settings.postagePermitFontPt, 6, 14, 8.5);
  const postagePermitLineHeight = clampNumber(state.settings.postagePermitLineHeight, 1, 2, 1.15);
  const recipientFontPt = clampNumber(state.settings.recipientFontPt, 8, 24, 12);
  const recipientTopPercent = clampNumber(state.settings.recipientTopPercent, 5, 85, 40);
  const recipientLeftPercent = clampNumber(state.settings.recipientLeftPercent, 5, 80, 42);
  const recipientLineHeight = clampNumber(state.settings.recipientLineHeight, 1, 2.2, 1.5);
  const postagePermitHtml = escapeHtml(state.settings.postagePermitText).replace(/\r?\n/g, "<br>");
  const postagePermitBlockHtml = state.settings.showPostagePermit
    ? `<div class="postage-permit">${postagePermitHtml}</div>`
    : "";
  const pages = jobs.map(({ item }) => {
    const locality = [
      formatAddressArea("ตำบล", item.subdistrict),
      formatAddressArea("อำเภอ", item.district),
    ].filter(Boolean).join(" ");
    const province = formatAddressArea("จังหวัด", item.province);
    const envelopeRecipientName = recipientEnvelopeName(item);
    const recipientDepartmentHtml = state.settings.showRecipientDepartment && item.department && envelopeRecipientName !== item.department
      ? `<p class="organization">${escapeHtml(item.department)}</p>`
      : "";
    const recipientAddressHtml = state.settings.showRecipientAddress
      ? `<p>${escapeHtml(item.address1)}</p><p>${escapeHtml(locality)}</p><p>${escapeHtml(province)}</p>${item.postalCode ? `<p class="postal-code"><strong>${escapeHtml(item.postalCode)}</strong></p>` : ""}`
      : "";
    return `<section class="envelope">${senderBlockHtml}${postagePermitBlockHtml}<div class="recipient">${recipientEnvelopeBlockHtml(item, { fontPt: recipientFontPt })}<div class="recipient-detail">${recipientDepartmentHtml}${recipientAddressHtml}</div></div></section>`;
  }).join("");
  const popup = window.open("", "_blank");
  if (!popup) {
    setNotice("เบราว์เซอร์บล็อกหน้าพิมพ์ กรุณาอนุญาต Pop-up แล้วลองอีกครั้ง");
    return;
  }
  popup.opener = null;
  popup.document.write(`<!doctype html><html lang="th"><head><meta charset="utf-8"><title>พิมพ์จ่าหน้าซอง</title><style>${printFontFaceCss()}@page{size:${width} ${height};margin:0}*{box-sizing:border-box}body{margin:0;color:#17223b;font-family:"TH Sarabun New","Noto Sans Thai",Tahoma,sans-serif}.envelope{position:relative;width:${width};height:${height};page-break-after:always;overflow:hidden;background:#fff}.envelope:last-child{page-break-after:auto}.sender{position:absolute;top:${senderTopMm}mm;left:${senderLeftMm}mm;width:55%;font-size:${senderFontPt}pt;line-height:${senderLineHeight};color:#111}.sender-content{min-width:0}.sender-address{margin-top:.7mm}.document-number{margin-top:1.2mm;font-weight:700}.garuda{display:block;width:auto;height:${garudaSizeMm}mm;object-fit:contain;object-position:left top}.garuda-hidden{visibility:hidden}.sender.garuda-left{display:flex;align-items:flex-start;gap:3mm}.garuda-left .garuda{flex:0 0 auto}.garuda-left .sender-content{padding-top:${senderTextOffsetMm}mm}.garuda-above .garuda{margin:0 0 2mm 0}.postage-permit{position:absolute;top:${postagePermitTopMm}mm;right:${postagePermitRightMm}mm;display:flex;width:${POSTAGE_PERMIT_WIDTH_MM}mm;height:${POSTAGE_PERMIT_HEIGHT_MM}mm;align-items:center;justify-content:center;overflow:hidden;padding:1.2mm;border:.35mm solid #111;color:#111;font-size:${postagePermitFontPt}pt;font-weight:700;line-height:${postagePermitLineHeight};text-align:center}.recipient{position:absolute;left:${recipientLeftPercent}%;top:${recipientTopPercent}%;width:calc(100% - ${recipientLeftPercent}% - 8mm);font-size:${recipientFontPt}pt;line-height:${recipientLineHeight}}.recipient-heading{display:flex;align-items:baseline;gap:.55em;line-height:inherit}.recipient-greeting{flex:0 0 auto;color:#667085}.recipient-name{display:block;min-width:0;white-space:nowrap}.recipient-name strong{font-weight:900}.recipient-heading.recipient-name-manual{align-items:flex-start}.recipient-heading.recipient-name-manual .recipient-name{white-space:normal}.recipient-detail{margin-left:2.55em}.recipient-position{margin:0;font-weight:900;white-space:nowrap}.recipient p{margin:0;line-height:inherit}.organization{font-weight:700}@media screen{body{background:#eef2f7;padding:18px}.envelope{margin:0 auto 18px;box-shadow:0 12px 36px rgba(15,23,42,.14)}}</style></head><body>${pages}<script>addEventListener('load',()=>setTimeout(()=>print(),250));<\/script></body></html>`);
  popup.document.close();
  saveCurrentPrintJobDraft({ envelopePrintedAt: new Date().toISOString() });
  setNotice(`เตรียมพิมพ์ ${jobs.length} ซอง จาก ${selectedCount} รายชื่อ บน${label} และบันทึกลงประวัติแล้ว`);
}

elements.search.addEventListener("input", (event) => {
  state.query = event.target.value;
  renderRows();
});
elements.category.addEventListener("change", (event) => {
  state.category = event.target.value;
  state.responsibleUnit = "ทั้งหมด";
  state.cooperativeType = "ทั้งหมด";
  renderCooperativeFilterOptions();
  renderRows();
});
elements.responsibleUnit.addEventListener("change", (event) => {
  state.responsibleUnit = event.target.value;
  renderRows();
});
elements.cooperativeType.addEventListener("change", (event) => {
  state.cooperativeType = event.target.value;
  renderRows();
});
elements.selectAll.addEventListener("change", () => {
  const rows = filteredRecipients();
  const allSelected = rows.length > 0 && rows.every((item) => state.selected.has(item.id));
  rows.forEach((item) => {
    if (allSelected) state.selected.delete(item.id);
    else state.selected.add(item.id);
  });
  renderRows();
  renderSummary();
  saveCurrentPrintJobDraft();
});
elements.downloadRecipientsCsv.addEventListener("click", downloadRecipientsCsv);
elements.paper.addEventListener("change", (event) => {
  const nextPaperSize = PAPER_SIZE_KEYS.includes(event.target.value) ? event.target.value : "DL";
  rememberCurrentPaperLayout();
  state.settings.paperSize = nextPaperSize;
  applyPaperLayout(nextPaperSize);
  persistSettings();
  saveCurrentPrintJobDraft();
  renderSummary();
  const selectedLabel = event.target.selectedOptions[0]?.textContent.split(" · ")[0] || nextPaperSize;
  setNotice(`โหลดชุดฟอนต์และตำแหน่งสำหรับ ${selectedLabel} แล้ว`);
});
elements.recipientFont.addEventListener("change", (event) => {
  state.settings.recipientFontPt = clampNumber(event.target.value, 8, 24, 12);
  persistSettings();
  renderSummary();
  setNotice(`ตั้งขนาดฟอนต์ผู้รับเป็น ${state.settings.recipientFontPt} พอยต์แล้ว`);
});
elements.showRecipientDepartment.addEventListener("change", (event) => {
  state.settings.showRecipientDepartment = event.target.checked;
  persistSettings();
  renderSummary();
  setNotice(state.settings.showRecipientDepartment ? "เปิดการแสดงชื่อหน่วยงานผู้รับแล้ว" : "ซ่อนชื่อหน่วยงานผู้รับแล้ว");
});
elements.showRecipientAddress.addEventListener("change", (event) => {
  state.settings.showRecipientAddress = event.target.checked;
  persistSettings();
  renderSummary();
  setNotice(state.settings.showRecipientAddress ? "เปิดการแสดงที่อยู่ผู้รับแล้ว" : "ซ่อนที่อยู่ผู้รับสำหรับการนำส่งด้วยตนเองแล้ว");
});
elements.showSender.addEventListener("change", (event) => {
  state.settings.showSender = event.target.checked;
  persistSettings();
  renderSummary();
  setNotice(state.settings.showSender ? "เปิดการแสดงข้อมูลผู้ส่งแล้ว" : "ซ่อนข้อมูลผู้ส่งเพื่อใช้ตราประทับแล้ว");
});
elements.showGaruda.addEventListener("change", (event) => {
  state.settings.showGaruda = event.target.checked;
  persistSettings();
  renderSummary();
  setNotice(state.settings.showGaruda ? "เปิดการแสดงตราครุฑแล้ว" : "ปิดการแสดงตราครุฑแล้ว");
});
elements.showPostagePermit.addEventListener("change", (event) => {
  state.settings.showPostagePermit = event.target.checked;
  persistSettings();
  renderSummary();
  setNotice(state.settings.showPostagePermit ? "เปิดการแสดงกรอบฝากส่งแล้ว" : "ซ่อนกรอบฝากส่งแล้ว");
});
$("#openAddRecipient").addEventListener("click", openRecipientDialog);
$("#closeRecipientDialog").addEventListener("click", closeRecipientDialog);
$("#cancelRecipient").addEventListener("click", closeRecipientDialog);
elements.deleteRecipientButton.addEventListener("click", () => deleteRecipient(state.editingRecipientId));
$("#closeDeleteRecipientDialog").addEventListener("click", closeDeleteRecipientDialog);
$("#cancelDeleteRecipient").addEventListener("click", closeDeleteRecipientDialog);
elements.deleteRecipientForm.addEventListener("submit", handleDeleteRecipientSubmit);
$("#recipientCategory").addEventListener("change", updateRecipientFormRequirements);
elements.recipientForm.elements.postalCode.addEventListener("invalid", (event) => {
  event.target.setCustomValidity("กรุณากรอกรหัสไปรษณีย์ 5 หลัก เป็นเลขไทยหรือเลขอารบิก");
});
elements.recipientForm.elements.postalCode.addEventListener("input", (event) => {
  event.target.setCustomValidity("");
});
elements.recipientForm.addEventListener("submit", handleRecipientSubmit);
$("#openRecipientLayoutSettings").addEventListener("click", openRecipientLayoutSettings);
$("#closeRecipientLayoutDialog").addEventListener("click", closeRecipientLayoutSettings);
$("#cancelRecipientLayout").addEventListener("click", closeRecipientLayoutSettings);
$("#resetRecipientLayout").addEventListener("click", resetRecipientLayout);
elements.recipientLayoutForm.addEventListener("submit", handleRecipientLayoutSubmit);
elements.openRecipientLineBreak.addEventListener("click", openRecipientLineBreakDialog);
$("#closeRecipientLineBreakDialog").addEventListener("click", closeRecipientLineBreakDialog);
$("#cancelRecipientLineBreak").addEventListener("click", closeRecipientLineBreakDialog);
$("#clearRecipientLineBreak").addEventListener("click", clearRecipientLineBreak);
elements.recipientLineBreakForm.addEventListener("submit", handleRecipientLineBreakSubmit);
$("#openSenderSettings").addEventListener("click", openSenderSettings);
$("#closeSenderDialog").addEventListener("click", closeSenderSettings);
$("#cancelSenderSettings").addEventListener("click", closeSenderSettings);
$("#resetSenderLayout").addEventListener("click", resetSenderLayout);
elements.senderForm.addEventListener("submit", handleSenderSubmit);
$("#openPostagePermitSettings").addEventListener("click", openPostagePermitSettings);
$("#closePostagePermitDialog").addEventListener("click", closePostagePermitSettings);
$("#cancelPostagePermit").addEventListener("click", closePostagePermitSettings);
$("#resetPostagePermit").addEventListener("click", resetPostagePermit);
elements.postagePermitForm.addEventListener("submit", handlePostagePermitSubmit);
$("#openManifestDialog").addEventListener("click", openManifestDialog);
$("#closeManifestDialog").addEventListener("click", closeManifestDialog);
$("#cancelManifestDialog").addEventListener("click", closeManifestDialog);
elements.manifestDate.addEventListener("change", () => saveCurrentPrintJobDraft());
elements.manifestRegisteredPrefix.addEventListener("input", limitManifestPrefixInput);
elements.manifestRegisteredPrefix.addEventListener("input", () => applyManifestPrefixMode("registered"));
elements.manifestEmsPrefix.addEventListener("input", limitManifestPrefixInput);
elements.manifestEmsPrefix.addEventListener("input", () => applyManifestPrefixMode("ems"));
elements.mailingManifestForm.addEventListener("submit", printMailingManifest);
$("#openPrintHistory").addEventListener("click", openPrintHistory);
$("#closePrintHistory").addEventListener("click", closePrintHistory);
$("#donePrintHistory").addEventListener("click", closePrintHistory);
$("#startNewPrintJob").addEventListener("click", startNewPrintJob);
elements.historyGroupFilter.addEventListener("change", handleHistoryFilterChange);
elements.historyMonthFilter.addEventListener("change", () => {
  elements.historyDateFilter.value = "";
  handleHistoryFilterChange();
});
elements.historyDateFilter.addEventListener("change", () => {
  elements.historyMonthFilter.value = "";
  handleHistoryFilterChange();
});
$("#resetHistoryFilters").addEventListener("click", resetHistoryFilters);
elements.printJobCreator.addEventListener("change", handlePrintJobCreatorChange);
elements.loginGateForm.addEventListener("submit", handleLoginGateSubmit);
elements.adminAuthButton.addEventListener("click", toggleAdminAuth);
elements.adminAuthForm.addEventListener("submit", handleAdminAuthSubmit);
$("#closeAdminAuth").addEventListener("click", closeAdminAuthDialog);
$("#cancelAdminAuth").addEventListener("click", closeAdminAuthDialog);
$("#heroPrint").addEventListener("click", printEnvelopes);
elements.previewPrevious.addEventListener("click", () => {
  const count = state.recipients.filter((item) => state.selected.has(item.id)).length;
  if (count <= 1) return;
  state.previewRecipientIndex = (state.previewRecipientIndex - 1 + count) % count;
  renderSummary();
});
elements.previewNext.addEventListener("click", () => {
  const count = state.recipients.filter((item) => state.selected.has(item.id)).length;
  if (count <= 1) return;
  state.previewRecipientIndex = (state.previewRecipientIndex + 1) % count;
  renderSummary();
});
let previewResizeFrame;
window.addEventListener("resize", () => {
  cancelAnimationFrame(previewResizeFrame);
  previewResizeFrame = requestAnimationFrame(renderSummary);
});

render();
initializeAdminAuth()
  .catch((error) => console.warn("ตรวจสอบสถานะผู้ดูแลไม่สำเร็จ", error))
  .finally(connectToDatabase);
