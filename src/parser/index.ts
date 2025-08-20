/**
 * Profparse module - Go stack trace parser
 *
 * Public API:
 * - FileParser: Synchronous parsing
 * - ZipHandler: Zip file utilities
 */

export * from './types.js';
export { FileParser } from './parser.js';
export { ZipHandler } from './zip.js';

// Convenient aliases
export { FileParser as Parser } from './parser.js';
