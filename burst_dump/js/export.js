/* ============================================================
   BURST//DUMP — writing the video

   Two ways out, best first:

   Fast (WebCodecs). Every frame is drawn at its exact time and handed to a
   VideoEncoder, the soundtrack is rendered offline (js/audio.js) and handed
   to an AudioEncoder, and vendor/mp4-muxer.mjs (MIT, Vanilagy) writes an
   H.264 + AAC MP4 with a proper index. Nothing waits on the wall clock, so
   a 30 s reel takes a few seconds, no frame is ever dropped, and the tab
   does not have to stay in front.

   Real time (MediaRecorder). The first version's path, for browsers without
   an H.264 encoder in WebCodecs: the canvas and the audio graph are
   recorded while the reel plays. MediaRecorder writes no usable duration
   (WebM: none at all; Chromium's fragmented MP4: a wrong one), so the
   fixers below, unchanged from the first version, patch the real length in
   before the file is saved.
   ============================================================ */
import { Muxer, ArrayBufferTarget } from "../vendor/mp4-muxer.mjs";

/* ---------- fast path ---------- */
// H.264 levels: [name, hex, max frame size in macroblocks, max macroblocks/s]
const LEVELS = [["4.0", "28", 8192, 245760], ["4.2", "2A", 8704, 522240], ["5.0", "32", 22080, 589824], ["5.1", "33", 36864, 983040], ["5.2", "34", 36864, 2073600]];

/* Resolves {video, audio, label} for a config the fast path can do here,
   or null. needAudio: the reel has a soundtrack. */
export async function fastSupport(w, h, fps, bitrate, needAudio) {
  if (typeof VideoEncoder === "undefined" || typeof VideoFrame === "undefined") return null;
  const mbs = Math.ceil(w / 16) * Math.ceil(h / 16), mbps = mbs * fps;
  const levels = LEVELS.filter((l) => mbs <= l[2] && mbps <= l[3]);
  let video = null;
  outer: for (const prof of ["6400", "4D00", "42E0"]) for (const l of levels) {
    const cfg = { codec: "avc1." + prof + l[1], width: w, height: h, bitrate, framerate: fps, avc: { format: "avc" } };
    try { const s = await VideoEncoder.isConfigSupported(cfg); if (s && s.supported) { video = cfg; break outer; } } catch (e) {}
  }
  /* VP9 in MP4 plays in browsers but not in every phone gallery, so it is
     never chosen for real; ?test-vp9 lets tools/e2e.js drive this whole
     path in the open-source Chromium, which has no H.264 encoder. */
  let vmux = "avc";
  if (!video && /[?&]test-vp9\b/.test(location.search)) {
    const cfg = { codec: "vp09.00.40.08", width: w, height: h, bitrate, framerate: fps };
    try { const s = await VideoEncoder.isConfigSupported(cfg); if (s && s.supported) { video = cfg; vmux = "vp9"; } } catch (e) {}
  }
  if (!video) return null;
  let audio = null, acodec = null;
  if (needAudio) {
    if (typeof AudioEncoder === "undefined" || typeof AudioData === "undefined") return null;
    for (const [codec, mux] of [["mp4a.40.2", "aac"], ["opus", "opus"]]) {
      const cfg = { codec, sampleRate: 48000, numberOfChannels: 2, bitrate: 192000 };
      try { const s = await AudioEncoder.isConfigSupported(cfg); if (s && s.supported) { audio = cfg; acodec = mux; break; } } catch (e) {}
    }
    if (!audio) return null;
  }
  return { video, vmux, audio, acodec, label: "MP4 · " + (vmux === "avc" ? "H.264" : "VP9") + (audio ? (acodec === "aac" ? " · AAC" : " · Opus") : "") };
}

/* opts: {support, canvas, fps, totalMs, draw(tMs), mix (AudioBuffer|null),
   progress(p), cancelled()}. Resolves a Blob, or null when cancelled. */
export async function exportFast(o) {
  const { support, canvas, fps } = o;
  const frames = Math.max(1, Math.ceil(o.totalMs / 1000 * fps));
  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: { codec: support.vmux, width: support.video.width, height: support.video.height, frameRate: fps },
    audio: support.audio ? { codec: support.acodec, numberOfChannels: 2, sampleRate: 48000 } : undefined,
    fastStart: "in-memory",
    firstTimestampBehavior: "offset"
  });
  let failure = null;
  const venc = new VideoEncoder({ output: (c, m) => muxer.addVideoChunk(c, m), error: (e) => { failure = e; } });
  venc.configure(support.video);
  /* A message to ourselves, not setTimeout: background tabs clamp timers to
     once a second, which would turn a fast export into a very slow one. */
  const ch = new MessageChannel(), waiting = [];
  ch.port1.onmessage = () => { const r = waiting.shift(); if (r) r(); };
  const yieldUI = () => new Promise((r) => { waiting.push(r); ch.port2.postMessage(0); });
  const usPerFrame = 1e6 / fps;
  for (let i = 0; i < frames; i++) {
    if (failure) throw failure;
    if (o.cancelled()) { try { venc.close(); } catch (e) {} return null; }
    o.draw(i * 1000 / fps);
    const vf = new VideoFrame(canvas, { timestamp: Math.round(i * usPerFrame), duration: Math.round(usPerFrame) });
    venc.encode(vf, { keyFrame: i % (fps * 2) === 0 });
    vf.close();
    // keep a few frames in flight, not the whole reel's worth of memory
    while (venc.encodeQueueSize > 4) { await yieldUI(); if (failure) throw failure; }
    if (i % 6 === 0) { o.progress(0.9 * i / frames); await yieldUI(); }
  }
  await venc.flush(); venc.close();
  if (failure) throw failure;

  if (support.audio && o.mix) {
    const aenc = new AudioEncoder({ output: (c, m) => muxer.addAudioChunk(c, m), error: (e) => { failure = e; } });
    aenc.configure(support.audio);
    const L = o.mix.getChannelData(0), R = o.mix.numberOfChannels > 1 ? o.mix.getChannelData(1) : L, sr = o.mix.sampleRate;
    const total = Math.min(L.length, Math.round(frames / fps * sr));
    for (let off = 0; off < total; off += 4096) {
      const n = Math.min(4096, total - off), data = new Float32Array(n * 2);
      data.set(L.subarray(off, off + n), 0); data.set(R.subarray(off, off + n), n);
      const ad = new AudioData({ format: "f32-planar", sampleRate: sr, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round(off / sr * 1e6), data });
      aenc.encode(ad); ad.close();
      if (failure) throw failure;
      if ((off / 4096) % 64 === 0) { o.progress(0.9 + 0.08 * off / total); await yieldUI(); }
    }
    await aenc.flush(); aenc.close();
    if (failure) throw failure;
  }
  muxer.finalize();
  o.progress(1);
  return new Blob([target.buffer], { type: "video/mp4" });
}

/* ---------- real-time path ---------- */
export function pickMime() {
  if (!window.MediaRecorder) return null;
  for (const m of ['video/mp4;codecs="avc1.640028,mp4a.40.2"', 'video/mp4;codecs="avc1.42E01E,mp4a.40.2"', "video/mp4;codecs=avc1", "video/mp4", "video/webm;codecs=vp9,opus", "video/webm"]) {
    try { if (MediaRecorder.isTypeSupported(m)) return m; } catch (e) {}
  }
  return null;
}
/* Starts recording the canvas (plus audioTrack if given). Returns
   {stop(durationMs) -> Promise<Blob>, ext}. */
export function startRecorder(canvas, fps, bitrate, audioTrack) {
  const mime = pickMime();
  if (!mime) throw new Error("MediaRecorder is not available in this browser");
  const stream = canvas.captureStream(fps);
  if (audioTrack) stream.addTrack(audioTrack);
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: bitrate, audioBitsPerSecond: 192000 });
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  rec.start(400);
  const ext = mime.includes("mp4") ? "mp4" : "webm", type = mime.split(";")[0];
  return {
    ext,
    stop: (durationMs) => new Promise((resolve, reject) => {
      rec.onstop = async () => {
        if (!chunks.length) return reject(new Error("the recording came back empty"));
        let blob = new Blob(chunks, { type });
        try {
          const u8 = new Uint8Array(await blob.arrayBuffer());
          blob = new Blob([ext === "webm" ? fixWebmDuration(u8, durationMs) : fixMp4Duration(u8, durationMs)], { type });
        } catch (e) { /* the original is still playable, just mislabelled */ }
        resolve(blob);
      };
      try { rec.stop(); } catch (e) { reject(e); }
    })
  };
}

function fixWebmDuration(buf,durationMs){
  if(!(buf[0]===0x1a&&buf[1]===0x45&&buf[2]===0xdf&&buf[3]===0xa3))return buf;
  const len=buf.length;
  const vintLen=b0=>{let mask=0x80,l=1;while(l<=8){if(b0&mask)return l;mask>>=1;l++;}return 8;};
  const readId=p=>{const l=vintLen(buf[p]);let id=0;for(let i=0;i<l;i++)id=id*256+buf[p+i];return{id,len:l};};
  const readSize=p=>{const l=vintLen(buf[p]);const mask=0x80>>(l-1);let val=buf[p]&(mask-1);let unknown=(buf[p]&(mask-1))===(mask-1);for(let i=1;i<l;i++){val=val*256+buf[p+i];if(buf[p+i]!==0xff)unknown=false;}return{val,len:l,unknown};};
  const findChild=(start,end,wantId)=>{let q=start;while(q+2<=end){const id=readId(q);const sz=readSize(q+id.len);const dataStart=q+id.len+sz.len;const dataEnd=sz.unknown?end:dataStart+sz.val;if(id.id===wantId)return{idStart:q,idLen:id.len,sizeStart:q+id.len,sizeLen:sz.len,dataStart,dataEnd,unknown:sz.unknown,sizeVal:sz.val};if(sz.unknown)return null;q=dataEnd;}return null;};
  const encodeSize=value=>{let l=1;while(value>Math.pow(2,7*l)-2)l++;const b=new Uint8Array(l);let v=value;for(let i=l-1;i>=0;i--){b[i]=v&0xff;v=Math.floor(v/256);}b[0]|=(0x80>>(l-1));return b;};
  const f64=value=>{const b=new Uint8Array(8);new DataView(b.buffer).setFloat64(0,value,false);return b;};
  const concat=arrs=>{let n=0;for(const a of arrs)n+=a.length;const o=new Uint8Array(n);let k=0;for(const a of arrs){o.set(a,k);k+=a.length;}return o;};
  const seg=findChild(0,len,0x18538067);if(!seg)return buf;
  const info=findChild(seg.dataStart,seg.dataEnd,0x1549a966);if(!info)return buf;
  let timecodeScale=1000000;
  const ts=findChild(info.dataStart,info.dataEnd,0x2ad7b1);
  if(ts){let v=0;for(let i=ts.dataStart;i<ts.dataEnd;i++)v=v*256+buf[i];if(v>0)timecodeScale=v;}
  const durationValue=(durationMs*1e6)/timecodeScale;
  const existing=findChild(info.dataStart,info.dataEnd,0x4489);
  if(existing&&existing.dataEnd-existing.dataStart===8){const out=buf.slice();out.set(f64(durationValue),existing.dataStart);return out;}
  const durElem=concat([new Uint8Array([0x44,0x89]),encodeSize(8),f64(durationValue)]);
  const delta=durElem.length;
  const newInfoDataLen=(info.dataEnd-info.dataStart)+delta;
  const newInfoSize=encodeSize(newInfoDataLen);
  const parts=[];
  parts.push(buf.slice(0,seg.sizeStart));
  if(seg.unknown)parts.push(buf.slice(seg.sizeStart,seg.dataStart));
  else parts.push(encodeSize(seg.sizeVal+delta+(newInfoSize.length-info.sizeLen)));
  parts.push(buf.slice(seg.dataStart,info.sizeStart));
  parts.push(newInfoSize);
  parts.push(buf.slice(info.dataStart,info.dataEnd));
  parts.push(durElem);
  parts.push(buf.slice(info.dataEnd));
  return concat(parts);
}
/* Chromium's MediaRecorder produces fragmented MP4 (moov + a run of moof
   fragments, no single mdat) with broken duration metadata: mvhd duration
   is 0, tkhd duration is only whatever the first fragment covered (~1-3s),
   mdhd duration is likewise stale, and mvex has no mehd (movie-extends
   fragment_duration) at all. Metadata-trusting parsers — phone galleries,
   Facebook, Instagram — read mvhd=0, fall back to the bogus tkhd value,
   and truncate the clip even though every frame is present in the moof
   fragments. This patches mvhd/tkhd/mdhd in place and inserts a mehd box
   carrying the real fragment_duration so the file reports its true length
   everywhere. */
function fixMp4Duration(buf,durationMs){
  try{
    const len=buf.length;
    if(len<8)return buf;
    const dv=new DataView(buf.buffer,buf.byteOffset,buf.byteLength);
    const typeAt=p=>String.fromCharCode(buf[p+4],buf[p+5],buf[p+6],buf[p+7]);
    /* Reads one box header at p (bounded by end). Returns null on a
       malformed/short box, {bail:true} on a 64-bit largesize box (never
       emitted by MediaRecorder for these boxes — safest to give up), or
       {p,type,size,rawSize,dataStart,dataEnd}. */
    const readBox=(p,end)=>{
      if(p+8>end)return null;
      const rawSize=dv.getUint32(p,false);
      const type=typeAt(p);
      if(rawSize===1)return{bail:true};
      let size=rawSize;
      if(rawSize===0)size=end-p;
      if(size<8||p+size>end)return null;
      return{p,type,size,rawSize,dataStart:p+8,dataEnd:p+size};
    };
    const findChild=(start,end,want)=>{
      let p=start;
      while(p+8<=end){
        const b=readBox(p,end);
        if(!b)return null;
        if(b.bail)return b;
        if(b.type===want)return b;
        p+=b.size;
      }
      return null;
    };
    const findAllChildren=(start,end,want)=>{
      const list=[];
      let p=start;
      while(p+8<=end){
        const b=readBox(p,end);
        if(!b)return null; // malformed or largesize -> caller bails
        if(b.type===want)list.push(b);
        p+=b.size;
      }
      return list;
    };

    /* Task requirement: verify this looks like MP4 via a top-level walk
       that finds moov; otherwise leave the buffer untouched. */
    const moov=findChild(0,len,'moov');
    if(!moov||moov.bail)return buf;
    const mvhd=findChild(moov.dataStart,moov.dataEnd,'mvhd');
    if(!mvhd||mvhd.bail)return buf;
    const traks=findAllChildren(moov.dataStart,moov.dataEnd,'trak');
    if(!traks||!traks.length)return buf;

    /* mvhd/tkhd/mdhd patches only rewrite existing fields, so work on a
       plain copy for those — no length change yet. */
    const out=buf.slice();
    const odv=new DataView(out.buffer,out.byteOffset,out.byteLength);

    const mvhdVer=out[mvhd.p+8];
    if(mvhdVer!==0&&mvhdVer!==1)return buf;
    const timescale=mvhdVer===1?odv.getUint32(mvhd.p+28,false):odv.getUint32(mvhd.p+20,false);
    if(!timescale)return buf;
    const mvhdDuration=Math.max(0,Math.round(durationMs/1000*timescale));
    if(mvhdVer===1)odv.setBigUint64(mvhd.p+32,BigInt(mvhdDuration),false);
    else odv.setUint32(mvhd.p+24,mvhdDuration>>>0,false);

    for(const trak of traks){
      const tkhd=findChild(trak.dataStart,trak.dataEnd,'tkhd');
      if(!tkhd||tkhd.bail)return buf;
      const tkhdVer=out[tkhd.p+8];
      if(tkhdVer!==0&&tkhdVer!==1)return buf;
      if(tkhdVer===1)odv.setBigUint64(tkhd.p+36,BigInt(mvhdDuration),false);
      else odv.setUint32(tkhd.p+28,mvhdDuration>>>0,false);

      const mdia=findChild(trak.dataStart,trak.dataEnd,'mdia');
      if(!mdia||mdia.bail)return buf;
      const mdhd=findChild(mdia.dataStart,mdia.dataEnd,'mdhd');
      if(!mdhd||mdhd.bail)return buf;
      const mdhdVer=out[mdhd.p+8];
      if(mdhdVer!==0&&mdhdVer!==1)return buf;
      const mediaTs=mdhdVer===1?odv.getUint32(mdhd.p+28,false):odv.getUint32(mdhd.p+20,false);
      if(!mediaTs)return buf;
      const mdhdDuration=Math.max(0,Math.round(durationMs/1000*mediaTs));
      if(mdhdVer===1)odv.setBigUint64(mdhd.p+32,BigInt(mdhdDuration),false);
      else odv.setUint32(mdhd.p+24,mdhdDuration>>>0,false);
    }

    /* mvex>mehd is what fragmented-file parsers use for overall duration.
       No mvex at all means this isn't fragmented — the patches above are
       the whole fix. */
    const mvex=findChild(moov.dataStart,moov.dataEnd,'mvex');
    if(!mvex)return out;
    if(mvex.bail)return buf;
    const mehd=findChild(mvex.dataStart,mvex.dataEnd,'mehd');
    if(mehd&&mehd.bail)return buf;
    if(mehd){
      const mehdVer=out[mehd.p+8];
      if(mehdVer!==0&&mehdVer!==1)return buf;
      if(mehdVer===1)odv.setBigUint64(mehd.p+12,BigInt(mvhdDuration),false);
      else odv.setUint32(mehd.p+12,mvhdDuration>>>0,false);
      return out;
    }

    /* No mehd (the real-world Chromium case): insert a 16-byte v0 mehd box
       as the first child of mvex, then grow mvex's and moov's own sizes by
       16 and splice the new bytes in. */
    const mehdBox=new Uint8Array(16);
    const mdv=new DataView(mehdBox.buffer);
    mdv.setUint32(0,16,false);
    mehdBox.set([0x6d,0x65,0x68,0x64],4); // 'mehd'
    mdv.setUint32(8,0,false); // version(0) + flags(0)
    mdv.setUint32(12,mvhdDuration>>>0,false);

    if(mvex.rawSize!==0)odv.setUint32(mvex.p,mvex.size+16,false); // rawSize 0 == "to EOF", stays correct as-is
    if(moov.rawSize!==0)odv.setUint32(moov.p,moov.size+16,false);

    const insertAt=mvex.dataStart;
    const rebuilt=new Uint8Array(out.length+16);
    rebuilt.set(out.subarray(0,insertAt),0);
    rebuilt.set(mehdBox,insertAt);
    rebuilt.set(out.subarray(insertAt),insertAt+16);
    return rebuilt;
  }catch(e){
    return buf;
  }
}
