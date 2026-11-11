// ไฟล์นี้ถูก generate จาก scripts/build-env.js (อ่านค่าจาก .env)
// ห้าม commit ค่าจริงขึ้น Git — ไฟล์นี้อยู่ใน .gitignore
// ค่าเริ่มต้น (ยังไม่ได้ตั้งค่า) = null → ระบบจะเปิดเป็น MOCKUP MODE โดยอัตโนมัติ
//
// ใช้ "self" แทน "window" เพราะไฟล์นี้ถูก import ทั้งในหน้าเว็บปกติ และใน Service Worker
// (Service Worker ไม่มี "window" แต่มี "self" ทั้งคู่ — ในหน้าเว็บปกติ self === window)
//
// วิธีใช้งานจริง:
// 1. คัดลอก .env.example เป็น .env
// 2. ใส่ค่า Firebase Config + VAPID Key (Push) + PUSH_BACKEND_URL (สำหรับ PIN)
// 3. รัน: node scripts/build-env.js
// 4. ไฟล์นี้จะถูกเขียนทับด้วยค่าจริง

self.__FIREBASE_CONFIG__ = null;
self.__FIREBASE_VAPID_KEY__ = null;
self.__PUSH_BACKEND_URL__ = null;
