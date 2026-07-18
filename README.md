# ระบบจ่าหน้าซองหนังสือเวียน

เว็บแอปสำหรับค้นหา เลือก และพิมพ์จ่าหน้าซองหนังสือเวียน โดยใช้โครงสร้างดังนี้

```text
Google Sheets → Google Apps Script Web App → GitHub → Vercel
```

- **Google Sheets** เก็บฐานข้อมูลรายชื่อผู้รับ
- **Google Apps Script (`apps-script/Code.gs`)** อ่านข้อมูลและส่งกลับเป็น API
- **GitHub** เก็บ Source code และตรวจสอบไวยากรณ์เมื่อ Push
- **Vercel** เผยแพร่หน้าเว็บจาก Repository โดยอัตโนมัติ

## 1. เตรียมฐานข้อมูล Google Sheets

สร้างชีตชื่อ `Recipients` แล้วกำหนดหัวตารางแถวแรกดังนี้

```text
id,prefix,firstName,lastName,position,department,address1,subdistrict,district,province,postalCode,active
```

สามารถนำเข้าไฟล์ `sample-data/recipients.csv` เพื่อเริ่มต้นได้ทันที ค่าในคอลัมน์ `active` ใช้ `TRUE` สำหรับรายการที่ต้องการแสดง และ `FALSE` สำหรับรายการที่ต้องการซ่อน

## 2. สร้าง Google Apps Script API

1. เปิด Google Sheet แล้วเลือก **Extensions > Apps Script**
2. คัดลอกโค้ดจาก `apps-script/Code.gs` ไปวางใน Apps Script
3. แก้ค่า `SPREADSHEET_ID` ให้เป็นรหัสจาก URL ของ Google Sheet
4. กด **Deploy > New deployment > Web app**
5. ตั้ง **Execute as: Me** และ **Who has access: Anyone**
6. คัดลอก Web app URL ที่ลงท้ายด้วย `/exec`
7. เปิด URL พร้อม `?action=health` เพื่อตรวจสอบ ควรได้รับข้อมูลที่มี `"ok":true`

เมื่อแก้โค้ด Apps Script ภายหลัง ต้องสร้าง Version ใหม่ใน **Manage deployments** เพื่อให้ระบบใช้โค้ดล่าสุด

## 3. กำหนด URL ให้หน้าเว็บ

เปิด `config.js` แล้วใส่ Web app URL

```js
window.ENVELOPE_APP_CONFIG = {
  appsScriptUrl: "https://script.google.com/macros/s/DEPLOYMENT_ID/exec",
  sender: "ชื่อหน่วยงานผู้ส่ง",
  senderAddress: "ที่อยู่หน่วยงานผู้ส่ง",
  paperSize: "DL",
};
```

หากเว้น `appsScriptUrl` ว่าง หน้าเว็บจะเริ่มด้วยข้อมูลตัวอย่าง และผู้ใช้สามารถใส่ URL ผ่านปุ่มตั้งค่าได้

## 4. เผยแพร่ผ่าน GitHub และ Vercel

1. Push ไฟล์ทั้งหมดขึ้น GitHub Repository โดยใช้ branch `main`
2. ใน Vercel เลือก **Add New > Project** แล้ว Import Repository นี้
3. เลือก Framework Preset เป็น **Other**
4. ไม่ต้องกำหนด Build Command และให้ Root Directory เป็นรากของ Repository
5. กด **Deploy**

หลังเชื่อม GitHub กับ Vercel แล้ว ทุก Push จะสร้าง Preview Deployment และเมื่อ Push หรือ Merge เข้า Production Branch จะเผยแพร่ Production Deployment อัตโนมัติ

ไฟล์ `.github/workflows/pages.yml` ใช้ตรวจไวยากรณ์ของ JavaScript เท่านั้น ไม่ได้ Deploy ไป GitHub Pages ส่วน `vercel.json` กำหนดค่าและ Security headers สำหรับ Vercel และ `.vercelignore` ป้องกันไม่ให้ไฟล์ Apps Script ต้นฉบับกับข้อมูลตัวอย่างถูกเผยแพร่ไปกับหน้าเว็บ

## 5. ทดสอบระบบ

1. เปิด URL ของ Vercel
2. ตรวจว่าสถานะเปลี่ยนเป็น **เชื่อม Google Sheets แล้ว**
3. ค้นหาและเลือกรายชื่อผู้รับ
4. เลือกขนาดซอง DL, C5 หรือกระดาษ A4
5. กด **ดูตัวอย่างและพิมพ์** และอนุญาต Pop-up หากเบราว์เซอร์แจ้งเตือน

หากเชื่อมต่อไม่สำเร็จ ให้ตรวจว่า URL ลงท้ายด้วย `/exec` ใช้ Deployment Version ล่าสุด และตั้งสิทธิ์ Web app เป็น **Anyone**

## ความปลอดภัย

Web app ที่ตั้งสิทธิ์เป็น **Anyone** สามารถถูกเรียกจากอินเทอร์เน็ตได้ จึงไม่ควรเก็บข้อมูลลับหรือข้อมูลส่วนบุคคลที่ไม่จำเป็นในชีตนี้ Google Sheet ต้นทางไม่จำเป็นต้องแชร์เป็นสาธารณะ เพราะ Apps Script อ่านข้อมูลด้วยสิทธิ์ของผู้ Deploy
