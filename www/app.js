// Logika tetap sama seperti yang Anda buat sebelumnya
let socket = null;
let activeOrders = JSON.parse(
  localStorage.getItem("kopral_active_orders") || "{}",
);
let warningShown = false;
let appStarted = false;

const HITUNG_TRIGGER_START_KEY = "kopral_hitung_trigger_started_at";
const HITUNG_TRIGGER_SEEN_KEY = "kopral_hitung_trigger_seen";
const HITUNG_TRIGGER_DAYS = 30;
const HITUNG_INITIAL_MODAL_KEY = "kopral_modal_awal_kedai";
const HITUNG_TOTAL_OMZET_BERSIH_KEY = "kopral_total_omzet_bersih";
const HITUNG_SELESAH_SNAPSHOT_KEY = "kopral_hitung_selisih_snapshot";

function getHitungTriggerStartDate() {
  const stored = localStorage.getItem(HITUNG_TRIGGER_START_KEY);
  if (stored) {
    const parsed = new Date(stored);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  const now = new Date();
  localStorage.setItem(HITUNG_TRIGGER_START_KEY, now.toISOString());
  return now;
}

function getTanggalDariData(value) {
  if (value === null || value === undefined || value === "") return null;

  if (typeof value === "number" && Number.isFinite(value)) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const raw = String(value).trim();
  if (!raw) return null;

  const parts = raw.split("-");
  if (parts.length === 3) {
    const [year, month, day] = parts.map((part) => Number(part));
    if ([year, month, day].every((part) => Number.isFinite(part))) {
      return new Date(year, month - 1, day);
    }
  }

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getTanggalUntukItem(item) {
  if (!item || typeof item !== "object") return null;

  const tanggalLangsung = getTanggalDariData(
    item?.tanggal || item?.tanggal_order || item?.created_at || item?.createdAt,
  );
  if (tanggalLangsung) return tanggalLangsung;

  const timestamp = item?.timestamp;
  if (timestamp !== undefined && timestamp !== null && timestamp !== "") {
    return getTanggalDariData(timestamp);
  }

  return null;
}

function getRentangPeriodeModalAwal() {
  const startDate = getHitungTriggerStartDate();
  const start = new Date(startDate);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 30);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

function periodeModalAwalSelesai() {
  const { end } = getRentangPeriodeModalAwal();
  const now = new Date();
  return now >= end;
}

function getRiwayat30Hari(tanggalBatas = null) {
  const riwayat = JSON.parse(
    localStorage.getItem("kopral_riwayat_data") || "[]",
  );
  const list = Array.isArray(riwayat) ? riwayat : [];
  const { start, end } = getRentangPeriodeModalAwal();
  const batasTanggal = tanggalBatas ? getTanggalDariData(tanggalBatas) : null;

  return list.filter((item) => {
    const tanggal = getTanggalUntukItem(item);
    if (!tanggal) return false;
    if (tanggal < start || tanggal > end) return false;
    if (batasTanggal) return tanggal <= batasTanggal;
    return true;
  });
}

function getPengeluaran30Hari(tanggalBatas = null) {
  const list = getDaftarPengeluaran();
  const { start, end } = getRentangPeriodeModalAwal();
  const batasTanggal = tanggalBatas ? getTanggalDariData(tanggalBatas) : null;

  return list.filter((item) => {
    const tanggal = getTanggalUntukItem(item);
    if (!tanggal) return false;
    if (tanggal < start || tanggal > end) return false;
    if (batasTanggal) return tanggal <= batasTanggal;
    return true;
  });
}

function getTanggalDefaultPopup30Hari() {
  const inputTanggal = document.getElementById("input-tanggal-hitung")?.value;
  if (inputTanggal) return inputTanggal;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return getLocalDateString(today);
}

function getRentangPopup30Hari(tanggalBatas = null) {
  const targetDate = tanggalBatas
    ? getTanggalDariData(tanggalBatas)
    : new Date();
  const end = new Date(targetDate || new Date());
  end.setHours(23, 59, 59, 999);
  const start = new Date(end);
  start.setDate(start.getDate() - (HITUNG_TRIGGER_DAYS - 1));
  start.setHours(0, 0, 0, 0);
  return { start, end };
}

function getRiwayatPopup30Hari(tanggalBatas = null) {
  const riwayat = JSON.parse(
    localStorage.getItem("kopral_riwayat_data") || "[]",
  );
  const list = Array.isArray(riwayat) ? riwayat : [];
  const { start, end } = getRentangPopup30Hari(tanggalBatas);

  return list.filter((item) => {
    const tanggal = getTanggalUntukItem(item);
    return tanggal && tanggal >= start && tanggal <= end;
  });
}

function getPengeluaranPopup30Hari(tanggalBatas = null) {
  const list = getDaftarPengeluaran();
  const { start, end } = getRentangPopup30Hari(tanggalBatas);

  return list.filter((item) => {
    const tanggal = getTanggalUntukItem(item);
    return tanggal && tanggal >= start && tanggal <= end;
  });
}

function hitungTotalOmzetBersihModalAwal() {
  if (!periodeModalAwalSelesai()) {
    return 0;
  }

  const modalAwal = parseRupiahValue(
    localStorage.getItem(HITUNG_INITIAL_MODAL_KEY) || "0",
  );
  const riwayat30Hari = getRiwayat30Hari();
  const pengeluaran30Hari = getPengeluaran30Hari();

  if (!riwayat30Hari.length && !pengeluaran30Hari.length) {
    return 0;
  }

  const omzetTotal = hitungTotalOmzet(riwayat30Hari);
  const pengeluaranTotal = pengeluaran30Hari.reduce(
    (sum, item) => sum + parseRupiahValue(item.nominal || 0),
    0,
  );
  const safeOmzet = Number.isFinite(omzetTotal) ? Math.max(0, omzetTotal) : 0;
  const safePengeluaran = Number.isFinite(pengeluaranTotal)
    ? Math.max(0, pengeluaranTotal)
    : 0;
  const hasilHitung = safeOmzet - safePengeluaran;
  return hasilHitung - modalAwal;
}

function renderTotalOmzetBersihModalAwal() {
  const display = document.getElementById("modal-awal-total-omzet-bersih");
  if (!display) return;

  const storedValue = localStorage.getItem(HITUNG_TOTAL_OMZET_BERSIH_KEY);
  const hasStoredValue = storedValue !== null && storedValue !== "";
  const bersih = hasStoredValue
    ? parseRupiahValue(storedValue)
    : hitungTotalOmzetBersihModalAwal();

  const formatted = new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Math.abs(bersih));

  if (bersih < 0) {
    display.textContent = `-Rp ${formatted.replace(/^Rp\s*/i, "")} Loss`;
    display.classList.remove("text-white", "text-emerald-400");
    display.classList.add("text-rose-400");
  } else if (bersih > 0) {
    display.textContent = `+Rp ${formatted.replace(/^Rp\s*/i, "")} Profit`;
    display.classList.remove("text-white", "text-rose-400");
    display.classList.add("text-emerald-400");
  } else {
    display.textContent = `Rp ${formatted.replace(/^Rp\s*/i, "")}`;
    display.classList.remove("text-rose-400", "text-emerald-400");
    display.classList.add("text-white");
  }
}

function renderTotalModalAwalTersimpan() {
  const display = document.getElementById("modal-awal-total-tersimpan");
  if (!display) return;

  const storedValue = localStorage.getItem(HITUNG_INITIAL_MODAL_KEY);
  if (storedValue === null || storedValue === "") {
    return;
  }

  const nilai = parseRupiahValue(storedValue);
  display.textContent = `Rp ${Math.max(0, nilai).toLocaleString("id-ID")}`;
}

function aturModeEditModalAwal(isEditing) {
  const button = document.getElementById("btn-edit-modal-awal");
  const input = document.getElementById("input-modal-awal-kedai");
  if (!button || !input) return;

  button.dataset.editing = isEditing ? "true" : "false";
  button.innerHTML = isEditing
    ? '<i class="fas fa-check mr-1"></i> Simpan Perubahan'
    : '<i class="fas fa-edit mr-1"></i> Edit';

  if (isEditing) {
    const nilai = parseRupiahValue(
      localStorage.getItem(HITUNG_INITIAL_MODAL_KEY) || "0",
    );
    input.value = String(Math.max(0, nilai));
    input.focus();
  } else {
    input.value = "";
  }
}

function aktifkanEditModalAwal() {
  aturModeEditModalAwal(true);
}

function aturStatusTombolHitung30Hari() {
  const button = document.getElementById("btn-hitung-30-hari");
  if (!button) return;

  button.disabled = false;
  button.classList.remove("opacity-50", "cursor-not-allowed");
  button.classList.add("border-cyan-500/30", "bg-cyan-500/10", "text-cyan-300");
  button.innerHTML = '<i class="fas fa-history mr-2"></i> Hitung 30 Hari';
}

function togglePopupHasil30Hari(show) {
  const popup = document.getElementById("popup-hasil-30-hari");
  if (!popup) return;

  if (show) {
    hitungSeluruh30Hari();
    popup.classList.remove("hidden");
    popup.classList.add("flex");
  } else {
    popup.classList.add("hidden");
    popup.classList.remove("flex");
  }
}

function hitungSeluruh30Hari() {
  const hasilValue = document.getElementById("hasil-30-hari-value");
  const omzetDisplay = document.getElementById("hasil-30-hari-omzet");
  const pengeluaranDisplay = document.getElementById(
    "hasil-30-hari-pengeluaran",
  );
  if (!hasilValue || !omzetDisplay || !pengeluaranDisplay) return;

  const tanggalTarget = getTanggalDefaultPopup30Hari();
  const riwayat30Hari = getRiwayatPopup30Hari(tanggalTarget);
  const pengeluaran30Hari = getPengeluaranPopup30Hari(tanggalTarget);
  const omzetTotal = hitungTotalOmzet(riwayat30Hari);
  const pengeluaranTotal = pengeluaran30Hari.reduce(
    (sum, item) => sum + parseRupiahValue(item.nominal || 0),
    0,
  );
  const hasil = omzetTotal - pengeluaranTotal;

  omzetDisplay.textContent = `Rp ${omzetTotal.toLocaleString("id-ID")}`;
  pengeluaranDisplay.textContent = `Rp ${pengeluaranTotal.toLocaleString("id-ID")}`;
  hasilValue.textContent =
    hasil < 0
      ? `-Rp ${Math.abs(hasil).toLocaleString("id-ID")}`
      : `Rp ${hasil.toLocaleString("id-ID")}`;
  return { omzetTotal, pengeluaranTotal, hasil };
}

function simpanHasil30HariKeModalAwal() {
  const modalAwalDisplay = document.getElementById(
    "modal-awal-total-omzet-bersih",
  );
  const hasil30Display = document.getElementById("hasil-30-hari-value");
  if (!modalAwalDisplay) return;

  const modalAwal = parseRupiahValue(
    localStorage.getItem(HITUNG_INITIAL_MODAL_KEY) || "0",
  );
  if (modalAwal <= 0) {
    Swal.fire({
      icon: "warning",
      title: "Modal biaya awal belum diisi",
      text: "Isi nominal modal biaya awal terlebih dahulu sebelum mengakumulasikan hasil.",
      confirmButtonText: "OK",
    });
    return;
  }

  const hasilData = hitungSeluruh30Hari();
  const totalLabaKotor = parseRupiahValue(
    hasil30Display?.textContent || hasilData?.hasil || "0",
  );
  const hasilAkhir = totalLabaKotor - modalAwal;

  localStorage.setItem(HITUNG_TOTAL_OMZET_BERSIH_KEY, String(hasilAkhir));
  renderTotalOmzetBersihModalAwal();
  Swal.fire({
    icon: "success",
    title: "Berhasil",
    text: "Total omzet bersih berhasil diperbarui dari total laba kotor dan modal biaya awal.",
    timer: 1400,
    showConfirmButton: false,
  });
}

function resetModalAwalKedai() {
  const modalAwalDisplay = document.getElementById(
    "modal-awal-total-tersimpan",
  );
  const omzetBersihDisplay = document.getElementById(
    "modal-awal-total-omzet-bersih",
  );
  const input = document.getElementById("input-modal-awal-kedai");
  const editButton = document.getElementById("btn-edit-modal-awal");

  localStorage.removeItem(HITUNG_INITIAL_MODAL_KEY);
  localStorage.removeItem(HITUNG_TOTAL_OMZET_BERSIH_KEY);
  localStorage.removeItem(HITUNG_TRIGGER_START_KEY);
  localStorage.removeItem(HITUNG_TRIGGER_SEEN_KEY);

  if (input) input.value = "";
  if (editButton) {
    editButton.dataset.editing = "false";
    editButton.innerHTML = '<i class="fas fa-edit mr-1"></i> Edit';
  }
  if (modalAwalDisplay) {
    modalAwalDisplay.textContent = "Rp 0";
  }
  if (omzetBersihDisplay) {
    omzetBersihDisplay.textContent = "Rp 0";
  }

  Swal.fire({
    icon: "success",
    title: "Reset berhasil",
    text: "Semua data modal awal dan hasil akumulasi telah dikembalikan ke nol.",
    timer: 1400,
    showConfirmButton: false,
  });
}

function konfirmasiResetModalAwalKedai() {
  Swal.fire({
    icon: "warning",
    title: "Reset modal awal?",
    text: "Apakah yakin sudah 30 hari untuk direset? Semua data modal awal dan hasil akumulasi akan dikembalikan ke nol.",
    showCancelButton: true,
    confirmButtonText: "Ya, reset",
    cancelButtonText: "Batal",
    confirmButtonColor: "#ef4444",
    cancelButtonColor: "#64748b",
  }).then((result) => {
    if (result.isConfirmed) {
      resetModalAwalKedai();
    }
  });
}

function simpanModalAwalKedai() {
  const input = document.getElementById("input-modal-awal-kedai");
  const button = document.getElementById("btn-edit-modal-awal");
  if (!input) return 0;

  const rawValue = String(input.value || "").trim();
  if (!rawValue) {
    Swal.fire({
      icon: "warning",
      title: "Input belum diisi",
      text: "Masukkan nominal modal awal sebelum menyimpan.",
      confirmButtonText: "OK",
    });
    input.focus();
    return 0;
  }

  const value = parseRupiahValue(rawValue);
  if (value <= 0) {
    Swal.fire({
      icon: "warning",
      title: "Nominal tidak valid",
      text: "Nominal modal awal harus lebih dari nol.",
      confirmButtonText: "OK",
    });
    input.focus();
    return 0;
  }

  const savedTotal = parseRupiahValue(
    localStorage.getItem(HITUNG_INITIAL_MODAL_KEY) || "0",
  );
  const isEditing = button?.dataset.editing === "true";
  const nextTotal = isEditing ? value : savedTotal + value;

  localStorage.setItem(HITUNG_INITIAL_MODAL_KEY, String(nextTotal));
  input.value = "";
  aturModeEditModalAwal(false);
  renderTotalModalAwalTersimpan();
  renderTotalOmzetBersihModalAwal();

  Swal.fire({
    icon: "success",
    title: "Berhasil",
    text: "Modal awal berhasil disimpan.",
    timer: 1200,
    showConfirmButton: false,
  });
  return nextTotal;
}

function toggleModalAwalKedai(show) {
  const modal = document.getElementById("modal-awal-kedai");
  const input = document.getElementById("input-modal-awal-kedai");
  const omzetDisplay = document.getElementById("modal-awal-total-omzet-bersih");
  if (!modal || !input || !omzetDisplay) return;

  if (show) {
    input.value = "";
    aturModeEditModalAwal(false);
    renderTotalModalAwalTersimpan();
    renderTotalOmzetBersihModalAwal();
    modal.classList.remove("hidden");
    modal.classList.add("flex");
  } else {
    input.value = "";
    aturModeEditModalAwal(false);
    modal.classList.add("hidden");
    modal.classList.remove("flex");
  }
}

function cekPemicuModalHitung() {
  const startDate = getHitungTriggerStartDate();
  const now = new Date();
  const elapsedDays = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
  const alreadySeen = localStorage.getItem(HITUNG_TRIGGER_SEEN_KEY) === "true";

  if (elapsedDays < HITUNG_TRIGGER_DAYS || alreadySeen) {
    return;
  }

  localStorage.setItem(HITUNG_TRIGGER_SEEN_KEY, "true");
  toggleModalAwalKedai(true);
}

function loadPersistedOrders() {
  try {
    const saved = localStorage.getItem("kopral_active_orders");
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed && typeof parsed === "object") {
        activeOrders = parsed;
      }
    }
  } catch (e) {
    console.warn("Gagal memuat antrean tersimpan:", e);
  }

  updateIncomingOrderCounter();
}

async function syncPendingOrdersFromServer() {
  try {
    const backend =
      typeof KOPRAL_BACKEND !== "undefined"
        ? KOPRAL_BACKEND
        : window.location.origin;
    const response = await fetch(`${backend}/api/pesanan-aktif`);
    const data = await response.json();
    if (data && data.success && Array.isArray(data.orders)) {
      const synced = {};
      data.orders.forEach((order) => {
        if (!order || !order.id_pesanan) return;
        synced[order.id_pesanan] = {
          ...order,
          timestamp: order.timestamp || new Date().getTime(),
        };
      });
      activeOrders = synced;
      localStorage.setItem(
        "kopral_active_orders",
        JSON.stringify(activeOrders),
      );
      renderActiveOrders();
      updateIncomingOrderCounter();
    }
  } catch (e) {
    console.warn("[Orders] Gagal mengambil pesanan aktif dari server:", e);
  }
}

function restoreAuthState() {
  try {
    const loginSaved = localStorage.getItem("kopral_logged_in") === "true";
    const storedRole =
      sessionStorage.getItem("kopral_role") ||
      localStorage.getItem("kopral_role") ||
      "";
    if (storedRole) {
      sessionStorage.setItem("kopral_role", storedRole);
      localStorage.setItem("kopral_role", storedRole);
    }
    return { loginSaved, storedRole };
  } catch (e) {
    console.warn("Gagal memuat state auth:", e);
    return { loginSaved: false, storedRole: "" };
  }
}

function showStartScreen() {
  const loginContainer = document.getElementById("login-form-container");
  const startOverlay = document.getElementById("start-overlay");

  if (loginContainer) {
    loginContainer.classList.add("hidden");
    loginContainer.style.display = "none";
    loginContainer.style.opacity = "0";
  }

  if (startOverlay) {
    startOverlay.classList.remove("hidden");
    startOverlay.style.display = "flex";
  }

  updateAuthControls();
}

function showLoginForm() {
  const loginContainer = document.getElementById("login-form-container");
  const startOverlay = document.getElementById("start-overlay");

  if (startOverlay) {
    startOverlay.classList.add("hidden");
    startOverlay.style.display = "none";
  }

  if (loginContainer) {
    loginContainer.classList.remove("hidden");
    loginContainer.style.display = "flex";
    loginContainer.style.opacity = "1";
  }

  updateAuthControls();
}

function setAuthOverlayState(showLogin) {
  if (showLogin) {
    showLoginForm();
    return;
  }

  const loginContainer = document.getElementById("login-form-container");
  const startOverlay = document.getElementById("start-overlay");

  if (loginContainer) {
    loginContainer.classList.add("hidden");
    loginContainer.style.display = "none";
    loginContainer.style.opacity = "0";
  }

  if (startOverlay) {
    startOverlay.classList.add("hidden");
    startOverlay.style.display = "none";
  }
}

function updateRoleLabel() {
  const roleLabel = document.getElementById("role-label");
  const headerRole = document.getElementById("header-role");
  if (!roleLabel && !headerRole) return;

  const role =
    sessionStorage.getItem("kopral_role") ||
    localStorage.getItem("kopral_role") ||
    "";

  const labelText =
    role === "admin" ? "Admin" : role === "dapur" ? "Dapur" : "Belum Login";
  const headerText =
    role === "admin" ? "Admin" : role === "dapur" ? "Dapur" : "Belum Login";

  if (roleLabel) {
    roleLabel.textContent = labelText;
    if (!role) {
      roleLabel.className =
        "mt-4 inline-flex items-center justify-center rounded-full border border-slate-600/40 bg-slate-800/60 px-4 py-2 text-[11px] font-bold uppercase tracking-[0.24em] text-slate-300";
    } else if (role === "admin") {
      roleLabel.className =
        "mt-4 inline-flex items-center justify-center rounded-full border border-emerald-400/30 bg-emerald-400/10 px-4 py-2 text-[11px] font-bold uppercase tracking-[0.24em] text-emerald-300";
    } else if (role === "dapur") {
      roleLabel.className =
        "mt-4 inline-flex items-center justify-center rounded-full border border-amber-400/30 bg-amber-400/10 px-4 py-2 text-[11px] font-bold uppercase tracking-[0.24em] text-amber-300";
    } else {
      roleLabel.className =
        "mt-4 inline-flex items-center justify-center rounded-full border border-slate-600/40 bg-slate-800/60 px-4 py-2 text-[11px] font-bold uppercase tracking-[0.24em] text-slate-300";
    }
  }

  if (headerRole) {
    headerRole.textContent = headerText;
    headerRole.className =
      role === "admin"
        ? "text-emerald-300 text-xs font-semibold uppercase tracking-[0.2em]"
        : role === "dapur"
          ? "text-amber-300 text-xs font-semibold uppercase tracking-[0.2em]"
          : "text-slate-400 text-xs";
  }
}

function updateAuthControls() {
  const logoutBtn = document.getElementById("btn-logout");
  const modalAwalBtn = document.getElementById("btn-modal-awal");
  const hitungBtn = document.getElementById("btn-hitung");
  const hasLoginState = localStorage.getItem("kopral_logged_in") === "true";
  const role =
    sessionStorage.getItem("kopral_role") ||
    localStorage.getItem("kopral_role") ||
    "";
  const isLoggedIn = hasLoginState && !!role;
  const isDapur = role === "dapur";

  if (logoutBtn) {
    logoutBtn.classList.toggle("hidden", !isLoggedIn);
    logoutBtn.classList.toggle("inline-flex", isLoggedIn);
    logoutBtn.style.display = isLoggedIn ? "inline-flex" : "none";
  }

  if (modalAwalBtn) {
    modalAwalBtn.classList.toggle("hidden", isDapur);
    modalAwalBtn.style.display = isDapur ? "none" : "inline-flex";
  }

  if (hitungBtn) {
    hitungBtn.classList.toggle("hidden", isDapur);
    hitungBtn.style.display = isDapur ? "none" : "inline-flex";
  }

  updateRoleLabel();
}

function persistAuthState(role) {
  try {
    sessionStorage.setItem("kopral_role", role);
    localStorage.setItem("kopral_role", role);
    localStorage.setItem("kopral_logged_in", "true");
    updateAuthControls();
  } catch (e) {
    console.warn("Gagal menyimpan state auth:", e);
  }
}

function clearAuthState() {
  try {
    sessionStorage.removeItem("kopral_role");
    localStorage.removeItem("kopral_role");
    localStorage.removeItem("kopral_logged_in");

    const userInput = document.getElementById("input-username");
    const passInput = document.getElementById("input-password");
    const errUser = document.getElementById("error-user");
    const errPass = document.getElementById("error-pass");

    if (userInput) userInput.value = "";
    if (passInput) passInput.value = "";
    if (errUser) {
      errUser.classList.add("hidden", "opacity-0");
      errUser.innerText = "* USERNAME SALAH";
    }
    if (errPass) {
      errPass.classList.add("hidden", "opacity-0");
      errPass.innerText = "* PASSWORD SALAH";
    }
    updateRoleLabel();
  } catch (e) {
    console.warn("Gagal membersihkan state auth:", e);
  }
}

function logoutKasir() {
  appStarted = false;
  try {
    if (socket) {
      socket.disconnect();
      socket = null;
    }
  } catch (e) {
    console.warn("Gagal memutus koneksi socket saat logout:", e);
  }

  clearAuthState();
  updateAuthControls();
  setStatusOnline(navigator.onLine);
  showStartScreen();
}

const STOCK_STORAGE_KEY = "kopral_stock_state";
const defaultStockData = {
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
let stockData = JSON.parse(localStorage.getItem(STOCK_STORAGE_KEY) || "null");

if (!stockData || Object.keys(stockData).length === 0) {
  stockData = { ...defaultStockData };
} else {
  stockData = { ...defaultStockData, ...stockData };
}
localStorage.setItem(STOCK_STORAGE_KEY, JSON.stringify(stockData));

function updateItemDropdown() {
  const kategori = document.getElementById("select-kategori").value; // Mengambil nilai dari dropdown kategori
  const selectProduk = document.getElementById("select-produk"); // Dropdown produk

  // Reset isi dropdown produk dan status
  selectProduk.innerHTML = '<option value="">Pilih Item</option>';
  document.getElementById("stok-status").classList.add("hidden");
  document.getElementById("stok-status").innerText = "";

  if (!kategori) {
    selectProduk.disabled = true;
    return;
  }

  selectProduk.disabled = false;

  // Filter item berdasarkan kategori
  Object.values(stockData).forEach((item) => {
    if (item.category === kategori) {
      const option = document.createElement("option");
      option.value = item.id;
      option.textContent =
        item.stock <= 0
          ? `${item.name} (Habis - restok jika persediaan masih ada)`
          : `${item.name} (${item.stock} stok)`;
      selectProduk.appendChild(option);
    }
  });
}

function updateStockStatus() {
  const idProduk = document.getElementById("select-produk").value;
  const statusEl = document.getElementById("stok-status");
  if (!idProduk) {
    statusEl.classList.add("hidden");
    statusEl.innerText = "";
    return;
  }
  const produk = stockData[idProduk];
  if (!produk) {
    statusEl.classList.add("hidden");
    statusEl.innerText = "";
    return;
  }
  if (produk.stock <= 0) {
    statusEl.classList.remove("hidden");
    statusEl.classList.remove("text-emerald-500");
    statusEl.classList.add("text-amber-400");
    statusEl.innerText =
      "Item ini saat ini habis. Silakan isi ulang stok jika persediaan masih tersedia.";
  } else {
    statusEl.classList.remove("hidden");
    statusEl.classList.remove("text-amber-400");
    statusEl.classList.add("text-emerald-400");
    statusEl.innerText = `Stok tersedia: ${produk.stock} pcs.`;
  }
}

function updateLocalStockState(id, stock, name) {
  if (!id) return;
  const existing = stockData[id] || { id, name: name || id, stock: 0 };
  console.log(
    `[Stock] Local update request for ${id} (${name || existing.name}): ${existing.stock} -> ${stock}`,
  );
  existing.stock = Number(stock);
  // mark local update time to avoid immediate remote overwrites
  existing._lastLocalUpdate = new Date().getTime();
  if (name) existing.name = name;
  stockData[id] = existing;
  localStorage.setItem(STOCK_STORAGE_KEY, JSON.stringify(stockData));
  updateItemDropdown();
}

function applyRemoteStockUpdate(update) {
  if (!update) return;
  console.log("[Stock] Remote update received:", update);
  try {
    const existing = stockData[update.id];
    const now = new Date().getTime();
    if (existing && existing._lastLocalUpdate) {
      const delta = now - existing._lastLocalUpdate;
      // if local update was very recent (<=5s), ignore remote update to avoid race
      if (delta <= 5000) {
        console.warn(
          `[Stock] Ignoring remote update for ${update.id} because of recent local change (${delta}ms)`,
        );
        return;
      }
    }
    updateLocalStockState(update.id, update.stock, update.name);
  } catch (e) {
    console.error("[Stock] Error applying remote update:", e);
  }
}

function updateIncomingOrderCounter() {
  const countEl = document.getElementById("order-count-value");
  const button = document.getElementById("order-counter-btn");
  const count = Object.keys(activeOrders || {}).length;

  if (countEl) {
    countEl.textContent = String(count);
  }

  if (button) {
    button.classList.toggle("bg-emerald-500/15", count > 0);
    button.classList.toggle("text-emerald-300", count > 0);
    button.classList.toggle("border-emerald-400/30", count > 0);
    button.classList.toggle("bg-amber-500/15", count === 0);
    button.classList.toggle("text-amber-300", count === 0);
    button.classList.toggle("border-amber-400/30", count === 0);
  }
}

async function syncStockFromServer() {
  try {
    const backend =
      typeof KOPRAL_BACKEND !== "undefined"
        ? KOPRAL_BACKEND
        : window.location.origin;
    const response = await fetch(`${backend}/?action=getMenu`);
    const data = await response.json();
    const menuItems = [
      ...(data?.coffee || []),
      ...(data?.["non-coffee"] || []),
      ...(data?.snacks || []),
    ];

    if (!Array.isArray(menuItems) || menuItems.length === 0) return;

    menuItems.forEach((item) => {
      if (!item?.id) return;
      const existing = stockData[item.id];
      if (!existing) return;
      const latestStock = Number(item.stock) || 0;
      existing.stock = latestStock;
      existing._lastLocalUpdate = new Date().getTime();
      stockData[item.id] = existing;
    });

    localStorage.setItem(STOCK_STORAGE_KEY, JSON.stringify(stockData));
    updateItemDropdown();
    updateStockStatus();
  } catch (e) {
    console.warn("[Stock] Gagal sinkronisasi stok dari server:", e);
  }
}

function initializeApp() {
  if (!localStorage.getItem(HITUNG_TRIGGER_START_KEY)) {
    localStorage.setItem(HITUNG_TRIGGER_START_KEY, new Date().toISOString());
  }

  loadPersistedOrders();
  updateItemDropdown();
  renderActiveOrders();
  setInterval(checkClosingTime, 30000);

  setStatusOnline(navigator.onLine);
  window.addEventListener("online", () => setStatusOnline(true));
  window.addEventListener("offline", () => setStatusOnline(false));

  const { loginSaved, storedRole } = restoreAuthState();
  if (storedRole) {
    sessionStorage.setItem("kopral_role", storedRole);
    localStorage.setItem("kopral_role", storedRole);
  }

  updateAuthControls();
  updateRoleLabel();
  loadPersistedOrders();
  renderActiveOrders();
  syncStockFromServer().catch(() => {});
  cekPemicuModalHitung();

  if (loginSaved && storedRole) {
    setAuthOverlayState(false);
    syncPendingOrdersFromServer().catch(() => {});
    if (!appStarted) {
      startApp();
    }
  } else {
    showStartScreen();
  }
}

if (document.readyState === "loading") {
  window.addEventListener("DOMContentLoaded", initializeApp);
} else {
  initializeApp();
}

function setStatusOnline(isOnline) {
  const dot = document.getElementById("dot-status");
  const text = document.getElementById("text-status");
  if (!dot || !text) return;
  if (isOnline) {
    dot.className = "w-2 h-2 rounded-full bg-green-500 animate-pulse";
    text.innerText = "ONLINE";
  } else {
    dot.className = "w-2 h-2 rounded-full bg-red-500";
    text.innerText = "OFFLINE - RECONNECTING...";
  }
}

// LOGIKA LOGIN DENGAN AKSES TERPISAH
function prosesLogin() {
  const user = document
    .getElementById("input-username")
    .value.trim()
    .toLowerCase();
  const pass = document.getElementById("input-password").value;
  const errUser = document.getElementById("error-user");
  const errPass = document.getElementById("error-pass");

  errUser.classList.add("hidden");
  errPass.classList.add("hidden");

  const kredensial = {
    admin: { pass: "admin123", role: "admin" },
    dapur: { pass: "dapur123", role: "dapur" },
  };

  const selected = kredensial[user];
  if (selected && selected.pass === pass) {
    const role = selected.role;
    persistAuthState(role);
    updateRoleLabel();
    loadPersistedOrders();
    renderActiveOrders();
    setAuthOverlayState(false);
    syncPendingOrdersFromServer().catch(() => {});
    syncStockFromServer().catch(() => {});

    if (!appStarted) {
      startApp();
    }

    if (role === "dapur") {
      console.log("Mode Dapur Aktif: Fitur Admin disembunyikan");
    }
  } else {
    if (!selected) {
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
  updateIncomingOrderCounter();
}

async function startApp() {
  if (appStarted) return;
  appStarted = true;

  try {
    if (typeof io === "undefined") {
      alert(
        "Error: Socket.io tidak terpanggil. Periksa koneksi internet Anda.",
      );
      return;
    }

    const role =
      sessionStorage.getItem("kopral_role") ||
      localStorage.getItem("kopral_role") ||
      "admin";
    sessionStorage.setItem("kopral_role", role);
    localStorage.setItem("kopral_role", role);

    const audio = document.getElementById("notif-sound");
    await audio.play().catch(() => {});
    audio.pause();
    const serverBase =
      typeof KOPRAL_BACKEND !== "undefined"
        ? KOPRAL_BACKEND
        : window.location.origin;
    socket = io(serverBase, {
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
    });
    socket.on("connect", () => {
      updateStatus(true);
      syncPendingOrdersFromServer().catch(() => {});
      syncStockFromServer().catch(() => {});
      // Identifikasi role ke server agar bisa bergabung di room khusus
      try {
        const role =
          sessionStorage.getItem("kopral_role") ||
          localStorage.getItem("kopral_role") ||
          "admin";
        sessionStorage.setItem("kopral_role", role);
        localStorage.setItem("kopral_role", role);
        socket.emit("identify", { role });
        console.log("[Socket] Identified role to server:", role);

        // Ambil riwayat dari server untuk role ini (agar bukti transfer hanya terlihat oleh admin)
        const backend =
          typeof KOPRAL_BACKEND !== "undefined"
            ? KOPRAL_BACKEND
            : window.location.origin;
        syncRiwayatFromServer(true)
          .then(() => {
            try {
              filterRiwayat();
            } catch (e) {}
            console.log("[Riwayat] Synced riwayat dari server for role:", role);
          })
          .catch((e) =>
            console.error("[Riwayat] Gagal ambil riwayat dari server:", e),
          );
      } catch (e) {
        console.error("[Socket] Gagal mengirim identitas role:", e);
      }
    });
    socket.on("disconnect", () => updateStatus(false));
    socket.on("connect_error", () => updateStatus(false));
    socket.on("update-stok-realtime", (update) => {
      applyRemoteStockUpdate(update);
    });
    socket.on("notifikasi-pesanan-baru", (pesanan) => {
      pesanan.timestamp = pesanan.timestamp || new Date().getTime();
      const isNew = !activeOrders[pesanan.id_pesanan];
      activeOrders[pesanan.id_pesanan] = pesanan;
      localStorage.setItem(
        "kopral_active_orders",
        JSON.stringify(activeOrders),
      );
      renderActiveOrders();
      updateIncomingOrderCounter();
      if (isNew) {
        document
          .getElementById("notif-sound")
          .play()
          .catch(() => {});
      }
    });
    // Terima notifikasi bahwa pesanan telah selesai dan tambahkan ke riwayat (jika belum ada)
    socket.on("notifikasi-pesanan-selesai", (pesanan) => {
      try {
        const riwayat = JSON.parse(
          localStorage.getItem("kopral_riwayat_data") || "[]",
        );
        const exists = riwayat.some((r) => r.id_pesanan === pesanan.id_pesanan);
        if (!exists) {
          riwayat.unshift(pesanan);
          localStorage.setItem("kopral_riwayat_data", JSON.stringify(riwayat));
          console.log(
            "[Riwayat] Menambahkan pesanan selesai dari server:",
            pesanan.id_pesanan,
          );
        } else {
          console.log(
            "[Riwayat] Pesanan sudah tercatat, melewatkan:",
            pesanan.id_pesanan,
          );
        }
      } catch (e) {
        console.error("[Riwayat] Error saat menerima pesanan selesai:", e);
      }
    });
    const startOverlay = document.getElementById("start-overlay");
    if (startOverlay) {
      startOverlay.classList.add("hidden");
      startOverlay.style.display = "none";
    }
    // Tambahkan efek watermark ketika aplikasi dimulai
    const watermark = document.querySelector(".logo-watermark");
    if (watermark) {
      watermark.classList.add("show-subtle");
    }
  } catch (err) {
    appStarted = false;
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

  const buktiUrl = pesanan.bukti_transfer || pesanan.buktiTransfer || "";
  const tombolBukti =
    buktiUrl && !isDapur
      ? `<button
                id="btn-bukti-${pesanan.id_pesanan}"
                data-bukti="${String(buktiUrl).replace(/"/g, "&quot;")}"
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
    <div class="order-card-inner">
      <div class="flex justify-between items-start mb-4">
        <div class="flex items-start gap-4">
          <div class="order-avatar bg-gradient-to-br from-amber-400 to-emerald-400">${pesanan.meja}</div>
          <div>
            <h3 class="font-bold text-white text-lg">${pesanan.nama}</h3>
            <div class="mt-1 flex gap-2 items-center">
              <span class="pill bg-amber-500/10 text-amber-500 border border-amber-500/20">MEJA ${pesanan.meja}</span>
              <span class="badge-order-type">${orderTypeLabel}</span>
            </div>
            <div class="mt-2 text-[12px] text-slate-400"><i class="fas fa-clock mr-1"></i> Jam Masuk: ${waktuMasuk}</div>
            ${namaRekeningUI}
          </div>
        </div>
        <div class="text-right">
          <div class="text-slate-400 text-sm">#${pesanan.id_pesanan}</div>
          <div class="mt-2 text-[10px] font-bold ${isCash ? "text-red-400" : "text-blue-400"} uppercase">
            <i class="fas ${isCash ? "fa-money-bill" : "fa-credit-card"} mr-1"></i> ${pesanan.pembayaran || "Transfer"}
          </div>
        </div>
      </div>

      <div class="order-items rounded-2xl p-4 mb-4">
        ${pesanan.items
          .map(
            (i) => `
              <div class="order-item">
                <div class="name text-slate-300 text-sm">${i.quantity}x ${i.name}</div>
                <div class="price">Rp ${Number(i.price).toLocaleString()}</div>
                ${i.note ? `<div class="w-full text-[11px] text-amber-400 italic mt-2">• ${i.note}</div>` : ""}
              </div>
            `,
          )
          .join("")}

        <div class="order-total border-t border-slate-700/50 mt-2 pt-2 text-white">
          <span>TOTAL</span>
          <span>Rp ${totalHarga.toLocaleString()}</span>
        </div>
      </div>

      <div class="order-actions grid gap-3">
        ${tombolBukti}
        ${tombolBayar}
        <div class="grid ${!isAdmin ? "grid-cols-2" : "grid-cols-1"} gap-3">
          ${tombolProses}
          <button id="btn-selesai-${pesanan.id_pesanan}" ${selesaiAttrs}>
            <i class="fas fa-check mr-2"></i> SELESAI
          </button>
        </div>
      </div>
    </div>
  `;
  document.getElementById("container-antrean").prepend(div);
  // Pasang event listener aman untuk tombol bukti (jangan gunakan inline onclick)
  try {
    if (buktiUrl && !isDapur) {
      const btn = document.getElementById(`btn-bukti-${pesanan.id_pesanan}`);
      if (btn) {
        btn.addEventListener("click", (e) => {
          const url = btn.getAttribute("data-bukti") || buktiUrl;
          showBukti(url);
        });
      }
    }
  } catch (e) {
    console.error("[UI] Gagal pasang listener tombol bukti:", e);
  }
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

async function selesaiPesanan(id) {
  const card = document.getElementById(id);
  if (card) {
    const pesanan = activeOrders[id] || {};
    const items = pesanan.items || [];
    const cardClone = card.cloneNode(true);
    cardClone.querySelector(".grid")?.remove();

    // Jika ada bukti transfer dan user adalah admin, tambahkan tombol untuk melihat bukti
    try {
      const role = sessionStorage.getItem("kopral_role") || "admin";
      const buktiUrl =
        (cardClone.dataset && cardClone.dataset.bukti) ||
        (pesanan && (pesanan.bukti_transfer || pesanan.buktiTransfer));
      if (role === "admin" && buktiUrl) {
        const btnBukti = Object.assign(document.createElement("button"), {
          className:
            "w-full mb-3 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold py-2 rounded-xl transition block text-center",
          innerHTML:
            '<i class="fas fa-image mr-1"></i> TAMPILKAN BUKTI TRANSFER',
        });
        btnBukti.setAttribute("data-bukti", buktiUrl);
        btnBukti.addEventListener("click", () => showBukti(buktiUrl));
        cardClone.appendChild(btnBukti);
      }
    } catch (e) {
      console.error("[UI] Error while adding bukti button:", e);
    }

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
      id_pesanan: pesanan.id_pesanan || id,
      nama: pesanan.nama || "-",
      meja: pesanan.meja || "-",
      metode: pesanan.metode || "-",
      pembayaran: pesanan.pembayaran || "-",
      total:
        pesanan.total ||
        items.reduce((acc, i) => acc + Number(i.price) * Number(i.quantity), 0),
      html: cardClone.innerHTML,
      items,
      timestamp: new Date().getTime(),
      tanggal: getLocalDateString(new Date()),
    };
    // Keputusan apakah tombol SELESAI harus mengupdate stok tergantung role dan metode pembayaran
    // Aturan:
    // - jika login sebagai 'dapur' => update stok saat pembayaran 'Cash' saja
    // - jika login sebagai 'admin' => update stok saat pembayaran 'Transfer' saja
    const role = sessionStorage.getItem("kopral_role") || "admin";
    const pembayaran = pesanan.pembayaran || "";
    function shouldEmitUpdate(role, pembayaran) {
      if (role === "dapur") return pembayaran === "Cash";
      if (role === "admin") return pembayaran === "Transfer";
      return false;
    }

    const doEmit = shouldEmitUpdate(role, pembayaran);

    // Jika server sudah mengurangi stok pada saat pesanan masuk, jangan kurangi lagi.
    if (pesanan.stocksDeducted) {
      console.log(
        "[Stock] Server sudah mengurangi stok saat pesanan masuk; melewatkan emit pada SELESAI.",
        pesanan.id_pesanan,
      );
    } else if (doEmit) {
      // Lakukan pengurangan stok lokal lalu beri tahu server dengan nilai stok absolut
      items.forEach((item) => {
        const stokItem = Object.values(stockData).find(
          (stockEntry) =>
            stockEntry.id === item.id || stockEntry.name === item.name,
        );
        if (!stokItem) return;

        const before = Number(stokItem.stock) || 0;
        const qty = Number(item.quantity) || 0;
        const after = before - qty;
        stokItem.stock = after < 0 ? 0 : after;
        stokItem._lastLocalUpdate = new Date().getTime();

        try {
          if (typeof socket !== "undefined" && socket && socket.connected) {
            socket.emit("update-stok-realtime", {
              id: stokItem.id,
              stock: stokItem.stock,
              name: stokItem.name,
            });
            console.log("[Stock] Emitted update-stok-realtime to server", {
              id: stokItem.id,
              stock: stokItem.stock,
            });
          } else {
            console.log("[Stock] Socket tidak terhubung, hanya update lokal:", {
              id: stokItem.id,
              stock: stokItem.stock,
            });
          }
        } catch (e) {
          console.error("[Stock] Error emitting stock update:", e);
        }
      });
      updateItemDropdown();
    } else {
      console.log(
        "[Stock] Tidak mengupdate stok pada SELESAI karena kombinasi role/pembayaran:",
        role,
        pembayaran,
      );
    }

    localStorage.setItem(STOCK_STORAGE_KEY, JSON.stringify(stockData));
    updateItemDropdown();

    // Kirim permintaan ke server agar riwayat tersimpan secara sentral (menghindari duplikat)
    try {
      const sourceRole = sessionStorage.getItem("kopral_role") || "admin";
      dataPesanan.sourceRole = sourceRole;
      const backend =
        typeof KOPRAL_BACKEND !== "undefined"
          ? KOPRAL_BACKEND
          : window.location.origin;
      fetch(`${backend}/api/pesanan-selesai`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(dataPesanan),
      })
        .then((r) => r.json())
        .then((j) => console.log("[Riwayat] server response:", j))
        .catch((e) => console.error("[Riwayat] Gagal kirim ke server:", e));
    } catch (e) {
      console.error("[Riwayat] Error saat mengirim pesanan selesai:", e);
    }
    delete activeOrders[id];
    localStorage.setItem("kopral_active_orders", JSON.stringify(activeOrders));
    updateIncomingOrderCounter();
    card.remove();
    if (Object.keys(activeOrders).length === 0) {
      document.getElementById("pesan-kosong").classList.remove("hidden");
    }
  }
}

function getKategori(name) {
  const n = name.toLowerCase();

  if (n.includes("matcha") || n.includes("coklat") || n.includes("chocolate")) {
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

  const dataTerstruktur = {
    Coffee: {},
    "Snack & Food": {},
    "Non-Coffee": {},
  };
  let totalCash = 0;
  let totalTransfer = 0;
  let totalOrders = riwayat.length;
  const allItems = {};

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

      if (!allItems[i.name]) {
        allItems[i.name] = { qty: 0, revenue: 0 };
      }
      allItems[i.name].qty += parseInt(i.quantity, 10);
      allItems[i.name].revenue +=
        parseInt(i.quantity, 10) * parseFloat(i.price);
    });
  });

  doc.setFontSize(16);
  doc.text("LAPORAN PENJUALAN KOPRAL", 14, 15);
  doc.setFontSize(10);
  doc.text(`Tanggal: ${new Date().toLocaleDateString("id-ID")}`, 14, 22);
  doc.text(`Jumlah Pesanan: ${totalOrders}`, 14, 28);
  doc.text(`Omzet CASH: Rp ${totalCash.toLocaleString()}`, 14, 34);
  doc.text(`Omzet TRANSFER: Rp ${totalTransfer.toLocaleString()}`, 14, 40);
  doc.text(
    `TOTAL KESELURUHAN: Rp ${(totalCash + totalTransfer).toLocaleString()}`,
    14,
    46,
  );

  let yPos = 58;
  riwayat.forEach((r, index) => {
    if (yPos > 250) {
      doc.addPage();
      yPos = 15;
    }
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.text(`Pesanan #${index + 1} - ${r.id_pesanan || "-"}`, 14, yPos);
    yPos += 6;
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.text(`Nama: ${r.nama || "-"}`, 14, yPos);
    doc.text(`Meja: ${r.meja || "-"}`, 80, yPos);
    yPos += 5;
    doc.text(`Metode: ${r.metode || "-"}`, 14, yPos);
    doc.text(`Pembayaran: ${r.pembayaran || "-"}`, 80, yPos);
    yPos += 5;
    doc.text(
      `Total Order: Rp ${Number(r.total || 0).toLocaleString()}`,
      14,
      yPos,
    );
    yPos += 6;

    const body = r.items.map((i) => [
      i.name,
      i.quantity,
      `Rp ${Number(i.price).toLocaleString()}`,
      `Rp ${Number(i.price * i.quantity).toLocaleString()}`,
      i.note || "-",
    ]);

    doc.autoTable({
      startY: yPos,
      head: [["Item", "Qty", "Harga", "Subtotal", "Catatan"]],
      body,
      theme: "grid",
      headStyles: { fillColor: [30, 41, 59] },
      styles: { fontSize: 8 },
      margin: { left: 14, right: 14 },
    });

    const orderTotal = body.reduce((sum, row) => {
      const subtotal = Number(row[3].replace(/[^0-9]/g, ""));
      return sum + subtotal;
    }, 0);

    yPos = doc.lastAutoTable.finalY + 8;
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.text(`Total Pesanan: Rp ${orderTotal.toLocaleString()}`, 14, yPos);
    yPos += 10;
  });

  if (yPos > 220) {
    doc.addPage();
    yPos = 15;
  }

  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.text("Ringkasan Terlaris", 14, yPos);
  yPos += 6;
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");

  const topItems = Object.entries(allItems)
    .sort((a, b) => b[1].qty - a[1].qty)
    .slice(0, 5);

  topItems.forEach(([name, stats], idx) => {
    doc.text(
      `${idx + 1}. ${name} - ${stats.qty} pcs (Rp ${stats.revenue.toLocaleString()})`,
      14,
      yPos,
    );
    yPos += 5;
    if (yPos > 280) {
      doc.addPage();
      yPos = 15;
    }
  });

  const filename = `Laporan_Penjualan_${new Date().toISOString().split("T")[0]}.pdf`;

  // Deteksi platform native Capacitor
  const isNative =
    window.Capacitor &&
    (typeof window.Capacitor.isNativePlatform === "function"
      ? window.Capacitor.isNativePlatform()
      : window.Capacitor.platform !== "web");

  if (isNative) {
    const base64String = doc.output("datauristring").split(",")[1];
    saveFileNative(filename, base64String);
  } else {
    doc.save(filename);
  }
}

async function saveFileNative(filename, data, directory = "DOCUMENTS") {
  try {
    const Filesystem = window.Capacitor?.Plugins?.Filesystem;
    if (!Filesystem) {
      throw new Error(
        "Plugin Filesystem tidak ditemukan atau belum disinkronisasi",
      );
    }

    // Request Izin jika belum ada
    const permStatus = await Filesystem.checkPermissions();
    if (permStatus.publicStorage !== "granted") {
      const request = await Filesystem.requestPermissions();
      if (request.publicStorage !== "granted") {
        throw new Error(
          "Izin penyimpanan ditolak. Silakan izinkan di Pengaturan HP.",
        );
      }
    }

    // Validasi data
    if (!data) throw new Error("Data file kosong");

    await Filesystem.writeFile({
      path: filename,
      data: data,
      directory: directory,
      encoding: filename.endsWith(".csv") ? "utf8" : undefined,
      recursive: true,
    });

    Swal.fire({
      title: "Berhasil!",
      text: `File tersimpan di folder Documents/${filename}`,
      icon: "success",
      confirmButtonColor: "#10b981",
    });
    return true;
  } catch (e) {
    console.error("Native Save Error:", e);
    Swal.fire({
      title: "Gagal Menyimpan",
      text: e.message || "Pastikan izin penyimpanan sudah aktif",
      icon: "error",
      confirmButtonColor: "#ef4444",
    });
    return false;
  }
}

function downloadCSV() {
  const riwayat = JSON.parse(
    localStorage.getItem("kopral_riwayat_data") || "[]",
  );
  if (riwayat.length === 0) {
    Swal.fire("Oops", "Data kosong", "info");
    return;
  }

  const rows = [
    [
      "Tanggal",
      "ID Pesanan",
      "Nama Pelanggan",
      "Meja",
      "Metode",
      "Pembayaran",
      "Kategori",
      "Item",
      "Qty",
      "Harga Satuan",
      "Subtotal",
      "Total Item",
      "Total Order",
    ],
  ];

  riwayat.forEach((r) => {
    const totalOrder =
      r.total || r.items.reduce((acc, i) => acc + i.price * i.quantity, 0);
    r.items.forEach((i) => {
      rows.push([
        r.tanggal,
        r.id_pesanan || "-",
        r.nama || "-",
        r.meja || "-",
        r.metode || "-",
        r.pembayaran || "-",
        getKategori(i.name),
        i.name,
        i.quantity,
        i.price,
        i.price * i.quantity,
        i.quantity,
        totalOrder,
      ]);
    });
  });

  const csv = rows
    .map((row) =>
      row
        .map((field) => {
          const cell = String(field).replace(/"/g, '""');
          return `"${cell}"`;
        })
        .join(","),
    )
    .join("\n");

  const filename = `Riwayat_${new Date().toISOString().split("T")[0]}.csv`;

  const isNative =
    window.Capacitor &&
    (typeof window.Capacitor.isNativePlatform === "function"
      ? window.Capacitor.isNativePlatform()
      : window.Capacitor.platform !== "web");

  if (isNative) {
    saveFileNative(filename, csv);
  } else {
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
  }
}

function renderRiwayatEntries(
  container,
  riwayatList,
  role,
  showTotal = true,
  showEntries = true,
) {
  container.innerHTML = "";
  const filtered = Array.isArray(riwayatList) ? riwayatList : [];

  if (showTotal && role !== "dapur") {
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

  if (!showEntries) {
    return;
  }

  filtered.forEach((item) => {
    const div = document.createElement("div");
    div.className =
      "bg-slate-900 p-3 sm:p-4 rounded-xl border border-slate-700 mb-3 shadow-sm";

    if (role === "dapur") {
      const waktu = item.timestamp
        ? new Date(item.timestamp).toLocaleTimeString("id-ID", {
            hour: "2-digit",
            minute: "2-digit",
          })
        : "--:--";
      const metode =
        item.metode === "Dine-In" ? "Makan di Tempat" : "Bawa Pulang";
      const isTransfer = item.pembayaran === "Transfer";
      const paymentBadge = `
        <div class="inline-flex items-center gap-2 rounded-full border border-slate-700/80 bg-slate-900 px-3 py-1 text-[10px] uppercase tracking-widest text-slate-300">
          <i class="fas ${isTransfer ? "fa-credit-card" : "fa-money-bill"}"></i>
          ${isTransfer ? "TRANSFER" : "CASH"}
        </div>
      `;
      div.innerHTML = `
        <div class="order-card-inner">
          <div class="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-3 mb-3">
            <div class="flex items-start gap-3 min-w-0">
              <div class="order-avatar bg-gradient-to-br from-amber-400 to-emerald-400 flex-shrink-0">${item.meja || "-"}</div>
              <div class="min-w-0">
                <h3 class="font-bold text-white text-base sm:text-lg leading-tight">${item.nama || "-"}</h3>
                <div class="mt-1 flex flex-wrap gap-2 items-center">
                  <span class="pill bg-amber-500/10 text-amber-500 border border-amber-500/20">MEJA ${item.meja || "-"}</span>
                  <span class="badge-order-type">${metode}</span>
                </div>
                <div class="mt-2 text-[11px] sm:text-[12px] text-slate-400 break-words"><i class="fas fa-clock mr-1"></i> Jam Masuk: ${waktu}</div>
              </div>
            </div>
            <div class="text-left sm:text-right flex-shrink-0">
              <div class="text-slate-400 text-[11px] sm:text-sm">#${item.id_pesanan || "-"}</div>
              <div class="mt-2">${paymentBadge}</div>
            </div>
          </div>
          <div class="order-items rounded-2xl p-3 sm:p-4 mb-3">
            ${item.items
              .map(
                (i) => `
                  <div class="order-item flex items-start justify-between gap-2 py-1.5">
                    <div class="name text-slate-300 text-[12px] sm:text-sm leading-5 min-w-0 pr-2">${i.quantity}x ${i.name}</div>
                    <div class="price text-[12px] sm:text-sm text-slate-200 whitespace-nowrap">Rp ${Number(i.price).toLocaleString()}</div>
                    ${i.note ? `<div class="w-full text-[10px] sm:text-[11px] text-amber-400 italic mt-1">• ${i.note}</div>` : ""}
                  </div>
                `,
              )
              .join("")}
            <div class="order-total border-t border-slate-700/50 mt-2 pt-2 text-white flex justify-between gap-3 text-[12px] sm:text-sm font-semibold">
              <span>TOTAL</span>
              <span>Rp ${Number(item.total || item.items.reduce((acc, i) => acc + i.price * i.quantity, 0)).toLocaleString()}</span>
            </div>
          </div>
          <div class="mt-2 text-center">
            <span class="inline-flex items-center justify-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-[10px] sm:text-[11px] font-bold uppercase tracking-widest text-emerald-300">
              <i class="fas fa-check-circle"></i> Pesanan Selesai
            </span>
          </div>
        </div>
      `;
    } else {
      let htmlContent = item.html || "";

      // Jika bukan admin, hilangkan semua referensi bukti transfer dan nama rekening dari HTML riwayat
      if (role !== "admin" && typeof htmlContent === "string") {
        // Hapus tombol atau elemen yang berisi teks 'Bukti Transfer' (lebih fleksibel)
        htmlContent = htmlContent.replace(
          /<button[^>]*>[\s\S]*?BUKTI TRANSFER[\s\S]*?<\/button>/gi,
          "",
        );
        // Hapus blok yang menampilkan nama rekening transfer
        htmlContent = htmlContent.replace(
          /<div[^>]*>[\s\S]*?Nama Rekening Transfer:[\s\S]*?<\/div>/gi,
          "",
        );
        // Hapus elemen lain yang mungkin menyertakan label 'Nama Rekening' (fallback)
        htmlContent = htmlContent.replace(
          /<div[^>]*>[\s\S]*?Nama Rekening[\s\S]*?<\/div>/gi,
          "",
        );
      }

      div.innerHTML = htmlContent;
      // Jika ada tombol bukti dalam HTML (riwayat admin), pasang listener agar tombol membuka modal
      try {
        if (role === "admin") {
          const buttons = div.querySelectorAll("button");
          buttons.forEach((b) => {
            const txt = (b.textContent || "").toLowerCase();
            if (txt.includes("bukti transfer") || b.dataset.bukti) {
              const url =
                b.getAttribute("data-bukti") ||
                item.bukti_transfer ||
                item.buktiTransfer;
              if (url) {
                b.addEventListener("click", () => showBukti(url));
              }
            }
          });
        }
      } catch (e) {
        console.error("[Riwayat] Error attaching bukti listeners:", e);
      }
    }

    container.appendChild(div);
  });
}

function updateTotalOmzetSummary(riwayatList, role) {
  const card = document.getElementById("total-omzet-container");
  const value = document.getElementById("total-omzet-value");
  if (!card || !value) return;

  if (role === "dapur") {
    card.classList.add("hidden");
    card.style.display = "none";
    return;
  }

  const filtered = Array.isArray(riwayatList) ? riwayatList : [];
  const totalOmzet = filtered.reduce(
    (acc, r) => acc + r.items.reduce((sub, i) => sub + i.price * i.quantity, 0),
    0,
  );

  value.textContent = `Rp ${totalOmzet.toLocaleString()}`;
  card.classList.remove("hidden");
  card.style.display = "block";
}

function normalizeTanggalValue(value) {
  if (value === null || value === undefined || value === "") return "";

  const raw = String(value).trim();
  if (!raw) return "";

  const parsed = getTanggalDariData(value);
  if (parsed) {
    return getLocalDateString(parsed);
  }

  const fallback = raw.match(/(\d{4})[-/](\d{2})[-/](\d{2})/);
  if (fallback) {
    return `${fallback[1]}-${fallback[2]}-${fallback[3]}`;
  }

  return raw;
}

function normalizeRiwayatList(rawList) {
  const list = Array.isArray(rawList) ? rawList : [];
  return list.map((item) => {
    const normalizedItem = { ...item };
    const tanggalSource =
      normalizedItem.tanggal ||
      normalizedItem.tanggal_order ||
      normalizedItem.created_at ||
      normalizedItem.createdAt ||
      normalizedItem.tanggal_pesan;
    normalizedItem.tanggal = normalizeTanggalValue(tanggalSource);
    if (!normalizedItem.tanggal && normalizedItem.timestamp) {
      normalizedItem.tanggal = normalizeTanggalValue(normalizedItem.timestamp);
    }
    return normalizedItem;
  });
}

async function syncRiwayatFromServer(force = false) {
  const role =
    sessionStorage.getItem("kopral_role") ||
    localStorage.getItem("kopral_role") ||
    "admin";
  const backend =
    typeof KOPRAL_BACKEND !== "undefined"
      ? KOPRAL_BACKEND
      : window.location.origin;

  try {
    const response = await fetch(
      `${backend}/api/riwayat?role=${encodeURIComponent(role)}`,
    );
    const data = await response.json();
    if (data && data.success && Array.isArray(data.riwayat)) {
      const normalized = normalizeRiwayatList(data.riwayat);
      localStorage.setItem("kopral_riwayat_data", JSON.stringify(normalized));
      return normalized;
    }
  } catch (e) {
    console.error("[Riwayat] Gagal sinkronisasi riwayat dari server:", e);
  }

  const stored = JSON.parse(
    localStorage.getItem("kopral_riwayat_data") || "[]",
  );
  return normalizeRiwayatList(stored);
}

function getRiwayatUntukHitung() {
  const tanggal = getTanggalHitung();
  const riwayat = JSON.parse(
    localStorage.getItem("kopral_riwayat_data") || "[]",
  );
  const list = Array.isArray(riwayat) ? riwayat : [];
  return tanggal ? list.filter((item) => item.tanggal === tanggal) : list;
}

function hitungTotalOmzet(riwayatList) {
  const list = Array.isArray(riwayatList) ? riwayatList : [];
  return list.reduce((acc, order) => {
    const items = Array.isArray(order?.items) ? order.items : [];
    const subtotal = items.reduce(
      (sum, item) =>
        sum + Number(item?.price || 0) * Number(item?.quantity || 0),
      0,
    );
    return acc + Number(order?.total ?? subtotal);
  }, 0);
}

function parseRupiahValue(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (value === null || value === undefined || value === "") {
    return 0;
  }

  const cleaned = String(value).trim();
  if (!cleaned) return 0;

  const normalized = cleaned
    .replace(/rp/gi, "")
    .replace(/\s+/g, "")
    .replace(/\./g, "")
    .replace(/,/g, ".")
    .replace(/[^\d.-]/g, "");

  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getTotalPengeluaranTerakumulasi() {
  const stored = localStorage.getItem("kopral_total_pengeluaran") || "0";
  return parseRupiahValue(stored);
}

function getLocalDateString(date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getTanggalHitung() {
  const tanggal = document.getElementById("input-tanggal-hitung")?.value || "";
  return tanggal || getLocalDateString(new Date());
}

function getDaftarPengeluaran() {
  try {
    const stored = localStorage.getItem("kopral_daftar_pengeluaran");
    if (!stored) return [];
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

function getDaftarPengeluaranTanggal(tanggal) {
  const list = getDaftarPengeluaran();
  if (!tanggal) return list;
  return list.filter(
    (item) => (item.tanggal || getLocalDateString(new Date())) === tanggal,
  );
}

function simpanDaftarPengeluaran(list) {
  localStorage.setItem("kopral_daftar_pengeluaran", JSON.stringify(list));
}

function simpanTotalPengeluaran(total) {
  const safeTotal = Math.max(0, parseRupiahValue(total));
  localStorage.setItem("kopral_total_pengeluaran", String(safeTotal));
  return safeTotal;
}

function renderTotalPengeluaran() {
  const display = document.getElementById("total-pengeluaran-value");
  if (!display) return;
  const tanggal = getTanggalHitung();
  const list = getDaftarPengeluaranTanggal(tanggal);
  const total = list.reduce(
    (sum, item) => sum + parseRupiahValue(item.nominal || 0),
    0,
  );
  display.textContent = `Rp ${total.toLocaleString("id-ID")}`;
}

function sinkronkanHitungTanggal() {
  const omzetValue = document.getElementById("hitung-omzet-value");
  const hasilCard = document.getElementById("hasil-hitung-card");
  const hasilValue = document.getElementById("hasil-hitung-value");
  const hasilCaption = document.getElementById("hasil-hitung-caption");
  if (!omzetValue || !hasilCard || !hasilValue || !hasilCaption) return;

  const tanggal = getTanggalHitung();
  const riwayat = getRiwayatUntukHitung();
  const totalOmzet = hitungTotalOmzet(riwayat);
  omzetValue.dataset.numericValue = String(totalOmzet);
  omzetValue.textContent = `Rp ${totalOmzet.toLocaleString("id-ID")}`;
  renderTotalPengeluaran();
  renderDaftarPengeluaran();
  hasilCard.classList.add("hidden");
  hasilValue.textContent = "Rp 0";
  hasilCaption.textContent =
    "Silakan tambah pengeluaran lalu klik hitung untuk melihat hasilnya.";
}

function renderDaftarPengeluaran() {
  const container = document.getElementById("daftar-pengeluaran");
  if (!container) return;

  const tanggal = getTanggalHitung();
  const allItems = getDaftarPengeluaran();
  const list = allItems.filter(
    (item) => (item.tanggal || getLocalDateString(new Date())) === tanggal,
  );
  if (!list.length) {
    container.innerHTML = `
      <div class="rounded-xl border border-dashed border-slate-700 p-3 text-center text-[11px] text-slate-500">
        Belum ada daftar pengeluaran untuk tanggal ini.
      </div>
    `;
    return;
  }

  container.innerHTML = list
    .map((item) => {
      const nominal = parseRupiahValue(item.nominal || 0);
      const tanggalLabel = item.tanggal
        ? item.tanggal
        : "Tanggal tidak tercatat";
      const itemIndex = allItems.findIndex((candidate) => candidate === item);
      const safeIndex = itemIndex >= 0 ? itemIndex : -1;
      return `
        <div class="mb-2 rounded-xl border border-slate-800 bg-slate-900/80 p-2.5">
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <div class="text-[11px] font-bold text-white">${item.keterangan || "Pengeluaran"}</div>
              <div class="mt-1 text-[10px] text-slate-400">Rp ${nominal.toLocaleString("id-ID")}</div>
              <div class="mt-1 text-[9px] uppercase tracking-[0.2em] text-slate-500">${tanggalLabel}</div>
            </div>
            <div class="flex gap-1">
              <button
                onclick="editPengeluaran(${safeIndex})"
                class="rounded-lg border border-slate-700 bg-slate-800 px-2 py-1 text-[10px] text-slate-300"
              >
                <i class="fas fa-edit"></i>
              </button>
              <button
                onclick="hapusPengeluaran(${safeIndex})"
                class="rounded-lg border border-red-600/30 bg-red-500/10 px-2 py-1 text-[10px] text-red-400"
              >
                <i class="fas fa-trash"></i>
              </button>
            </div>
          </div>
        </div>
      `;
    })
    .join("");
}

function tambahkanPengeluaran() {
  const keteranganInput = document.getElementById(
    "input-pengeluaran-keterangan",
  );
  const input = document.getElementById("input-pengeluaran");
  const display = document.getElementById("total-pengeluaran-value");
  if (!keteranganInput || !input || !display) return;

  const keterangan = (keteranganInput.value || "").trim();
  const nilaiBaru = parseRupiahValue(input.value || "0");
  if (!keterangan) {
    Swal.fire("Info", "Isi keterangan pengeluaran terlebih dahulu.", "info");
    return;
  }
  if (nilaiBaru <= 0) {
    Swal.fire("Info", "Nominal pengeluaran harus lebih dari nol.", "info");
    return;
  }

  const tanggal = getTanggalHitung();
  const list = getDaftarPengeluaran();
  list.push({ keterangan, nominal: nilaiBaru, tanggal });
  simpanDaftarPengeluaran(list);

  renderTotalPengeluaran();
  renderDaftarPengeluaran();
  keteranganInput.value = "";
  input.value = "";
}

function editPengeluaran(index) {
  const list = getDaftarPengeluaran();
  if (index < 0 || index >= list.length) return;
  const item = list[index];
  if (!item) return;

  Swal.fire({
    title: "Edit Pengeluaran",
    html: `
      <div class="text-left space-y-3">
        <div>
          <label class="block text-[11px] font-bold uppercase tracking-[0.2em] text-slate-500 mb-1">Keterangan</label>
          <input id="swal-keterangan" value="${item.keterangan || ""}" class="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm" />
        </div>
        <div>
          <label class="block text-[11px] font-bold uppercase tracking-[0.2em] text-slate-500 mb-1">Nominal</label>
          <input id="swal-nominal" type="number" min="0" value="${item.nominal || 0}" class="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm" />
        </div>
      </div>
    `,
    focusConfirm: false,
    showCancelButton: true,
    confirmButtonText: "Simpan",
    preConfirm: () => {
      const nextKeterangan = document
        .getElementById("swal-keterangan")
        .value.trim();
      const nextNominal = parseRupiahValue(
        document.getElementById("swal-nominal").value || "0",
      );
      if (!nextKeterangan) {
        Swal.showValidationMessage("Keterangan wajib diisi.");
        return false;
      }
      if (nextNominal <= 0) {
        Swal.showValidationMessage("Nominal harus lebih dari nol.");
        return false;
      }
      return { keterangan: nextKeterangan, nominal: nextNominal };
    },
  }).then((result) => {
    if (!result.isConfirmed || !result.value) return;
    const oldNominal = parseRupiahValue(item.nominal || 0);
    const newNominal = parseRupiahValue(result.value.nominal || 0);
    list[index] = {
      ...item,
      keterangan: result.value.keterangan,
      nominal: newNominal,
    };
    simpanDaftarPengeluaran(list);
    renderTotalPengeluaran();
    renderDaftarPengeluaran();
  });
}

function hapusPengeluaran(index) {
  const list = getDaftarPengeluaran();
  if (index < 0 || index >= list.length) return;
  const item = list[index];
  if (!item) return;

  list.splice(index, 1);
  simpanDaftarPengeluaran(list);
  renderTotalPengeluaran();
  renderDaftarPengeluaran();
}

function toggleHitungModal(show) {
  const modal = document.getElementById("modal-hitung");
  const omzetValue = document.getElementById("hitung-omzet-value");
  const hasilCard = document.getElementById("hasil-hitung-card");
  const hasilValue = document.getElementById("hasil-hitung-value");
  const hasilCaption = document.getElementById("hasil-hitung-caption");
  const inputPengeluaran = document.getElementById("input-pengeluaran");

  if (!modal || !omzetValue || !hasilCard || !hasilValue || !hasilCaption) {
    return;
  }

  if (show) {
    const tanggalInput = document.getElementById("input-tanggal-hitung");
    const tanggalAktif = getTanggalHitung();
    if (tanggalInput) {
      tanggalInput.value = tanggalAktif;
    }
    const riwayat = getRiwayatUntukHitung();
    const totalOmzet = hitungTotalOmzet(riwayat);
    omzetValue.dataset.numericValue = String(totalOmzet);
    omzetValue.textContent = `Rp ${totalOmzet.toLocaleString("id-ID")}`;
    if (inputPengeluaran) inputPengeluaran.value = "";
    const keteranganInput = document.getElementById(
      "input-pengeluaran-keterangan",
    );
    if (keteranganInput) keteranganInput.value = "";
    renderTotalPengeluaran();
    renderDaftarPengeluaran();
    hasilCard.classList.add("hidden");
    hasilValue.textContent = "Rp 0";
    hasilCaption.textContent =
      "Silakan tambah pengeluaran lalu klik hitung untuk melihat hasilnya.";
    aturStatusTombolHitung30Hari();
    modal.classList.remove("hidden");
    modal.classList.add("flex");
  } else {
    modal.classList.add("hidden");
    modal.classList.remove("flex");
  }
}

function hitungSelisihPengeluaran() {
  const hasilCard = document.getElementById("hasil-hitung-card");
  const hasilValue = document.getElementById("hasil-hitung-value");
  const hasilCaption = document.getElementById("hasil-hitung-caption");
  const omzetValue = document.getElementById("hitung-omzet-value");

  if (!hasilCard || !hasilValue || !hasilCaption) {
    return;
  }

  const omzet = parseRupiahValue(
    omzetValue?.dataset?.numericValue ?? omzetValue?.textContent ?? "0",
  );
  const tanggal = getTanggalHitung();
  const list = getDaftarPengeluaranTanggal(tanggal);
  const pengeluaran = list.reduce(
    (sum, item) => sum + parseRupiahValue(item.nominal || 0),
    0,
  );
  const safeOmzet = Number.isFinite(omzet) ? Math.max(0, omzet) : 0;
  const safePengeluaran = Number.isFinite(pengeluaran)
    ? Math.max(0, pengeluaran)
    : 0;
  const hasil = Math.max(0, safeOmzet - safePengeluaran);

  hasilValue.textContent = `Rp ${hasil.toLocaleString("id-ID")}`;
  if (safePengeluaran > safeOmzet) {
    hasilCaption.textContent =
      "Pengeluaran melebihi omzet, hasil dibatasi Rp 0 agar tidak muncul nilai minus.";
  } else if (hasil === 0) {
    hasilCaption.textContent =
      "Hasil sama dengan nol karena pengeluaran setara dengan omzet.";
  } else {
    hasilCaption.textContent =
      "Sisa omzet masih positif setelah dikurangi total pengeluaran.";
  }
  hasilCard.classList.remove("hidden");
}

async function filterRiwayat() {
  const role =
    sessionStorage.getItem("kopral_role") ||
    localStorage.getItem("kopral_role") ||
    "admin";
  const inputTanggal = document.getElementById("input-tanggal");
  const tanggal = inputTanggal ? inputTanggal.value : "";
  const container = document.getElementById("container-riwayat");
  if (!container) return;

  const riwayat = await syncRiwayatFromServer(true);
  const targetTanggal = normalizeTanggalValue(tanggal);
  const filtered = targetTanggal
    ? riwayat.filter((item) => {
        const itemTanggal = normalizeTanggalValue(
          item.tanggal ||
            item.tanggal_order ||
            item.created_at ||
            item.createdAt ||
            item.timestamp,
        );
        return itemTanggal === targetTanggal;
      })
    : riwayat;

  container.innerHTML = "";
  updateTotalOmzetSummary(filtered, role);
  renderRiwayatEntries(container, filtered, role, false, false);
}

function toggleRiwayatPopup(show) {
  const popup = document.getElementById("history-popup");
  const content = document.getElementById("popup-riwayat-content");
  if (!popup || !content) return;

  if (show) {
    popup.classList.remove("hidden");
    popup.classList.add("flex");
    const role = sessionStorage.getItem("kopral_role");
    const riwayat = JSON.parse(
      localStorage.getItem("kopral_riwayat_data") || "[]",
    );
    renderRiwayatEntries(content, riwayat, role, false, true);
  } else {
    popup.classList.add("hidden");
    popup.classList.remove("flex");
  }
}

function hapusRiwayatManual() {
  const riwayat = JSON.parse(
    localStorage.getItem("kopral_riwayat_data") || "[]",
  );
  const pengeluaran = getDaftarPengeluaran();
  const batas = new Date();
  batas.setDate(batas.getDate() - 30);
  const dataBaru = riwayat.filter((i) => new Date(i.timestamp) >= batas);
  const dataPengeluaranBaru = pengeluaran.filter((i) => {
    const tanggalItem = i.tanggal || "";
    if (!tanggalItem) return false;
    const itemDate = new Date(`${tanggalItem}T00:00:00`);
    return itemDate >= batas;
  });

  if (
    dataBaru.length === riwayat.length &&
    dataPengeluaranBaru.length === pengeluaran.length
  ) {
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
      simpanDaftarPengeluaran(dataPengeluaranBaru);
      if (document.getElementById("modal-hitung")) {
        renderTotalPengeluaran();
        renderDaftarPengeluaran();
      }
      filterRiwayat();
      Swal.fire(
        "Dihapus!",
        "Riwayat lama dan pengeluaran lama berhasil dibersihkan.",
        "success",
      );
    }
  });
}

function toggleModal(show) {
  const modal = document.getElementById("modal");
  const adminActions = document.getElementById("admin-actions");
  const btnCetak = document.getElementById("btn-cetak-pdf");
  const btnExport = document.getElementById("btn-export-csv");
  const btnRiwayat = document.getElementById("btn-riwayat-pesanan");
  const btnHapus = document.getElementById("btn-hapus-riwayat");
  const role = sessionStorage.getItem("kopral_role");
  const totalOmzetCard = document.getElementById("total-omzet-container");

  if (show) {
    modal.classList.remove("hidden");
    if (adminActions) {
      adminActions.style.display = "grid";
    }
    if (role === "dapur") {
      if (btnCetak) btnCetak.classList.add("hidden");
      if (btnExport) btnExport.classList.add("hidden");
      if (btnHapus) btnHapus.classList.add("hidden");
      if (btnRiwayat) btnRiwayat.classList.remove("hidden");
      if (totalOmzetCard) {
        totalOmzetCard.classList.add("hidden");
        totalOmzetCard.style.display = "none";
      }
    } else {
      if (btnCetak) btnCetak.classList.remove("hidden");
      if (btnExport) btnExport.classList.remove("hidden");
      if (btnHapus) btnHapus.classList.remove("hidden");
      if (btnRiwayat) btnRiwayat.classList.remove("hidden");
      if (totalOmzetCard) {
        totalOmzetCard.classList.remove("hidden");
        totalOmzetCard.style.display = "block";
      }
    }
    document.getElementById("input-tanggal").value = getLocalDateString(
      new Date(),
    );
    filterRiwayat();
  } else {
    modal.classList.add("hidden");
  }
}

function toggleModalStok(show) {
  const modal = document.getElementById("modal-stok");
  if (show) {
    // Reset pilihan kategori dan stok saat modal dibuka kembali
    document.getElementById("select-kategori").value = "";
    document.getElementById("input-stok").value = "";
    document.getElementById("stok-status").classList.add("hidden");
    document.getElementById("stok-status").innerText = "";
    updateItemDropdown();
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
    const backend =
      typeof KOPRAL_BACKEND !== "undefined"
        ? KOPRAL_BACKEND
        : window.location.origin;
    const response = await fetch(`${backend}/update-stok`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: idProduk,
        stock: jumlahBaru,
        name: produkTerpilih?.name || idProduk,
      }),
    });

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
