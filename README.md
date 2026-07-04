# 🎵 Music Vault (MusShare)

Music Vault adalah aplikasi **Decentralized Music Sharing & Streaming** berbasis arsitektur *Client-Server (Master-Slave)* yang mengusung antarmuka bergaya modern *Neumorphism/Glassmorphism*. Project ini mensimulasikan lingkungan ekosistem **Peer-to-Peer (P2P)** di mana setiap *node* (pengguna) dapat saling membagikan, mencari, dan melakukan *streaming* file audio secara langsung tanpa perlu proses instalasi database yang rumit.

## ✨ Fitur Utama

- **No-Login Ownership System:** Identitas pengguna dikelola menggunakan `Node-ID` unik yang dibuat secara otomatis melalui `localStorage` di browser, sehingga tidak memerlukan database relasional untuk sistem *login*.
- **Live Audio Streaming:** Mendukung *HTTP 206 Partial Content*. Pengguna dapat melompati (seek/skip) menit ke berapapun dalam lagu tanpa harus mengunduh file secara utuh (anti-buffering).
- **Audio Visualizer:** Animasi grafik frekuensi suara *real-time* yang digambar langsung di atas elemen `<canvas>` menggunakan Web Audio API.
- **Secure File Deletion:** File musik Anda tidak bisa dihapus oleh orang lain. Java Server akan memverifikasi kepemilikan file dengan mencocokkan *Header X-Node-Id* pengirim dengan isi file metadata `.owner` yang tersimpan di server.
- **Network Telemetry:** Statistik lalu lintas secara *real-time* yang menampilkan latensi (*ping*), total peer yang aktif, dan total lagu unik yang tersedia di jaringan secara keseluruhan.

## 💻 Tech Stack
Project ini dibangun khusus dengan teknologi fundamental yang sangat ringan:
- **Frontend:** Vanilla HTML5, CSS3 (Flexbox/Grid), dan murni Vanilla JavaScript (Tanpa Framework seperti React/Vue).
- **Backend:** Murni Java Standard Edition menggunakan `com.sun.net.httpserver.HttpServer` (Tanpa Spring Boot atau framework tambahan).
- **Database:** *In-Memory Indexing* menggunakan `ConcurrentHashMap` dan sistem penyimpanan *File-based* untuk performa maksimal.

---

## 🚀 Cara Menjalankan Project Secara Lokal

Untuk menjalankan project ini, Anda harus menjalankan Backend (Server Java) dan Frontend (Web Server) secara terpisah.

### 1. Menjalankan Backend (Server Java)
Server Java berfungsi sebagai jantung aplikasi yang bertugas menyimpan file mp3, menyimpan indeks, serta melayani lalu lintas streaming. Pastikan [Java JDK](https://www.oracle.com/java/technologies/downloads/) sudah terinstal di komputer Anda.

1. Buka Terminal / Command Prompt.
2. Masuk ke direktori project ini.
3. Lakukan kompilasi dan jalankan servernya:
   ```bash
   javac IndexingServer.java
   java IndexingServer
   ```
4. Server Java akan berjalan di port `8081`. 

### 2. Menjalankan Frontend (Tampilan Web)
1. Buka Terminal / Command Prompt baru (biarkan terminal Java tetap menyala).
2. Masuk ke direktori project ini.
3. Jalankan server HTTP lokal (disarankan menggunakan Python):
   ```bash
   python3 -m http.server 8001
   ```
4. Buka browser Anda dan akses: 👉 **http://localhost:8001**

---

## 📂 Struktur Direktori

```text
musshare/
├── IndexingServer.java    # Kode sumber (Source Code) utama untuk Server Java
├── index.html             # Halaman antarmuka utama (UI)
├── css/
│   ├── core.css           # Styling dasar & variabel warna
│   ├── ui.css             # Desain komponen Neumorphism/Glassmorphism
│   └── upload.css         # Styling khusus halaman library dan animasi upload
├── js/
│   ├── core.js            # Logika P2P Node, Network Stats, dan Visualizer
│   ├── search.js          # Mesin pencari dan relasi node indexing
│   ├── upload.js          # Logika upload multipart, file library, & fitur hapus
│   └── playlist.js        # Modul penyusunan koleksi lagu
├── uploads/               # Direktori fisik tempat lagu (.mp3) dan metadata kepemilikan (.owner) disimpan
└── playlists.dat          # Basis data file-based untuk menyimpan struktur playlist
```

## ⚠️ Catatan Penting Terkait Vercel / Cloud Deployment
Project ini dirancang dengan interaksi langsung terhadap Java Raw Socket. **Anda tidak dapat mengeksekusi (deploy) `IndexingServer.java` di Vercel**, karena Vercel hanya mendukung fungsi serverless dan hosting *Static Sites*.

Jika Anda mengunggah frontend project ini ke Vercel:
Aplikasi web (GUI) akan muncul dengan baik, namun akan mengalami `Disconnected / Failed to Fetch`. Ini terjadi karena web yang sudah ter-deploy di Vercel secara otomatis mencari backend di alamat HTTPS, sedangkan backend Java Anda masih terkunci di `http://localhost:8081` lokal laptop Anda.

**Solusinya:** Gunakan *Tunneling Software* seperti **Ngrok** untuk mengekspos port 8081 Anda ke publik menjadi URL HTTPS, lalu ganti kode `BACKEND_URL` di dalam `js/core.js` dengan URL dari Ngrok tersebut. Atau gunakan layanan hosting VM/VPS konvensional untuk Server Java Anda.
