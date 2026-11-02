# Sesli Sohbet

3-6 kişilik, tarayıcıdan çalışan sesli sohbet. Ses cihazlar arasında doğrudan akar,
sunucu sadece birbirinizi bulmanızı sağlar. Hiçbir paket kurmak gerekmez.

## 1) Bilgisayarında dene (isteğe bağlı)
1. Node.js 18 veya üstünü kur: https://nodejs.org
2. Bu klasörde terminal aç ve çalıştır:  node server.js
3. Tarayıcıda http://localhost:3000 adresini aç (localhost'ta mikrofon https olmadan da çalışır).

## 2) Arkadaşlarla kullanmak için internete aç (Render, ücretsiz)
1. https://github.com adresinde ücretsiz hesap aç, "New repository" ile yeni bir depo oluştur.
2. "uploading an existing file" bağlantısıyla bu klasördeki dosyaları (server.js, index.html, package.json) yükle ve "Commit" de.
3. https://render.com adresinde GitHub hesabınla giriş yap.
4. "New +" > "Web Service" > GitHub deposunu seç.
5. Ayarlar: Runtime: Node, Build Command: boş bırak (veya "npm install"), Start Command: node server.js, Instance Type: Free.
6. "Create Web Service" de. 1-2 dakika sonra https://ADIN.onrender.com gibi bir adres verir.
7. Bu adresi arkadaşlarına gönder. Herkes adını ve AYNI oda adını yazıp "Katıl"a basar.

Notlar:
- Ücretsiz planda sunucu bir süre kullanılmazsa uyur; ilk açılış 30-60 saniye sürebilir.
- Oda adı bir şifre gibidir. Tahmin edilmesi zor bir ad seç (örn. ustalar-4821).
- Bir odada en fazla 6 kişi olabilir (server.js içinde MAX_PER_ROOM).
- Arkadaşlar kulaklık kullanırsa yankı olmaz.

## Ses efektleri (ses tahtası)
Sohbet sırasında sağdaki kırmızı butonlar ses efekti çalar. 8 yer vardır.
- Boş yerdeki "+" işaretine bas, bilgisayarından bir mp3 ya da wav seç (en fazla 2 MB). Odadaki herkes görür.
- Kırmızı butona basınca ses odadaki herkesin cihazında çalar. Altında sesin adı yazar.
- Sağ üstteki × işareti sesi odadaki herkes için siler.
- "Efekt sesi" çubuğu sadece kendi cihazında sesi ayarlar.
- Sesler sunucunun belleğinde tutulur. Oda boşaldıktan 10 dakika sonra ya da sunucu yeniden başlayınca (Render uyanınca) silinir, tekrar yüklemek gerekir.
- Kulaklık kullanmayanlarda efekt sesi mikrofona karışıp yankı yapabilir.
- Sınırları server.js'in en üstünden değiştirebilirsin (SLOTS, MAX_SOUND, MAX_TOTAL).

## Giriş ve çıkış sesleri
Biri odaya girince `sesler/giris.mp3`, odadan çıkınca `sesler/cikis.mp3` odadaki DİĞER herkeste çalar
(giren ya da çıkan kişi kendi sesini duymaz). Odayı kimse ayarlamaz, bu sesler hep açıktır.
- Sesleri değiştirmek için `sesler` klasöründeki dosyaları AYNI İSİMLERLE (giris.mp3, cikis.mp3) değiştir.
  GitHub'da yeni dosyaları yükleyince Render kendisi yeniden yayınlar.
- Dosya yoksa o ses çalmaz, sunucu bir uyarı yazar ama çalışmaya devam eder.
- Kısa kopmalarda (3 saniyeden az) ve sayfa yenilemede çalmaz.
- Bir kişinin kendi cihazında kısmak için "Efekt sesi" çubuğunu kullanabilir.

## 3) Bazı kişiler birbirini duyamıyorsa (isteğe bağlı TURN)
Çok kısıtlı ağlarda (okul, ofis, bazı mobil operatörler) doğrudan bağlantı kurulamayabilir.
Bir TURN servisine (örn. ücretsiz katmanı olan Metered veya Open Relay) kayıt olup
Render'da "Environment" bölümüne şu değişkenleri ekle:
  TURN_URL  = turn:sunucu-adresi:80   (birden fazlaysa virgülle ayır)
  TURN_USER = kullanici
  TURN_PASS = sifre
Sunucuyu yeniden başlat. Başka bir şey değiştirmen gerekmez.
