// Decoder for the compact TEFM mesh / point format written by tools/meshcodec.py.
// Layout: header (40 B) | u16 positions | [u8 scalar] | [u8 rgb] | [u32 n + LEB128 face stream].

const FLAG_FACES = 1, FLAG_SCALAR = 2, FLAG_RGB = 4;

export async function fetchTEFM(url, onProgress) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  // Fetch decodes compressed responses, but Content-Length describes the compressed bytes.
  const encoding = res.headers.get('Content-Encoding');
  const total = !encoding || encoding === 'identity'
    ? Number(res.headers.get('Content-Length')) || 0 : 0;
  if (!res.body || !onProgress || !total) {
    const buffer = await res.arrayBuffer();
    if (onProgress) onProgress(1);
    return decodeTEFM(buffer);
  }
  const reader = res.body.getReader();
  const out = new Uint8Array(total);
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out.set(value, got);
    got += value.length;
    onProgress(got / total);
  }
  return decodeTEFM(out.buffer);
}

export function decodeTEFM(buf) {
  const dv = new DataView(buf);
  const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
  if (magic !== 'TEFM') throw new Error('Not a TEFM file');
  const flags = dv.getUint8(5);
  const nv = dv.getUint32(8, true), nf = dv.getUint32(12, true);
  const lo = [0, 1, 2].map(k => dv.getFloat32(16 + 4 * k, true));
  const hi = [0, 1, 2].map(k => dv.getFloat32(28 + 4 * k, true));
  let off = 40;
  const q = new Uint16Array(buf, off, nv * 3);
  off += nv * 6;
  const positions = new Float32Array(nv * 3);
  const s = [0, 1, 2].map(k => (hi[k] - lo[k]) / 65535);
  for (let i = 0; i < nv * 3; i += 3) {
    positions[i] = lo[0] + q[i] * s[0];
    positions[i + 1] = lo[1] + q[i + 1] * s[1];
    positions[i + 2] = lo[2] + q[i + 2] * s[2];
  }
  let scalar = null, rgb = null, index = null;
  if (flags & FLAG_SCALAR) { scalar = new Uint8Array(buf, off, nv); off += nv; }
  if (flags & FLAG_RGB) { rgb = new Uint8Array(buf, off, nv * 3); off += nv * 3; }
  if (flags & FLAG_FACES) {
    const n = dv.getUint32(off, true);
    off += 4;
    const bytes = new Uint8Array(buf, off, n);
    index = new Uint32Array(nf * 3);
    let p = 0, next = 0;
    for (let i = 0; i < nf * 3; i++) {
      let code = 0, mul = 1, b;
      do { b = bytes[p++]; code += (b & 127) * mul; mul *= 128; } while (b & 128);
      index[i] = code === 0 ? next++ : next - code;
    }
  }
  return { nv, nf, positions, scalar, rgb, index, bboxMin: lo, bboxMax: hi };
}

// sRGB byte -> linear float, for vertex colours (three.js treats colour attributes as linear).
export const SRGB_TO_LINEAR = new Float32Array(256).map((_, i) => {
  const c = i / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
});

// Turbo colormap (Google's polynomial approximation), returns sRGB in 0..1.
export function turbo(t) {
  t = Math.min(1, Math.max(0, t));
  const r = 0.13572138 + t * (4.61539260 + t * (-42.66032258 + t * (132.13108234 + t * (-152.94239396 + t * 59.28637943))));
  const g = 0.09140261 + t * (2.19418839 + t * (4.84296658 + t * (-14.18503333 + t * (4.27729857 + t * 2.82956604))));
  const b = 0.10667330 + t * (12.64194608 + t * (-60.58204836 + t * (110.36276771 + t * (-89.90310912 + t * 27.34824973))));
  return [r, g, b].map(v => Math.min(1, Math.max(0, v)));
}

export function toLinear(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
