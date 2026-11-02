// Sesli Sohbet - sinyal sunucusu + ses tahtası. Hiçbir paket gerektirmez (npm install gerekmez).
// Ses sunucudan geçmez; sunucu sadece cihazların birbirini bulmasını sağlar.
// Ses tahtasındaki efekt dosyaları odaya özel olarak sunucunun belleğinde tutulur.
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const MAX_PER_ROOM = 6;

// --- Ses tahtası ayarları ---
const SLOTS = 8;                          // odadaki ses yeri sayısı
const MAX_SOUND = 2 * 1024 * 1024;        // tek dosya sınırı: 2 MB
const MAX_TOTAL = 150 * 1024 * 1024;      // sunucudaki toplam ses sınırı
const KEEP_EMPTY_MS = 10 * 60 * 1000;     // oda boşalınca sesler bu kadar süre saklanır

const rooms = new Map();   // oda -> Map(id -> {res, name, lastPlay})
const boards = new Map();  // oda -> {slots: [ {name, mime, buf, v} | null ], timer}
let totalBytes = 0, soundSeq = 0;
// --- Sabit giriş / çıkış sesleri: sesler/giris.mp3 ve sesler/cikis.mp3 ---
const cueData = {}; // tür -> {buf, v}
[["join", "giris.mp3"], ["leave", "cikis.mp3"]].forEach(([kind, file]) => {
  try {
    const buf = fs.readFileSync(path.join(__dirname, "sesler", file));
    cueData[kind] = { buf, v: require("crypto").createHash("md5").update(buf).digest("hex").slice(0, 8) };
  } catch (e) {
    console.log("Uyarı: sesler/" + file + " bulunamadı, " + (kind === "join" ? "giriş" : "çıkış") + " sesi çalmayacak.");
  }
});
const pendingLeave = new Map(); // "oda:id" -> zamanlayıcı (kısa kopmalarda çıkış sesi çalmasın diye)
const LEAVE_DELAY_MS = 3000;

const cleanKey = (s, n) => String(s || "").toLowerCase().replace(/[^a-z0-9_.-]/g, "").slice(0, n);
const cleanName = (s) => String(s || "").replace(/[<>&"]/g, "").trim().slice(0, 20) || "Misafir";
const cleanSound = (s) => String(s || "").replace(/[\u0000-\u001f<>&"]/g, "").trim().slice(0, 24) || "Ses";

function sse(res, event, data) {
  res.write("event: " + event + "\ndata: " + JSON.stringify(data) + "\n\n");
}
function broadcast(room, event, data) {
  const m = rooms.get(room);
  if (m) m.forEach((c) => sse(c.res, event, data));
}
const isMember = (room, id) => { const m = rooms.get(room); return !!(m && m.has(id)); };

function getBoard(room) {
  let b = boards.get(room);
  if (!b) { b = { slots: new Array(SLOTS).fill(null), timer: null }; boards.set(room, b); }
  return b;
}
function boardMeta(room) {
  const b = boards.get(room);
  return Array.from({ length: SLOTS }, (_, i) => (b && b.slots[i] ? { name: b.slots[i].name, v: b.slots[i].v } : null));
}
function cuesOf() {
  return { join: cueData.join ? cueData.join.v : null, leave: cueData.leave ? cueData.leave.v : null };
}
function sendBoard(room) {
  broadcast(room, "board", { board: boardMeta(room) });
}
// Giriş / çıkış sesi: odadaki diğer herkese çalınır (olayı yaşayan kişiye değil)
function cue(room, kind, whoId, whoName) {
  const m = rooms.get(room);
  if (!cueData[kind] || !m) return;
  m.forEach((c, mid) => {
    if (mid !== whoId) sse(c.res, "play", { name: whoName, cue: kind });
  });
}
function dropBoard(room) {
  const b = boards.get(room);
  if (!b) return;
  b.slots.forEach((s) => { if (s) totalBytes -= s.buf.length; });
  clearTimeout(b.timer);
  boards.delete(room);
}

// Dosyanın gerçekten mp3 / wav olup olmadığını ilk baytlarından kontrol et
function normMime(h) {
  const t = String(h || "").split(";")[0].trim().toLowerCase();
  if (t === "audio/wav" || t === "audio/x-wav" || t === "audio/wave") return "audio/wav";
  if (t === "audio/mpeg" || t === "audio/mp3") return "audio/mpeg";
  return null;
}
function sniff(buf, mime) {
  if (buf.length < 12) return false;
  const wav = buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WAVE";
  const mp3 = buf.toString("ascii", 0, 3) === "ID3" || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0);
  return mime === "audio/wav" ? wav : mp3;
}

function iceServers() {
  const list = [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }];
  if (process.env.TURN_URL) {
    list.push({
      urls: process.env.TURN_URL.split(","),
      username: process.env.TURN_USER || "",
      credential: process.env.TURN_PASS || "",
    });
  }
  return list;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  const P = url.pathname;

  if (req.method === "GET" && (P === "/" || P === "/index.html")) {
    fs.readFile(path.join(__dirname, "index.html"), (err, buf) => {
      if (err) { res.writeHead(500); return res.end("index.html bulunamadı"); }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" });
      res.end(buf);
    });
    return;
  }

  if (req.method === "GET" && P === "/config") {
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    return res.end(JSON.stringify({ iceServers: iceServers() }));
  }

  if (req.method === "GET" && P === "/events") {
    const room = cleanKey(url.searchParams.get("room"), 40);
    const id = cleanKey(url.searchParams.get("id"), 24);
    const name = cleanName(url.searchParams.get("name"));
    if (!room || !id) { res.writeHead(400); return res.end("room ve id gerekli"); }

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    if (!rooms.has(room)) rooms.set(room, new Map());
    const members = rooms.get(room);

    // Aynı id yeniden bağlanıyorsa eskisini kapat
    const old = members.get(id);
    if (old) { try { old.res.end(); } catch (e) {} members.delete(id); }

    if (members.size >= MAX_PER_ROOM) {
      sse(res, "full", { max: MAX_PER_ROOM });
      return res.end();
    }

    // Oda tekrar doluyorsa ses silme zamanlayıcısını iptal et
    const bd = boards.get(room);
    if (bd && bd.timer) { clearTimeout(bd.timer); bd.timer = null; }

    const others = [];
    members.forEach((m, mid) => others.push({ id: mid, name: m.name }));
    sse(res, "init", { peers: others, board: boardMeta(room), cues: cuesOf() });
    members.forEach((m) => sse(m.res, "join", { id, name }));
    members.set(id, { res, name, lastPlay: 0 });

    // Kısa süre önce çıkıp dönen kişi (sayfa yenileme, kopma) için giriş sesi çalma
    const pkey = room + ":" + id;
    const pend = pendingLeave.get(pkey);
    if (pend) { clearTimeout(pend); pendingLeave.delete(pkey); }
    else if (!old) cue(room, "join", id, name);

    const ka = setInterval(() => res.write(": ping\n\n"), 20000);
    req.on("close", () => {
      clearInterval(ka);
      const cur = rooms.get(room);
      if (cur && cur.get(id) && cur.get(id).res === res) {
        cur.delete(id);
        cur.forEach((m) => sse(m.res, "leave", { id }));
        const lk = room + ":" + id;
        clearTimeout(pendingLeave.get(lk));
        pendingLeave.set(lk, setTimeout(() => { pendingLeave.delete(lk); cue(room, "leave", id, name); }, LEAVE_DELAY_MS));
        if (cur.size === 0) {
          rooms.delete(room);
          const b = boards.get(room);
          if (b) {
            clearTimeout(b.timer);
            b.timer = setTimeout(() => { if (!rooms.has(room)) dropBoard(room); }, KEEP_EMPTY_MS);
            b.timer.unref();
          }
        }
      }
    });
    return;
  }

  if (req.method === "POST" && P === "/signal") {
    const room = cleanKey(url.searchParams.get("room"), 40);
    const from = cleanKey(url.searchParams.get("id"), 24);
    let body = "";
    req.on("data", (c) => { body += c; if (body.length > 16384) req.destroy(); });
    req.on("end", () => {
      try {
        const msg = JSON.parse(body);
        const to = cleanKey(msg.to, 24);
        const members = rooms.get(room);
        const target = members && members.get(to);
        if (members && members.has(from) && target) sse(target.res, "signal", { from, data: msg.data });
        res.writeHead(204); res.end();
      } catch (e) { res.writeHead(400); res.end(); }
    });
    return;
  }

  // ---------- Ses tahtası ----------
  if (P.startsWith("/sound/")) {
    const room = cleanKey(url.searchParams.get("room"), 40);
    const id = cleanKey(url.searchParams.get("id"), 24);
    const slot = parseInt(url.searchParams.get("slot"), 10);
    const slotOk = slot >= 0 && slot < SLOTS;

    // Ses dosyasını indir (oda adını bilen herkes)
    if (req.method === "GET" && P === "/sound/file") {
      const b = boards.get(room);
      const s = slotOk && b && b.slots[slot];
      if (!s || String(s.v) !== url.searchParams.get("v")) { res.writeHead(404); return res.end(); }
      res.writeHead(200, {
        "Content-Type": s.mime,
        "Content-Length": s.buf.length,
        "Cache-Control": "private, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
      });
      return res.end(s.buf);
    }

    if (req.method === "POST" && P === "/sound/upload") {
      const mime = normMime(req.headers["content-type"]);
      const declared = parseInt(req.headers["content-length"] || "0", 10);
      if (!isMember(room, id) || !slotOk) { req.resume(); res.writeHead(400); return res.end(); }
      if (declared > MAX_SOUND) { res.writeHead(413, { Connection: "close" }); return res.end(); }
      const chunks = []; let len = 0, over = false;
      req.on("data", (c) => { len += c.length; if (len > MAX_SOUND) over = true; else chunks.push(c); });
      req.on("end", () => {
        if (over) { res.writeHead(413); return res.end(); }
        const buf = Buffer.concat(chunks);
        if (!mime || !sniff(buf, mime)) { res.writeHead(415); return res.end(); }
        const b = getBoard(room);
        if (b.slots[slot]) { res.writeHead(409); return res.end(); }
        if (totalBytes + buf.length > MAX_TOTAL) { res.writeHead(507); return res.end(); }
        b.slots[slot] = { name: cleanSound(url.searchParams.get("name")), mime, buf, v: ++soundSeq };
        totalBytes += buf.length;
        sendBoard(room);
        res.writeHead(204); res.end();
      });
      return;
    }

    // Sabit giriş/çıkış sesi dosyası
    if (req.method === "GET" && P === "/sound/cue") {
      const c = cueData[url.searchParams.get("kind")];
      if (!c) { res.writeHead(404); return res.end(); }
      res.writeHead(200, {
        "Content-Type": "audio/mpeg",
        "Content-Length": c.buf.length,
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
      });
      return res.end(c.buf);
    }

    if (req.method === "POST" && P === "/sound/delete") {
      if (!isMember(room, id) || !slotOk) { res.writeHead(400); return res.end(); }
      const b = boards.get(room);
      if (b && b.slots[slot]) {
        totalBytes -= b.slots[slot].buf.length;
        b.slots[slot] = null;
        sendBoard(room);
      }
      res.writeHead(204); return res.end();
    }

    if (req.method === "POST" && P === "/sound/play") {
      const me = rooms.get(room) && rooms.get(room).get(id);
      const b = boards.get(room);
      const s = slotOk && b && b.slots[slot];
      if (me && s && Date.now() - me.lastPlay > 250) { // art arda spam'i engelle
        me.lastPlay = Date.now();
        broadcast(room, "play", { slot, v: s.v, sname: s.name, name: me.name });
      }
      res.writeHead(204); return res.end();
    }
  }

  res.writeHead(404); res.end("Bulunamadı");
});

server.listen(PORT, () => console.log("Sesli Sohbet çalışıyor: http://localhost:" + PORT));
