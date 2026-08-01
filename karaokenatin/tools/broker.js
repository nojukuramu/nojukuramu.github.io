/* tools/broker.js — a local stand-in for the public PeerJS broker.
 *
 * Implements just enough of the PeerServer wire protocol for the end-to-end
 * test: register an id, relay {type, src, dst, payload} envelopes, answer with
 * EXPIRE when the destination is unknown. Run by tools/e2e.js; not shipped.
 *
 * Usage: node tools/broker.js [port]
 */
"use strict";

const crypto = require("crypto");
const http = require("http");

/* A ~120-line WebSocket server, so the test needs no dependencies at all. */
const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

function accept(key) {
  return crypto.createHash("sha1").update(key + GUID).digest("base64");
}

function frame(text) {
  const payload = Buffer.from(text, "utf8");
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.from([0x81, len]);
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81; header[1] = 126; header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81; header[1] = 127; header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, payload]);
}

/** Pull complete text frames out of a growing buffer. Returns [messages, rest]. */
function unframe(buf) {
  const out = [];
  let off = 0;
  for (;;) {
    if (buf.length - off < 2) break;
    const b0 = buf[off];
    const b1 = buf[off + 1];
    const opcode = b0 & 0x0f;
    const masked = (b1 & 0x80) !== 0;
    let len = b1 & 0x7f;
    let p = off + 2;
    if (len === 126) { if (buf.length < p + 2) break; len = buf.readUInt16BE(p); p += 2; }
    else if (len === 127) { if (buf.length < p + 8) break; len = Number(buf.readBigUInt64BE(p)); p += 8; }
    let mask = null;
    if (masked) { if (buf.length < p + 4) break; mask = buf.slice(p, p + 4); p += 4; }
    if (buf.length < p + len) break;
    const data = Buffer.from(buf.slice(p, p + len));
    if (mask) for (let i = 0; i < data.length; i++) data[i] ^= mask[i % 4];
    off = p + len;
    if (opcode === 0x8) { out.push({ close: true }); break; }
    if (opcode === 0x1) out.push({ text: data.toString("utf8") });
    // opcode 0x9/0xA (ping/pong) and 0x0 (continuation) are ignored
  }
  return [out, buf.slice(off)];
}

function start(port) {
  const peers = new Map(); // id -> { socket, token }

  const server = http.createServer((req, res) => {
    res.writeHead(426).end("upgrade required");
  });

  server.on("upgrade", (req, socket) => {
    const url = new URL(req.url, "http://localhost");
    const id = url.searchParams.get("id");
    const token = url.searchParams.get("token");
    const key = req.headers["sec-websocket-key"];
    if (!id || !key) { socket.destroy(); return; }

    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\n" +
      "Upgrade: websocket\r\nConnection: Upgrade\r\n" +
      "Sec-WebSocket-Accept: " + accept(key) + "\r\n\r\n"
    );

    const existing = peers.get(id);
    if (existing && existing.token !== token) {
      socket.write(frame(JSON.stringify({ type: "ID-TAKEN", payload: { msg: "ID is taken" } })));
      socket.end();
      return;
    }
    if (existing) { try { existing.socket.destroy(); } catch (e) { /* replaced */ } }

    peers.set(id, { socket, token });
    socket.write(frame(JSON.stringify({ type: "OPEN" })));

    let buf = Buffer.alloc(0);
    socket.on("data", (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      const [msgs, rest] = unframe(buf);
      buf = rest;
      for (const m of msgs) {
        if (m.close) { socket.end(); return; }
        let msg;
        try { msg = JSON.parse(m.text); } catch (e) { continue; }
        if (msg.type === "HEARTBEAT") continue;
        if (!msg.dst) continue;
        const target = peers.get(msg.dst);
        const envelope = JSON.stringify({ type: msg.type, src: id, dst: msg.dst, payload: msg.payload });
        if (target) target.socket.write(frame(envelope));
        else socket.write(frame(JSON.stringify({ type: "EXPIRE", src: msg.dst, dst: id })));
      }
    });

    const drop = () => { if (peers.get(id) && peers.get(id).socket === socket) peers.delete(id); };
    socket.on("close", drop);
    socket.on("error", drop);
  });

  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => resolve({ server, port: server.address().port, peers }));
  });
}

module.exports = { start };

if (require.main === module) {
  start(Number(process.argv[2]) || 0).then(({ port }) => {
    console.log("broker listening on ws://127.0.0.1:" + port);
  });
}
