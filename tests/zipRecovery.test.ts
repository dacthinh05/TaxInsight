import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import zlib from 'zlib';
import { ZipExtractor } from '../src/main/files/ZipExtractor';
import { TaxFiling } from '../src/shared/types';

describe('ZipExtractor — Phục hồi giải nén tệp ZIP thiếu END header (No END header found)', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tax_zip_recovery_'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });
  const makeMockFiling = (id = '000.701.18.G12-260120-27110000187063'): TaxFiling => ({
    id,
    title: 'Tờ khai thuế GTGT',
    declarationCode: '01/GTGT',
    period: 'Tháng 12/2025',
    taxType: 'VAT',
    filingType: 'ORIGINAL',
    downloadAvailable: true
  });

  it('giải nén thành công tệp XML từ ZIP bị mất phần End of Central Directory (Deflate method)', () => {
    const xmlText = '<?xml version="1.0"?><HSoThue><TKhai>01/GTGT</TKhai><SoTien>50000000</SoTien></HSoThue>';
    const xmlBuffer = Buffer.from(xmlText, 'utf-8');
    const filename = Buffer.from('ToKhai.xml', 'utf-8');

    // Nén deflate raw (-15 wbits)
    const deflated = zlib.deflateRawSync(xmlBuffer);

    // Xây dựng Local File Header (PK\x03\x04) chuẩn nhưng KHÔNG có Central Directory ở đuôi
    const header = Buffer.alloc(30);
    header.write('PK\x03\x04', 0, 4, 'ascii');
    header.writeUInt16LE(20, 4); // version
    header.writeUInt16LE(0, 6);  // flags
    header.writeUInt16LE(8, 8);  // method 8 = deflate
    header.writeUInt16LE(0, 10); // time
    header.writeUInt16LE(0, 12); // date
    header.writeUInt32LE(0x12345678, 14); // crc32
    header.writeUInt32LE(deflated.length, 18); // compressed size
    header.writeUInt32LE(xmlBuffer.length, 22); // uncompressed size
    header.writeUInt16LE(filename.length, 26); // filename length
    header.writeUInt16LE(0, 28); // extra length

    const truncatedZip = Buffer.concat([header, filename, deflated]);
    const base64Content = truncatedZip.toString('base64');

    // Chạy qua ZipExtractor
    const filing = makeMockFiling();
    const result = ZipExtractor.extractBase64Zip(base64Content, tempDir, filing, '3700776724');

    expect(result).toBeDefined();
    expect(result.savedPaths.length).toBeGreaterThan(0);
    expect(result.xmlPath).toBeDefined();

    const savedContent = fs.readFileSync(result.xmlPath!, 'utf-8');
    expect(savedContent).toBe(xmlText);
  });

  it('giải nén thành công tệp XML từ ZIP bị mất phần End of Central Directory (Stored method)', () => {
    const xmlText = '<?xml version="1.0"?><HSoThue><TKhai>05/KK-TNCN</TKhai></HSoThue>';
    const xmlBuffer = Buffer.from(xmlText, 'utf-8');
    const filename = Buffer.from('05_KK_TNCN.xml', 'utf-8');

    const header = Buffer.alloc(30);
    header.write('PK\x03\x04', 0, 4, 'ascii');
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0, 6);
    header.writeUInt16LE(0, 8); // method 0 = Stored
    header.writeUInt16LE(0, 10);
    header.writeUInt16LE(0, 12);
    header.writeUInt32LE(0x12345678, 14);
    header.writeUInt32LE(xmlBuffer.length, 18);
    header.writeUInt32LE(xmlBuffer.length, 22);
    header.writeUInt16LE(filename.length, 26);
    header.writeUInt16LE(0, 28);

    const truncatedZip = Buffer.concat([header, filename, xmlBuffer]);
    const base64Content = truncatedZip.toString('base64');

    const filing = makeMockFiling('000.701.18.G12-260120-27110000187064');
    const result = ZipExtractor.extractBase64Zip(base64Content, tempDir, filing, '3700776724');

    expect(result).toBeDefined();
    expect(result.savedPaths.length).toBeGreaterThan(0);
    const savedContent = fs.readFileSync(result.xmlPath!, 'utf-8');
    expect(savedContent).toBe(xmlText);
  });
});
