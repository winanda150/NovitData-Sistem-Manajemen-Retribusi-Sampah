import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.1/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.1/firebase-auth.js";
import { getFirestore, collection, addDoc, onSnapshot, doc, updateDoc, deleteDoc, query, orderBy } from "https://www.gstatic.com/firebasejs/10.12.1/firebase-firestore.js";

// KONFIGURASI FIREBASE
const firebaseConfig = {
    apiKey: "AIzaSyBFhlupsjgmbbvCjcAfjdBizdHxLjGdgoM",
    authDomain: "novitdata-auth.firebaseapp.com",
    projectId: "novitdata-auth",
    storageBucket: "novitdata-auth.firebasestorage.app",
    messagingSenderId: "771423208259", 
    appId: "1:771423208259:web:469840aca356e9a3d065f6", 
    measurementId: "G-ML2ZC3G6CK"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

let isLoggingIn = false;
let currentLoadingYear = null; // Untuk mencegah race condition saat load data
let unsubscribeWarga = null; // Menyimpan fungsi untuk menghentikan listener real-time

// Global variables for pagination and data storage
let allWargaData = []; // To store all fetched data for pagination and export
let filteredWargaData = []; // To store filtered data for search
let currentPage = 1;
const rowsPerPage = 10;

// Fungsi Helper Debounce untuk mengoptimalkan pencarian
function debounce(func, timeout = 300) {
    let timer;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => { func.apply(this, args); }, timeout);
    };
}

// --- LOGIKA HALAMAN LOGIN (index.html) ---
const loginForm = document.getElementById('loginForm');
if (loginForm) {
    const emailField = document.getElementById('email');
    const password = document.getElementById('password');
    const togglePassword = document.getElementById('togglePassword');
    const loginBtn = document.getElementById('loginBtn');
    const errorMessage = document.getElementById('error-message');
    const successPopup = document.getElementById('successPopup');

    onAuthStateChanged(auth, (user) => {
        if (user) {
            // Jika user ditemukan dan bukan sedang proses klik tombol login, langsung lempar
            if (!isLoggingIn) window.location.href = "dashboard.html";
        } else {
            // Jika tidak ada user (belum login), barulah tampilkan form login-nya
            const loginSection = document.getElementById('halaman-login');
            if (loginSection) loginSection.style.display = "flex";
        }
    });

    const clearError = () => { errorMessage.style.display = "none"; errorMessage.textContent = ""; };
    emailField.addEventListener('input', clearError);
    password.addEventListener('input', clearError);

    togglePassword.addEventListener('click', function () {
        const type = password.getAttribute('type') === 'password' ? 'text' : 'password';
        password.setAttribute('type', type);
        this.classList.toggle('fa-eye');
        this.classList.toggle('fa-eye-slash');
    });

    loginForm.addEventListener('submit', async function (e) {
        e.preventDefault();
        loginBtn.disabled = true;
        loginBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Loading...';
        isLoggingIn = true;

        try {
            await signInWithEmailAndPassword(auth, emailField.value, password.value);
            successPopup.style.display = "flex";
            setTimeout(() => { window.location.href = "dashboard.html"; }, 2000);
        } catch (error) {
            isLoggingIn = false;
            if (error.code === 'auth/user-not-found') {
                errorMessage.textContent = "Akun belum terdaftar di NovitData";
            } else if (error.code === 'auth/wrong-password') {
                errorMessage.textContent = "Password anda salah!";
            } else if (error.code === 'auth/invalid-credential') {
                errorMessage.textContent = "Email atau Password anda salah!";
            } else {
                errorMessage.textContent = "Gagal memproses. Coba lagi.";
            }
            errorMessage.style.display = "block";
        } finally {
            loginBtn.disabled = false;
            loginBtn.textContent = "Login";
        }
    });
}

// --- LOGIKA HALAMAN DASHBOARD (dashboard.html) ---
const logoutBtn = document.getElementById('logoutBtn');
if (logoutBtn) {
    const welcomeText = document.getElementById('welcome-text');
    const tahunRetribusi = document.getElementById('tahunRetribusi');

    // --- LOGIKA DARK MODE ---
    const themeToggle = document.getElementById('themeToggle');
    if (themeToggle) {
        const icon = themeToggle.querySelector('i');
        
        const applyTheme = (theme) => {
            if (theme === 'dark') {
                document.documentElement.setAttribute('data-theme', 'dark');
                icon.classList.replace('fa-sun', 'fa-moon');
            } else {
                document.documentElement.removeAttribute('data-theme');
                icon.classList.replace('fa-moon', 'fa-sun');
            }
        };

        // Load tema tersimpan
        applyTheme(localStorage.getItem('novitDataTheme') || 'light');

        themeToggle.addEventListener('click', () => {
            const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
            const newTheme = isDark ? 'light' : 'dark';
            applyTheme(newTheme);
            localStorage.setItem('novitDataTheme', newTheme);
        });
    }

    // Pindahkan deklarasi ke atas agar bisa diakses oleh semua fungsi di dalam scope ini
    const dataWargaBody = document.getElementById('dataWargaBody');
    const dataWargaFooter = document.getElementById('dataWargaFooter');
    const formatRupiah = (number) => {
        if (typeof number !== 'number') {
            return 'Rp 0'; // Handle non-numeric input gracefully
        }
        return 'Rp ' + (number || 0).toLocaleString('id-ID');
    };

    // Fungsi untuk mengisi dropdown tahun
    if (tahunRetribusi) {
        const tahunSekarang = new Date().getFullYear();
        // Kita sediakan pilihan dari 2026 sampai 2030
        for (let t = 2026; t <= 2030; t++) {
            const opsi = document.createElement('option');
            opsi.value = t;
            opsi.textContent = t;
            if (t === tahunSekarang) opsi.selected = true;
            tahunRetribusi.appendChild(opsi);
        }
    }

    const modal = document.getElementById('modalWarga');
    const btnTambahWarga = document.getElementById('btnTambahWarga');
    const closeModal = document.getElementById('closeModal');
    const btnBatal = document.getElementById('btnBatal');
    const formTambahWarga = document.getElementById('formTambahWarga');
    const modalTitle = document.getElementById('modalTitle');
    const modalSubmitBtn = document.getElementById('modalSubmitBtn');
    const btnHapusWarga = document.getElementById('btnHapusWarga');
    const wargaIdInput = document.getElementById('wargaId');
    const namaWargaInput = document.getElementById('namaWarga');
    const paginationInfo = document.querySelector('.pagination-info'); // New
    const paginationControls = document.querySelector('.pagination-controls'); // New
    const footerActions = document.querySelector('.right-footer-actions');
    const btnExportExcel = document.getElementById('btnExportExcel'); // New
    const searchInput = document.getElementById('searchInput');

    // Element Popup Kustom
    const deleteConfirmPopup = document.getElementById('deleteConfirmPopup');
    const deleteConfirmMessage = document.getElementById('deleteConfirmMessage');
    const btnYaHapus = document.getElementById('btnYaHapus');
    const btnBatalHapus = document.getElementById('btnBatalHapus');
    const actionSuccessPopup = document.getElementById('actionSuccessPopup');
    const successPopupTitle = document.getElementById('successPopupTitle');
    const successPopupMessage = document.getElementById('successPopupMessage');

    // Fungsi untuk menghitung statistik kartu di dashboard
    const updateDashboardStats = () => {
        // Gunakan allWargaData (data asli dari DB) untuk statistik yang akurat
        let totalRevenue = 0;

        allWargaData.forEach(warga => {
            const total = warga.retribusi.reduce((sum, val) => sum + (Number(val) || 0), 0);
            totalRevenue += total;
        });
        // Update Cards
        document.getElementById('statTotalRevenue').textContent = formatRupiah(totalRevenue);
        document.getElementById('statTotalWarga').textContent = allWargaData.length;
    };

    onAuthStateChanged(auth, (user) => {
        if (user) {
            document.body.style.display = "block";
            welcomeText.textContent = "Halo, " + user.email + "!";
            loadDataWarga(); // Panggil setelah dropdown tahun siap
        } else {
            window.location.href = "index.html";
        }
    });

    // --- FUNGSI FIRESTORE ---
    // Load data dari Firestore saat halaman dimuat
    const loadDataWarga = async () => {
        // Hentikan listener sebelumnya jika ada (saat ganti tahun)
        if (unsubscribeWarga) {
            unsubscribeWarga();
        }

        const tahunTerpilih = tahunRetribusi.value;
        currentLoadingYear = tahunTerpilih;
        
        dataWargaBody.innerHTML = ''; // Kosongkan tabel sebelum memuat data baru

        // Tampilkan loading spinner
        const loadingRow = document.createElement('tr');
        loadingRow.innerHTML = `<td colspan="16" class="loading-td"><div class="spinner-container"><i class="fas fa-spinner fa-spin"></i><span>Memuat data...</span></div></td>`;
        dataWargaBody.appendChild(loadingRow);

        const collectionRef = collection(db, "warga_" + tahunTerpilih);
        // Mengurutkan berdasarkan waktu pembuatan (createdAt) secara menaik (asc)
        const q = query(collectionRef, orderBy("createdAt", "asc"));

        // Gunakan onSnapshot untuk pembaruan real-time
        unsubscribeWarga = onSnapshot(q, (querySnapshot) => {
            // Cek apakah user sudah pindah tahun lagi
            if (currentLoadingYear !== tahunTerpilih) return; // Prevent race condition

            allWargaData = []; // Clear previous data
            querySnapshot.forEach((doc) => {
                allWargaData.push({ id: doc.id, ...doc.data() });
            });

            // Terapkan filter pencarian jika sedang aktif agar hasil cari tidak hilang saat ada update data
            const searchTerm = searchInput ? searchInput.value.toLowerCase() : "";
            if (searchTerm) {
                filteredWargaData = allWargaData.filter(warga =>
                    warga.nama.toLowerCase().includes(searchTerm)
                );
            } else {
                filteredWargaData = [...allWargaData];
            }
            
            // Now, display only the current page's data
            displayCurrentPageData();
            // Update dashboard stats based on all data
            updateDashboardStats();
        }, (error) => {
            console.error("Error pada listener real-time:", error);
            dataWargaBody.innerHTML = '<tr><td colspan="16">Gagal memuat data. Periksa izin akses.</td></tr>';
        });
    };

    // Function to display data for the current page
    const displayCurrentPageData = () => {
        dataWargaBody.innerHTML = ''; // Clear table

        if (filteredWargaData.length === 0) {
            const msg = searchInput.value ? `Nama "${searchInput.value}" tidak ditemukan.` : `Tidak ada data warga untuk tahun ${tahunRetribusi.value}.`;
            showNoDataMessage(msg);
            updatePaginationInfo();
            paginationControls.innerHTML = ''; // Clear pagination buttons
            dataWargaFooter.innerHTML = ''; // Clear footer
            
            // Kondisi mobile & data kosong (0 <= 10)
            if (footerActions) {
                if (window.innerWidth <= 767) {
                    footerActions.style.gap = '5px';
                } else {
                    footerActions.style.gap = '';
                }
            }
            return;
        }

        const startIndex = (currentPage - 1) * rowsPerPage;
        const endIndex = startIndex + rowsPerPage;
        const dataToDisplay = filteredWargaData.slice(startIndex, endIndex);

        dataToDisplay.forEach((data, index) => {
            renderRowToTable(data.id, data.nama, data.retribusi, startIndex + index + 1); // Pass actual row number
        });

        updatePaginationInfo();
        updatePaginationControls();
        renderTableFooter();

        // Pengondisian: Mobile dan data <= 10, set gap jadi 5px
        if (footerActions) {
            if (window.innerWidth <= 767 && filteredWargaData.length <= rowsPerPage) {
                footerActions.style.gap = '5px';
            } else {
                footerActions.style.gap = ''; // Kembalikan ke pengaturan CSS asli
            }
        }
    };

    // Fungsi untuk menghitung dan merender total per bulan di footer tabel
    const renderTableFooter = () => {
        const monthlyTotals = Array(12).fill(0);
        let grandTotal = 0;

        // Hitung total dari filteredWargaData (semua halaman yang terfilter)
        filteredWargaData.forEach(warga => {
            warga.retribusi.forEach((val, idx) => {
                const amount = Number(val) || 0;
                monthlyTotals[idx] += amount;
                grandTotal += amount;
            });
        });

        let monthsFooterHtml = "";
        monthlyTotals.forEach(total => {
            // Menampilkan dalam format ribuan (dibagi 1000 seperti di baris data)
            monthsFooterHtml += `<td>${total > 0 ? (total / 1000).toLocaleString('id-ID') : 0}</td>`;
        });

        dataWargaFooter.innerHTML = `
            <tr class="footer-total-row">
                <td colspan="2" class="text-right"><strong>TOTAL PER BULAN</strong></td>
                ${monthsFooterHtml}
                <td class="row-total"><strong>${grandTotal.toLocaleString('id-ID')}</strong></td>
                <td><i class="fas fa-coins"></i></td>
            </tr>
        `;
    };

    // Update pagination info text
    const updatePaginationInfo = () => {
        const totalItems = filteredWargaData.length;
        const startItem = Math.min(totalItems, (currentPage - 1) * rowsPerPage + 1);
        const endItem = Math.min(totalItems, currentPage * rowsPerPage);
        
        if (totalItems === 0) {
            paginationInfo.textContent = 'Menampilkan 0 dari 0 warga';
        } else {
            paginationInfo.textContent = `Menampilkan ${startItem} sampai ${endItem} warga`;
        }
    };

    // Generate pagination buttons
    const updatePaginationControls = () => {
        const totalPages = Math.ceil(filteredWargaData.length / rowsPerPage);
        paginationControls.innerHTML = '';

        if (totalPages <= 1) return;

        const btnPrev = document.createElement('button');
        btnPrev.innerHTML = '<i class="fas fa-chevron-left"></i>';
        btnPrev.disabled = currentPage === 1;
        btnPrev.onclick = () => { if (currentPage > 1) { currentPage--; displayCurrentPageData(); } };
        paginationControls.appendChild(btnPrev);

        for (let i = 1; i <= totalPages; i++) {
            const btnPage = document.createElement('button');
            btnPage.textContent = i;
            if (i === currentPage) btnPage.className = 'active';
            btnPage.onclick = () => { currentPage = i; displayCurrentPageData(); };
            paginationControls.appendChild(btnPage);
        }

        const btnNext = document.createElement('button');
        btnNext.innerHTML = '<i class="fas fa-chevron-right"></i>';
        btnNext.disabled = currentPage === totalPages;
        btnNext.onclick = () => { if (currentPage < totalPages) { currentPage++; displayCurrentPageData(); } };
        paginationControls.appendChild(btnNext);
    };

    const showNoDataMessage = (message) => {
        const noDataRow = document.createElement('tr');
        noDataRow.className = "empty-row-msg";
        noDataRow.innerHTML = `<td colspan="16" style="text-align: center; padding: 20px; color: #888;">${message}</td>`;
        dataWargaBody.appendChild(noDataRow);
    };

    // Dengarkan perubahan pada dropdown tahun
    if (tahunRetribusi) {
        tahunRetribusi.addEventListener('change', loadDataWarga);
    }

    // Fungsi pembantu untuk render baris ke tabel (agar bisa dipakai berulang)
    const renderRowToTable = (id, nama, retribusi, rowNumber) => {
        const tr = document.createElement('tr');
        tr.setAttribute('data-id', id);
        let monthsHtml = "";
        let total = 0;
        retribusi.forEach(value => {
            const val = Number(value) || 0;
            monthsHtml += `<td data-value="${val}">${val > 0 ? (val / 1000) : 0}</td>`;
            total += val;
        });
        tr.innerHTML = `
            <td class="no-cell">${rowNumber}</td>
            <td class="text-left nama-warga-cell">${nama}</td>
            ${monthsHtml}
            <td class="row-total" data-value="${total}">${(total || 0).toLocaleString('id-ID')}</td>
            <td><button class="btn-action btn-edit-warga" data-id="${id}"><i class="fas fa-edit"></i></button></td>
        `;
        dataWargaBody.appendChild(tr);
    };

    // Fungsi untuk mereset dan menyembunyikan modal
    const hideModal = () => {
        modal.style.display = 'none';
        formTambahWarga.reset();
        // Reset modal ke mode 'Tambah Warga'
        modalTitle.innerHTML = '<i class="fas fa-user-plus"></i> Tambah Warga Baru';
        modalSubmitBtn.textContent = 'Simpan Data';
        wargaIdInput.value = ''; // Kosongkan ID warga
        btnHapusWarga.style.display = 'none'; // Sembunyikan tombol hapus
        btnBatal.style.marginRight = 'auto'; // Memindahkan tombol Batal ke kiri khusus mode Tambah Warga
    };

    // Fungsi menampilkan popup sukses sejenak
    const showSuccessPopup = (title, message) => {
        successPopupTitle.textContent = title;
        successPopupMessage.textContent = message;
        actionSuccessPopup.style.display = 'flex';
        setTimeout(() => {
            actionSuccessPopup.style.display = 'none';
        }, 2000);
    };

    // Buka Modal
    if (btnTambahWarga) {
        btnTambahWarga.addEventListener('click', () => {
            hideModal(); // Pastikan modal bersih sebelum dibuka
            modal.style.display = 'flex';
        });
    }

    // Tutup Modal via tombol X atau Batal
    if (closeModal) closeModal.addEventListener('click', hideModal);
    if (btnBatal) btnBatal.addEventListener('click', hideModal);

    // Tutup jika klik di luar modal
    window.addEventListener('click', (e) => {
        if (e.target === modal) hideModal();
    });

    // Logika untuk tombol Edit di tabel
    if (dataWargaBody) {
        dataWargaBody.addEventListener('click', (e) => {
            if (e.target.closest('.btn-edit-warga')) {
                const editButton = e.target.closest('.btn-edit-warga');
                const wargaId = editButton.dataset.id; // Ambil ID warga dari data-id
                const row = editButton.closest('tr');
                const namaWarga = row.querySelector('.nama-warga-cell').textContent; // Ambil nama warga dari kolom

                // Ambil semua cell yang berisi angka retribusi (Jan - Des)
                const monthCells = row.querySelectorAll('td:not(:first-child):not(.text-left):not(.row-total):not(:last-child)');
                
                monthCells.forEach((cell, idx) => {
                    // Pastikan mengambil nilai asli dari data-value dan beri format ribuan untuk input
                    const fullVal = parseInt(cell.getAttribute('data-value')) || 0;
                    const inputEl = document.getElementById(`m${idx + 1}`);
                    if (inputEl) inputEl.value = fullVal > 0 ? fullVal.toLocaleString('id-ID') : '';
                });

                // Set modal ke mode 'Edit Warga'
                modalTitle.innerHTML = '<i class="fas fa-edit"></i> Edit Data Warga';
                modalSubmitBtn.textContent = 'Update Data';
                btnHapusWarga.style.display = 'inline-block'; // Tampilkan tombol hapus saat edit
                wargaIdInput.value = wargaId;
                namaWargaInput.value = namaWarga;
                btnBatal.style.marginRight = '0'; // Reset margin saat Edit agar Batal & Update tetap di sisi kanan
                modal.style.display = 'flex';
            }
        });
    }

    // Logika tombol Hapus Warga
    if (btnHapusWarga) {
        btnHapusWarga.addEventListener('click', () => {
            deleteConfirmMessage.textContent = `Apakah Anda yakin ingin menghapus data warga ini? Tindakan ini tidak dapat dibatalkan.`;
            deleteConfirmPopup.style.display = 'flex';
        });
    }

    if (btnBatalHapus) {
        btnBatalHapus.addEventListener('click', () => {
            deleteConfirmPopup.style.display = 'none';
        });
    }

    if (btnYaHapus) {
        btnYaHapus.addEventListener('click', async () => {
            const wargaId = wargaIdInput.value;
            const tahunTerpilih = tahunRetribusi.value;

            try {
                // Hapus dari Firestore
                await deleteDoc(doc(db, "warga_" + tahunTerpilih, wargaId));

                // Kita tidak perlu menghapus baris di DOM secara manual, 
                // onSnapshot akan mendeteksi dokumen terhapus dan merender ulang tabel.
                deleteConfirmPopup.style.display = 'none';
                hideModal();
                showSuccessPopup("Terhapus!", `Data warga telah dihapus`);
            } catch (e) {
                console.error("Error deleting: ", e);
                alert("Gagal menghapus data dari database.");
            }
        });
    }

    // Fungsi pembantu untuk menambah baris baru secara dinamis ke tabel
    const saveWargaToFirestore = async (nama, retribusi) => {
        const tahunTerpilih = tahunRetribusi.value;
        try {
            const docRef = await addDoc(collection(db, "warga_" + tahunTerpilih), {
                nama: nama,
                retribusi: retribusi,
                createdAt: new Date()
            });
            
            // onSnapshot akan menangani rendering baris baru secara otomatis
            showSuccessPopup("Berhasil!", `Data warga telah ditambahkan`);
            return true;
        } catch (e) {
            console.error("Error adding document: ", e);
            alert("Gagal menyimpan ke database.");
            return false;
        }
    };

    // Handle Form Submit (Placeholder)
    if (formTambahWarga) {
        formTambahWarga.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            // Cegah double submit
            modalSubmitBtn.disabled = true;
            const originalBtnText = modalSubmitBtn.textContent;
            modalSubmitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Memproses...';

            const nama = namaWargaInput.value.trim();
            const wargaId = wargaIdInput.value;
            
            let isSuccess = false;

            if (!nama) {
                alert("Nama warga tidak boleh kosong atau hanya berisi spasi!");
                modalSubmitBtn.disabled = false;
                modalSubmitBtn.textContent = originalBtnText;
                return;
            }

            // Cek duplikasi nama (case-insensitive)
            // Jika mode edit (wargaId ada), kita abaikan dokumen yang sedang diedit itu sendiri
            const namaLower = nama.toLowerCase();
            const isDuplicate = allWargaData.some(w => 
                w.nama.toLowerCase() === namaLower && w.id !== wargaId
            );

            if (isDuplicate) {
                alert(`Peringatan: Warga dengan nama "${nama}" sudah terdaftar di tahun ini.`);
                modalSubmitBtn.disabled = false;
                modalSubmitBtn.textContent = originalBtnText;
                return;
            }

            // Ambil data retribusi dari 12 input bulan di modal
            const retribusi = [];
            for (let i = 1; i <= 12; i++) {
                const rawValue = document.getElementById(`m${i}`).value.replace(/\./g, '');
                retribusi.push(parseInt(rawValue) || 0);
            }

            if (wargaId) {
                // Mode Edit
                const tahunTerpilih = tahunRetribusi.value;
                try {
                    // Update ke Firestore
                    await updateDoc(doc(db, "warga_" + tahunTerpilih, wargaId), {
                        nama: nama,
                        retribusi: retribusi
                    });

                    showSuccessPopup("Berhasil!", `Data warga telah diperbarui`);
                    isSuccess = true;
                } catch (err) {
                    console.error(err);
                    alert("Gagal mengupdate data. Periksa koneksi internet Anda.");
                } finally {
                    modalSubmitBtn.disabled = false;
                    modalSubmitBtn.textContent = originalBtnText;
                    if (isSuccess) hideModal();
                }
            } else {
                // Mode Tambah Baru
                isSuccess = await saveWargaToFirestore(nama, retribusi);
                modalSubmitBtn.disabled = false;
                modalSubmitBtn.textContent = originalBtnText;
                if (isSuccess) hideModal();
            }
        });
    }

    // Logika Pencarian Warga
    if (searchInput) {
        const handleSearch = (e) => {
            const filter = searchInput.value.toLowerCase();
            
            // Filter data array based on search input
            filteredWargaData = allWargaData.filter(warga => {
                return warga.nama.toLowerCase().includes(filter);
            });

            currentPage = 1; // Reset to first page on search
            displayCurrentPageData();
        };
        
        // Menggunakan debounce agar pencarian tidak dijalankan terlalu sering saat mengetik
        searchInput.addEventListener('input', debounce(handleSearch, 500));
    }

    // Formatting real-time agar input menampilkan titik ribuan (Contoh: 20.000)
    document.querySelectorAll('.month-input').forEach(input => {
        input.addEventListener('input', (e) => {
            // Hapus semua karakter kecuali angka
            let value = e.target.value.replace(/\D/g, "");
            
            if (value) {
                // Format angka dengan locale Indonesia (titik sebagai pemisah ribuan)
                e.target.value = parseInt(value).toLocaleString('id-ID');
            } else {
                e.target.value = '';
            }
        });
    });

    // Logika untuk tombol Export Excel
    if (btnExportExcel) {
        btnExportExcel.addEventListener('click', () => {
            // Menggunakan filteredWargaData agar hasil export sesuai dengan pencarian yang sedang aktif
            const dataToExport = filteredWargaData.length > 0 ? filteredWargaData : allWargaData;

            if (dataToExport.length === 0) {
                alert("Tidak ada data untuk diexport.");
                return;
            }

            // --- ANIMASI BUTTON NIAT ---
            btnExportExcel.classList.add('btn-loading');
            btnExportExcel.disabled = true;

            // Buat elemen persentase dan garis progres secara dinamis
            const percentWrapper = document.createElement('div');
            percentWrapper.className = 'btn-percentage-wrapper';
            percentWrapper.innerHTML = '<span id="dynamicPercent">0</span>%';
            
            const progressLine = document.createElement('div');
            progressLine.className = 'btn-progress-line';
            
            btnExportExcel.appendChild(percentWrapper);
            btnExportExcel.appendChild(progressLine);

            const percentSpan = document.getElementById('dynamicPercent');
            const progressObj = { value: 0 };
            
            const tl = gsap.timeline();

            // 1. Munculkan angka dari bawah ke tengah
            tl.to(percentWrapper, { bottom: "30%", duration: 0.4, ease: "back.out(1.7)" });

            // 2. Jalankan progres angka dan garis secara sinkron
            tl.to(progressObj, {
                value: 100,
                duration: 2.0,
                ease: "power2.inOut",
                onUpdate: () => {
                    const val = Math.floor(progressObj.value);
                    percentSpan.innerText = val;
                    progressLine.style.width = val + "%";
                },
                onComplete: () => {
                    processExcelDownload();
                }
            }, "-=0.2");

            function processExcelDownload() {
                const tahunTerpilih = tahunRetribusi.value;
                const fileName = `Data Retribusi Warga ${tahunTerpilih}${searchInput.value ? '_Filtered' : ''}.xlsx`;

                const dataForExcel = dataToExport.map((warga, index) => {
                    const row = { 'No': index + 1, 'Nama Warga': warga.nama };
                    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
                    let totalRetribusi = 0;
                    months.forEach((month, i) => {
                        const value = warga.retribusi[i] || 0;
                        row[month] = value;
                        totalRetribusi += value;
                    });
                    row['Total'] = totalRetribusi;
                    return row;
                });

            // Create a new workbook
            const wb = XLSX.utils.book_new();
            // Convert JSON data to worksheet
            const ws = XLSX.utils.json_to_sheet(dataForExcel);
            // Add worksheet to workbook
            XLSX.utils.book_append_sheet(wb, ws, "Data Retribusi");
            // Write and download the Excel file
            XLSX.writeFile(wb, fileName);
            
                // 3. Animasi Selesai (Angka meluncur ke atas dan hilang)
                gsap.to(percentWrapper, { 
                    bottom: "120%", 
                    opacity: 0, 
                    duration: 0.4, 
                    ease: "power2.in",
                    onComplete: () => {
                        btnExportExcel.classList.remove('btn-loading');
                        btnExportExcel.disabled = false;
                        percentWrapper.remove();
                        progressLine.remove();
                        showSuccessPopup("Ekspor Berhasil!", "File Excel telah tersimpan.");
                    }
                });
            }
        });
    }

    logoutBtn.addEventListener('click', () => {
        signOut(auth).then(() => { window.location.href = "index.html"; });
    });
}

// --- SISTEM KEAMANAN ANTI-INSPECT (SUPER KETAT) ---
(function() {
    // 1. Mematikan Klik Kanan
    document.addEventListener('contextmenu', e => e.preventDefault());

    // 2. Mematikan Shortcut Keyboard (F12, Ctrl+Shift+I, J, C, U)
    document.addEventListener('keydown', (e) => {
        if (
            e.key === "F12" ||
            (e.ctrlKey && e.shiftKey && (e.key === "I" || e.key === "J" || e.key === "C")) ||
            (e.ctrlKey && e.key === "u")
        ) {
            e.preventDefault();
            return false;
        }
    });

    // 3. Debugger Trap (Membekukan browser jika DevTools terbuka)
    const dynamicDebugger = function() {
        try {
            (function () {
                (function a() {
                    try {
                        (function b(i) {
                            if (("" + i / i).length !== 1 || i % 20 === 0) {
                                (function () { }).constructor("debugger")();
                            } else {
                                debugger;
                            }
                            b(++i);
                        })(0);
                    } catch (e) {
                        setTimeout(a, 1000);
                    }
                })();
            })();
        } catch (e) {}
    };

    // Jalankan trap secara berkala
    setInterval(dynamicDebugger, 2000);

    // 4. Deteksi DevTools melalui ambang batas ukuran jendela
    const checkDevTools = () => {
        const threshold = 160;
        if (
            window.outerWidth - window.innerWidth > threshold ||
            window.outerHeight - window.innerHeight > threshold
        ) {
            // Jika terdeteksi, kita bisa mengosongkan halaman atau redirect
            document.body.innerHTML = "<h1 style='text-align:center; margin-top:20%; color:red;'>Akses Ditolak: Developer Tools Terdeteksi!</h1>";
            window.location.reload();
        }
    };
    window.addEventListener('resize', debounce(checkDevTools, 500));

    // 5. Anti-Console Manipulation
    setInterval(() => {
        console.clear();
        console.log("%cPERINGATAN!", "color: red; font-size: 30px; font-weight: bold;");
        console.log("%cArea ini dilarang bagi pengguna. Segala aktivitas dicatat.", "font-size: 16px;");
    }, 1000);
})();