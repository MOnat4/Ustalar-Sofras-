// Sesli Sohbet - sinyal sunucusu. Hiçbir paket gerektirmez (npm install gerekmez).
// Ses sunucudan geçmez; sunucu sadece cihazların birbirini bulmasını sağlar.
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const MAX_PER_ROOM = 6;
const rooms = new Map(); // oda -> Map(id -> {res, name})

const cleanKey = (s, n) => String(s || "").toLowerCase().replace(/[^a-z0-9_.-]/g, "").slice(0, n);
const cleanName = (s) => String(s || "").replace(/[<>&"]/g, "").trim().slice(0, 20) || "Misafir";

function sse(res, event, data) {
  res.write("event: " + event + "\ndata: " + JSON.stringify(data) + "\n\n");
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

  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
    fs.readFile(path.join(__dirname, "index.html"), (err, buf) => {
      if (err) { res.writeHead(500); return res.end("index.html bulunamadı"); }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" });
      res.end(buf);
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/config") {
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    return res.end(JSON.stringify({ iceServers: iceServers() }));
  }

  if (req.method === "GET" && url.pathname === "/events") {
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

    const others = [];
    members.forEach((m, mid) => others.push({ id: mid, name: m.name }));
    sse(res, "init", { peers: others });
    members.forEach((m) => sse(m.res, "join", { id, name }));
    members.set(id, { res, name });

    const ka = setInterval(() => res.write(": ping\n\n"), 20000);
    req.on("close", () => {
      clearInterval(ka);
      const cur = rooms.get(room);
      if (cur && cur.get(id) && cur.get(id).res === res) {
        cur.delete(id);
        cur.forEach((m) => sse(m.res, "leave", { id }));
        if (cur.size === 0) rooms.delete(room);
      }
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/signal") {
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

  res.writeHead(404); res.end("Bulunamadı");
});

server.listen(PORT, () => console.log("Sesli Sohbet çalışıyor: http://localhost:" + PORT));
