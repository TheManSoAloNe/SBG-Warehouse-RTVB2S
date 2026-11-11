/**
 * SBG-Warehouse RTVB2S — Push Notification Backend
 * -------------------------------------------------
 * หน้าที่ของเซิร์ฟเวอร์นี้มีอย่างเดียวคือ:
 *   1. เปิดการเชื่อมต่อ Firestore แบบ Realtime (onSnapshot) ค้างไว้ตลอดเวลา
 *   2. ตรวจจับ 2 เหตุการณ์:
 *        - มีการ "ปิดชื่องาน" (ชื่องานs: status active -> closed)
 *        - มีการ "บันทึก Carton ใหม่" (cartons: เอกสารใหม่)
 *   3. ค้นหา FCM Token ของคนอื่นๆ ที่อยู่ในชื่องานเดียวกัน (ไม่ส่งกลับไปหาคนที่ทำเอง)
 *   4. ยิง Push Notification ผ่าน Firebase Cloud Messaging (ใช้งานได้แม้ปิดแอป/เบราว์เซอร์ไปแล้ว)
 *
 * เซิร์ฟเวอร์นี้ไม่มี business logic อื่นใด ไม่ได้ทำหน้าที่ CRUD ข้อมูลแทน Frontend
 * (Frontend ยังคงเขียน/อ่าน Firestore ตรงเหมือนเดิมทุกจุด) — เซิร์ฟเวอร์นี้แค่ "เฝ้าดูแล้วส่งข่าว"
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');

/* ------------------------------------------------------------------
   1) โหลด Firebase Service Account จาก ENV แล้ว init firebase-admin
------------------------------------------------------------------ */
function loadServiceAccount() {
  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
  if (!b64) {
    console.error('[FATAL] ไม่พบ FIREBASE_SERVICE_ACCOUNT_BASE64 ใน environment variables');
    console.error('ดูวิธีตั้งค่าที่ .env.example');
    process.exit(1);
  }
  try {
    const json = Buffer.from(b64, 'base64').toString('utf-8');
    return JSON.parse(json);
  } catch (err) {
    console.error('[FATAL] อ่าน FIREBASE_SERVICE_ACCOUNT_BASE64 ไม่สำเร็จ (base64/JSON ผิดรูปแบบ):', err.message);
    process.exit(1);
  }
}

const serviceAccount = loadServiceAccount();
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});
const db = admin.firestore();
const messaging = admin.messaging();

console.log('[startup] เชื่อมต่อ Firebase project:', serviceAccount.project_id);

/* ------------------------------------------------------------------
   1b) ตัวนับสถิติ + แม่แบบข้อความแจ้งเตือน (B3, B4, B9)
------------------------------------------------------------------ */
const serverStartTime = Date.now();
let pushSentToday = 0;
let pushCounterDate = new Date().toDateString();

function bumpPushCounter(count) {
  const today = new Date().toDateString();
  if (today !== pushCounterDate) { pushCounterDate = today; pushSentToday = 0; }
  pushSentToday += count;
}

let notifyTemplates = { jobClosed: '', cartonNew: '' };
db.collection('settings').doc('notifyTemplates').onSnapshot(
  (doc) => { if (doc.exists && doc.data().data) notifyTemplates = doc.data().data; },
  (err) => console.warn('[templates] listen error:', err.message)
);

function fillTemplate(tpl, vars) {
  if (!tpl) return null;
  let out = tpl;
  Object.keys(vars).forEach((k) => { out = out.split('{' + k + '}').join(vars[k]); });
  return out;
}

/* ------------------------------------------------------------------
   2) ยูทิลิตี้: ส่ง Push ให้ทุก token ของคนในชื่องานเดียวกัน (ยกเว้นคนที่ทำเอง)
------------------------------------------------------------------ */
async function notifyJobMembers({ jobId, excludeUserId, title, body }) {
  if (!jobId) return;
  try {
    const snap = await db.collection('fcmTokens').where('jobId', '==', jobId).get();
    const tokens = [];
    snap.forEach((doc) => {
      const data = doc.data();
      if (!data.token) return;
      if (excludeUserId && data.userId === excludeUserId) return;
      tokens.push(data.token);
    });

    if (!tokens.length) {
      console.log(`[notify] ไม่มีผู้รับสำหรับ job ${jobId} (excluding ${excludeUserId})`);
      return;
    }

    const message = {
      notification: { title, body },
      webpush: {
        notification: {
          icon: '/icons/icon-192.png',
          badge: '/icons/icon-192.png',
        },
        fcmOptions: { link: '/' },
      },
      tokens,
    };

    const result = await messaging.sendEachForMulticast(message);
    bumpPushCounter(result.successCount);
    console.log(`[notify] ส่งสำเร็จ ${result.successCount}/${tokens.length} ไปยัง job ${jobId}: "${title}"`);

    // เก็บกวาด token ที่ใช้ไม่ได้แล้ว (unregister/invalid) ออกจาก Firestore
    const invalidTokens = [];
    result.responses.forEach((r, i) => {
      if (!r.success) {
        const code = r.error && r.error.code;
        if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token') {
          invalidTokens.push(tokens[i]);
        }
      }
    });
    if (invalidTokens.length) {
      const batch = db.batch();
      const cleanupSnap = await db.collection('fcmTokens').where('token', 'in', invalidTokens.slice(0, 10)).get();
      cleanupSnap.forEach((doc) => batch.delete(doc.ref));
      await batch.commit().catch(() => {});
      console.log(`[notify] ลบ token ที่หมดอายุ ${invalidTokens.length} รายการ`);
    }
  } catch (err) {
    console.error('[notify] error:', err.message);
  }
}

/* ------------------------------------------------------------------
   3) ฟังการเปลี่ยนแปลงของ "ชื่องานs" — แจ้งเตือนเมื่อมีการปิดงาน
------------------------------------------------------------------ */
const lastKnownJobStatus = new Map(); // jobId -> status ('active' | 'closed')
let jobsListenerReady = false;

db.collection('ชื่องานs').onSnapshot(
  (snapshot) => {
    snapshot.docChanges().forEach((change) => {
      const job = change.doc.data();
      const jobId = change.doc.id;
      const prevStatus = lastKnownJobStatus.get(jobId);
      lastKnownJobStatus.set(jobId, job.status);

      // ข้ามรอบแรกที่โหลด (initial snapshot) ไม่ให้แจ้งเตือนย้อนหลังของเก่า
      if (!jobsListenerReady) return;

      if ((change.type === 'modified' || change.type === 'added') && job.status === 'closed' && prevStatus !== 'closed') {
        const vars = { jobName: job.name || 'ชื่องาน', userName: job.closedByName || '-', cartonNo: '' };
        notifyJobMembers({
          jobId,
          excludeUserId: job.closedByUserId,
          title: '📋 ' + (job.name || 'ชื่องาน') + ' ถูกปิดแล้ว',
          body: fillTemplate(notifyTemplates.jobClosed, vars) || ('ปิดโดย ' + (job.closedByName || '-')),
        });
      }

      if (change.type === 'modified' && job.status === 'active' && prevStatus === 'closed') {
        notifyJobMembers({
          jobId,
          title: '↩️ ' + (job.name || 'ชื่องาน') + ' ถูกเปิดใช้งานอีกครั้ง',
          body: 'เปิดโดย ' + (job.reopenedByName || '-'),
        });
      }
    });
    jobsListenerReady = true;
  },
  (err) => console.error('[listener:ชื่องานs] error:', err.message)
);

/* ------------------------------------------------------------------
   4) ฟังการเปลี่ยนแปลงใน "cartons" — แจ้งเตือนเมื่อ Carton ถูก "ปิด" สำเร็จ
   Feedback 1.1: ตอนนี้ Carton doc ถูกสร้างเป็น draft ทันทีที่เริ่มสแกน (ไม่ใช่ตอนปิดแบบเดิม)
   ดังนั้นห้ามแจ้งเตือนตอน "added" อีกต่อไป (จะกลายเป็นแจ้งเตือนทุกครั้งที่มีคนเริ่มสแกน Carton เปล่าๆ)
   ต้องเปลี่ยนไปจับตอน status เปลี่ยนจาก draft -> closed แทน (เหมือน logic ของ ชื่องานs)
------------------------------------------------------------------ */
const lastKnownCartonStatus = new Map(); // cartonId -> status ('draft' | 'closed')
let cartonsListenerReady = false;

db.collection('cartons').onSnapshot(
  (snapshot) => {
    snapshot.docChanges().forEach((change) => {
      const carton = change.doc.data();
      const cartonId = change.doc.id;
      const prevStatus = lastKnownCartonStatus.get(cartonId);
      lastKnownCartonStatus.set(cartonId, carton.status);

      // ข้ามรอบแรกที่โหลด (initial snapshot) ไม่ให้แจ้งเตือนย้อนหลังของเก่า
      if (!cartonsListenerReady) return;

      const justClosed = carton.status === 'closed' && prevStatus !== 'closed';
      if ((change.type === 'modified' || change.type === 'added') && justClosed) {
        const vars = {
          jobName: carton['ชื่องานName'] || '', userName: carton.closedByName || carton.userName || '-', cartonNo: carton.cartonNo || '-',
        };
        notifyJobMembers({
          jobId: carton['ชื่องานId'],
          excludeUserId: carton.closedByUserId || carton.userId,
          title: '📦 Carton ใหม่: ' + (carton.cartonNo || '-'),
          body: fillTemplate(notifyTemplates.cartonNew, vars) ||
            ((carton.userName || '-') + ' สแกน ' + (carton.totalSku || 0) + ' SKU / ' + (carton.totalQty || 0) + ' ชิ้น'),
        });
      }
    });
    cartonsListenerReady = true;
  },
  (err) => console.error('[listener:cartons] error:', err.message)
);

/* ------------------------------------------------------------------
   4b) AUTO-CLOSE ชื่องานที่ไม่มีการสแกนเกิน 8 ชั่วโมง (B7)
   Frontend เตือนล่วงหน้า 30 นาทีในหน้า Settings — ที่นี่คือจุดที่ "ปิดจริง"
   เช็คทุก 5 นาที เพื่อไม่ให้พลาดเวลาที่แม่นยำเกินไป (ยอมรับความคลาดเคลื่อนได้ไม่กี่นาที)
------------------------------------------------------------------ */
const AUTO_CLOSE_MS = 8 * 60 * 60 * 1000; // 8 ชั่วโมง
const AUTO_CLOSE_CHECK_INTERVAL_MS = 5 * 60 * 1000; // เช็คทุก 5 นาที

async function runAutoCloseCheck() {
  try {
    const snap = await db.collection('ชื่องานs').where('status', '==', 'active').get();
    const now = Date.now();
    for (const doc of snap.docs) {
      const job = doc.data();
      const lastActivity = job.lastActivityAt ? toMillisSafe(job.lastActivityAt) : toMillisSafe(job.createdAt);
      if (!lastActivity) continue;
      if (now - lastActivity < AUTO_CLOSE_MS) continue;

      await doc.ref.update({
        status: 'closed',
        closedAt: admin.firestore.Timestamp.now(),
        closedByUserId: null,
        closedByName: 'ระบบ (Auto-close 8 ชม.)',
      });
      console.log(`[auto-close] ปิดชื่องาน "${job.name}" อัตโนมัติ (ไม่มีการสแกนเกิน 8 ชม.)`);

      notifyJobMembers({
        jobId: doc.id,
        title: '⏰ ' + (job.name || 'ชื่องาน') + ' ถูกปิดอัตโนมัติ',
        body: 'ไม่มีการสแกนเกิน 8 ชั่วโมง ระบบปิดให้อัตโนมัติ',
      });
    }
  } catch (err) {
    console.error('[auto-close] error:', err.message);
  }
}

function toMillisSafe(val) {
  if (!val) return 0;
  if (typeof val.toMillis === 'function') return val.toMillis();
  if (val instanceof Date) return val.getTime();
  return new Date(val).getTime() || 0;
}

setInterval(runAutoCloseCheck, AUTO_CLOSE_CHECK_INTERVAL_MS);
setTimeout(runAutoCloseCheck, 15000); // เช็คครั้งแรกหลังสตาร์ทเซิร์ฟเวอร์ 15 วิ

/* ------------------------------------------------------------------
   5) Express server — ใช้แค่สำหรับ health check + ping กันเครื่อง sleep
------------------------------------------------------------------ */
const app = express();
app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    service: 'sbg-warehouse-push-backend',
    firebaseProject: serviceAccount.project_id,
    jobsListenerReady,
    cartonsListenerReady,
    pushSentToday,
    uptimeMinutes: (Date.now() - serverStartTime) / 60000,
    time: new Date().toISOString(),
  });
});

app.get('/health', (req, res) => res.status(200).send('OK'));

// endpoint ทดสอบยิง push เอง (ป้องกันด้วย secret กันคนนอกยิงเล่น)
app.post('/api/test-push', async (req, res) => {
  const { secret, jobId, title, body } = req.body || {};
  if (!secret || secret !== process.env.ADMIN_TEST_SECRET) {
    return res.status(403).json({ error: 'invalid secret' });
  }
  if (!jobId) return res.status(400).json({ error: 'jobId is required' });
  await notifyJobMembers({ jobId, title: title || 'ทดสอบแจ้งเตือน', body: body || 'ข้อความทดสอบจาก /api/test-push' });
  res.json({ ok: true });
});

/* ------------------------------------------------------------------
   6) PIN verification — ป้องกันหน้าตั้งค่า (Setup / Import) ของ Frontend
   PIN จริงเก็บไว้ที่ ENV ของ backend เท่านั้น (ไม่ฝังไว้ใน Frontend)
   มี rate limit กันคนสุ่มลอง PIN รัวๆ (ต่อ IP)
------------------------------------------------------------------ */
const pinAttempts = new Map(); // ip -> { count, resetAt }
const PIN_MAX_ATTEMPTS = 5;
const PIN_WINDOW_MS = 5 * 60 * 1000; // 5 นาที

function getClientIp(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
}

app.post('/api/verify-pin', (req, res) => {
  if (!process.env.ADMIN_PIN) {
    return res.status(500).json({ ok: false, error: 'ADMIN_PIN ยังไม่ได้ตั้งค่าบนเซิร์ฟเวอร์' });
  }

  const ip = getClientIp(req);
  const now = Date.now();
  const record = pinAttempts.get(ip);

  if (record && now < record.resetAt && record.count >= PIN_MAX_ATTEMPTS) {
    const waitSec = Math.ceil((record.resetAt - now) / 1000);
    return res.status(429).json({ ok: false, error: `ลองผิดหลายครั้งเกินไป กรุณารออีก ${waitSec} วินาที` });
  }

  const { pin } = req.body || {};
  const isCorrect = typeof pin === 'string' && pin === process.env.ADMIN_PIN;

  if (isCorrect) {
    pinAttempts.delete(ip);
    return res.json({ ok: true });
  }

  const next = record && now < record.resetAt
    ? { count: record.count + 1, resetAt: record.resetAt }
    : { count: 1, resetAt: now + PIN_WINDOW_MS };
  pinAttempts.set(ip, next);

  return res.status(401).json({ ok: false, error: 'PIN ไม่ถูกต้อง', attemptsLeft: Math.max(0, PIN_MAX_ATTEMPTS - next.count) });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`[startup] SBG-Warehouse Push Backend กำลังทำงานที่พอร์ต ${PORT}`);
});
