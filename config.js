// ใส่ URL ที่ได้จาก Deploy > Manage deployments > Web app ของ Google Apps Script
// URL ต้องลงท้ายด้วย /exec ระบบจะเชื่อม Google Sheets ให้อัตโนมัติเมื่อเปิดหน้าเว็บ
// หากเว้นว่าง ระบบจะเปิดด้วยข้อมูลตัวอย่าง และให้ผู้ใช้ใส่ URL ผ่านหน้าตั้งค่า
window.ENVELOPE_APP_CONFIG = {
  appsScriptUrl: "https://script.google.com/macros/s/AKfycbz7WU2jcB3tqDcHCW0XInm3fGPF7MCDO_m1j3zGmo7Tvf9BbxnFbwGhzg7fUPpE_qty/exec",
  sender: "สำนักงานสหกรณ์จังหวัดขอนแก่น",
  senderAddress: "เลขที่ 1/112 หมู่ที่ 13 ถนนหน้าเมือง ตำบลในเมือง\nอำเภอเมือง จังหวัดขอนแก่น 40000\nโทรศัพท์. 0-4324-6682 โทรสาร. 0-4324-6681",
  documentNumber: "ที่ ขก0010/.................................................................",
  paperSize: "DL",
  showSender: true,
  garudaImage: "https://img1.pic.in.th/images/-PNG0457c311e6c77ae0f.png",
  showGaruda: true,
  garudaPlacement: "left",
  garudaSizeMm: 15,
  senderTopMm: 6,
  senderLeftMm: 14,
  senderTextOffsetMm: 10,
  senderFontPt: 9.5,
  recipientFontPt: 12,
  recipientTopPercent: 40,
  recipientLeftPercent: 42,
  recipientLineHeight: 1.5,
  postagePermitText: "ชำระค่าฝากส่งเป็นรายเดือน\nใบอนุญาตเลขที่ xx/xxx\nไปรษณีย์เดชาวุธ",
  postagePermitTopMm: 7,
  postagePermitRightMm: 8,
  postagePermitFontPt: 8.5,
};
