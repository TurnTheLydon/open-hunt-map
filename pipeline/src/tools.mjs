// Locate external CLIs on PATH or in the repo's .tools/ folder.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT } from './paths.mjs';

export function findTool(name) {
  const exe = process.platform === 'win32' ? `${name}.exe` : name;
  for (const local of [join(ROOT, '.tools', exe), join(ROOT, '.tools', name, exe)]) {
    if (existsSync(local)) return local;
  }
  const res = spawnSync(process.platform === 'win32' ? 'where' : 'which', [name], { encoding: 'utf8' });
  return res.status === 0 ? res.stdout.split(/\r?\n/)[0].trim() : null;
}
