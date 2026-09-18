const path = require('node:path');
function privateHtmlName(requestPath) {
  let decoded;
  try { decoded = decodeURIComponent(requestPath).replace(/\\/g, '/'); } catch { return null; }
  if (/^\/+$/u.test(decoded)) return 'index.html';
  const match = decoded.match(/(?:^|\/)(index|overlay|v1)\.html[. ]*\/*$/i);
  return match ? `${match[1].toLowerCase()}.html` : null;
}
function safeAvatarPath(root, filename) {
  if (typeof filename !== 'string' || !filename || /[\\/\0:]/.test(filename) || !/\.(jpe?g|png|gif|webp|avif)$/i.test(filename)) return null;
  const directory = path.resolve(root), candidate = path.resolve(directory, filename);
  const relative = path.relative(directory, candidate);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return candidate;
}
module.exports = { privateHtmlName, safeAvatarPath };
