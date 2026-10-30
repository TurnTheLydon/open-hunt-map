// Minimal PMTiles v3 writer: clustered, deduplicated, gzip directories.
// Spec: https://github.com/protomaps/PMTiles/blob/main/spec/v3/spec.md
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { zxyToTileId } from 'pmtiles';

const HEADER_BYTES = 127;
const ROOT_MAX_BYTES = 16384 - HEADER_BYTES;

export class PMTilesWriter {
  tiles = []; // { id, data }

  add(z, x, y, data) {
    this.tiles.push({ id: zxyToTileId(z, x, y), data });
  }

  // header: { minZoom, maxZoom, bounds: [w, s, e, n], tileType, tileCompression }
  finish(header, metadata) {
    this.tiles.sort((a, b) => a.id - b.id);

    const chunks = [];
    const byHash = new Map();
    const entries = [];
    let dataLength = 0;
    for (const { id, data } of this.tiles) {
      const hash = createHash('sha1').update(data).digest('hex');
      let offset = byHash.get(hash);
      if (offset === undefined) {
        offset = dataLength;
        byHash.set(hash, offset);
        chunks.push(data);
        dataLength += data.length;
      }
      const last = entries.at(-1);
      if (last && last.offset === offset && last.tileId + last.runLength === id) {
        last.runLength++;
      } else {
        entries.push({ tileId: id, offset, length: data.length, runLength: 1 });
      }
    }

    const { root, leaves } = buildDirectories(entries);
    const meta = gzipSync(Buffer.from(JSON.stringify(metadata)));

    const rootOffset = HEADER_BYTES;
    const metaOffset = rootOffset + root.length;
    const leafOffset = metaOffset + meta.length;
    const dataOffset = leafOffset + leaves.length;

    const h = Buffer.alloc(HEADER_BYTES);
    h.write('PMTiles', 0, 'ascii');
    h.writeUInt8(3, 7);
    const u64 = (v, at) => h.writeBigUInt64LE(BigInt(v), at);
    u64(rootOffset, 8);
    u64(root.length, 16);
    u64(metaOffset, 24);
    u64(meta.length, 32);
    u64(leafOffset, 40);
    u64(leaves.length, 48);
    u64(dataOffset, 56);
    u64(dataLength, 64);
    u64(this.tiles.length, 72);
    u64(entries.length, 80);
    u64(chunks.length, 88);
    h.writeUInt8(1, 96); // clustered
    h.writeUInt8(2, 97); // internal compression: gzip
    h.writeUInt8(header.tileCompression, 98);
    h.writeUInt8(header.tileType, 99);
    h.writeUInt8(header.minZoom, 100);
    h.writeUInt8(header.maxZoom, 101);
    const [w, s, e, n] = header.bounds;
    const e7 = (v) => Math.round(v * 1e7);
    h.writeInt32LE(e7(w), 102);
    h.writeInt32LE(e7(s), 106);
    h.writeInt32LE(e7(e), 110);
    h.writeInt32LE(e7(n), 114);
    h.writeUInt8(header.minZoom, 118);
    h.writeInt32LE(e7((w + e) / 2), 119);
    h.writeInt32LE(e7((s + n) / 2), 123);

    return Buffer.concat([h, root, meta, leaves, ...chunks]);
  }
}

function buildDirectories(entries) {
  const root = serialize(entries);
  if (root.length <= ROOT_MAX_BYTES) return { root, leaves: Buffer.alloc(0) };

  for (let leafSize = 4096; ; leafSize *= 2) {
    const leafBufs = [];
    const rootEntries = [];
    let offset = 0;
    for (let i = 0; i < entries.length; i += leafSize) {
      const leaf = serialize(entries.slice(i, i + leafSize));
      rootEntries.push({ tileId: entries[i].tileId, offset, length: leaf.length, runLength: 0 });
      leafBufs.push(leaf);
      offset += leaf.length;
    }
    const root = serialize(rootEntries);
    if (root.length <= ROOT_MAX_BYTES) return { root, leaves: Buffer.concat(leafBufs) };
  }
}

function serialize(entries) {
  const out = [];
  const varint = (v) => {
    while (v >= 0x80) {
      out.push((v % 0x80) | 0x80);
      v = Math.floor(v / 0x80);
    }
    out.push(v);
  };
  varint(entries.length);
  let lastId = 0;
  for (const e of entries) {
    varint(e.tileId - lastId);
    lastId = e.tileId;
  }
  for (const e of entries) varint(e.runLength);
  for (const e of entries) varint(e.length);
  entries.forEach((e, i) => {
    const prev = entries[i - 1];
    varint(i > 0 && e.offset === prev.offset + prev.length ? 0 : e.offset + 1);
  });
  return gzipSync(Buffer.from(out));
}
