import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './paths.js';

export const desyncCapabilities = JSON.parse(
  fs.readFileSync(
    path.join(ROOT, 'tests/fixtures/desync_capabilities.json'),
    'utf8',
  ),
);
export const desyncContract = JSON.parse(
  fs.readFileSync(
    path.join(ROOT, 'tests/fixtures/desync_extensions.json'),
    'utf8',
  ),
);
