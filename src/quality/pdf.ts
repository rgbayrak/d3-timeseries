// Minimal PDF writer: one JPEG image per page, scaled to fill the page.
// Dependency-free; JPEG data is embedded as-is (DCTDecode), so no image
// decoding or compression is needed here.

export interface PdfPageImage {
  /** JPEG file bytes */
  jpeg: Uint8Array;
  /** Pixel size of the JPEG */
  width: number;
  height: number;
}

/** A4 landscape in PDF points (1/72 in) */
export const A4_LANDSCAPE = { width: 842, height: 595 };

const encoder = new TextEncoder();

/**
 * Build a PDF with one page per image. Each page is `pageSize` points and the
 * image is stretched to fill it, so images should share the page's aspect ratio.
 */
export function buildPdf(pages: PdfPageImage[], pageSize = A4_LANDSCAPE): Uint8Array {
  const chunks: Uint8Array[] = [];
  let length = 0;
  const offsets: number[] = []; // byte offset of object i+1

  const push = (data: string | Uint8Array) => {
    const bytes = typeof data === 'string' ? encoder.encode(data) : data;
    chunks.push(bytes);
    length += bytes.length;
  };
  const beginObject = (id: number) => {
    offsets[id - 1] = length;
    push(`${id} 0 obj\n`);
  };

  // Object ids: 1 catalog, 2 page tree, then per page: page, content, image
  const pageId = (i: number) => 3 + i * 3;
  const contentId = (i: number) => 4 + i * 3;
  const imageId = (i: number) => 5 + i * 3;
  const { width: W, height: H } = pageSize;

  // Header; the comment of non-ASCII bytes marks the file as binary for transfer tools
  push('%PDF-1.4\n%âãÏÓ\n');

  beginObject(1);
  push('<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

  beginObject(2);
  const kids = pages.map((_, i) => `${pageId(i)} 0 R`).join(' ');
  push(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>\nendobj\n`);

  pages.forEach((page, i) => {
    beginObject(pageId(i));
    push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] ` +
        `/Resources << /XObject << /Im0 ${imageId(i)} 0 R >> >> /Contents ${contentId(i)} 0 R >>\nendobj\n`,
    );

    const content = `q ${W} 0 0 ${H} 0 0 cm /Im0 Do Q\n`;
    beginObject(contentId(i));
    push(`<< /Length ${encoder.encode(content).length} >>\nstream\n${content}endstream\nendobj\n`);

    beginObject(imageId(i));
    push(
      `<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.length} >>\nstream\n`,
    );
    push(page.jpeg);
    push('\nendstream\nendobj\n');
  });

  const xrefOffset = length;
  const count = 2 + pages.length * 3;
  let xref = `xref\n0 ${count + 1}\n0000000000 65535 f \n`;
  for (let i = 0; i < count; i++) xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  push(xref);
  push(`trailer\n<< /Size ${count + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);

  const out = new Uint8Array(length);
  let pos = 0;
  for (const c of chunks) {
    out.set(c, pos);
    pos += c.length;
  }
  return out;
}
