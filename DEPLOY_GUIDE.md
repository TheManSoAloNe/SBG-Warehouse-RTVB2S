# 📖 คู่มือ Deploy SBG-Warehouse RTVB2S แบบทีละขั้นตอน (สำหรับคนที่ไม่ใช่ IT)

คู่มือนี้เขียนแบบละเอียดที่สุด คลิกตรงไหน ใส่อะไร บอกหมด ทำตามลำดับ 1 → 2 → 3 → 4 ห้ามข้าม

**ภาพรวมสิ่งที่จะทำ (4 เฟส):**
1. 🔥 ตั้งค่า Firebase (ฐานข้อมูล)
2. 🐙 อัพโหลดโค้ดขึ้น GitHub (Private Repo)
3. 🌐 Deploy หน้าเว็บ (Frontend) บน Render
4. 🔔 Deploy ระบบแจ้งเตือน (Backend) บน Render

ใช้เวลารวมประมาณ 45-60 นาที ถ้าทำครั้งแรก

---

## เฟส 1: ตั้งค่า Firebase

### 1.1 สร้าง Firebase Project
1. เข้า https://console.firebase.google.com เข้าสู่ระบบด้วย Gmail ของคุณ
2. กด **"Add project" / "สร้างโปรเจกต์"**
3. ตั้งชื่อโปรเจกต์ เช่น `sbg-warehouse` แล้วกด Continue
4. เรื่อง Google Analytics เลือก **ปิด (Disable)** ก็ได้ ไม่จำเป็นสำหรับแอปนี้
5. กด **Create Project** รอสักครู่จนเสร็จ

### 1.2 เปิดใช้งาน Firestore Database
1. ในเมนูซ้าย เลือก **Build → Firestore Database**
2. กด **Create database**
3. เลือก **Start in production mode** (ปลอดภัยกว่า) → Next
4. เลือก Location ใกล้ไทยที่สุด เช่น `asia-southeast1 (Singapore)` → Enable
5. รอสักครู่ Firestore จะพร้อมใช้งาน

### 1.3 ตั้งค่า Security Rules (สำคัญ — อย่าข้าม)
1. ในหน้า Firestore ไปที่แท็บ **Rules**
2. ลบข้อความเดิมทั้งหมด แล้ววางอันนี้แทน:
   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /{document=**} {
         allow read, write: if true;
       }
     }
   }
   ```
3. กด **Publish**

> ⚠️ Rule นี้เปิดให้ใครก็ได้ที่มีลิงก์เขียนข้อมูลได้ เหมาะกับทีมใช้งานภายใน 5 คนเท่านั้น ไม่ควรใช้กับระบบสาธารณะ

### 1.4 ดึงค่า Firebase Config (สำหรับ Frontend)
1. กดรูปเฟือง ⚙️ มุมซ้ายบน → **Project settings**
2. เลื่อนลงมาส่วน **Your apps** กดไอคอน **`</>`** (Web)
3. ตั้งชื่อ App เช่น `sbg-warehouse-web` → Register app
4. จะเห็นโค้ดหน้าตาแบบนี้ **คัดลอกค่าทั้งหมดเก็บไว้** (จะใช้ตอนเฟส 3):
   ```js
   const firebaseConfig = {
     apiKey: "AIzaSy...",
     authDomain: "sbg-warehouse.firebaseapp.com",
     projectId: "sbg-warehouse",
     storageBucket: "sbg-warehouse.appspot.com",
     messagingSenderId: "123456789",
     appId: "1:123456789:web:abcdef"
   };
   ```
5. กด Continue to console

### 1.5 สร้าง VAPID Key (สำหรับ Push Notification)
1. ยังอยู่หน้า Project Settings → ไปแท็บ **Cloud Messaging**
2. เลื่อนลงหา **Web configuration** → กด **Generate key pair**
3. จะได้ Key string ยาวๆ **คัดลอกเก็บไว้** (ใช้ตอนเฟส 3)

### 1.6 สร้าง Service Account Key (สำหรับ Backend)
1. ยังอยู่หน้า Project Settings → ไปแท็บ **Service accounts**
2. กด **Generate new private key** → ยืนยัน **Generate key**
3. ไฟล์ `.json` จะถูกดาวน์โหลดลงเครื่อง — **เก็บไฟล์นี้ไว้ให้ดี ห้ามส่งให้ใครหรืออัพโหลดที่ไหนทั้งสิ้น** (จะใช้ตอนเฟส 4)

**เฟส 1 เสร็จแล้ว ✅** ตอนนี้คุณควรมี 3 อย่างเก็บไว้: Firebase Config (ข้อ 1.4), VAPID Key (ข้อ 1.5), ไฟล์ Service Account `.json` (ข้อ 1.6)

---

## เฟส 2: อัพโหลดโค้ดขึ้น GitHub (Private Repo)

### 2.1 สร้างบัญชี GitHub (ถ้ายังไม่มี)
1. เข้า https://github.com → Sign up → ทำตามขั้นตอนสมัคร

### 2.2 สร้าง Private Repository
1. มุมขวาบน กด **+** → **New repository**
2. Repository name: `sbg-warehouse` (หรือชื่อที่ชอบ)
3. เลือก **Private** (สำคัญมาก — ต้องเป็น Private)
4. **ไม่ต้อง** ติ๊ก "Add a README file" (เพราะเรามีไฟล์อยู่แล้ว)
5. กด **Create repository**

### 2.3 อัพโหลดไฟล์โปรเจกต์ขึ้น GitHub

**วิธีที่ง่ายที่สุดสำหรับคนไม่ใช่ IT: อัพโหลดผ่านเว็บเบราว์เซอร์โดยตรง**

1. แตกไฟล์ zip ของโปรเจกต์ (`sbg-warehouse-rtvb2s.zip`) ในเครื่องคุณก่อน
2. ในหน้า Repository ที่เพิ่งสร้าง จะเห็นข้อความ "Quick setup" → กด **uploading an existing file**
3. **ลากทั้งโฟลเดอร์ที่แตกไฟล์แล้ว** วางลงในหน้าเว็บ (หรือกด choose your files แล้วเลือกทั้งหมด)
4. เลื่อนลงล่างสุด ใส่ข้อความ commit เช่น `Initial upload`
5. กด **Commit changes**

> ⚠️ **สำคัญมาก:** ตรวจสอบให้แน่ใจว่า**ไม่ได้อัพโหลดไฟล์ `.env` และไฟล์ Service Account `.json`** ขึ้นไปด้วย — ไฟล์เหล่านี้มีข้อมูลลับ ถ้า GitHub เตือนหรือคุณเห็นไฟล์เหล่านี้ในรายการที่จะอัพโหลด ให้เอาออกก่อน กด Commit

**เฟส 2 เสร็จแล้ว ✅** โค้ดอยู่บน GitHub Private Repo แล้ว

---

## เฟส 3: Deploy หน้าเว็บ (Frontend) บน Render

### 3.1 สมัคร Render
1. เข้า https://render.com → กด **Get Started** → เลือก **Sign up with GitHub** (ง่ายที่สุด เชื่อมกับ GitHub เลย)
2. อนุญาตให้ Render เข้าถึง GitHub ของคุณ

### 3.2 เตรียมค่า Firebase ใส่ในไฟล์ `.env`
ก่อน deploy ต้องใส่ค่า Firebase ที่เก็บไว้จากเฟส 1 เข้าไปในไฟล์ก่อน:
1. เปิดไฟล์ `.env` ในโปรเจกต์ (อยู่ที่โฟลเดอร์หลัก ข้าง `index.html`) ด้วยโปรแกรม Notepad หรือ text editor ทั่วไป
2. ใส่ค่าตามที่คัดลอกมาจากข้อ 1.4 และ 1.5:
   ```
   FIREBASE_API_KEY=AIzaSy...
   FIREBASE_AUTH_DOMAIN=sbg-warehouse.firebaseapp.com
   FIREBASE_PROJECT_ID=sbg-warehouse
   FIREBASE_STORAGE_BUCKET=sbg-warehouse.appspot.com
   FIREBASE_MESSAGING_SENDER_ID=123456789
   FIREBASE_APP_ID=1:123456789:web:abcdef
   FIREBASE_VAPID_KEY=(ค่าที่ได้จากข้อ 1.5)
   PUSH_BACKEND_URL=(ยังไม่ต้องใส่ตอนนี้ — จะกลับมาใส่ทีหลังหลังทำเฟส 4 เสร็จ)
   ```
3. เซฟไฟล์
4. เปิดเครื่อง Terminal/Command Prompt ในโฟลเดอร์โปรเจกต์ พิมพ์:
   ```
   node scripts/build-env.js
   ```
   (ถ้าไม่มี Node.js ในเครื่อง ข้ามขั้นตอนนี้ไปก่อน แล้วใช้วิธี "ตั้งค่าผ่านหน้าเว็บ" แทนในข้อ 3.6)
5. อัพโหลดไฟล์ที่แก้ไขแล้ว (`.env` และ `js/env.js`) กลับขึ้น GitHub อีกครั้ง (ทำแบบข้อ 2.3 — เข้า repo แล้วลากไฟล์วางทับ)

### 3.3 สร้าง Static Site บน Render
1. Render Dashboard → กด **New +** → **Static Site**
2. เลือก repo `sbg-warehouse` ที่สร้างไว้ → Connect
3. ตั้งค่า:
   - **Name**: `sbg-warehouse-app` (หรือชื่อที่ชอบ)
   - **Branch**: `main`
   - **Build Command**: เว้นว่างไว้ได้ (ไม่ต้อง build)
   - **Publish Directory**: `.` (จุดเดียว หมายถึงโฟลเดอร์หลัก)
4. กด **Create Static Site**
5. รอสักครู่ Render จะ deploy ให้ เสร็จแล้วจะได้ URL เช่น `https://sbg-warehouse-app.onrender.com`

**เฟส 3 เสร็จแล้ว ✅** เปิด URL ที่ได้ ควรเห็นหน้าแอป SBG-Warehouse ขึ้น badge **REAL** มุมซ้ายบน (ถ้ายังขึ้น MOCKUP แปลว่าค่า Firebase ยังไม่ถูกอ่าน ตรวจสอบขั้นตอน 3.2 อีกครั้ง)

---

## เฟส 4: Deploy ระบบแจ้งเตือน (Backend) บน Render

### 4.1 แปลงไฟล์ Service Account เป็น Base64
ไฟล์ `.json` จากข้อ 1.6 ต้องแปลงเป็นข้อความยาวๆ ก่อนถึงจะใส่ใน Render ได้:

**ถ้าใช้ Mac:**
1. เปิด Terminal
2. พิมพ์ (แก้ path ให้ตรงกับที่ไฟล์อยู่จริง):
   ```
   base64 -i ~/Downloads/sbg-warehouse-firebase-adminsdk-xxxxx.json | pbcopy
   ```
3. คำสั่งนี้จะคัดลอกผลลัพธ์ใส่ Clipboard ให้อัตโนมัติ (ไปวางได้เลยในขั้นตอนถัดไป)

**ถ้าใช้ Windows (PowerShell):**
1. เปิด PowerShell
2. พิมพ์ (แก้ path ให้ตรงกับที่ไฟล์อยู่จริง):
   ```
   [Convert]::ToBase64String([IO.File]::ReadAllBytes("C:\Users\ชื่อคุณ\Downloads\sbg-warehouse-firebase-adminsdk-xxxxx.json")) | Set-Clipboard
   ```
3. คำสั่งนี้จะคัดลอกผลลัพธ์ใส่ Clipboard ให้อัตโนมัติ

**ถ้าไม่ถนัดใช้ Terminal เลย:** ใช้เว็บไซต์แปลงไฟล์เป็น Base64 ก็ได้ (ค้นหา "base64 file encode online") — แต่ระวัง อย่าใช้เว็บที่ไม่น่าเชื่อถือ เพราะไฟล์นี้มีสิทธิ์เข้าถึงฐานข้อมูลของคุณเต็มรูปแบบ แนะนำให้ใช้วิธี Terminal ด้านบนจะปลอดภัยกว่า

### 4.2 สร้าง Web Service บน Render
1. Render Dashboard → กด **New +** → **Web Service**
2. เลือก repo `sbg-warehouse` เดิม → Connect
3. ตั้งค่า:
   - **Name**: `sbg-warehouse-push` (หรือชื่อที่ชอบ)
   - **Root Directory**: `backend`
   - **Branch**: `main`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: อ่านหัวข้อ "ข้อควรระวัง" ด้านล่างก่อนเลือก

### 4.3 ใส่ค่า Environment Variables
ในหน้าเดียวกัน เลื่อนลงมาส่วน **Environment Variables** กด **Add Environment Variable** ใส่ทีละตัว:

| Key | Value |
|---|---|
| `FIREBASE_SERVICE_ACCOUNT_BASE64` | (วางข้อความยาวๆ จากข้อ 4.1) |
| `ADMIN_PIN` | ตั้งรหัส 4-8 หลักเอง เช่น `2024` (ใช้เข้าหน้าตั้งค่าในแอป) |
| `ADMIN_TEST_SECRET` | ตั้งรหัสลับอะไรก็ได้ เช่น `mysecret123` |

กด **Create Web Service** — รอสักครู่ Render จะ build และรันให้

### 4.4 ตรวจสอบว่า Backend ทำงาน
1. เปิด URL ของ backend ที่ได้ (เช่น `https://sbg-warehouse-push.onrender.com`)
2. ควรเห็นข้อความ JSON แบบนี้: `{"status":"ok","service":"sbg-warehouse-push-backend",...}`
3. ถ้าเห็นแบบนี้ = สำเร็จ ✅

### 4.5 เชื่อม Backend กลับเข้า Frontend
1. คัดลอก URL ของ backend (เช่น `https://sbg-warehouse-push.onrender.com`)
2. กลับไปเปิดไฟล์ `.env` (ไฟล์เดียวกับเฟส 3.2) ใส่:
   ```
   PUSH_BACKEND_URL=https://sbg-warehouse-push.onrender.com
   ```
3. รัน `node scripts/build-env.js` อีกครั้ง
4. อัพโหลดไฟล์ `.env` และ `js/env.js` ที่อัพเดทแล้ว กลับขึ้น GitHub (Render จะ deploy ให้ใหม่อัตโนมัติภายในไม่กี่นาที)

### ⚠️ ข้อควรระวังสำคัญที่สุด — Render ฟรีจะ "หลับ"

Backend ตัวนี้ต้องทำงานตลอดเวลาเพื่อฟังการแจ้งเตือน แต่ Render แผนฟรีจะ**หลับอัตโนมัติถ้าไม่มีคนเข้าใช้ 15 นาที** พอหลับแล้ว Push จะไม่ถูกส่ง

**วิธีแก้ (เลือกอย่างใดอย่างหนึ่ง — แนะนำทำทันทีหลัง deploy เสร็จ):**

- **วิธีฟรี**: ไปที่ https://uptimerobot.com สมัครฟรี → สร้าง Monitor ใหม่ → ใส่ URL `https://sbg-warehouse-push.onrender.com/health` → ตั้งให้ ping ทุก 5-10 นาที วิธีนี้จะหลอกให้ Render คิดว่ามีคนใช้งานตลอด ไม่หลับ
- **วิธีจ่ายเงิน**: ใน Render กลับไปที่ตั้งค่า backend service → เปลี่ยน Instance Type จาก Free เป็น **Starter** (มีค่าใช้จ่ายรายเดือน) จะไม่หลับเลย

**เฟส 4 เสร็จแล้ว ✅**

---

## ✅ ทดสอบระบบทั้งหมด

1. เปิดแอปในมือถือ 2 เครื่อง (คนละคน)
2. เข้าชื่องานเดียวกันทั้งสองเครื่อง
3. ทั้งสองเครื่องกด 🔔 เปิดการแจ้งเตือน (อนุญาตสิทธิ์ตอนเบราว์เซอร์ถาม)
4. **ปิดแอปเครื่องที่ 2 ไปเลยจริงๆ** (ไม่ใช่แค่สลับแท็บ)
5. เครื่องที่ 1 ลองสแกน Carton หรือปิดชื่องาน
6. เครื่องที่ 2 ควรมีแจ้งเตือนขึ้นมาแม้ปิดแอปอยู่ 🎉

ถ้าไม่ขึ้น ให้เช็คตามลำดับ: Backend ยัง sleep อยู่ไหม (ดูข้อ ⚠️ ด้านบน) → ตั้งค่า UptimeRobot ไว้หรือยัง → VAPID Key ใส่ถูกไหม → ลอง Hard refresh (Ctrl+Shift+R) แอปทั้งสองเครื่อง

---

## 🆘 ถ้าติดปัญหา

บอกได้เลยว่าติดตรงขั้นตอนไหน (เช่น "เฟส 3 ข้อ 3.3 กด Create แล้ว error") จะช่วยไล่ดูให้ครับ ไม่ต้องรู้เรื่อง IT มาก่อนก็ทำตามคู่มือนี้ได้
