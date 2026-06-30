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
    }
});

// Middleware untuk membaca data JSON dan mengizinkan akses lintas domain (CORS)
app.use(express.json());
app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
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