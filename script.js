import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.1/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.1/firebase-auth.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/10.12.1/firebase-analytics.js";

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
const analytics = getAnalytics(app);
const auth = getAuth(app);

let isLoggingIn = false;

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

    const clearError = () => { if (errorMessage.style.display === "block") errorMessage.style.display = "none"; };
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
        loginBtn.textContent = "Loading...";
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

    onAuthStateChanged(auth, (user) => {
        if (user) {
            document.body.style.display = "block";
            welcomeText.textContent = "Halo, " + user.email + "!";
        } else {
            window.location.href = "index.html";
        }
    });

    logoutBtn.addEventListener('click', () => {
        signOut(auth).then(() => { window.location.href = "index.html"; });
    });
}