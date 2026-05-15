// Script para generar los iconos PNG de la PWA
// Correr con: node generate-icons.js

const fs = require("fs");
const path = require("path");

// Genera un PNG simple (cuadrado azul con letra S) sin dependencias externas
// usando solo Buffer y el formato PNG manual (IHDR + IDAT + IEND)

const zlib = require("zlib");

function createPNG(size) {
  const width = size;
  const height = size;

  // Color de fondo: #0f172a (azul muy oscuro)
  // Color acento:  #3b82f6 (azul eléctrico)

  // Construir datos de píxeles (RGBA)
  const pixels = Buffer.alloc(width * height * 4);
  const cx = width / 2;
  const cy = height / 2;
  const r = width * 0.38;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const cornerR = width * 0.18;

      // Esquinas redondeadas (máscara)
      const inRoundedRect =
        x >= cornerR &&
        x <= width - cornerR &&
        y >= cornerR &&
        y <= height - cornerR;
      const inCornerCircle =
        (x < cornerR && y < cornerR && Math.sqrt((x - cornerR) ** 2 + (y - cornerR) ** 2) < cornerR) ||
        (x > width - cornerR && y < cornerR && Math.sqrt((x - (width - cornerR)) ** 2 + (y - cornerR) ** 2) < cornerR) ||
        (x < cornerR && y > height - cornerR && Math.sqrt((x - cornerR) ** 2 + (y - (height - cornerR)) ** 2) < cornerR) ||
        (x > width - cornerR && y > height - cornerR && Math.sqrt((x - (width - cornerR)) ** 2 + (y - (height - cornerR)) ** 2) < cornerR);

      const inside = inRoundedRect || inCornerCircle;

      if (!inside) {
        // Transparente fuera del rect redondeado
        pixels[i] = 0; pixels[i+1] = 0; pixels[i+2] = 0; pixels[i+3] = 0;
        continue;
      }

      // Fondo degradado oscuro
      const grad = Math.floor(15 + (y / height) * 8);
      let rr = grad, gg = grad + 4, bb = grad + 20;

      // Círculo de acento
      if (dist < r && dist > r * 0.72) {
        const alpha = 1 - Math.abs(dist - r * 0.86) / (r * 0.14);
        rr = Math.floor(rr + 59 * alpha);
        gg = Math.floor(gg + 130 * alpha);
        bb = Math.floor(bb + 246 * alpha);
      }

      // Ícono de bastón simplificado (línea vertical + punto)
      const stickX = cx;
      const stickTop = cy - r * 0.55;
      const stickBot = cy + r * 0.55;
      const stickW = width * 0.025;
      if (Math.abs(x - stickX) < stickW && y > stickTop && y < stickBot) {
        rr = 255; gg = 255; bb = 255;
      }
      // Dot arriba (cabeza)
      if (dist < width * 0.05 && Math.sqrt((x-cx)**2 + (y-(cy-r*0.42))**2) < width * 0.05) {
        rr = 59; gg = 130; bb = 246;
      }

      pixels[i]   = Math.min(255, rr);
      pixels[i+1] = Math.min(255, gg);
      pixels[i+2] = Math.min(255, bb);
      pixels[i+3] = 255;
    }
  }

  // Construir raw PNG data (filtro None = 0x00 por fila)
  const rowSize = width * 4 + 1;
  const rawData = Buffer.alloc(height * rowSize);
  for (let y = 0; y < height; y++) {
    rawData[y * rowSize] = 0; // filter type None
    pixels.copy(rawData, y * rowSize + 1, y * width * 4, (y + 1) * width * 4);
  }

  const compressed = zlib.deflateSync(rawData);

  // Chunks
  function chunk(type, data) {
    const buf = Buffer.alloc(12 + data.length);
    buf.writeUInt32BE(data.length, 0);
    buf.write(type, 4, "ascii");
    data.copy(buf, 8);
    const crc = crc32(Buffer.concat([Buffer.from(type, "ascii"), data]));
    buf.writeUInt32BE(crc, 8 + data.length);
    return buf;
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", compressed), chunk("IEND", Buffer.alloc(0))]);
}

// CRC32
function crc32(buf) {
  const table = makeCRCTable();
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xFF];
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
function makeCRCTable() {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
}

// Generar y guardar
const outDir = path.join(__dirname, "public", "icons");
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

for (const size of [192, 512]) {
  const png = createPNG(size);
  const out = path.join(outDir, `icon-${size}.png`);
  fs.writeFileSync(out, png);
  console.log(`✅ Generado: public/icons/icon-${size}.png (${size}x${size})`);
}

console.log("\n🎉 Iconos listos. Ahora corré: git add . && git commit -m 'add icons' && git push");
