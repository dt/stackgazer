/**
 * Profparse module - Go stack trace parser
 *
 * Public API:
 * - FileParser: Synchronous parsing
 * - AsyncFileParser: Asynchronous parsing with web workers
 * - ZipHandler: Zip file utilities
 */

export * from './types.js';
export { FileParser } from './parser.js';
export { AsyncFileParser } from './async-parser.js';
export { ZipHandler } from './zip.js';

// Convenient aliases
export { FileParser as Parser } from './parser.js';
export { AsyncFileParser as AsyncParser } from './async-parser.js';
