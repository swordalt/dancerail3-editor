interface ZipFileEntry {
  name: string;
  data: Blob | ArrayBuffer | Uint8Array | string;
}

const textEncoder = new TextEncoder();

const crcTable = new Uint32Array(256);

for (let index = 0; index < crcTable.length; index += 1) {
  let value = index;

  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
  }

  crcTable[index] = value >>> 0;
}

const getCrc32 = (bytes: Uint8Array) => {
  let crc = 0xffffffff;

  for (const byte of bytes) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }

  return (crc ^ 0xffffffff) >>> 0;
};

const writeUint16 = (target: Uint8Array, offset: number, value: number) => {
  target[offset] = value & 0xff;
  target[offset + 1] = (value >>> 8) & 0xff;
};

const writeUint32 = (target: Uint8Array, offset: number, value: number) => {
  target[offset] = value & 0xff;
  target[offset + 1] = (value >>> 8) & 0xff;
  target[offset + 2] = (value >>> 16) & 0xff;
  target[offset + 3] = (value >>> 24) & 0xff;
};

const getDosDateTime = (date: Date) => {
  const year = Math.max(1980, date.getFullYear());
  const dosTime = (
    (date.getHours() << 11) |
    (date.getMinutes() << 5) |
    Math.floor(date.getSeconds() / 2)
  );
  const dosDate = (
    ((year - 1980) << 9) |
    ((date.getMonth() + 1) << 5) |
    date.getDate()
  );

  return { dosDate, dosTime };
};

const toBytes = async (data: ZipFileEntry['data']) => {
  if (typeof data === 'string') {
    return textEncoder.encode(data);
  }

  if (data instanceof Uint8Array) {
    return data;
  }

  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }

  return new Uint8Array(await data.arrayBuffer());
};

export const createZipBlob = async (entries: ZipFileEntry[]) => {
  const zipBuffer = await createZipBuffer(entries);

  return new Blob([zipBuffer], { type: 'application/zip' });
};

export const createZipBuffer = async (entries: ZipFileEntry[]) => {
  const fileRecords: Uint8Array[] = [];
  const centralRecords: Uint8Array[] = [];
  const now = new Date();
  const { dosDate, dosTime } = getDosDateTime(now);
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = textEncoder.encode(entry.name);
    const dataBytes = await toBytes(entry.data);
    const crc32 = getCrc32(dataBytes);
    const localHeader = new Uint8Array(30 + nameBytes.length);

    writeUint32(localHeader, 0, 0x04034b50);
    writeUint16(localHeader, 4, 20);
    writeUint16(localHeader, 6, 0x0800);
    writeUint16(localHeader, 8, 0);
    writeUint16(localHeader, 10, dosTime);
    writeUint16(localHeader, 12, dosDate);
    writeUint32(localHeader, 14, crc32);
    writeUint32(localHeader, 18, dataBytes.length);
    writeUint32(localHeader, 22, dataBytes.length);
    writeUint16(localHeader, 26, nameBytes.length);
    writeUint16(localHeader, 28, 0);
    localHeader.set(nameBytes, 30);

    const centralHeader = new Uint8Array(46 + nameBytes.length);

    writeUint32(centralHeader, 0, 0x02014b50);
    writeUint16(centralHeader, 4, 20);
    writeUint16(centralHeader, 6, 20);
    writeUint16(centralHeader, 8, 0x0800);
    writeUint16(centralHeader, 10, 0);
    writeUint16(centralHeader, 12, dosTime);
    writeUint16(centralHeader, 14, dosDate);
    writeUint32(centralHeader, 16, crc32);
    writeUint32(centralHeader, 20, dataBytes.length);
    writeUint32(centralHeader, 24, dataBytes.length);
    writeUint16(centralHeader, 28, nameBytes.length);
    writeUint16(centralHeader, 30, 0);
    writeUint16(centralHeader, 32, 0);
    writeUint16(centralHeader, 34, 0);
    writeUint16(centralHeader, 36, 0);
    writeUint32(centralHeader, 38, 0);
    writeUint32(centralHeader, 42, offset);
    centralHeader.set(nameBytes, 46);

    fileRecords.push(localHeader, dataBytes);
    centralRecords.push(centralHeader);
    offset += localHeader.length + dataBytes.length;
  }

  const centralDirectoryOffset = offset;
  const centralDirectorySize = centralRecords.reduce((sum, record) => sum + record.length, 0);
  const endRecord = new Uint8Array(22);

  writeUint32(endRecord, 0, 0x06054b50);
  writeUint16(endRecord, 4, 0);
  writeUint16(endRecord, 6, 0);
  writeUint16(endRecord, 8, entries.length);
  writeUint16(endRecord, 10, entries.length);
  writeUint32(endRecord, 12, centralDirectorySize);
  writeUint32(endRecord, 16, centralDirectoryOffset);
  writeUint16(endRecord, 20, 0);

  const output = new Uint8Array(offset + centralDirectorySize + endRecord.length);
  let outputOffset = 0;

  for (const record of [...fileRecords, ...centralRecords, endRecord]) {
    output.set(record, outputOffset);
    outputOffset += record.length;
  }

  return output.buffer;
};
