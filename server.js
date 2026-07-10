const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const fs = require("fs");

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

// Menyediakan file statis (Dashboard Kasir) dari folder 'public'
app.use(express.static(path.join(__dirname, "public")));

// Menyediakan file statis (Website Pelanggan) dari folder 'KOPRAL Coffee Central'
app.use(
  "/pelanggan",
  express.static(path.join(__dirname, "../KOPRAL Coffee Central")),
);

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

  // Kirim data pesanan secara REAL-TIME ke dashboard kasir / aplikasi Android
  const stocksDeducted = updatedStocks.length > 0;
  io.emit("notifikasi-pesanan-baru", { ...dataPesanan, stocksDeducted });

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

    dataPesanan.timestamp = dataPesanan.timestamp || new Date().getTime();
    dataPesanan.tanggal =
      dataPesanan.tanggal || new Date().toISOString().split("T")[0];
    riwayat.unshift(dataPesanan);
    saveRiwayat(riwayat, sourceRole);

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

// Jalankan server (Render otomatis menentukan port, jika tidak ada gunakan 3000)
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`===================================================`);
  console.log(`🚀 SERVER KASIR KOPRAL AKTIF DI PORT: ${PORT}`);
  console.log(`===================================================`);
});
