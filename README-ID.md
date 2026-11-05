# BIRO UMUM CONNECT — Starter MVP

Aplikasi web responsif/PWA yang dapat dikemas menjadi APK Android. Stack: React + Vite + Supabase + Capacitor.

## Yang sudah disiapkan
- Halaman login email/password melalui Supabase Auth.
- Daftar percakapan berdasarkan keanggotaan pengguna.
- Chat realtime melalui Supabase Realtime.
- Emoji dasar melalui tombol emoji.
- Unggah lampiran gambar dan dokumen ke Storage privat.
- Grup percakapan melalui RPC.
- Tampilan responsif desktop dan Android.
- Konfigurasi awal PWA dan Capacitor.

## Penting
Ini adalah starter implementasi, bukan sistem produksi yang sudah terpasang. Backend belum dibuat dan belum ada akun. Gunakan data dummy untuk uji coba. Jangan masukkan data kedinasan sungguhan sebelum persetujuan pengelola TI instansi dan pemeriksaan keamanan.

## 1. Siapkan Supabase
1. Buat proyek baru di Supabase.
2. Pilih region terdekat yang tersedia (misalnya Singapore bila tersedia pada saat pembuatan).
3. Buka SQL Editor dan jalankan seluruh isi `supabase/schema.sql`.
4. Di Authentication, buat akun uji coba melalui dashboard (email + password).
5. Tambahkan profil pengguna pada tabel `profiles` dengan `id` sama dengan UUID user dari Authentication, `full_name`, `email`, dan `role='admin'` untuk akun admin uji coba.
6. Buat bucket Storage bernama `chat-files`, set sebagai **Private**.
7. Tambahkan kebijakan Storage SELECT dan INSERT seperti komentar di bagian akhir `schema.sql`, menggunakan SQL berikut:

```sql
create policy "conversation members read chat files"
on storage.objects for select to authenticated
using (
  bucket_id = 'chat-files'
  and (storage.foldername(name))[1] in (
    select conversation_id::text from public.conversation_members where user_id=auth.uid()
  )
);

create policy "conversation members upload chat files"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'chat-files'
  and (storage.foldername(name))[1] in (
    select conversation_id::text from public.conversation_members where user_id=auth.uid()
  )
);
```

8. Tambahkan akun uji coba ke grup dengan membuat grup melalui aplikasi. Akun admin dapat mengundang akun uji coba lain setelah dibuat.

## 2. Jalankan di komputer pengembangan
Buat file `.env` berdasarkan `.env.example`, lalu isi URL dan publishable/anon key dari Project Settings > API.
Jangan pernah memasukkan `service_role` key ke frontend.

```bash
npm install
npm run dev
```

## 3. Build website
```bash
npm run build
```
Folder hasilnya `dist/`. Deploy ke hosting statis yang disetujui instansi, misalnya Netlify atau layanan hosting internal. Isi environment variables `VITE_SUPABASE_URL` dan `VITE_SUPABASE_ANON_KEY` pada pengaturan hosting.

## 4. Build APK Android
```bash
npm install
npm run build
npx cap add android
npx cap sync android
cd android
./gradlew assembleDebug
```
APK debug akan berada di `android/app/build/outputs/apk/debug/app-debug.apk`.

## 5. Perhatian untuk versi produksi
- Lengkapi validasi keanggotaan, kebijakan Storage, pembatasan ukuran/jenis file, rate limit, moderasi dan audit log.
- Tambahkan status terkirim/dibaca yang benar, push notification Android, pencarian pesan, manajemen anggota grup, dan direct message.
- Terapkan backup, retensi, penghapusan akun, pemulihan, monitoring, dan uji beban.
- Lakukan penilaian keamanan dan persetujuan pengelola TI instansi sebelum penggunaan resmi.
- Supabase Realtime memberi pengiriman event cepat, tetapi kecepatan nyata bergantung pada jaringan, region server, ukuran file, dan konfigurasi.
