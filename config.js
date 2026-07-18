// ใส่ URL ที่ได้จาก Deploy > Manage deployments > Web app ของ Google Apps Script
// URL ต้องลงท้ายด้วย /exec ระบบจะเชื่อม Google Sheets ให้อัตโนมัติเมื่อเปิดหน้าเว็บ
// หากเว้นว่าง ระบบจะเปิดด้วยข้อมูลตัวอย่าง และให้ผู้ใช้ใส่ URL ผ่านหน้าตั้งค่า
window.ENVELOPE_APP_CONFIG = {
  appsScriptUrl: "", // ตัวอย่าง: https://script.google.com/macros/s/DEPLOYMENT_ID/exec
  sender: "สำนักงานสหกรณ์จังหวัดขอนแก่น",
  senderAddress: "ศาลากลางจังหวัดขอนแก่น ถนนศูนย์ราชการ ตำบลในเมือง อำเภอเมืองขอนแก่น ขอนแก่น 40000",
  paperSize: "DL",
};
