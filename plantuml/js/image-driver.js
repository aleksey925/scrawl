import { zlibSync } from "fflate";

const scrawlRgbOnly = 1;

const scrawlCrcTable = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function scrawlCrc(bytes) {
  let c = -1;
  for (const byte of bytes) {
    c = scrawlCrcTable[(c ^ byte) & 255] ^ (c >>> 8);
  }
  return (c ^ -1) >>> 0;
}

function scrawlChunk(type, data) {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) {
    out[4 + i] = type.charCodeAt(i);
  }
  out.set(data, 8);
  view.setUint32(8 + data.length, scrawlCrc(out.subarray(4, 8 + data.length)));
  return out;
}

function scrawlPng(width, height, argb, opaque) {
  const rows = new Uint8Array((width * 4 + 1) * height);
  let at = 0;
  for (let y = 0; y < height; y++) {
    rows[at++] = 0;
    for (let x = 0; x < width; x++) {
      const pixel = argb[y * width + x];
      rows[at++] = (pixel >>> 16) & 255;
      rows[at++] = (pixel >>> 8) & 255;
      rows[at++] = pixel & 255;
      rows[at++] = opaque ? 255 : (pixel >>> 24) & 255;
    }
  }
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header[8] = 8;
  header[9] = 6;
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    scrawlChunk("IHDR", header),
    scrawlChunk("IDAT", zlibSync(rows, { level: 9 })),
    scrawlChunk("IEND", new Uint8Array(0)),
  ];
  const png = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    png.set(part, offset);
    offset += part.length;
  }
  return png;
}

const scrawlBase64Digits = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function scrawlBase64(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const triple = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += scrawlBase64Digits[(triple >>> 18) & 63] + scrawlBase64Digits[(triple >>> 12) & 63];
    out += i + 1 < bytes.length ? scrawlBase64Digits[(triple >>> 6) & 63] : "=";
    out += i + 2 < bytes.length ? scrawlBase64Digits[triple & 63] : "=";
  }
  return out;
}

const scrawlImageDriver = {
  $draw0(shape, x, y, mapper, param, svg) {
    const image = na_PixelImage_getImage(shape.$image1);
    const width = image.$width2;
    const height = image.$height4;
    if (!svg.$hidden) {
      const png = scrawlPng(width, height, image.$pixels.data, image.$imageType === scrawlRgbOnly);
      const node = nspkds_XmlDocument_createElement(svg.$document, $rt_str("image"));
      nspkds_XmlNode_setAttribute(node, $rt_str("width"), nspkds_SvgGraphics_format(svg, width));
      nspkds_XmlNode_setAttribute(node, $rt_str("height"), nspkds_SvgGraphics_format(svg, height));
      nspkds_XmlNode_setAttribute(node, $rt_str("x"), nspkds_SvgGraphics_format(svg, x));
      nspkds_XmlNode_setAttribute(node, $rt_str("y"), nspkds_SvgGraphics_format(svg, y));
      nspkds_XmlNode_setAttribute(node, $rt_str("href"), $rt_str(`data:image/png;base64,${scrawlBase64(png)}`));
      nspkds_XmlNode_appendChild(nspkds_SvgGraphics_getG(svg), node);
    }
    nspkds_SvgGraphics_ensureVisible(svg, x, y);
    nspkds_SvgGraphics_ensureVisible(svg, x + width, y + height);
  },
};
