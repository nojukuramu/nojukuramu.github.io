/* tools/turn.js — a TURN server small enough to read, for the voice tests.
 *
 * The one claim about RouteCast's voice that a local test cannot otherwise
 * make is the relay claim: that two riders behind NATs that will never see
 * each other still talk, and roughly what that costs them. Forcing
 * `iceTransportPolicy: "relay"` in a browser needs a TURN server that actually
 * relays — no public one can be trusted to be up, and a public one that is
 * merely slow makes the app look broken.
 *
 * So the tests bring their own, over UDP, with long-term credentials:
 *
 *   Allocate / Refresh          an allocation and its lifetime
 *   CreatePermission            who may send to it
 *   ChannelBind + ChannelData   the 4-byte framing browsers prefer
 *   Send / Data indications     the unframed path, for completeness
 *
 * Deliberately absent: TCP and TLS transports, IPv6, EVEN-PORT, bandwidth
 * accounting, and any attempt to be a good citizen on a real network. This is
 * a test fixture bound to loopback, not a server.
 *
 * `delayMs` adds latency to every relayed packet, which is how the tests ask
 * "what does a rider behind a hard NAT actually hear?" without needing a bad
 * network to be available.
 *
 * Not shipped. Nothing here runs in a browser.
 *
 * Usage: node tools/turn.js [port]      (or require() it from a test)
 */
"use strict";

const dgram = require("dgram");
const crypto = require("crypto");

const MAGIC = 0x2112a442;

const T = {
  ALLOCATE: 0x0003, ALLOCATE_OK: 0x0103, ALLOCATE_ERR: 0x0113,
  REFRESH: 0x0004, REFRESH_OK: 0x0104, REFRESH_ERR: 0x0114,
  SEND: 0x0016, DATA: 0x0017,
  CREATE_PERM: 0x0008, CREATE_PERM_OK: 0x0108, CREATE_PERM_ERR: 0x0118,
  CHANNEL_BIND: 0x0009, CHANNEL_BIND_OK: 0x0109, CHANNEL_BIND_ERR: 0x0119,
  BINDING: 0x0001, BINDING_OK: 0x0101
};

const A = {
  MAPPED_ADDRESS: 0x0001, USERNAME: 0x0006, MESSAGE_INTEGRITY: 0x0008,
  ERROR_CODE: 0x0009, CHANNEL_NUMBER: 0x000c, LIFETIME: 0x000d,
  XOR_PEER_ADDRESS: 0x0012, DATA: 0x0013, REALM: 0x0014, NONCE: 0x0015,
  XOR_RELAYED_ADDRESS: 0x0016, REQUESTED_TRANSPORT: 0x0019,
  XOR_MAPPED_ADDRESS: 0x0020, SOFTWARE: 0x8022, FINGERPRINT: 0x8028
};

/* ---------------- message plumbing ---------------- */

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}

function attr(type, value) {
  const pad = (4 - (value.length % 4)) % 4;
  const out = Buffer.alloc(4 + value.length + pad);
  out.writeUInt16BE(type, 0);
  out.writeUInt16BE(value.length, 2);
  value.copy(out, 4);
  return out;
}

function u32(n) { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0, 0); return b; }

function addrValue(ip, port, xorTid) {
  const v = Buffer.alloc(8);
  v[0] = 0;
  v[1] = 0x01;
  const parts = ip.split(".").map(Number);
  const raw = ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
  if (xorTid) {
    v.writeUInt16BE(port ^ (MAGIC >>> 16), 2);
    v.writeUInt32BE((raw ^ MAGIC) >>> 0, 4);
  } else {
    v.writeUInt16BE(port, 2);
    v.writeUInt32BE(raw, 4);
  }
  return v;
}

function readAddr(v) {
  if (!v || v.length < 8) return null;
  const port = v.readUInt16BE(2) ^ (MAGIC >>> 16);
  const raw = (v.readUInt32BE(4) ^ MAGIC) >>> 0;
  return {
    port,
    address: [(raw >>> 24) & 255, (raw >>> 16) & 255, (raw >>> 8) & 255, raw & 255].join(".")
  };
}

function errorValue(code, reason) {
  const text = Buffer.from(reason, "utf8");
  const v = Buffer.alloc(4 + text.length);
  v[2] = Math.floor(code / 100);
  v[3] = code % 100;
  text.copy(v, 4);
  return v;
}

/** Split a STUN message into {type, tid, attrs:{type:Buffer}} — last wins,
    which is fine here because nothing legitimate repeats an attribute. */
function parse(msg) {
  if (!msg || msg.length < 20) return null;
  if ((msg[0] & 0xc0) !== 0) return null;
  if (msg.readUInt32BE(4) !== MAGIC) return null;
  const len = msg.readUInt16BE(2);
  if (20 + len > msg.length) return null;
  const out = { type: msg.readUInt16BE(0), tid: msg.slice(8, 20), attrs: {}, raw: msg, len };
  let off = 20;
  const end = 20 + len;
  while (off + 4 <= end) {
    const t = msg.readUInt16BE(off);
    const l = msg.readUInt16BE(off + 2);
    if (off + 4 + l > end) break;
    out.attrs[t] = msg.slice(off + 4, off + 4 + l);
    if (t === A.MESSAGE_INTEGRITY) out.miOffset = off;
    off += 4 + l + ((4 - (l % 4)) % 4);
  }
  return out;
}

/** The long-term-credential key: MD5 of username:realm:password. */
function ltKey(username, realm, password) {
  return crypto.createHash("md5").update(username + ":" + realm + ":" + password).digest();
}

/** HMAC-SHA1 over the message, with the length field rewritten to end just
    after MESSAGE-INTEGRITY — the one genuinely fiddly corner of STUN auth. */
function integrity(upTo, key, totalLenWithMi) {
  const copy = Buffer.from(upTo);
  copy.writeUInt16BE(totalLenWithMi, 2);
  return crypto.createHmac("sha1", key).update(copy).digest();
}

function checkIntegrity(m, key) {
  if (m.miOffset == null) return false;
  const upTo = m.raw.slice(0, m.miOffset);
  const want = integrity(upTo, key, m.miOffset - 20 + 24);
  const have = m.attrs[A.MESSAGE_INTEGRITY];
  return !!have && have.length === 20 && crypto.timingSafeEqual(want, have);
}

/** Build a response: attributes, then MESSAGE-INTEGRITY (when a key is given),
    then FINGERPRINT. Order matters to every client that checks. */
function build(type, tid, attrs, key) {
  let body = Buffer.concat(attrs);
  let head = Buffer.alloc(20);
  head.writeUInt16BE(type, 0);
  head.writeUInt32BE(MAGIC, 4);
  tid.copy(head, 8);

  if (key) {
    head.writeUInt16BE(body.length + 24, 2);      // + MESSAGE-INTEGRITY
    const mac = integrity(Buffer.concat([head, body]), key, body.length + 24);
    body = Buffer.concat([body, attr(A.MESSAGE_INTEGRITY, mac)]);
  }
  head.writeUInt16BE(body.length + 8, 2);         // + FINGERPRINT
  const upTo = Buffer.concat([head, body]);
  return Buffer.concat([upTo, attr(A.FINGERPRINT, u32(crc32(upTo) ^ 0x5354554e))]);
}

/* ---------------- the server ---------------- */

/**
 * Start a TURN server.
 *
 * @param {object} opts
 *   port      0 for an ephemeral one (the default)
 *   host      bind address, default 127.0.0.1
 *   username  default "rider"
 *   password  default "routecast"
 *   realm     default "routecast.test"
 *   delayMs   extra latency added to every relayed packet, each way
 * @returns {Promise<{port, host, urls, username, credential, stats, close, setDelay}>}
 */
function start(opts) {
  opts = opts || {};
  const host = opts.host || "127.0.0.1";
  const username = opts.username || "rider";
  const password = opts.password || "routecast";
  const realm = opts.realm || "routecast.test";
  let delayMs = opts.delayMs || 0;
  const key = ltKey(username, realm, password);
  const nonce = crypto.randomBytes(12).toString("hex");

  const stats = { allocations: 0, relayedOut: 0, relayedIn: 0, channels: 0, bytes: 0 };
  const sock = dgram.createSocket("udp4");
  const allocs = new Map();   // "ip:port" of the client -> allocation

  function keyOf(rinfo) { return rinfo.address + ":" + rinfo.port; }

  function reply(buf, rinfo) {
    try { sock.send(buf, rinfo.port, rinfo.address); } catch (e) { /* client gone */ }
  }

  function authFail(m, rinfo, errType) {
    reply(build(errType, m.tid, [
      attr(A.ERROR_CODE, errorValue(401, "Unauthorized")),
      attr(A.REALM, Buffer.from(realm)),
      attr(A.NONCE, Buffer.from(nonce))
    ]), rinfo);
  }

  /** Everything an allocation owns: its relay socket, its permissions, its
      channels, and the client it belongs to. */
  function allocate(m, rinfo) {
    const existing = allocs.get(keyOf(rinfo));
    if (existing) {
      reply(build(T.ALLOCATE_OK, m.tid, [
        attr(A.XOR_RELAYED_ADDRESS, addrValue(host, existing.relayPort, true)),
        attr(A.XOR_MAPPED_ADDRESS, addrValue(rinfo.address, rinfo.port, true)),
        attr(A.LIFETIME, u32(600))
      ], key), rinfo);
      return;
    }

    const relay = dgram.createSocket("udp4");
    relay.on("message", (data, from) => {
      const alloc = allocs.get(keyOf(rinfo));
      if (!alloc) return;
      const peerKey = from.address + ":" + from.port;
      if (!alloc.perms.has(from.address)) return;     // no permission, no delivery
      stats.relayedIn++;
      stats.bytes += data.length;

      const chan = alloc.channelsByPeer.get(peerKey);
      let out;
      if (chan != null) {
        // ChannelData: a 4-byte header instead of a whole STUN message.
        const head = Buffer.alloc(4);
        head.writeUInt16BE(chan, 0);
        head.writeUInt16BE(data.length, 2);
        const pad = (4 - (data.length % 4)) % 4;
        out = Buffer.concat([head, data, Buffer.alloc(pad)]);
      } else {
        out = build(T.DATA, crypto.randomBytes(12), [
          attr(A.XOR_PEER_ADDRESS, addrValue(from.address, from.port, true)),
          attr(A.DATA, data)
        ]);
      }
      if (delayMs > 0) setTimeout(() => reply(out, rinfo), delayMs);
      else reply(out, rinfo);
    });

    relay.bind(0, host, () => {
      const alloc = {
        client: rinfo,
        relay,
        relayPort: relay.address().port,
        perms: new Set(),
        channelsByPeer: new Map(),   // "ip:port" -> channel number
        peersByChannel: new Map()    // channel number -> {address, port}
      };
      allocs.set(keyOf(rinfo), alloc);
      stats.allocations++;
      reply(build(T.ALLOCATE_OK, m.tid, [
        attr(A.XOR_RELAYED_ADDRESS, addrValue(host, alloc.relayPort, true)),
        attr(A.XOR_MAPPED_ADDRESS, addrValue(rinfo.address, rinfo.port, true)),
        attr(A.LIFETIME, u32(600))
      ], key), rinfo);
    });
  }

  function relayOut(alloc, peer, data) {
    if (!alloc || !peer || !data || !data.length) return;
    stats.relayedOut++;
    stats.bytes += data.length;
    const go = () => {
      try { alloc.relay.send(data, peer.port, peer.address); } catch (e) { /* gone */ }
    };
    if (delayMs > 0) setTimeout(go, delayMs);
    else go();
  }

  sock.on("message", (msg, rinfo) => {
    // ChannelData is not a STUN message at all: the top two bits say so.
    if (msg.length >= 4 && (msg[0] & 0xc0) === 0x40) {
      const alloc = allocs.get(keyOf(rinfo));
      if (!alloc) return;
      const chan = msg.readUInt16BE(0);
      const len = msg.readUInt16BE(2);
      const peer = alloc.peersByChannel.get(chan);
      if (!peer || msg.length < 4 + len) return;
      relayOut(alloc, peer, msg.slice(4, 4 + len));
      return;
    }

    const m = parse(msg);
    if (!m) return;
    const alloc = allocs.get(keyOf(rinfo));

    switch (m.type) {
      case T.BINDING:
        // A TURN server answers Binding too, which is how one line in the ICE
        // config can serve as both srflx and relay source.
        reply(build(T.BINDING_OK, m.tid, [
          attr(A.XOR_MAPPED_ADDRESS, addrValue(rinfo.address, rinfo.port, true))
        ]), rinfo);
        return;

      case T.ALLOCATE:
        if (!m.attrs[A.MESSAGE_INTEGRITY]) return authFail(m, rinfo, T.ALLOCATE_ERR);
        if (!checkIntegrity(m, key)) {
          return reply(build(T.ALLOCATE_ERR, m.tid, [
            attr(A.ERROR_CODE, errorValue(401, "Unauthorized"))
          ]), rinfo);
        }
        return allocate(m, rinfo);

      case T.REFRESH: {
        if (!alloc) return;
        if (!checkIntegrity(m, key)) return authFail(m, rinfo, T.REFRESH_ERR);
        const want = m.attrs[A.LIFETIME] ? m.attrs[A.LIFETIME].readUInt32BE(0) : 600;
        if (want === 0) {
          try { alloc.relay.close(); } catch (e) { /* already gone */ }
          allocs.delete(keyOf(rinfo));
        }
        return reply(build(T.REFRESH_OK, m.tid, [attr(A.LIFETIME, u32(want))], key), rinfo);
      }

      case T.CREATE_PERM: {
        if (!alloc) return;
        if (!checkIntegrity(m, key)) return authFail(m, rinfo, T.CREATE_PERM_ERR);
        const p = readAddr(m.attrs[A.XOR_PEER_ADDRESS]);
        if (p) alloc.perms.add(p.address);
        return reply(build(T.CREATE_PERM_OK, m.tid, [], key), rinfo);
      }

      case T.CHANNEL_BIND: {
        if (!alloc) return;
        if (!checkIntegrity(m, key)) return authFail(m, rinfo, T.CHANNEL_BIND_ERR);
        const cn = m.attrs[A.CHANNEL_NUMBER];
        const p = readAddr(m.attrs[A.XOR_PEER_ADDRESS]);
        if (!cn || !p) {
          return reply(build(T.CHANNEL_BIND_ERR, m.tid, [
            attr(A.ERROR_CODE, errorValue(400, "Bad Request"))
          ], key), rinfo);
        }
        const chan = cn.readUInt16BE(0);
        alloc.perms.add(p.address);
        alloc.channelsByPeer.set(p.address + ":" + p.port, chan);
        alloc.peersByChannel.set(chan, p);
        stats.channels++;
        return reply(build(T.CHANNEL_BIND_OK, m.tid, [], key), rinfo);
      }

      case T.SEND: {
        if (!alloc) return;
        const p = readAddr(m.attrs[A.XOR_PEER_ADDRESS]);
        const data = m.attrs[A.DATA];
        if (p && data && alloc.perms.has(p.address)) relayOut(alloc, p, data);
        return;
      }

      default:
        return;
    }
  });

  return new Promise((resolve, reject) => {
    sock.once("error", reject);
    sock.bind(opts.port || 0, host, () => {
      const port = sock.address().port;
      resolve({
        port,
        host,
        username,
        credential: password,
        realm,
        stats,
        /** Drop straight into an RTCConfiguration. */
        iceServer: {
          urls: ["turn:" + host + ":" + port + "?transport=udp"],
          username,
          credential: password
        },
        setDelay(ms) { delayMs = ms | 0; },
        close() {
          allocs.forEach((a) => { try { a.relay.close(); } catch (e) { /* ignore */ } });
          allocs.clear();
          return new Promise((r) => sock.close(r));
        }
      });
    });
  });
}

module.exports = { start, parse, build, attr, ltKey };

if (require.main === module) {
  start({ port: Number(process.argv[2]) || 3478, host: "0.0.0.0" }).then((s) => {
    console.log("turn listening on " + s.host + ":" + s.port +
                "  (" + s.username + " / " + s.credential + ")");
  });
}
