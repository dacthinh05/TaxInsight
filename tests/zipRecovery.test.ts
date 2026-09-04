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

  it('giải nén thành công tệp ZIP bị mất EOCD bằng cơ chế tổng hợp EOCD chuẩn khi Central Directory còn nguyên', () => {
    const xmlText = '<?xml version="1.0"?><HSoThue><TKhai>01/GTGT</TKhai><Tien>9999999</Tien></HSoThue>';
    const xmlBuf = Buffer.from(xmlText, 'utf-8');
    const deflated = zlib.deflateRawSync(xmlBuf);
    const fn = Buffer.from('01_GTGT.xml', 'utf-8');
    const realCrc = zlib.crc32(xmlBuf);
    // LFH
    const lfh = Buffer.alloc(30);
    lfh.write('PK\x03\x04', 0, 4, 'ascii');
    lfh.writeUInt16LE(20, 4);
    lfh.writeUInt16LE(0, 6);
    lfh.writeUInt16LE(8, 8);
    lfh.writeUInt32LE(realCrc, 14);
    lfh.writeUInt32LE(deflated.length, 18);
    lfh.writeUInt32LE(xmlBuf.length, 22);
    lfh.writeUInt16LE(fn.length, 26);
    lfh.writeUInt16LE(0, 28);

    // CDH (Central Directory Header)
    const cdh = Buffer.alloc(46);
    cdh.write('PK\x01\x02', 0, 4, 'ascii');
    cdh.writeUInt16LE(20, 4);
    cdh.writeUInt16LE(20, 6);
    cdh.writeUInt16LE(0, 8);
    cdh.writeUInt16LE(8, 10);
    cdh.writeUInt32LE(realCrc, 16);
    cdh.writeUInt32LE(deflated.length, 20);
    cdh.writeUInt32LE(xmlBuf.length, 24);
    cdh.writeUInt16LE(fn.length, 28);
    cdh.writeUInt16LE(0, 30);
    cdh.writeUInt16LE(0, 32);
    cdh.writeUInt32LE(0, 42); // relative offset of local header = 0

    // Ghép ZIP có Central Directory nhưng KHÔNG CÓ EOCD (PK\x05\x06)
    const zipMissingEocd = Buffer.concat([lfh, fn, deflated, cdh, fn]);
    const base64Content = zipMissingEocd.toString('base64');

    const filing = makeMockFiling('000.701.18.G12-260319-27110000158143');
    const result = ZipExtractor.extractBase64Zip(base64Content, tempDir, filing, '3700776724');

    expect(result).toBeDefined();
    expect(result.savedPaths.length).toBeGreaterThan(0);
    expect(result.xmlPath).toBeDefined();
    const savedContent = fs.readFileSync(result.xmlPath!, 'utf-8');
    expect(savedContent).toBe(xmlText);
  });

  it('giải nén thành công tệp ZIP streaming có compressedSize=0 và Data Descriptor (PK\\x07\\x08)', () => {
    const xmlText = '<?xml version="1.0"?><HSoThue><TKhai>01/GTGT</TKhai><Period>Thang 01/2026</Period></HSoThue>';
    const xmlBuf = Buffer.from(xmlText, 'utf-8');
    const deflated = zlib.deflateRawSync(xmlBuf);
    const fn = Buffer.from('Thang01.xml', 'utf-8');

    // LFH với compressedSize=0, uncompressedSize=0, flags=8 (Data Descriptor)
    const lfh = Buffer.alloc(30);
    lfh.write('PK\x03\x04', 0, 4, 'ascii');
    lfh.writeUInt16LE(20, 4);
    lfh.writeUInt16LE(8, 6); // flags: bit 3 set
    lfh.writeUInt16LE(8, 8); // method 8
    lfh.writeUInt32LE(0, 14); // crc = 0
    lfh.writeUInt32LE(0, 18); // compSize = 0!
    lfh.writeUInt32LE(0, 22); // uncompSize = 0!
    lfh.writeUInt16LE(fn.length, 26);
    lfh.writeUInt16LE(0, 28);

    // Data descriptor
    const dd = Buffer.alloc(16);
    dd.write('PK\x07\x08', 0, 4, 'ascii');
    dd.writeUInt32LE(0xabcdef01, 4);
    dd.writeUInt32LE(deflated.length, 8);
    dd.writeUInt32LE(xmlBuf.length, 12);

    // Truncated streaming zip: LFH + fn + deflated + dd (không có Central Directory hay EOCD)
    const streamingZip = Buffer.concat([lfh, fn, deflated, dd]);
    const base64Content = streamingZip.toString('base64');

    const filing = makeMockFiling('000.701.18.G12-260211-27110000127279');
    const result = ZipExtractor.extractBase64Zip(base64Content, tempDir, filing, '3700776724');

    expect(result).toBeDefined();
    expect(result.savedPaths.length).toBeGreaterThan(0);
    expect(result.xmlPath).toBeDefined();
    const savedContent = fs.readFileSync(result.xmlPath!, 'utf-8');
    expect(savedContent).toBe(xmlText);
  });

  it('cứu hộ XML khi buffer bị lỗi header ZIP nhưng chứa nội dung XML hồ sơ thuế hợp lệ', () => {
    const xmlText = '<?xml version="1.0" encoding="UTF-8"?><HSoThueDTu><TKhai>01/GTGT</TKhai><Msg>Recovered</Msg></HSoThueDTu>';
    // Buffer bắt đầu bằng PK rác hoặc hỏng, nhưng sau đó chứa XML hợp lệ
    const corruptedZipWithXml = Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x99, 0x99, 0x00, 0x11, 0x22]),
      Buffer.from(xmlText, 'utf-8')
    ]);
    const base64Content = corruptedZipWithXml.toString('base64');

    const filing = makeMockFiling('000.701.18.G12-260319-27110000158143');
    const result = ZipExtractor.extractBase64Zip(base64Content, tempDir, filing, '3700776724');

    expect(result).toBeDefined();
    expect(result.savedPaths.length).toBeGreaterThan(0);
    expect(result.xmlPath).toBeDefined();
    const savedContent = fs.readFileSync(result.xmlPath!, 'utf-8');
    expect(savedContent).toContain('<TKhai>01/GTGT</TKhai>');
  });
});
