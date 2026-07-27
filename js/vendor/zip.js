/* 아주 작은 ZIP 리더/라이터 (압축 없이 저장 = store 방식)
   사진(JPEG)은 이미 압축되어 있어 store로 충분합니다. */
(function (global) {
  const CRC = (() => {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[i] = c >>> 0;
    }
    return t;
  })();

  function crc32(u8) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function dosTime(d) {
    return ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() / 2)) & 0xFFFF;
  }
  function dosDate(d) {
    return (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xFFFF;
  }

  async function toU8(data) {
    if (data instanceof Uint8Array) return data;
    if (typeof data === 'string') return new TextEncoder().encode(data);
    if (data instanceof Blob) return new Uint8Array(await data.arrayBuffer());
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    throw new Error('지원하지 않는 데이터 형식');
  }

  /** files: [{name, data}] → Blob */
  async function makeZip(files) {
    const enc = new TextEncoder();
    const now = new Date();
    const time = dosTime(now), date = dosDate(now);
    const parts = [];
    const central = [];
    let offset = 0;

    for (const f of files) {
      const nameBuf = enc.encode(f.name);
      const body = await toU8(f.data);
      const crc = crc32(body);

      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true);
      lh.setUint16(4, 20, true);
      lh.setUint16(6, 0x0800, true);   // UTF-8 파일명
      lh.setUint16(8, 0, true);        // store
      lh.setUint16(10, time, true);
      lh.setUint16(12, date, true);
      lh.setUint32(14, crc, true);
      lh.setUint32(18, body.length, true);
      lh.setUint32(22, body.length, true);
      lh.setUint16(26, nameBuf.length, true);
      lh.setUint16(28, 0, true);
      parts.push(new Uint8Array(lh.buffer), nameBuf, body);

      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true);
      ch.setUint16(4, 20, true);
      ch.setUint16(6, 20, true);
      ch.setUint16(8, 0x0800, true);
      ch.setUint16(10, 0, true);
      ch.setUint16(12, time, true);
      ch.setUint16(14, date, true);
      ch.setUint32(16, crc, true);
      ch.setUint32(20, body.length, true);
      ch.setUint32(24, body.length, true);
      ch.setUint16(28, nameBuf.length, true);
      ch.setUint32(42, offset, true);
      central.push(new Uint8Array(ch.buffer), nameBuf);

      offset += 30 + nameBuf.length + body.length;
    }

    const cdSize = central.reduce((n, p) => n + p.length, 0);
    const eo = new DataView(new ArrayBuffer(22));
    eo.setUint32(0, 0x06054b50, true);
    eo.setUint16(8, files.length, true);
    eo.setUint16(10, files.length, true);
    eo.setUint32(12, cdSize, true);
    eo.setUint32(16, offset, true);

    return new Blob([...parts, ...central, new Uint8Array(eo.buffer)], { type: 'application/zip' });
  }

  /** Blob(zip) → [{name, blob}] (store 방식만 지원) */
  async function readZip(blob) {
    const u8 = new Uint8Array(await blob.arrayBuffer());
    const dv = new DataView(u8.buffer);
    let eocd = -1;
    for (let i = u8.length - 22; i >= 0 && i > u8.length - 66000; i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('올바른 zip 파일이 아닙니다.');
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const dec = new TextDecoder('utf-8');
    const out = [];

    for (let i = 0; i < count; i++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true);
      const csize = dv.getUint32(p + 20, true);
      const nlen = dv.getUint16(p + 28, true);
      const elen = dv.getUint16(p + 30, true);
      const clen = dv.getUint16(p + 32, true);
      const lho = dv.getUint32(p + 42, true);
      const name = dec.decode(u8.subarray(p + 46, p + 46 + nlen));
      p += 46 + nlen + elen + clen;

      if (method !== 0) { out.push({ name, blob: null, unsupported: true }); continue; }
      const lnlen = dv.getUint16(lho + 26, true);
      const lelen = dv.getUint16(lho + 28, true);
      const start = lho + 30 + lnlen + lelen;
      out.push({ name, blob: new Blob([u8.subarray(start, start + csize)]) });
    }
    return out;
  }

  global.ZipKit = { makeZip, readZip };
})(window);
