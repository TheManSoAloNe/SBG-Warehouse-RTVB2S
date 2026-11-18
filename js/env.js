// ไฟล์นี้ถูก generate อัตโนมัติจาก scripts/build-env.js
// ห้ามแก้ไขตรงนี้ตรงๆ — ให้ไปแก้ที่ .env แล้วรัน node scripts/build-env.js ใหม่
// ห้าม commit ไฟล์นี้ขึ้น Git (อยู่ใน .gitignore แล้ว)
// ใช้ "self" แทน "window" เพราะไฟล์นี้ถูก import ทั้งในหน้าเว็บปกติ และใน Service Worker
self.__FIREBASE_CONFIG__ = {
  "apiKey": "AIzaSyClNUQksC7cKEoKtdfAO3zXcT8csgBVgVA",
  "authDomain": "sbg-warehouse-rtvb2s.firebaseapp.com",
  "projectId": "sbg-warehouse-rtvb2s",
  "storageBucket": "sbg-warehouse-rtvb2s.firebasestorage.app",
  "messagingSenderId": "950339112649",
  "appId": "1:950339112649:web:86b4563823a850abe60718"
};
self.__FIREBASE_VAPID_KEY__ = "your-vapid-key-here";
self.__PUSH_BACKEND_URL__ = "https://sbg-warehouse-rtvb2s-push-lwer.onrender.com";
