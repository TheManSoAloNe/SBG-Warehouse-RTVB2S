/* Service Worker — SBG-Warehouse RTVB2S
   1) แคชเฉพาะไฟล์ static ของแอป (app shell) เพื่อให้เปิดแอปได้เร็วขึ้นและใช้งานได้
      บางส่วนแม้เน็ตหลุดชั่วคราว ข้อมูล Firestore ยังต้องใช้อินเทอร์เน็ตตามปกติ
   2) รับ Push Notification จาก Firebase Cloud Messaging (FCM) ตอนแอปปิด/อยู่เบื้องหลัง
      (ทำงานร่วมกับ Backend บน Render ที่คอยฟัง Firestore แล้วยิง push มาที่นี่) */

const CACHE_NAME = 'sbg-warehouse-v3';
const APP_SHELL = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './js/env.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = event.request.url;
  // ไม่แคช Firebase / CDN ภายนอก ปล่อยให้ผ่านเน็ตตามปกติเสมอ (ต้องการข้อมูล realtime)
  if (url.includes('firestore') || url.includes('firebaseio') || url.includes('gstatic') ||
      url.includes('unpkg.com') || url.includes('firebase')) {
    return;
  }
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request).catch(() => cached))
  );
});

/* ------------------------------------------------------------------
   Firebase Cloud Messaging — Background Push Handler
   importScripts ใช้ได้เฉพาะใน Service Worker เท่านั้น (ไม่ใช่หน้าเว็บปกติ)
   env.js ใช้ "self.__FIREBASE_CONFIG__" (ไม่ใช่ window) จึงอ่านได้ทั้งสองที่
------------------------------------------------------------------ */
try {
  importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
  importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');
  importScripts('./js/env.js');

  if (self.__FIREBASE_CONFIG__ && self.__FIREBASE_CONFIG__.apiKey) {
    firebase.initializeApp(self.__FIREBASE_CONFIG__);
    const messaging = firebase.messaging();

    messaging.onBackgroundMessage((payload) => {
      const title = (payload.notification && payload.notification.title) || 'SBG-Warehouse';
      const body = (payload.notification && payload.notification.body) || '';
      self.registration.showNotification(title, {
        body,
        icon: './icons/icon-192.png',
        badge: './icons/icon-192.png',
        data: { url: './' },
      });
    });
  }
} catch (e) {
  // เกิดได้ถ้าไม่มีอินเทอร์เน็ตตอนติดตั้ง SW ครั้งแรก หรือยังไม่ได้ตั้งค่า Firebase — ไม่ต้อง throw ต่อ
  console.warn('[service-worker] FCM background handler ไม่ทำงาน:', e.message || e);
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || './';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(targetUrl);
    })
  );
});
