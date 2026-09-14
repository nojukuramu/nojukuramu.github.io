/* tools/stun.js — a STUN server small enough to read, for the voice tests.
 *
 * RouteCast's voice path is a claim about ICE: that a link comes up fast, that
 * it comes up at all when the only route left is a relay, and that a STUN
 * server which has quietly died costs nothing. None of those can be checked
 * against somebody else's public server — a public server that is having a bad
 * afternoon looks exactly like a bug in the app.
 *
 * So the tests bring their own. This is RFC 5389 Binding, and only Binding:
 * "what address did this packet come from". Roughly sixty lines of real work,
 * plus the two failure modes that matter to the app:
 *
 *   mode "ok"     answer every request                  (the happy path)
 *   mode "black"  answer nothing, ever                  (a dead server)
 *   mode "slow"   answer, but `delayMs` late            (an overloaded one)
 *
 * Not shipped. Nothing here runs in a browser.
 *
 * Usage: node tools/stun.js [port]      (or require() it from a test)
 */
"use strict";

const dgram = require("dgram");

const MAGIC = 0x2112a442;
const BINDING_REQUEST = 0x0001;
const BINDING_SUCCESS = 0x0101;
const XOR_MAPPED_ADDRESS = 0x0020;
const MAPPED_ADDRESS = 0x0001;
const SOFTWARE = 0x8022;
const FINGERPRINT = 0x8028;

/* CRC-32, for FINGERPRINT. A table is overkill for packets this small. */
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}

/** A STUN attribute, padded to the 4-byte boundary the RFC insists on. */
function attr(type, value) {
  const pad = (4 - (value.length % 4)) % 4;
  const out = Buffer.alloc(4 + value.length + pad);
  out.writeUInt16BE(type, 0);
  out.writeUInt16BE(value.length, 2);
  value.copy(out, 4);
  return out;
}

/** XOR-MAPPED-ADDRESS: the port and v4 address, masked with the magic cookie
    so that a NAT rewriting payloads by accident cannot rewrite this one. */
function xorAddress(ip, port) {
  const v = Buffer.alloc(8);
  v[0] = 0;
  v[1] = 0x01; // IPv4
  v.writeUInt16BE(port ^ (MAGIC >>> 16), 2);
  const parts = ip.split(".").map(Number);
  const raw = (parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3];
  v.writeUInt32BE((raw ^ MAGIC) >>> 0, 4);
  return v;
}

function plainAddress(ip, port) {
  const v = Buffer.alloc(8);
  v[0] = 0;
  v[1] = 0x01;
  v.writeUInt16BE(port, 2);
  ip.split(".").map(Number).forEach((b, i) => { v[4 + i] = b; });
  return v;
}

/** Is this even a STUN message? Type, magic cookie and a sane length. */
function parse(msg) {
  if (!msg || msg.length < 20) return null;
  if ((msg[0] & 0xc0) !== 0) return null;             // top two bits are zero
  if (msg.readUInt32BE(4) !== MAGIC) return null;
  const len = msg.readUInt16BE(2);
  if (20 + len > msg.length) return null;
  return { type: msg.readUInt16BE(0), tid: msg.slice(8, 20) };
}

function build(type, tid, attrs) {
  const body = Buffer.concat(attrs);
  // FINGERPRINT is computed over the message as if it were already there, so
  // the length written now has to include it.
  const head = Buffer.alloc(20);
  head.writeUInt16BE(type, 0);
  head.writeUInt16BE(body.length + 8, 2);
  head.writeUInt32BE(MAGIC, 4);
  tid.copy(head, 8);
  const upTo = Buffer.concat([head, body]);
  const fp = Buffer.alloc(4);
  fp.writeUInt32BE((crc32(upTo) ^ 0x5354554e) >>> 0, 0);
  return Buffer.concat([upTo, attr(FINGERPRINT, fp)]);
}

/**
 * Start a STUN server.
 *
 * @param {object} opts
 *   port     0 for an ephemeral one (the default; the real port is returned)
 *   host     bind address, default 127.0.0.1
 *   mode     "ok" | "black" | "slow"
 *   delayMs  how late "slow" is, default 3000
 * @returns {Promise<{port:number, close:Function, stats:object, setMode:Function}>}
 */
function start(opts) {
  opts = opts || {};
  const host = opts.host || "127.0.0.1";
  let mode = opts.mode || "ok";
  const delayMs = opts.delayMs == null ? 3000 : opts.delayMs;
  const stats = { requests: 0, answered: 0, dropped: 0 };
  const sock = dgram.createSocket("udp4");
  const pending = new Set();

  sock.on("message", (msg, rinfo) => {
    const m = parse(msg);
    if (!m || m.type !== BINDING_REQUEST) return;
    stats.requests++;
    if (mode === "black") { stats.dropped++; return; }

    const reply = build(BINDING_SUCCESS, m.tid, [
      attr(XOR_MAPPED_ADDRESS, xorAddress(rinfo.address, rinfo.port)),
      attr(MAPPED_ADDRESS, plainAddress(rinfo.address, rinfo.port)),
      attr(SOFTWARE, Buffer.from("routecast-test-stun"))
    ]);

    let timer = null;
    const send = () => {
      if (timer) pending.delete(timer);
      stats.answered++;
      try { sock.send(reply, rinfo.port, rinfo.address); } catch (e) { /* gone */ }
    };
    if (mode !== "slow") return send();
    timer = setTimeout(send, delayMs);
    pending.add(timer);
  });

  return new Promise((resolve, reject) => {
    sock.once("error", reject);
    sock.bind(opts.port || 0, host, () => {
      resolve({
        port: sock.address().port,
        host,
        stats,
        setMode(next) { mode = next; },
        close() {
          pending.forEach(clearTimeout);
          pending.clear();
          return new Promise((r) => sock.close(r));
        }
      });
    });
  });
}

module.exports = { start, parse, build, attr, xorAddress, crc32, MAGIC };

if (require.main === module) {
  start({ port: Number(process.argv[2]) || 3478, host: "0.0.0.0" }).then((s) => {
    console.log("stun listening on " + s.host + ":" + s.port);
  });
}
