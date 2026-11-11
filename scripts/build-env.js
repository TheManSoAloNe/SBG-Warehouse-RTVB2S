/**
 * build-env.js
 * อ่านไฟล์ .env แล้วสร้าง js/env.js สำหรับใช้งานฝั่ง Browser
 * รัน: node scripts/build-env.js
 *
 * หมายเหตุ: โปรเจกต์นี้ไม่จำเป็นต้องใช้ Node ในการรันแอปจริง
 * สคริปต์นี้เป็นแค่เครื่องมือช่วย generate js/env.js จาก .env เท่านั้น
 * ถ้าไม่มี Node ก็สามารถสร้าง js/env.js เองด้วยมือ โดยดูโครงสร้างจาก js/env.example.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ENV_PATH = path.join(ROOT, '.env');
const OUT_PATH = path.join(ROOT, 'js', 'env.js');

function parseEnv(content) {
  const result = {};
  content.split('\n').forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const idx = trimmed.indexOf('=');
    if (idx === -1) return;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    value = value.replace(/^["']|["']$/g, '');
    result[key] = value;
  });
  return result;
}

function main() {
  if (!fs.existsSync(ENV_PATH)) {
    console.error('[build-env] ไม่พบไฟล์ .env — คัดลอก .env.example เป็น .env ก่อน');
    process.exit(1);
  }

  const raw = fs.readFileSync(ENV_PATH, 'utf-8');
  const env = parseEnv(raw);

  const required = [
    'FIREBASE_API_KEY',
    'FIREBASE_AUTH_DOMAIN',
    'FIREBASE_PROJECT_ID',
    'FIREBASE_STORAGE_BUCKET',
    'FIREBASE_MESSAGING_SENDER_ID',
    'FIREBASE_APP_ID',
  ];

  const hasAllValues = required.every((key) => env[key] && env[key].length > 0);
  const vapidKey = env.FIREBASE_VAPID_KEY || '';
  const backendUrl = (env.PUSH_BACKEND_URL || '').replace(/\/$/, ''); // ตัด "/" ท้ายออกกันพลาด

  let fileContent;

  if (!hasAllValues) {
    console.warn('[build-env] .env ยังไม่ครบค่า Firebase → สร้าง env.js แบบว่าง (จะเข้า MOCKUP MODE)');
    fileContent = `// ไฟล์นี้ถูก generate อัตโนมัติจาก scripts/build-env.js
// .env ยังไม่ได้ใส่ค่า Firebase ครบ → ระบบจะเปิดเป็น MOCKUP MODE
// ใช้ "self" แทน "window" เพราะไฟล์นี้ถูก import ทั้งในหน้าเว็บปกติ และใน Service Worker
// (Service Worker ไม่มี "window" แต่มี "self" ทั้งคู่)
self.__FIREBASE_CONFIG__ = null;
self.__FIREBASE_VAPID_KEY__ = null;
self.__PUSH_BACKEND_URL__ = ${backendUrl ? JSON.stringify(backendUrl) : 'null'};
`;
  } else {
    const config = {
      apiKey: env.FIREBASE_API_KEY,
      authDomain: env.FIREBASE_AUTH_DOMAIN,
      projectId: env.FIREBASE_PROJECT_ID,
      storageBucket: env.FIREBASE_STORAGE_BUCKET,
      messagingSenderId: env.FIREBASE_MESSAGING_SENDER_ID,
      appId: env.FIREBASE_APP_ID,
    };

    fileContent = `// ไฟล์นี้ถูก generate อัตโนมัติจาก scripts/build-env.js
// ห้ามแก้ไขตรงนี้ตรงๆ — ให้ไปแก้ที่ .env แล้วรัน node scripts/build-env.js ใหม่
// ห้าม commit ไฟล์นี้ขึ้น Git (อยู่ใน .gitignore แล้ว)
// ใช้ "self" แทน "window" เพราะไฟล์นี้ถูก import ทั้งในหน้าเว็บปกติ และใน Service Worker
self.__FIREBASE_CONFIG__ = ${JSON.stringify(config, null, 2)};
self.__FIREBASE_VAPID_KEY__ = ${vapidKey ? JSON.stringify(vapidKey) : 'null'};
self.__PUSH_BACKEND_URL__ = ${backendUrl ? JSON.stringify(backendUrl) : 'null'};
`;
    console.log('[build-env] สร้าง js/env.js สำเร็จ → ระบบจะเปิดเป็น REAL MODE' + (vapidKey ? ' (พบ VAPID Key — Push Notification พร้อมใช้งาน)' : ' (ไม่พบ VAPID Key — Push Notification จะยังใช้ไม่ได้ ดู .env.example)'));
    if (!backendUrl) {
      console.warn('[build-env] ไม่พบ PUSH_BACKEND_URL → ระบบ PIN ป้องกันหน้าตั้งค่าจะใช้งานไม่ได้ (จะเข้าหน้า Setup ได้โดยไม่ต้องใส่ PIN)');
    }
  }

  fs.writeFileSync(OUT_PATH, fileContent, 'utf-8');
  console.log(`[build-env] เขียนไฟล์ที่ ${OUT_PATH} เรียบร้อย`);
}

main();
