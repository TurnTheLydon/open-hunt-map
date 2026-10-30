// Where published tiles live: a local folder for development, or any S3-compatible bucket
// (Cloudflare R2, AWS S3, MinIO) when S3_BUCKET is set.
import { copyFileSync, createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { PUBLISH_DIR } from './paths.mjs';

// Tile files are versioned by name, so they never change once written.
export const IMMUTABLE = 'public, max-age=31536000, immutable';
export const REVALIDATE = 'public, max-age=60, must-revalidate';

class LocalStorage {
  describe = () => PUBLISH_DIR;

  async putFile(key, path) {
    mkdirSync(dirname(join(PUBLISH_DIR, key)), { recursive: true });
    copyFileSync(path, join(PUBLISH_DIR, key));
  }

  async putJson(key, value) {
    mkdirSync(dirname(join(PUBLISH_DIR, key)), { recursive: true });
    writeFileSync(join(PUBLISH_DIR, key), JSON.stringify(value, null, 2) + '\n');
  }

  async getJson(key) {
    const path = join(PUBLISH_DIR, key);
    return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null;
  }

  async list(prefix) {
    const folder = prefix.slice(0, prefix.lastIndexOf('/') + 1);
    const dir = join(PUBLISH_DIR, folder);
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .map((name) => folder + name)
      .filter((key) => key.startsWith(prefix));
  }

  async delete(key) {
    rmSync(join(PUBLISH_DIR, key), { force: true });
  }
}

class S3Storage {
  constructor() {
    this.bucket = process.env.S3_BUCKET;
  }

  describe = () => `s3://${this.bucket}`;

  async client() {
    if (!this._client) {
      const { S3Client } = await import('@aws-sdk/client-s3');
      this._client = new S3Client({
        region: process.env.S3_REGION ?? 'auto',
        endpoint: process.env.S3_ENDPOINT,
        credentials: {
          accessKeyId: process.env.S3_ACCESS_KEY_ID,
          secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
        },
      });
    }
    return this._client;
  }

  async putFile(key, path, { cacheControl = IMMUTABLE, contentType = 'application/octet-stream' } = {}) {
    const { Upload } = await import('@aws-sdk/lib-storage');
    const upload = new Upload({
      client: await this.client(),
      params: { Bucket: this.bucket, Key: key, Body: createReadStream(path), CacheControl: cacheControl, ContentType: contentType },
      partSize: 64 * 1024 * 1024,
      queueSize: 4,
    });
    await upload.done();
  }

  async putJson(key, value) {
    const { PutObjectCommand } = await import('@aws-sdk/client-s3');
    await (await this.client()).send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: JSON.stringify(value, null, 2) + '\n',
        ContentType: 'application/json',
        CacheControl: REVALIDATE,
      }),
    );
  }

  async getJson(key) {
    const { GetObjectCommand, NoSuchKey } = await import('@aws-sdk/client-s3');
    try {
      const res = await (await this.client()).send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      return JSON.parse(await res.Body.transformToString());
    } catch (err) {
      if (err instanceof NoSuchKey || err.name === 'NoSuchKey') return null;
      throw err;
    }
  }

  async list(prefix) {
    const { ListObjectsV2Command } = await import('@aws-sdk/client-s3');
    const keys = [];
    let token;
    do {
      const res = await (await this.client()).send(
        new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, ContinuationToken: token }),
      );
      for (const o of res.Contents ?? []) keys.push(o.Key);
      token = res.NextContinuationToken;
    } while (token);
    return keys;
  }

  async delete(key) {
    const { DeleteObjectCommand } = await import('@aws-sdk/client-s3');
    await (await this.client()).send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

export const storage = process.env.S3_BUCKET ? new S3Storage() : new LocalStorage();
