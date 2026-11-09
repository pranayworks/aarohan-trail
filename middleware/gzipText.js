// Small built-in gzip for text files (pages, scripts, styles, JSON). No extra package needed.
// Makes the apps load 3-4 times faster on slow mobile data. Skips live-connection traffic, media and ranges.
const zlib = require('zlib');
function gzipText(req, res, next) {
  if (req.method !== 'GET' || req.path.startsWith('/socket.io') || !/\bgzip\b/i.test(req.headers['accept-encoding'] || '')) return next();
  const origWrite = res.write, origEnd = res.end, chunks = [];
  let decided = false, compress = false;
  const toBuf = (c, enc) => (Buffer.isBuffer(c) ? c : Buffer.from(c, typeof enc === 'string' ? enc : 'utf8'));
  function decide() {
    if (decided) return; decided = true;
    const type = String(res.getHeader('Content-Type') || '');
    compress = /(text\/|javascript|json|svg|xml)/i.test(type) && !/event-stream/i.test(type) &&
      !res.getHeader('Content-Encoding') && ![204, 206, 304].includes(res.statusCode);
    if (compress) { res.removeHeader('Content-Length'); res.setHeader('Content-Encoding', 'gzip'); res.setHeader('Vary', 'Accept-Encoding'); }
  }
  res.write = function (chunk, enc, cb) {
    decide();
    if (!compress) return origWrite.apply(res, arguments);
    if (chunk) chunks.push(toBuf(chunk, enc));
    const done = typeof enc === 'function' ? enc : cb; if (typeof done === 'function') done();
    return true;
  };
  res.end = function (chunk, enc, cb) {
    decide();
    if (!compress) return origEnd.apply(res, arguments);
    if (chunk && typeof chunk !== 'function') chunks.push(toBuf(chunk, enc));
    const body = Buffer.concat(chunks);
    zlib.gzip(body, { level: 6 }, (err, out) => {
      if (err) { res.removeHeader('Content-Encoding'); res.setHeader('Content-Length', body.length); return origEnd.call(res, body); }
      res.setHeader('Content-Length', out.length); origEnd.call(res, out);
    });
    return res;
  };
  next();
}
module.exports = gzipText;
