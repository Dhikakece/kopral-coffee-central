// Logika tetap sama seperti yang Anda buat sebelumnya
let socket = null;
let activeOrders = JSON.parse(
  localStorage.getItem("kopral_active_orders") || "{}",
);
let warningShown = false;

const STOCK_STORAGE_KEY = "kopral_stock_state";
const defaultStockData = {
  m01: { id: "m01", name: "Pure Matcha Latte", stock: 10 },
  m02: { id: "m02", name: "Chocolate", stock: 10 },
  m03: { id: "m03", name: "Espresso Roman", stock: 10 },
  m04: { id: "m04", name: "French Fries", stock: 10 },
};
let stockData = JSON.parse(localStorage.getItem(STOCK_STORAGE_KEY) || "null");

if (!stockData || Object.keys(stockData).length === 0) {
  stockData = { ...defaultStockData };
  localStorage.setItem(STOCK_STORAGE_KEY, JSON.stringify(stockData));
}

function populateStockSelect() {
  const select = document.getElementById("select-produk");
  if (!select) return;
  select.innerHTML = "";
  Object.values(stockData).forEach((item) => {
    const option = document.createElement("option");
    option.value = item.id;
    option.textContent = `${item.name} (${item.stock} stok)`;
    select.appendChild(option);
  });
}

function updateLocalStockState(id, stock, name) {
  if (!id) return;
  const existing = stockData[id] || { id, name: name || id, stock: 0 };
  existing.stock = Number(stock);
  if (name) existing.name = name;
  stockData[id] = existing;
  localStorage.setItem(STOCK_STORAGE_KEY, JSON.stringify(stockData));
  populateStockSelect();
}

function applyRemoteStockUpdate(update) {
  if (!update) return;
  updateLocalStockState(update.id, update.stock, update.name);
}

window.onload = () => {
  populateStockSelect();
  renderActiveOrders();
  setInterval(checkClosingTime, 30000);
};

// LOGIKA LOGIN DENGAN AKSES TERPISAH
function prosesLogin() {
  const user = document.getElementById("input-username").value;
  const pass = document.getElementById("input-password").value;
  const errUser = document.getElementById("error-user");
  const errPass = document.getElementById("error-pass");

  // Reset error
  errUser.classList.add("hidden");
  errPass.classList.add("hidden");

  // Definisi Kredensial
  const kredensial = {
    admin: { pass: "admin123", role: "admin" },
    dapur: { pass: "dapur123", role: "dapur" },
  };

  if (kredensial[user] && kredensial[user].pass === pass) {
    // Login Berhasil
    const container = document.getElementById("login-form-container");
    container.style.opacity = "0";

    // Simpan role ke session agar bisa dipakai untuk membatasi fitur
    sessionStorage.setItem("kopral_role", kredensial[user].role);

    setTimeout(() => {
      container.style.display = "none";
      startApp();

      // Opsional: Sembunyikan fitur tertentu jika yang login adalah Dapur
      if (kredensial[user].role === "dapur") {
        console.log("Mode Dapur Aktif: Fitur Admin disembunyikan");
        // Contoh: document.querySelector('.tombol-admin').style.display = 'none';
      }
    }, 500);
  } else {
    // Login Gagal
    if (!kredensial[user]) {
      errUser.innerText = "* USERNAME TIDAK DITEMUKAN";
      errUser.classList.remove("hidden", "opacity-0");
    } else {
      errPass.innerText = "* PASSWORD SALAH";
      errPass.classList.remove("hidden", "opacity-0");
    }
  }
}

function updateStatus(isConnected) {
  const dot = document.getElementById("dot-status");
  const text = document.getElementById("text-status");
  if (isConnected) {
    dot.className = "w-2 h-2 rounded-full bg-green-500 animate-pulse";
    text.innerText = "ONLINE";
  } else {
    dot.className = "w-2 h-2 rounded-full bg-red-500";
    text.innerText = "OFFLINE - RECONNECTING...";
  }
}

function checkClosingTime() {
  const now = new Date();
  const hours = now.getHours();
  const minutes = now.getMinutes();
  if (hours === 23 && minutes >= 55) {
    showClosingWarning();
  } else {
    warningShown = false;
  }
}

function showClosingWarning() {
  if (warningShown) return;
  const audio = document.getElementById("warning-sound");
  audio.play().catch((error) => console.log("Audio play failed:", error));
  Swal.fire({
    title: "⚠️ PERINGATAN TUTUP HARI",
    html: "Sudah mendekati jam 00:00! Segera selesaikan atau hapus pesanan yang menggantung agar data penjualan hari ini akurat.",
    icon: "warning",
    confirmButtonColor: "#d97706",
    confirmButtonText: "Siap, Mengerti!",
    allowOutsideClick: false,
  });
  warningShown = true;
}

function renderActiveOrders() {
  const container = document.getElementById("container-antrean");
  document.querySelectorAll(".group").forEach((el) => el.remove());
  const orders = Object.values(activeOrders);
  if (orders.length > 0) {
    document.getElementById("pesan-kosong").classList.add("hidden");
    orders
      .sort((a, b) => b.timestamp - a.timestamp)
      .forEach((pesanan) => {
        displayOrderUI(pesanan);
      });
  } else {
    document.getElementById("pesan-kosong").classList.remove("hidden");
  }
}

async function startApp() {
  try {
    const audio = document.getElementById("notif-sound");
    await audio.play().catch(() => {});
    audio.pause();
    socket = io("https://kopral-coffee-central.onrender.com", {
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
    });
    socket.on("connect", () => updateStatus(true));
    socket.on("disconnect", () => updateStatus(false));
    socket.on("connect_error", () => updateStatus(false));
    socket.on("update-stok-realtime", (update) => {
      applyRemoteStockUpdate(update);
    });
    socket.on("notifikasi-pesanan-baru", (pesanan) => {
      pesanan.timestamp = pesanan.timestamp || new Date().getTime();
      activeOrders[pesanan.id_pesanan] = pesanan;
      localStorage.setItem(
        "kopral_active_orders",
        JSON.stringify(activeOrders),
      );
      renderActiveOrders();
      document
        .getElementById("notif-sound")
        .play()
        .catch(() => {});
    });
    document.getElementById("start-overlay").style.display = "none";
  } catch (err) {
    Swal.fire("Error", "Gagal terhubung ke server", "error");
  }
}

function displayOrderUI(pesanan) {
  const role = sessionStorage.getItem("kopral_role");
  const isAdmin = role === "admin";
  const isDapur = role === "dapur";

  const waktuMasuk = pesanan.timestamp
    ? new Date(pesanan.timestamp).toLocaleTimeString("id-ID", {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "--:--";
  const totalHarga = pesanan.items.reduce(
    (acc, i) => acc + parseFloat(i.price) * parseInt(i.quantity, 10),
    0,
  );
  const isCash = pesanan.pembayaran === "Cash";
  const orderTypeLabel =
    pesanan.metode === "Dine-In" ? "🍽️ Makan di Tempat" : "🛍️ Bawa Pulang";

  let isSelesaiDisabled = false;
  if (isDapur || (isCash && !pesanan.sudah_dibayar)) {
    isSelesaiDisabled = true;
  }

  const selesaiAttrs = isSelesaiDisabled
    ? 'disabled class="bg-slate-800 text-slate-600 border border-slate-700 cursor-not-allowed text-xs font-bold py-3 rounded-2xl transition w-full"'
    : `onclick="selesaiPesanan('${pesanan.id_pesanan}')" class="bg-green-600 hover:bg-green-700 text-white text-xs font-bold py-3 rounded-2xl transition w-full"`;

  const div = document.createElement("div");
  div.id = pesanan.id_pesanan;
  div.className =
    "group bg-slate-800 border border-slate-700 p-5 rounded-3xl shadow-2xl";

  const tombolProses = !isAdmin
    ? `<button
                id="btn-proses-${pesanan.id_pesanan}"
                onclick="prosesPesanan('${pesanan.id_pesanan}')"
                class="bg-amber-500 hover:bg-amber-600 text-slate-950 text-xs font-bold py-3 rounded-2xl transition w-full"
            >
                <i class="fas fa-clock"></i> PROSES
            </button>`
    : "";

  const tombolBukti =
    pesanan.bukti_transfer && !isDapur
      ? `<button
                onclick="showBukti('${pesanan.bukti_transfer}')"
                class="w-full mb-3 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold
                    py-2 rounded-xl transition block text-center"
            >
                <i class="fas fa-image mr-1"></i> LIHAT BUKTI TRANSFER
            </button>`
      : "";

  const tombolBayar =
    isCash && !isDapur
      ? `<button
                id="btn-bayar-${pesanan.id_pesanan}"
                onclick="konfirmasiBayar('${pesanan.id_pesanan}')"
                class="bg-red-600 hover:bg-red-700 text-white text-xs font-bold py-3 rounded-2xl transition w-full mb-3"
            >
                <i class="fas fa-hand-holding-usd"></i> KONFIRMASI BAYAR
            </button>`
      : "";

  const namaRekeningUI =
    pesanan.pembayaran === "Transfer" && pesanan.nama_pengirim && !isDapur
      ? `<div class="mt-2 bg-slate-900 border border-blue-500/30 p-2 rounded-lg text-[10px] text-blue-300">
                <span class="font-bold uppercase">Nama Rekening Transfer:</span>
                ${pesanan.nama_pengirim}
            </div>`
      : "";

  div.innerHTML = `
        <div class="flex justify-between items-start mb-4">
            <div>
                <h3 class="font-bold text-white text-lg">${pesanan.nama}</h3>
                <div class="flex items-center gap-2 mt-1">
                    <span class="bg-amber-500/10 text-amber-500 text-[10px] font-bold px-3 py-1 rounded-full
                        border border-amber-500/20">MEJA ${pesanan.meja}</span>
                    <span class="badge-order-type">${orderTypeLabel}</span>
                </div>
                <div class="mt-2 text-[10px] text-slate-400 font-bold">
                    <i class="fas fa-clock mr-1"></i> Jam Masuk: ${waktuMasuk}
                </div>
                <div class="mt-2 text-[10px] font-bold ${isCash ? "text-red-400" : "text-blue-400"} uppercase">
                    <i class="fas ${isCash ? "fa-money-bill" : "fa-credit-card"} mr-1"></i>
                    ${pesanan.pembayaran || "Transfer"}
                </div>
                ${namaRekeningUI}
            </div>
        </div>
        <div class="bg-slate-900/50 rounded-2xl p-4 space-y-2 mb-4">
            ${pesanan.items
              .map(
                (i) => `
                <div class="flex flex-col mb-2">
                    <div class="flex justify-between text-sm">
                        <span class="text-slate-300">${i.quantity}x ${i.name}</span>
                        <span class="font-medium text-slate-100">Rp ${Number(i.price).toLocaleString()}</span>
                    </div>
                    ${
                      i.note
                        ? `<div class="text-[10px] text-amber-400 italic mt-0.5">
                        • Catatan: ${i.note}
                    </div>`
                        : ""
                    }
                </div>
            `,
              )
              .join("")}
            <div class="border-t border-slate-700/50 mt-2 pt-2 flex justify-between font-black text-white">
                <span>TOTAL</span>
                <span>Rp ${totalHarga.toLocaleString()}</span>
            </div>
        </div>
        ${tombolBukti}
        <div class="grid grid-cols-1 gap-3">
            ${tombolBayar}
            <div class="grid ${!isAdmin ? "grid-cols-2" : "grid-cols-1"} gap-3">
                ${tombolProses}
                <button id="btn-selesai-${pesanan.id_pesanan}" ${selesaiAttrs}>
                    <i class="fas fa-check"></i> SELESAI
                </button>
            </div>
        </div>
    `;
  document.getElementById("container-antrean").prepend(div);
}

function showBukti(url) {
  const modal = document.getElementById("modal-bukti");
  const img = document.getElementById("img-bukti");
  img.src = url;
  modal.classList.remove("hidden");
}

function hideBukti() {
  document.getElementById("modal-bukti").classList.add("hidden");
  document.getElementById("img-bukti").src = "";
}

function konfirmasiBayar(id) {
  Swal.fire({
    title: "Konfirmasi Pembayaran",
    text: "Pastikan pelanggan sudah membayar tunai.",
    icon: "question",
    showCancelButton: true,
    confirmButtonColor: "#16a34a",
    cancelButtonColor: "#d33",
    confirmButtonText: "Sudah Bayar",
  }).then((result) => {
    if (result.isConfirmed) {
      const btnSelesai = document.getElementById(`btn-selesai-${id}`);
      const btnBayar = document.getElementById(`btn-bayar-${id}`);

      if (btnSelesai) {
        btnSelesai.disabled = false;
        btnSelesai.className =
          "bg-green-600 hover:bg-green-700 text-white text-xs font-bold py-3 rounded-2xl transition w-full";
        btnSelesai.onclick = function () {
          selesaiPesanan(id);
        };
      }

      if (btnBayar) {
        btnBayar.style.display = "none";
      }

      if (activeOrders[id]) {
        activeOrders[id].sudah_dibayar = true;
        localStorage.setItem(
          "kopral_active_orders",
          JSON.stringify(activeOrders),
        );
      }

      Swal.fire("Berhasil!", "Pembayaran dikonfirmasi.", "success");
    }
  });
}

function prosesPesanan(id) {
  const btnProses = document.getElementById(`btn-proses-${id}`);
  const btnSelesai = document.getElementById(`btn-selesai-${id}`);

  btnProses.innerHTML = '<i class="fas fa-check-circle"></i> DIPROSES';
  btnProses.classList.replace("bg-amber-500", "bg-blue-600");
  btnProses.disabled = true;

  btnSelesai.disabled = false;
  btnSelesai.className =
    "bg-green-600 hover:bg-green-700 text-white text-xs font-bold py-3 rounded-2xl transition";
  btnSelesai.onclick = function () {
    selesaiPesanan(id);
  };
}

function selesaiPesanan(id) {
  const card = document.getElementById(id);
  if (card) {
    const cardClone = card.cloneNode(true);
    cardClone.querySelector(".grid")?.remove();
    cardClone.appendChild(
      Object.assign(document.createElement("div"), {
        className: "mt-4 pt-4 border-t border-slate-700/50 text-center",
        innerHTML: `<span class="inline-block bg-green-900/30 text-green-500 text-[10px] font-bold
                    px-4 py-2 rounded-full border border-green-500/20">
                    <i class="fas fa-check-circle mr-2"></i> PESANAN SELESAI
                </span>`,
      }),
    );
    const dataPesanan = {
      html: cardClone.innerHTML,
      items: activeOrders[id].items,
      pembayaran: activeOrders[id].pembayaran,
      timestamp: new Date().getTime(),
      tanggal: new Date().toISOString().split("T")[0],
    };
    const items = activeOrders[id].items;
    items.forEach((item) => {
      if (activeOrders[item.id]) {
        activeOrders[item.id].stock -= item.quantity;

        if (activeOrders[item.id].stock < 0) {
          activeOrders[item.id].stock = 0;
        }
      }
    });
    localStorage.setItem("kopral_active_orders", JSON.stringify(activeOrders));

    const riwayat = JSON.parse(
      localStorage.getItem("kopral_riwayat_data") || "[]",
    );
    riwayat.unshift(dataPesanan);
    localStorage.setItem("kopral_riwayat_data", JSON.stringify(riwayat));
    delete activeOrders[id];
    localStorage.setItem("kopral_active_orders", JSON.stringify(activeOrders));
    card.remove();
    if (Object.keys(activeOrders).length === 0) {
      document.getElementById("pesan-kosong").classList.remove("hidden");
    }
  }
}

function cetakLaporanPDF() {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  const riwayat = JSON.parse(
    localStorage.getItem("kopral_riwayat_data") || "[]",
  );
  if (riwayat.length === 0) {
    Swal.fire("Oops", "Data kosong", "info");
    return;
  }

  const getKategori = (name) => {
    const n = name.toLowerCase();

    if (
      n.includes("matcha") ||
      n.includes("coklat") ||
      n.includes("chocolate")
    ) {
      return "Non-Coffee";
    }

    const coffeeKeywords = [
      "kopi",
      "coffee",
      "espresso",
      "latte",
      "americano",
      "cappuccino",
      "macchiato",
      "mocha",
      "affogato",
      "kopral",
    ];
    if (coffeeKeywords.some((keyword) => n.includes(keyword))) {
      return "Coffee";
    }

    const snackKeywords = [
      "snack",
      "food",
      "makan",
      "gorengan",
      "camilan",
      "mie",
      "nasi",
      "fries",
      "kentang",
      "croissant",
      "dimsum",
      "toast",
      "burger",
      "sandwich",
      "pastry",
      "roti",
      "pisang",
      "siomay",
      "bakso",
      "ayam",
    ];
    if (snackKeywords.some((keyword) => n.includes(keyword))) {
      return "Snack & Food";
    }

    const nonCoffeeKeywords = [
      "tea",
      "teh",
      "squash",
      "susu",
      "milk",
      "mocktail",
      "jus",
      "juice",
      "ice",
      "lemon",
      "yakult",
    ];
    if (nonCoffeeKeywords.some((keyword) => n.includes(keyword))) {
      return "Non-Coffee";
    }

    return "Non-Coffee";
  };

  const dataTerstruktur = {
    Coffee: {},
    "Snack & Food": {},
    "Non-Coffee": {},
  };
  let totalCash = 0;
  let totalTransfer = 0;

  riwayat.forEach((r) => {
    const subtotalOrder = r.items.reduce(
      (acc, i) => acc + parseFloat(i.price) * parseInt(i.quantity, 10),
      0,
    );
    if (r.pembayaran === "Cash") {
      totalCash += subtotalOrder;
    } else {
      totalTransfer += subtotalOrder;
    }

    r.items.forEach((i) => {
      const kat = getKategori(i.name);
      if (!dataTerstruktur[kat]) {
        dataTerstruktur[kat] = {};
      }
      if (!dataTerstruktur[kat][i.name]) {
        dataTerstruktur[kat][i.name] = { qty: 0, price: i.price };
      }
      dataTerstruktur[kat][i.name].qty += parseInt(i.quantity, 10);
    });
  });

  doc.setFontSize(16);
  doc.text("LAPORAN PENJUALAN KOPRAL", 14, 15);
  doc.setFontSize(10);
  doc.text(`Total Omzet CASH: Rp ${totalCash.toLocaleString()}`, 14, 25);
  doc.text(
    `Total Omzet TRANSFER: Rp ${totalTransfer.toLocaleString()}`,
    14,
    30,
  );
  doc.text(
    `TOTAL KESELURUHAN: Rp ${(totalCash + totalTransfer).toLocaleString()}`,
    14,
    35,
  );

  let yPos = 45;
  for (const [kategori, items] of Object.entries(dataTerstruktur)) {
    if (Object.keys(items).length === 0) {
      continue;
    }

    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.text(`Kategori: ${kategori}`, 14, yPos);
    yPos += 5;

    const body = Object.keys(items).map((name) => [
      name,
      items[name].qty,
      `Rp ${Number(items[name].price).toLocaleString()}`,
      `Rp ${(items[name].qty * items[name].price).toLocaleString()}`,
    ]);

    doc.autoTable({
      startY: yPos,
      head: [["Nama Item", "Qty", "Harga", "Subtotal"]],
      body,
      theme: "striped",
      headStyles: { fillColor: [51, 65, 85] },
    });

    yPos = doc.lastAutoTable.finalY + 10;
  }

  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.text("Terlaris:", 14, yPos);
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");

  yPos += 7;
  Object.keys(dataTerstruktur).forEach((kat) => {
    const items = dataTerstruktur[kat];
    let terlaris = { name: "-", qty: 0 };
    Object.keys(items).forEach((name) => {
      if (items[name].qty > terlaris.qty) {
        terlaris = { name, qty: items[name].qty };
      }
    });
    doc.text(`Kategori ${kat} : ${terlaris.name} (★)`, 14, yPos);
    yPos += 5;
  });

  doc.save(`Laporan_Penjualan_${new Date().toISOString().split("T")[0]}.pdf`);
}

function downloadCSV() {
  const riwayat = JSON.parse(
    localStorage.getItem("kopral_riwayat_data") || "[]",
  );
  if (riwayat.length === 0) {
    Swal.fire("Oops", "Data kosong", "info");
    return;
  }
  let csv = "Tanggal,Items,Total\n";
  riwayat.forEach((r) => {
    const items = r.items.map((i) => `${i.quantity}x ${i.name}`).join(";");
    csv += `${r.tanggal},"${items}",${r.items.reduce((acc, i) => acc + i.price * i.quantity, 0)}\n`;
  });
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `Riwayat_${new Date().toISOString().split("T")[0]}.csv`;
  a.click();
}

function filterRiwayat() {
  const role = sessionStorage.getItem("kopral_role");
  const tanggal = document.getElementById("input-tanggal").value;
  const container = document.getElementById("container-riwayat");
  const riwayat = JSON.parse(
    localStorage.getItem("kopral_riwayat_data") || "[]",
  );

  container.innerHTML = "";
  const filtered = tanggal
    ? riwayat.filter((i) => i.tanggal === tanggal)
    : riwayat;

  if (role !== "dapur") {
    const totalOmzet = filtered.reduce(
      (acc, r) =>
        acc + r.items.reduce((sub, i) => sub + i.price * i.quantity, 0),
      0,
    );
    container.innerHTML = `<div class="bg-amber-500/10 p-4 rounded-xl border border-amber-500/20 mb-4 text-center">
            <p class="text-amber-500 text-[10px] font-bold uppercase">Total Omzet</p>
            <h3 class="text-white font-black text-xl">Rp ${totalOmzet.toLocaleString()}</h3>
        </div>`;
  }

  filtered.forEach((item) => {
    const div = document.createElement("div");
    div.className = "bg-slate-900 p-4 rounded-xl border border-slate-700 mb-3";

    let htmlContent = item.html || "";

    if (role === "dapur" && typeof htmlContent === "string") {
      htmlContent = htmlContent.replace(
        /<button[^>]*>.*?LIHAT BUKTI TRANSFER.*?<\/button>/gi,
        "",
      );
    }

    div.innerHTML = htmlContent;
    container.appendChild(div);
  });
}

function hapusRiwayatManual() {
  const riwayat = JSON.parse(
    localStorage.getItem("kopral_riwayat_data") || "[]",
  );
  const batas = new Date();
  batas.setDate(batas.getDate() - 30);
  const dataBaru = riwayat.filter((i) => new Date(i.timestamp) >= batas);
  if (dataBaru.length === riwayat.length) {
    Swal.fire(
      "Info",
      "Tidak ada riwayat lama (>30 hari) untuk dihapus.",
      "info",
    );
    return;
  }
  Swal.fire({
    title: "Hapus Riwayat Lama?",
    text: "Hanya data > 30 hari yang akan dihapus.",
    icon: "warning",
    showCancelButton: true,
    confirmButtonColor: "#d33",
    confirmButtonText: "Ya, Hapus!",
  }).then((result) => {
    if (result.isConfirmed) {
      localStorage.setItem("kopral_riwayat_data", JSON.stringify(dataBaru));
      filterRiwayat();
      Swal.fire("Dihapus!", "Riwayat lama berhasil dibersihkan.", "success");
    }
  });
}

function toggleModal(show) {
  const modal = document.getElementById("modal");
  const adminActions = document.getElementById("admin-actions");
  const role = sessionStorage.getItem("kopral_role");

  if (show) {
    modal.classList.remove("hidden");
    if (role === "dapur") {
      adminActions.style.display = "none";
    } else {
      adminActions.style.display = "grid";
    }
    document.getElementById("input-tanggal").value = new Date()
      .toISOString()
      .split("T")[0];
    filterRiwayat();
  } else {
    modal.classList.add("hidden");
  }
}

function toggleModalStok(show) {
  const modal = document.getElementById("modal-stok");
  if (show) {
    populateStockSelect();
    modal.classList.remove("hidden");
  } else {
    modal.classList.add("hidden");
  }
}

async function prosesStok() {
  const idProduk = document.getElementById("select-produk").value;
  const jumlahBaru = parseInt(document.getElementById("input-stok").value, 10);
  const produkTerpilih = stockData[idProduk];

  if (!idProduk) {
    Swal.fire("Error", "Pilih produk terlebih dahulu!", "error");
    return;
  }

  if (Number.isNaN(jumlahBaru)) {
    Swal.fire("Error", "Masukkan angka stok yang valid!", "error");
    return;
  }

  try {
    const response = await fetch(
      "https://kopral-coffee-central.onrender.com/update-stok",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: idProduk,
          stock: jumlahBaru,
          name: produkTerpilih?.name || idProduk,
        }),
      },
    );

    if (!response.ok) throw new Error("Gagal update ke server");

    updateLocalStockState(
      idProduk,
      jumlahBaru,
      produkTerpilih?.name || idProduk,
    );

    Swal.fire(
      "Berhasil",
      "Stok telah diperbarui dan disinkronkan ke pelanggan!",
      "success",
    );
    toggleModalStok(false);
  } catch (error) {
    console.error("Error updating stock:", error);
    Swal.fire("Error", "Gagal terhubung ke server.", "error");
  }
}
