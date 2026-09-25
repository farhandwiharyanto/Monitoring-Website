# Status page publik

Membuat halaman status, menulis kabar incident, dan memasang custom domain.

[← Kembali ke README](../README.md)

## Membuat status page

Buat dari menu **Status Pages**. Monitor bisa dipilih dua cara dan keduanya digabung:

- **Lewat tag/group** — semua monitor bertag itu ikut tampil, termasuk yang ditambahkan nanti.
- **Satu per satu** — tampil lebih dulu, sesuai urutan pilihannya.

Halaman diakses tanpa login lewat `/status/<slug>` atau lewat custom domain.

### Yang TIDAK ikut tampil ke publik

Payload publik sengaja dibatasi. URL asli, hostname, port, konfigurasi check (interval,
timeout, expected status code, keyword, assertion), kredensial, push token, pesan heartbeat,
dan penyebab teknis incident **tidak** disertakan. Yang tampil hanya nama monitor, tipe,
status, uptime, heartbeat bar, waktu incident, dan kabar yang ditulis admin.

### Incident update

Selama gangguan, admin bisa menulis kabar dari halaman detail monitor (tombol **Tulis kabar**
pada baris incident). Tersedia empat status: *Sedang diperiksa*, *Penyebab ditemukan*,
*Sedang dipantau*, dan *Sudah teratasi*.

Kabar ini murni untuk komunikasi — status incident sendiri tetap ditentukan heartbeat, jadi
menulis "Sudah teratasi" tidak menutup incident bila monitornya masih down.

Lewat API:

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"status":"investigating","message":"Tim sedang investigasi, perkiraan pulih 30 menit"}' \
  https://pulsewatch.contoh.com/api/incidents/12/updates
```

## Berlangganan lewat feed

Tiap status page yang menampilkan incident menyediakan feed Atom:

```
/api/public/status/<slug>/feed.xml
```

Tautannya juga dipasang di `<head>` halaman, sehingga pembaca feed dan browser
menemukannya sendiri dari alamat halaman biasa, dan muncul sebagai tautan di
kaki halaman. Isinya incident 90 hari terakhir (maksimal 50) beserta kabar yang
ditulis admin selama gangguan berlangsung; maintenance tidak ikut.

Halaman yang menyembunyikan incident tidak menyediakan feed. Id tiap entri tidak
berubah saat incident ditutup, jadi pelanggan tidak mendapat notifikasi kedua
untuk gangguan yang sama.

## Custom domain untuk status page

Isi field *Custom domain* pada status page, lalu arahkan domain itu ke Pulsewatch. Saat
domain dibuka di root (`/`), Pulsewatch mencocokkan host dengan status page dan langsung
menampilkannya.

**Set `TRUST_PROXY=true`** bila Pulsewatch berada di belakang reverse proxy. Tanpa itu,
header `X-Forwarded-Host` sengaja diabaikan supaya tidak bisa dipalsukan klien yang menembak
Pulsewatch langsung.

### nginx

```nginx
server {
    listen 443 ssl http2;
    server_name status.contoh.com;

    ssl_certificate     /etc/letsencrypt/live/status.contoh.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/status.contoh.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3001;

        # Host asli inilah yang dipakai Pulsewatch memilih status page
        proxy_set_header Host              $host;
        proxy_set_header X-Forwarded-Host  $host;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Socket.io butuh upgrade websocket agar status page ikut realtime
        proxy_http_version 1.1;
        proxy_set_header Upgrade    $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

### Traefik (label docker-compose)

```yaml
services:
  pulsewatch:
    labels:
      - "traefik.enable=true"
      # Dashboard admin
      - "traefik.http.routers.pulsewatch.rule=Host(`pulsewatch.contoh.com`)"
      - "traefik.http.routers.pulsewatch.entrypoints=websecure"
      - "traefik.http.routers.pulsewatch.tls.certresolver=letsencrypt"
      # Status page publik di domain sendiri, diarahkan ke service yang sama
      - "traefik.http.routers.pulsewatch-status.rule=Host(`status.contoh.com`)"
      - "traefik.http.routers.pulsewatch-status.entrypoints=websecure"
      - "traefik.http.routers.pulsewatch-status.tls.certresolver=letsencrypt"
      - "traefik.http.services.pulsewatch.loadbalancer.server.port=3001"
```

Traefik meneruskan `X-Forwarded-Host` secara bawaan, jadi cukup pastikan `TRUST_PROXY=true`
di environment Pulsewatch.

### DNS

Arahkan `status.contoh.com` ke server yang sama — `CNAME` ke host Pulsewatch, atau `A`/`AAAA`
ke IP-nya. Satu domain hanya boleh dipakai satu status page; domain yang sudah terpakai
ditolak saat disimpan.

Memastikan pemetaannya benar:

```bash
curl -H "X-Forwarded-Host: status.contoh.com" \
  https://pulsewatch.contoh.com/api/public/status/resolve
# {"slug":"internal-platform"}
```
