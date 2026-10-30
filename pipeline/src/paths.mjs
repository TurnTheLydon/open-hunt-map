import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';

export const ROOT = resolve(fileURLToPath(import.meta.url), '../../..');
export const SOURCES_DIR = join(ROOT, 'pipeline', 'sources');
export const DATA_DIR = join(ROOT, 'data');
// Where the app reads tiles from. Locally that's the web app's public folder; in
// production the same files go to object storage behind a CDN.
export const PUBLISH_DIR = process.env.PUBLISH_DIR ?? join(ROOT, 'apps', 'web', 'public', 'tiles');
