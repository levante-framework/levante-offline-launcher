// Serves the bundles built by ../pack-builder/build-bundles.mjs the way the public bucket
// would: static files, CORS for any origin, and HTTP Range requests (the launcher resumes a
// bundle download from the first missing entry's byte offset).
//
//   node serve-bundles.mjs [dir]     default dir ../pack-builder/bundles, port 4175 (PORT env)

import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';

const root = path.resolve(process.argv[2] || '../pack-builder/bundles');
const port = Number(process.env.PORT || 4175);
const types = { '.json': 'application/json', '.bin': 'application/octet-stream' };
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Range, Content-Type',
  'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
  'Accept-Ranges': 'bytes',
  'Cache-Control': 'no-cache',
};

createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors);
    return res.end();
  }
  const file = path.join(root, decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
  if (!file.startsWith(root)) {
    res.writeHead(403, cors);
    return res.end();
  }
  let st;
  try {
    st = await stat(file);
  } catch {
    res.writeHead(404, cors);
    return res.end('not found');
  }
  if (!st.isFile()) {
    res.writeHead(404, cors);
    return res.end('not found');
  }
  const type = types[path.extname(file)] || 'application/octet-stream';
  const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
  if (range) {
    const start = Number(range[1]);
    const end = range[2] ? Math.min(Number(range[2]), st.size - 1) : st.size - 1;
    if (start >= st.size || start > end) {
      res.writeHead(416, { ...cors, 'Content-Range': `bytes */${st.size}` });
      return res.end();
    }
    res.writeHead(206, { ...cors, 'Content-Type': type, 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${st.size}` });
    if (req.method === 'HEAD') return res.end();
    return createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { ...cors, 'Content-Type': type, 'Content-Length': st.size });
  if (req.method === 'HEAD') return res.end();
  createReadStream(file).pipe(res);
}).listen(port, '127.0.0.1', () => console.log(`serving bundles from ${root} at http://127.0.0.1:${port}`));
