# ระบบจ่าหน้าซองจดหมายราชการ

เว็บสำหรับค้นหารายชื่อผู้รับ พิมพ์หน้าซอง และพิมพ์ใบนำส่งไปรษณีย์ โดยใช้ Google Sheets เป็นฐานข้อมูลกลาง ผ่าน Google Apps Script Web App และเผยแพร่หน้าเว็บบน Vercel

## โครงสร้างระบบ

หน้าเว็บ Vercel ↔ Google Apps Script ↔ Google Sheets

- ชีต `Recipients` เก็บรายชื่อผู้รับ
- ชีต `PrintJobs` เก็บประวัติชุดงานพิมพ์
- ชีต `Users` เก็บบัญชี รหัสผ่าน บทบาท และสถานะการใช้งาน
- `WRITE_KEY` ใน Script Properties ใช้ลงลายเซ็นเซสชันและไม่เปิดเผยต่อหน้าเว็บ
- บัญชีบทบาท `user` สามารถเพิ่มและแก้ไขรายชื่อได้ แต่ไม่สามารถลบข้อมูล
- บัญชีบทบาท `admin` สามารถเพิ่ม แก้ไข และลบข้อมูลได้
- การเพิ่ม แก้ไข ลบรายชื่อ และประวัติชุดงาน จะบันทึกลง Google Sheets
- ห้ามใส่ `WRITE_KEY` ใน `config.js`, GitHub หรือโค้ดหน้าเว็บ

## ไฟล์สำคัญ

- `index.source.html` หน้าเว็บต้นฉบับ
- `assets/app.js` การทำงานของเว็บและการเชื่อม Google Apps Script
- `assets/styles.css` รูปแบบหน้าเว็บและหน้าพิมพ์
- `config.js` URL `/exec` ของ Google Apps Script
- `apps-script/Code.gs` API สำหรับอ่านและเขียน Google Sheets
- `scripts/build-standalone.mjs` สร้าง `index.html` สำหรับอัปโหลด
- `index.html` ไฟล์ที่สร้างแล้วสำหรับใช้งานจริง

## ตั้งค่า Google Apps Script

1. เปิดโปรเจกต์ Apps Script แล้วนำ `apps-script/Code.gs` ไปวาง
2. แก้ `SPREADSHEET_ID` ให้ตรงกับ Google Sheet ที่ต้องการใช้
3. ไปที่ **Project Settings > Script Properties**
4. เพิ่ม Property ชื่อ `WRITE_KEY` และกำหนดรหัสผู้ดูแล
5. กด **Deploy > New deployment > Web app**
6. เลือก **Execute as: Me** และ **Who has access: Anyone**
7. คัดลอก URL ที่ลงท้าย `/exec` ไปใส่ใน `config.js`
8. เมื่อแก้ `Code.gs` ภายหลัง ต้องสร้างเวอร์ชัน deployment ใหม่

ระบบอ่านบัญชีจากชีต `Users` โดยตรง ผู้ดูแลสามารถแก้รหัสผ่าน บทบาท หรือปิดบัญชีได้จากชีตนี้ โดยไม่ต้องแก้โค้ดหน้าเว็บ

หากต้องการให้การอ่านข้อมูลเร็วขึ้น ให้เพิ่มบริการ **Google Sheets API v4** ใน Apps Script ส่วนระบบยังมี Spreadsheet service เป็นตัวสำรอง

## เมื่อแก้ไขเว็บ

สร้าง `index.html` ใหม่ด้วยคำสั่ง:

```powershell
node scripts/build-standalone.mjs
```

จากนั้นอัปโหลดหรือ push ไฟล์ต่อไปนี้ขึ้น GitHub/Vercel:

- `index.html`
- `config.js`
- `assets/`
- `vercel.json`

โฟลเดอร์ `apps-script/` ใช้สำหรับนำโค้ดไปอัปเดตใน Google Apps Script ไม่จำเป็นต่อการทำงานของหน้าเว็บบน Vercel

## ทดสอบหน้าพิมพ์

รันชุดตรวจโครงสร้างและกฎแบ่งหน้าด้วยคำสั่ง:

```powershell
node --test tests/print-layout-regression.test.mjs
```

ก่อนเผยแพร่ ให้ตรวจภาพพิมพ์ใน Chrome และ Edge ที่ซูม 100% ตามรายการใน `tests/PRINT-LAYOUT-CHECKLIST.md`
