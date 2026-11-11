# 🔔 SBG-Warehouse — Push Notification Backend

เซิร์ฟเวอร์ตัวเล็กๆ ที่ทำหน้าที่เดียว: **เฝ้าดู Firestore แบบ Realtime แล้วยิง Push Notification ผ่าน Firebase Cloud Messaging (FCM)** เพื่อให้ผู้ใช้ได้รับแจ้งเตือนแม้ปิดแอป/ปิดเบราว์เซอร์ไปแล้ว (ต่างจาก local notification ในตัวแอปที่ทำงานได้แค่ตอนเปิดแอปทิ้งไว้)

ไม่ได้ทำหน้าที่ CRUD ข้อมูลแทน Frontend — Frontend ยังคงอ่าน/เขียน Firestore ตรงเหมือนเดิมทุกจุด

## เหตุการณ์ที่แจ้งเตือน

1. **ปิดชื่องาน** — แจ้งทุกคนในชื่องานนั้น (ยกเว้นคนที่กดปิดเอง)
2. **เปิดชื่องานอีกครั้ง (Undo)** — แจ้งทุกคนในชื่องานนั้น
3. **สแกน Carton ใหม่** — แจ้งทุกคนในชื่องานนั้น (ยกเว้นคนที่สแกนเอง)

## เตรียมของก่อน Deploy

### 1) สร้าง Firebase Service Account Key
- Firebase Console → ⚙️ Project Settings → Service Accounts → **Generate New Private Key**
- จะได้ไฟล์ `.json` มา 1 ไฟล์ — **ห้าม commit ขึ้น Git เด็ดขาด**
- แปลงเป็น Base64 (ต้องทำเพราะ Environment Variable ใส่ multi-line JSON ตรงๆ มักมีปัญหา):
  ```bash
  # Mac / Linux
  base64 -i serviceAccountKey.json | tr -d '\n'
  ```
  ```powershell
  # Windows PowerShell
  [Convert]::ToBase64String([IO.File]::ReadAllBytes("serviceAccountKey.json"))
  ```
- เก็บผลลัพธ์ (ข้อความยาวๆ บรรทัดเดียว) ไว้ใช้ในขั้นตอนถัดไป

### 2) สร้าง Web Push Certificate (VAPID Key) — ใช้ฝั่ง Frontend
- Firebase Console → ⚙️ Project Settings → Cloud Messaging → Web configuration → **Generate key pair**
- ได้ Key string มา 1 อัน — เอาไปใส่ใน `.env` ของ **Frontend** (ไม่ใช่ backend) ที่ `FIREBASE_VAPID_KEY`

## Deploy บน Render

1. Push โค้ดขึ้น GitHub (private repo ได้ตามแผนเดิม)
2. Render Dashboard → **New +** → **Web Service** (ไม่ใช่ Static Site — ตัวนี้ต้องรันโปรเซสค้างไว้ตลอด)
3. เลือก repo แล้วตั้งค่า:
   - **Root Directory**: `backend`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: ดูหัวข้อ "⚠️ ข้อควรระวังสำคัญ" ด้านล่างก่อนเลือก
4. ไปที่ Environment → เพิ่มตัวแปร:
   - `FIREBASE_SERVICE_ACCOUNT_BASE64` = (ค่า Base64 จากขั้นตอนที่ 1)
   - `ADMIN_TEST_SECRET` = ตั้งรหัสลับเอง (ใช้ทดสอบ endpoint `/api/test-push`)
   - ไม่ต้องตั้ง `PORT` — Render จัดการให้เอง
5. Deploy — เช็คว่า Log ขึ้น `[startup] SBG-Warehouse Push Backend กำลังทำงานที่พอร์ต ...` และ `[startup] เชื่อมต่อ Firebase project: ...`
6. เปิด URL ของ backend (เช่น `https://sbg-warehouse-push.onrender.com/`) ควรเห็น JSON สถานะ `"status": "ok"`

## ⚠️ ข้อควรระวังสำคัญ — Render Free Tier จะ Sleep

Render's free tier ("Web Service") จะ **spin down (sleep) อัตโนมัติหลังไม่มี HTTP request เข้ามา 15 นาที** — และเซิร์ฟเวอร์นี้ไม่ได้รอรับ request จาก Frontend เลย (มันแค่เฝ้าฟัง Firestore เบื้องหลัง) ดังนั้นถ้าไม่มีอะไรมา "ปลุก" มันเป็นระยะ **มันจะหลับ แล้ว Realtime listener จะหยุดทำงาน → Push จะไม่ถูกส่ง**

ทางแก้ (เลือกอย่างใดอย่างหนึ่ง):

- **วิธีฟรี**: ใช้บริการ Uptime Pinger ภายนอก (เช่น UptimeRobot, cron-job.org — มี free tier) ตั้งให้ ping `https://<your-backend>.onrender.com/health` ทุก 10 นาที เพื่อกันไม่ให้ sleep
- **วิธีจ่ายเงิน**: อัพเกรด Render instance เป็น **Starter plan** (มีค่าใช้จ่ายรายเดือน) ซึ่งไม่มีการ sleep เลย เหมาะกับ backend ที่ต้องรัน realtime listener ตลอดเวลาแบบนี้โดยเฉพาะ

> 💡 ถ้าอยากได้ความเสถียร 100% โดยไม่ต้องพึ่ง pinger ภายนอก การอัพเกรดเป็น Starter plan คุ้มที่สุดสำหรับ use case นี้ เพราะรออยู่เฉยๆ กิน resource น้อยมาก

## ทดสอบว่า Push ทำงานจริง

1. เปิดแอป Frontend บนมือถือ 2 เครื่อง (คนละ user) เข้าชื่องานเดียวกัน กด 🔔 เปิดการแจ้งเตือนทั้งสองเครื่อง
2. **ปิดแอปเครื่องที่ 2 ไปเลย** (ปิดจริงๆ ไม่ใช่แค่สลับแท็บ)
3. เครื่องที่ 1 สแกน Carton หรือปิดชื่องาน
4. เครื่องที่ 2 ควรได้รับ push notification แม้ปิดแอปอยู่ (ถ้า backend ไม่ได้ sleep อยู่)

หรือทดสอบยิงเองผ่าน endpoint:
```bash
curl -X POST https://<your-backend>.onrender.com/api/test-push \
  -H "Content-Type: application/json" \
  -d '{"secret":"<ADMIN_TEST_SECRET>","jobId":"<jobId>","title":"ทดสอบ","body":"สวัสดี"}'
```

## รันทดสอบในเครื่องตัวเอง

```bash
cd backend
cp .env.example .env
# ใส่ค่าใน .env ให้ครบ
npm install
npm start
```
