# ตรวจเข้าทำงานจาก Google Timeline

เว็บแอปแบบเปิดจากลิงก์ได้ สำหรับตรวจว่าวันไหนไปทำงาน จากไฟล์ Google Timeline

ข้อมูลถูกประมวลผลในเบราว์เซอร์ ไม่ถูกอัปโหลดไปเซิร์ฟเวอร์

## วิธีใช้บนมือถือหรือคอม

1. เปิด `index.html` หรือหน้า GitHub Pages
2. อัปโหลดไฟล์ Timeline ที่ส่งออกจากมือถือ
3. ปักหมุดที่ทำงาน หรือใส่พิกัด
4. ตั้งรัศมี ช่วงเวลางาน วันทำงาน และชั่วโมงขั้นต่ำ
5. กดประมวลผล แล้วดาวน์โหลด CSV ได้

## ส่งออกไฟล์จาก Google Timeline

### Android
Settings → Location → Location services → Timeline → Export Timeline data

### iPhone
Google Maps → รูปโปรไฟล์ → Settings → Location & Privacy / Personal content → Export Timeline data

ไฟล์มักชื่อ `Timeline.json` หรือ `location-history.json`

## โฮสต์บน GitHub Pages

1. สร้าง repository ใหม่
2. อัปโหลดไฟล์ทั้งหมดในโฟลเดอร์นี้ขึ้นรากของ repo
3. เปิด Settings → Pages → Deploy from branch `main` โฟลเดอร์ `/root`
4. เปิดลิงก์ `https://USERNAME.github.io/REPO_NAME/`

## ค่าที่ตั้งได้

- พิกัดที่ทำงาน
- รัศมีเป็นเมตร
- ช่วงวันที่
- วันทำงาน
- ช่วงเวลาที่นับ
- จำนวนชั่วโมงขั้นต่ำจึงจะถือว่าไปทำงาน

## หมายเหตุ

โปรแกรมนี้เป็นเครื่องมือส่วนตัว ไม่ใช่ระบบลงเวลาทางการของบริษัท
ความแม่นยำขึ้นกับ GPS และว่าเปิด Timeline ไว้หรือไม่
