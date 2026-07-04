const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);

// Konfigurasi Socket.io dengan CORS terbuka agar bisa diakses dari HP Pelanggan & Aplikasi Android
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    // FITUR BARU: Mengizinkan ukuran buffer hingga 10MB untuk menangani data gambar/bukti transfer
    maxHttpBufferSize: 10 * 1024 * 1024 
});

// Middleware untuk membaca data JSON dan mengizinkan akses lintas domain (CORS)
// Catatan: Express secara default juga memiliki limit, untuk amannya jika ada error, 
// tambahkan app.use(express.json({ limit: '10mb' })); di bawah ini.
app.use(express.json({ limit: '10mb' }));

// UBAH DI BAGIAN INI: Mengizinkan metode OPTIONS, GET, POST agar aman dari blokir browser lokal
app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS"); // Tambahan izin metode
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
    
    // Jika browser mengirimkan preflight (OPTIONS), langsung jawab dengan status 200 sukses
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

// Menyediakan file statis (Dashboard Kasir) dari folder 'public'
app.use(express.static(path.join(__dirname, 'public')));

// API Endpoint: Tempat website pelanggan mengirimkan data pesanan (POST)
app.post('/api/pesanan-masuk', (req, res) => {
    const dataPesanan = req.body;
    
    console.log("👉 Ada Pesanan Baru Masuk via Cloud:", dataPesanan);

    // Kirim data pesanan secara REAL-TIME ke dashboard kasir / aplikasi Android
    io.emit('notifikasi-pesanan-baru', dataPesanan);

    // Kirim respon balik sukses ke website pelanggan
    res.status(200).json({ success: true, message: "Pesanan berhasil diteruskan ke kasir cloud." });
});

// Jalankan server (Render otomatis menentukan port, jika tidak ada gunakan 3000)
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`===================================================`);
    console.log(`🚀 SERVER KASIR KOPRAL AKTIF DI PORT: ${PORT}`);
    console.log(`===================================================`);
});
