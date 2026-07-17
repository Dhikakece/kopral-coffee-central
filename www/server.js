const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const fs = require("fs");
const webpush = require("web-push");

const app = express();
const server = http.createServer(app);

// Konfigurasi Socket.io dengan CORS terbuka agar bisa diakses dari HP Pelanggan & Aplikasi Android
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
  // FITUR BARU: Mengizinkan ukuran buffer hingga 10MB untuk menangani data gambar/bukti transfer
  maxHttpBufferSize: 10 * 1024 * 1024,
});

// Tangani koneksi socket dan event dari klien
io.on("connection", (socket) => {
  console.log("[Socket] Client connected:", socket.id);

  // Klien dapat mengirimkan identitas role untuk bergabung pada room khusus
  socket.on("identify", (payload) => {
    try {
      const role = String(payload && payload.role ? payload.role : "").trim();
      if (!role) return;
      const safe = role.replace(/[^a-z0-9_-]/gi, "_").toLowerCase();
      socket.join(safe);
      console.log(`[Socket] ${socket.id} joined room: ${safe}`);
    } catch (e) {
      console.error("[Socket] Error on identify:", e);
    }
  });

  // Terima update stok dari dashboard kasir (atau admin) lalu broadcast ke semua klien
  socket.on("update-stok-realtime", (payload) => {
    try {
      const id = payload?.id;
      const stock = Number(payload?.stock);
      const name = payload?.name;
      if (!id) return;
      const safeStock = Number.isFinite(stock)
        ? stock
        : stockCatalog[id]?.stock || 0;
      const produk = stockCatalog[id] || { id, name: name || id, stock: 0 };
      produk.stock = safeStock;
      if (name) produk.name = name;
      stockCatalog[id] = produk;
      saveStockCatalog();

      console.log(
        `[Socket] Received update-stok-realtime from ${socket.id}:`,
        produk,
      );

      // Siarkan ke semua klien (termasuk pengirim) agar tampilan sinkron
      io.emit("update-stok-realtime", {
        id: produk.id,
        name: produk.name,
        stock: produk.stock,
      });
    } catch (e) {
      console.error("[Socket] Error processing update-stok-realtime:", e);
    }
  });

  socket.on("disconnect", () => {
    console.log("[Socket] Client disconnected:", socket.id);
  });
});

// Middleware untuk membaca data JSON dan mengizinkan akses lintas domain (CORS)
// Catatan: Express secara default juga memiliki limit, untuk amannya jika ada error,
// tambahkan app.use(express.json({ limit: '10mb' })); di bawah ini.
app.use(express.json({ limit: "10mb" }));

// Izinkan CORS secara global sebelum route apapun agar semua response menyertakan header
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept",
  );
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

const DATA_PATH = path.join(__dirname, "data", "stock.json");
const RIWAYAT_PATH = path.join(__dirname, "data", "riwayat.json");
const PAYMENTS_PATH = path.join(__dirname, "data", "payments.json");
const SUBSCRIPTIONS_PATH = path.join(__dirname, "data", "subscriptions.json");

const DEVICES_PATH = path.join(__dirname, "data", "devices.json");
const FIREBASE_SERVICE_ACCOUNT_PATH = path.join(
  __dirname,
  "data",
  "firebase-service-account.json",
);

let firebaseAdmin = null;
let firebaseAvailable = false;
let firebaseInitError = null;

function parseFirebaseServiceAccount(rawValue) {
  if (!rawValue) return null;
  const value = String(rawValue).trim();
  if (!value) return null;

  try {
    return JSON.parse(value);
  } catch (e) {
    // coba decode dari base64 jika env var dikirim dalam bentuk base64
    try {
      const decoded = Buffer.from(value, "base64").toString("utf8").trim();
      if (decoded.startsWith("{")) {
        return JSON.parse(decoded);
      }
    } catch (decodeErr) {
      // ignore
    }
  }
  return null;
}

function initializeFirebaseAdmin() {
  try {
    const admin = require("firebase-admin");
    const candidates = [];

    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      candidates.push({
        source: "FIREBASE_SERVICE_ACCOUNT",
        value: process.env.FIREBASE_SERVICE_ACCOUNT,
      });
    }
    if (process.env.FIREBASE_SERVICE_ACCOUNT_BASE64) {
      candidates.push({
        source: "FIREBASE_SERVICE_ACCOUNT_BASE64",
        value: process.env.FIREBASE_SERVICE_ACCOUNT_BASE64,
      });
    }
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      candidates.push({
        source: "GOOGLE_APPLICATION_CREDENTIALS",
        value: process.env.GOOGLE_APPLICATION_CREDENTIALS,
      });
    }
    if (fs.existsSync(FIREBASE_SERVICE_ACCOUNT_PATH)) {
      candidates.push({
        source: "local-file",
        value: FIREBASE_SERVICE_ACCOUNT_PATH,
      });
    }

    let serviceAccount = null;
    let usedSource = null;

    for (const candidate of candidates) {
      if (!candidate.value) continue;

      if (candidate.source === "local-file") {
        try {
          serviceAccount = JSON.parse(fs.readFileSync(candidate.value, "utf8"));
          usedSource = candidate.source;
          break;
        } catch (e) {
          console.warn(
            `[Firebase] Gagal baca file ${candidate.value}:`,
            e.message,
          );
        }
      } else {
        const parsed = parseFirebaseServiceAccount(candidate.value);
        if (parsed) {
          serviceAccount = parsed;
          usedSource = candidate.source;
          break;
        }
      }
    }

    if (!serviceAccount) {
      firebaseInitError = "No valid Firebase service account found.";
      console.warn(
        "[Firebase] Tidak ada service account valid. FCM akan dinonaktifkan sampai credential tersedia.",
      );
      return;
    }

    const apps = Array.isArray(admin.apps) ? admin.apps : [];
    if (apps.length === 0) {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
    }

    firebaseAdmin = admin;
    firebaseAvailable = true;
    firebaseInitError = null;
    console.log(`[Firebase] Firebase Admin aktif via ${usedSource}.`);
  } catch (e) {
    firebaseInitError = e.message;
    console.error("[Firebase] GAGAL TOTAL Inisialisasi:", e.message);
  }
}
initializeFirebaseAdmin();

// Load environment variables from .env (optional)
try {
  require("dotenv").config();
} catch (e) {
  // dotenv is optional; in production env vars should be set externally
}

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || "";
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || "";

if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
  console.warn(
    "[VAPID] VAPID keys not found in environment variables. Web-push disabled for now.",
  );
} else {
  webpush.setVapidDetails(
    "mailto:admin@kopral.coffee",
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY,
  );
}

const defaultStockCatalog = {
  c01: { id: "c01", name: "Espresso Roman", stock: 0, category: "coffee" },
  c02: { id: "c02", name: "Creamy Latte", stock: 0, category: "coffee" },
  c03: { id: "c03", name: "Americano", stock: 0, category: "coffee" },
  c04: { id: "c04", name: "Cappuccino", stock: 0, category: "coffee" },
  c05: { id: "c05", name: "Caramel Macchiato", stock: 0, category: "coffee" },
  c06: { id: "c06", name: "Manual Brew", stock: 0, category: "coffee" },
  c07: { id: "c07", name: "Kopi Gula Aren", stock: 0, category: "coffee" },
  n01: {
    id: "n01",
    name: "Pure Matcha Latte",
    stock: 0,
    category: "non-coffee",
  },
  n02: { id: "n02", name: "Chocolate", stock: 0, category: "non-coffee" },
  n03: { id: "n03", name: "Milkshake", stock: 0, category: "non-coffee" },
  n04: { id: "n04", name: "Mocktail", stock: 0, category: "non-coffee" },
  n05: { id: "n05", name: "Lychee Tea", stock: 0, category: "non-coffee" },
  n06: { id: "n06", name: "Lemon Tea", stock: 0, category: "non-coffee" },
  n07: {
    id: "n07",
    name: "Signature Chocolate",
    stock: 0,
    category: "non-coffee",
  },
  s01: {
    id: "s01",
    name: "Butter Croissant",
    stock: 0,
    category: "snack & food",
  },
  s02: { id: "s02", name: "Mie Goreng", stock: 0, category: "snack & food" },
  s03: { id: "s03", name: "Pastry", stock: 0, category: "snack & food" },
  s04: { id: "s04", name: "Onion Rings", stock: 0, category: "snack & food" },
  s05: { id: "s05", name: "Tahu Crispy", stock: 0, category: "snack & food" },
  s06: { id: "s06", name: "Nasi Goreng", stock: 0, category: "snack & food" },
  s07: { id: "s07", name: "French Fries", stock: 0, category: "snack & food" },
};

function loadStockCatalog() {
  try {
    if (!fs.existsSync(DATA_PATH)) {
      fs.writeFileSync(DATA_PATH, JSON.stringify(defaultStockCatalog, null, 2));
      return { ...defaultStockCatalog };
    }
    const file = fs.readFileSync(DATA_PATH, "utf8");
    const disk = JSON.parse(file);
    return { ...defaultStockCatalog, ...disk };
  } catch (e) {
    console.error("[Server] Gagal membaca data stok, menggunakan default:", e);
    return { ...defaultStockCatalog };
  }
}

function saveStockCatalog() {
  try {
    fs.writeFileSync(DATA_PATH, JSON.stringify(stockCatalog, null, 2));
  } catch (e) {
    console.error("[Server] Gagal menyimpan data stok:", e);
  }
}

const PENDING_ORDERS_PATH = path.join(__dirname, "data", "pending_orders.json");

function loadPendingOrders() {
  try {
    if (!fs.existsSync(PENDING_ORDERS_PATH)) {
      fs.writeFileSync(PENDING_ORDERS_PATH, JSON.stringify([], null, 2));
      return [];
    }
    const file = fs.readFileSync(PENDING_ORDERS_PATH, "utf8");
    const parsed = JSON.parse(file || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.error("[Server] Gagal membaca pending orders:", e);
    return [];
  }
}

function savePendingOrders(orders) {
  try {
    const safe = Array.isArray(orders) ? orders : [];
    fs.writeFileSync(PENDING_ORDERS_PATH, JSON.stringify(safe, null, 2));
  } catch (e) {
    console.error("[Server] Gagal menyimpan pending orders:", e);
  }
}

function upsertPendingOrder(order) {
  if (!order || !order.id_pesanan) return null;
  const pending = loadPendingOrders();
  const normalized = {
    ...order,
    timestamp: order.timestamp || new Date().getTime(),
    tanggal: order.tanggal || new Date().toISOString().split("T")[0],
  };
  const existingIndex = pending.findIndex(
    (entry) => entry.id_pesanan === normalized.id_pesanan,
  );
  if (existingIndex >= 0) {
    pending[existingIndex] = { ...pending[existingIndex], ...normalized };
  } else {
    pending.unshift(normalized);
  }
  savePendingOrders(pending);
  return pending;
}

function removePendingOrder(id) {
  if (!id) return [];
  const pending = loadPendingOrders();
  const next = pending.filter((entry) => entry.id_pesanan !== id);
  savePendingOrders(next);
  return next;
}

function riwayatFileForRole(role) {
  const safe = String(role || "global")
    .replace(/[^a-z0-9_-]/gi, "_")
    .toLowerCase();
  return path.join(__dirname, "data", `riwayat_${safe}.json`);
}

function loadRiwayat(role) {
  try {
    const filePath = riwayatFileForRole(role);
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, JSON.stringify([], null, 2));
      return [];
    }
    const file = fs.readFileSync(filePath, "utf8");
    return JSON.parse(file || "[]");
  } catch (e) {
    console.error("[Server] Gagal membaca riwayat:", e);
    return [];
  }
}

function saveRiwayat(riwayat, role) {
  try {
    const filePath = riwayatFileForRole(role);
    fs.writeFileSync(filePath, JSON.stringify(riwayat, null, 2));
  } catch (e) {
    console.error("[Server] Gagal menyimpan riwayat:", e);
  }
}

function loadPayments() {
  try {
    if (!fs.existsSync(PAYMENTS_PATH)) {
      fs.writeFileSync(PAYMENTS_PATH, JSON.stringify({}, null, 2));
      return {};
    }
    const file = fs.readFileSync(PAYMENTS_PATH, "utf8");
    return JSON.parse(file || "{}");
  } catch (e) {
    console.error("[Server] Gagal membaca payments:", e);
    return {};
  }
}

function savePayments(payments) {
  try {
    fs.writeFileSync(PAYMENTS_PATH, JSON.stringify(payments, null, 2));
  } catch (e) {
    console.error("[Server] Gagal menyimpan payments:", e);
  }
}

function loadDevices() {
  try {
    if (!fs.existsSync(DEVICES_PATH)) {
      fs.writeFileSync(DEVICES_PATH, JSON.stringify([], null, 2));
      return [];
    }
    const file = fs.readFileSync(DEVICES_PATH, "utf8");
    return JSON.parse(file || "[]");
  } catch (e) {
    console.error("[Server] Gagal membaca devices:", e);
    return [];
  }
}

function saveDevices(devices) {
  try {
    fs.writeFileSync(DEVICES_PATH, JSON.stringify(devices, null, 2));
  } catch (e) {
    console.error("[Server] Gagal menyimpan devices:", e);
  }
}

async function sendFCMNotificationToDevices(payload) {
  if (!firebaseAvailable || !firebaseAdmin) {
    console.warn(
      "[Firebase] Gagal kirim: Firebase tidak aktif. Cek service account/credential.",
    );
    return;
  }

  try {
    const devices = loadDevices();
    const tokens = Array.from(
      new Set(
        devices
          .map((d) => String(d && d.token ? d.token : "").trim())
          .filter(Boolean),
      ),
    );

    if (!tokens.length) {
      console.log("[Firebase] Tidak ada token HP terdaftar di devices.json.");
      return;
    }

    console.log(
      `[Firebase] Mengirim notifikasi ke ${tokens.length} token terdaftar...`,
    );

    const sendPromises = tokens.map(async (token) => {
      const message = {
        token,
        notification: {
          title: payload.title || "KOPRAL POS",
          body: payload.body || "Ada notifikasi baru",
        },
        android: {
          priority: "high",
          notification: {
            channelId: "push-notification-channel-id",
            sound: "notification",
            visibility: "public",
          },
        },
        data: payload.data || {},
      };

      try {
        await firebaseAdmin.messaging().send(message);
        return { success: true, token };
      } catch (err) {
        const errorMessage = err && err.message ? err.message : String(err);
        console.warn(
          `[Firebase] Gagal kirim ke token ${token.slice(0, 12)}...: ${errorMessage}`,
        );
        return { success: false, token, error: errorMessage };
      }
    });

    const results = await Promise.all(sendPromises);
    const successCount = results.filter((r) => r.success).length;
    const failureCount = results.length - successCount;

    console.log(
      `[Firebase] Selesai: ${successCount} Berhasil, ${failureCount} Gagal.`,
    );

    const invalidTokens = results.filter(
      (r) =>
        !r.success &&
        (r.error.includes("not-registered") ||
          r.error.includes("not-found") ||
          r.error.includes("invalid-registration-token")),
    );

    if (invalidTokens.length > 0) {
      console.log(
        `[Firebase] Membersihkan ${invalidTokens.length} token mati/invalid...`,
      );
      const aliveDevices = devices.filter(
        (device) =>
          !invalidTokens.find((it) => String(device.token || "") === it.token),
      );
      saveDevices(aliveDevices);
    }
  } catch (e) {
    console.error("[Firebase] Error fatal pada fungsi kirim:", e);
  }
}

function loadSubscriptions() {
  try {
    if (!fs.existsSync(SUBSCRIPTIONS_PATH)) {
      fs.writeFileSync(SUBSCRIPTIONS_PATH, JSON.stringify([], null, 2));
      return [];
    }
    const file = fs.readFileSync(SUBSCRIPTIONS_PATH, "utf8");
    return JSON.parse(file || "[]");
  } catch (e) {
    console.error("[Server] Gagal membaca subscriptions:", e);
    return [];
  }
}

function saveSubscriptions(subscriptions) {
  try {
    fs.writeFileSync(
      SUBSCRIPTIONS_PATH,
      JSON.stringify(subscriptions, null, 2),
    );
  } catch (e) {
    console.error("[Server] Gagal menyimpan subscriptions:", e);
  }
}

async function sendPushNotification(payload) {
  if (!Array.isArray(subscriptions)) return;
  const keep = [];

  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(sub, JSON.stringify(payload));
        keep.push(sub);
      } catch (error) {
        if (error.statusCode === 410 || error.statusCode === 404) {
          console.log(
            "[Push] Subscription tidak valid, dihapus:",
            sub.endpoint,
          );
        } else {
          console.error("[Push] Gagal mengirim notifikasi:", error);
          keep.push(sub);
        }
      }
    }),
  );

  if (keep.length !== subscriptions.length) {
    subscriptions.splice(0, subscriptions.length, ...keep);
    saveSubscriptions(subscriptions);
  }
}

let payments = loadPayments();
let subscriptions = loadSubscriptions();

function findProductByName(name) {
  if (!name) return null;
  const lower = String(name).trim().toLowerCase();
  return Object.values(stockCatalog).find(
    (item) => item.name && item.name.toLowerCase() === lower,
  );
}

let stockCatalog = loadStockCatalog();

function getMenuPayload() {
  return {
    coffee: Object.values(stockCatalog)
      .filter((item) => item.category === "coffee")
      .map((item) => ({ id: item.id, name: item.name, stock: item.stock })),
    "non-coffee": Object.values(stockCatalog)
      .filter((item) => item.category === "non-coffee")
      .map((item) => ({ id: item.id, name: item.name, stock: item.stock })),
    snacks: Object.values(stockCatalog)
      .filter((item) => item.category === "snack & food")
      .map((item) => ({ id: item.id, name: item.name, stock: item.stock })),
  };
}

app.get("/", (req, res, next) => {
  if (req.query.action === "getMenu") {
    return res.json(getMenuPayload());
  }
  next();
});

// Menyediakan file statis dari root www agar index.html dan app.js dapat diakses
app.use(express.static(__dirname));

// Menyediakan file statis (Dashboard Kasir) dari folder 'public'
app.use(express.static(path.join(__dirname, "public")));

// Menyediakan file statis (Website Pelanggan) dari folder 'KOPRAL Coffee Central'
const customerSiteCandidates = [
  path.resolve(__dirname, "..", "..", "KOPRAL Coffee Central"),
  path.resolve(__dirname, "..", "KOPRAL Coffee Central"),
  path.resolve(__dirname, "../KOPRAL Coffee Central"),
];
const customerSitePath =
  customerSiteCandidates.find((candidate) => fs.existsSync(candidate)) ||
  customerSiteCandidates[0];

if (fs.existsSync(customerSitePath)) {
  console.log(`[Static] Pelanggan site served from: ${customerSitePath}`);
  app.use("/pelanggan", express.static(customerSitePath));
} else {
  console.warn(`[Static] Pelanggan site folder not found: ${customerSitePath}`);
}

app.get("/vapidPublicKey", (req, res) => {
  res.status(200).json({ publicKey: VAPID_PUBLIC_KEY });
});

app.post("/subscribe", (req, res) => {
  try {
    const subscription = req.body;
    if (!subscription || !subscription.endpoint) {
      return res
        .status(400)
        .json({ success: false, message: "Subscription invalid." });
    }

    const exists = subscriptions.some(
      (item) => item.endpoint === subscription.endpoint,
    );
    if (!exists) {
      subscriptions.push(subscription);
      saveSubscriptions(subscriptions);
      console.log("[Push] Subscription baru tersimpan:", subscription.endpoint);
    }

    return res.status(201).json({ success: true });
  } catch (e) {
    console.error("[Push] Gagal menyimpan subscription:", e);
    return res.status(500).json({
      success: false,
      message: "Server gagal menyimpan subscription.",
    });
  }
});

// API Endpoint: Tempat website pelanggan mengirimkan data pesanan (POST)
app.post("/api/pesanan-masuk", (req, res) => {
  const dataPesanan = req.body;
  const updatedStocks = [];

  console.log("👉 Ada Pesanan Baru Masuk via Cloud:", dataPesanan);

  if (Array.isArray(dataPesanan.items)) {
    dataPesanan.items.forEach((item) => {
      const quantity = Number(item.quantity) || 0;
      if (quantity <= 0) return;

      let produk = stockCatalog[item.id];
      if (!produk && item.name) {
        produk = findProductByName(item.name);
      }
      if (!produk) {
        return;
      }

      const beforeStock = Number(produk.stock) || 0;
      const afterStock = Math.max(0, beforeStock - quantity);
      if (afterStock !== beforeStock) {
        produk.stock = afterStock;
        stockCatalog[produk.id] = produk;
        updatedStocks.push(produk);
        console.log(
          `[Server] Dikurangi stok ${produk.name} (${produk.id}): ${beforeStock} -> ${afterStock}`,
        );
      }
    });

    if (updatedStocks.length) {
      saveStockCatalog();
      updatedStocks.forEach((produk) => {
        io.emit("update-stok-realtime", {
          id: produk.id,
          name: produk.name,
          stock: produk.stock,
        });
      });
    }
  }

  // Simpan bukti transfer jika dikirim oleh pelanggan (agar hanya admin yang dapat melihatnya nanti)
  try {
    const proof = dataPesanan.bukti_transfer || dataPesanan.buktiTransfer;
    if (proof && dataPesanan.id_pesanan) {
      payments[dataPesanan.id_pesanan] = proof;
      savePayments(payments);
      console.log(
        "[Payments] Stored bukti transfer for:",
        dataPesanan.id_pesanan,
      );
    }
  } catch (e) {
    console.error("[Payments] Error storing bukti transfer:", e);
  }

  // Kirim data pesanan secara REAL-TIME ke dashboard kasir / aplikasi Android
  const stocksDeducted = updatedStocks.length > 0;
  // Untuk admin: sertakan bukti_transfer jika ada
  const adminPayload = { ...dataPesanan, stocksDeducted };

  // Untuk umum: kirim versi yang disanitasi tanpa bukti_transfer
  const sanitized = { ...dataPesanan };
  delete sanitized.bukti_transfer;
  delete sanitized.buktiTransfer;

  const pendingOrder = {
    ...adminPayload,
    timestamp: dataPesanan.timestamp || new Date().getTime(),
    tanggal: dataPesanan.tanggal || new Date().toISOString().split("T")[0],
  };
  upsertPendingOrder(pendingOrder);

  // Emit sanitized ke semua klien
  io.emit("notifikasi-pesanan-baru", { ...sanitized, stocksDeducted });
  // Emit lengkap ke admin room (jika ada bukti)
  try {
    const adminRoom = "admin";
    io.to(adminRoom).emit("notifikasi-pesanan-baru", adminPayload);
  } catch (e) {
    console.error("[Socket] Gagal emit notifikasi-pesanan-baru ke admin:", e);
  }

  // Send web-push notifications
  sendPushNotification({
    title: "Pesanan Baru Masuk",
    body: `Pesanan baru dari ${dataPesanan.nama || "pelanggan"}.`,
    url: "/",
  }).catch((pushError) => {
    console.error("[Push] Error saat mengirim push:", pushError);
  });

  // Send native push via FCM to registered devices (Capacitor clients)
  sendFCMNotificationToDevices({
    title: "Pesanan Baru Masuk",
    body: `Pesanan baru dari ${dataPesanan.nama || "pelanggan"}.`,
    data: { orderId: dataPesanan.id_pesanan || "" },
  }).catch((e) => console.error("[Firebase] send failed:", e));

  // Kirim respon balik sukses ke website pelanggan
  res.status(200).json({
    success: true,
    message: "Pesanan berhasil diteruskan ke kasir cloud.",
    itemsUpdated: updatedStocks.map((item) => ({
      id: item.id,
      name: item.name,
      stock: item.stock,
    })),
    stocksDeducted,
  });
});

// Register device token from Capacitor/Firebase clients
app.post("/register-device", (req, res) => {
  try {
    const { token, platform, meta } = req.body || {};
    const cleanedToken = String(token || "").trim();
    if (!cleanedToken) {
      return res.status(400).json({ success: false, error: "token-required" });
    }

    const devices = loadDevices();
    const exists = devices.find((d) => String(d.token || "") === cleanedToken);
    if (!exists) {
      devices.push({
        token: cleanedToken,
        platform: platform || "unknown",
        meta: meta || {},
        addedAt: new Date().toISOString(),
      });
      saveDevices(devices);
      console.log(
        `[Firebase] Device token tersimpan: ${cleanedToken.slice(0, 20)}...`,
      );
    } else {
      console.log(
        `[Firebase] Device token sudah ada: ${cleanedToken.slice(0, 20)}...`,
      );
    }

    res.status(201).json({ success: true });
  } catch (e) {
    console.error("[Firebase] register-device error:", e);
    res.status(500).json({ success: false, error: String(e) });
  }
});

// --- TAMBAHKAN FITUR UPDATE STOK DI SINI ---
app.post("/update-stok", (req, res) => {
  const { id, stock, name } = req.body;
  const safeStock = Number(stock);

  if (!id) {
    return res
      .status(400)
      .json({ success: false, message: "ID produk wajib diisi." });
  }

  const produk = stockCatalog[id] || { id, name: name || id, stock: 0 };
  produk.stock = Number.isFinite(safeStock) ? safeStock : produk.stock;
  if (name) produk.name = name;
  stockCatalog[id] = produk;

  saveStockCatalog();

  console.log(
    `📦 Update Stok: Produk ${produk.name} (${id}) menjadi ${produk.stock}`,
  );

  // Broadcast (siarkan) pembaruan stok ke SEMUA klien (Dashboard Kasir & Website Pelanggan)
  // Dengan ini, web pelanggan bisa langsung tahu stok berubah secara real-time
  io.emit("update-stok-realtime", {
    id: produk.id,
    name: produk.name,
    stock: produk.stock,
  });

  res
    .status(200)
    .json({ success: true, message: "Stok berhasil disinkronkan." });
});

// Ambil antrean pesanan yang masih aktif dari server
app.get("/api/pesanan-aktif", (req, res) => {
  try {
    const orders = loadPendingOrders();
    return res.status(200).json({ success: true, orders });
  } catch (e) {
    console.error("[Server] Error /api/pesanan-aktif:", e);
    return res
      .status(500)
      .json({ success: false, message: "Internal server error" });
  }
});

// Endpoint untuk menandai pesanan selesai secara sentral dan menyimpan riwayat
app.post("/api/pesanan-selesai", (req, res) => {
  try {
    const dataPesanan = req.body || {};
    if (!dataPesanan.id_pesanan) {
      return res
        .status(400)
        .json({ success: false, message: "id_pesanan wajib disertakan." });
    }

    const sourceRole = String(dataPesanan.sourceRole || "").trim() || "global";

    const riwayat = loadRiwayat(sourceRole);
    const exists = riwayat.some((r) => r.id_pesanan === dataPesanan.id_pesanan);
    if (exists) {
      // Sudah tercatat, kirim broadcast hanya ke room role untuk sinkron
      const room = sourceRole.replace(/[^a-z0-9_-]/gi, "_").toLowerCase();
      io.to(room).emit("notifikasi-pesanan-selesai", dataPesanan);
      return res.status(200).json({
        success: true,
        message: "Sudah tercatat sebelumnya.",
        added: false,
      });
    }

    // Jika ada bukti transfer tersimpan untuk pesanan ini, lampirkan ke entri riwayat (hanya untuk role admin)
    try {
      const storedProof = payments[dataPesanan.id_pesanan];
      if (storedProof && sourceRole === "admin") {
        dataPesanan.bukti_transfer = storedProof;
      }
    } catch (e) {
      console.error("[Payments] Error while attaching proof:", e);
    }

    dataPesanan.timestamp = dataPesanan.timestamp || new Date().getTime();
    dataPesanan.tanggal =
      dataPesanan.tanggal || new Date().toISOString().split("T")[0];
    riwayat.unshift(dataPesanan);
    saveRiwayat(riwayat, sourceRole);
    removePendingOrder(dataPesanan.id_pesanan);

    // Broadcast ke klien dengan role yang sama saja
    const room = sourceRole.replace(/[^a-z0-9_-]/gi, "_").toLowerCase();
    io.to(room).emit("notifikasi-pesanan-selesai", dataPesanan);

    return res
      .status(200)
      .json({ success: true, message: "Tercatat.", added: true });
  } catch (e) {
    console.error("[Server] Error /api/pesanan-selesai:", e);
    return res
      .status(500)
      .json({ success: false, message: "Internal server error" });
  }
});

// Ambil riwayat untuk role tertentu
app.get("/api/riwayat", (req, res) => {
  try {
    const role = String(req.query.role || "global").trim() || "global";
    const riwayat = loadRiwayat(role);
    return res.status(200).json({ success: true, role, riwayat });
  } catch (e) {
    console.error("[Server] Error /api/riwayat:", e);
    return res
      .status(500)
      .json({ success: false, message: "Internal server error" });
  }
});

// Jalankan server (Render otomatis menentukan port, jika tidak ada gunakan 3000)
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`===================================================`);
  console.log(`🚀 SERVER KASIR KOPRAL AKTIF DI PORT: ${PORT}`);
  console.log(`===================================================`);
});
