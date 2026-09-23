// Theia's CLI calls a CommonJS function; the maintained upstream is ESM.
// Archive parsing and path/link validation remain entirely upstream.
module.exports = async (...args) => (await import('@xhmikosr/decompress')).default(...args);
