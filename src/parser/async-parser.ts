/**
 * Async parser using web workers
 */

import { Result } from './types.js';
import { FileParser } from './parser.js';

interface WorkerResponse {
  id: string;
  result: Result;
}

interface AsyncFileParserOptions {
  workerUrl?: string;
  parseTimeout?: number;
}

/**
 * Async parser that uses web workers for background processing
 */
export class AsyncFileParser {
  private worker: Worker | null = null;
  private pendingRequests = new Map<string, { resolve: Function; reject: Function }>();
  private requestCounter = 0;
  private workerUrl?: string;
  private parseTimeout: number;

  constructor(options?: AsyncFileParserOptions) {
    this.workerUrl = options?.workerUrl;
    this.parseTimeout = options?.parseTimeout ?? 30000;
    this.initWorker();
  }

  private initWorker(): void {
    try {
      // PLACEHOLDER: This will be replaced by build script with inlined worker code
      if (typeof window !== 'undefined') {
        // Build script replaces this entire section with inlined worker code - path is temporary placeholder
        this.worker = new Worker(this.workerUrl || './dist/worker.js', { type: 'module' });
      } else {
        this.worker = null;
        return;
      }

      this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        const { id, result } = event.data;
        const pending = this.pendingRequests.get(id);

        if (pending) {
          this.pendingRequests.delete(id);
          pending.resolve(result);
        }
      };

      this.worker.onerror = error => {
        console.warn('Worker error:', error);
        this.worker = null;
      };
    } catch (error) {
      console.warn('Failed to create worker:', error);
      this.worker = null;
    }
  }

  /**
   * Parse a file asynchronously using web worker
   */
  async parseFile(content: string, fileName: string): Promise<Result> {
    // Use synchronous parsing if worker not available
    if (!this.worker) {
      const syncParser = new FileParser();
      return syncParser.parseFile(content, fileName);
    }

    return new Promise((resolve, reject) => {
      const id = `req_${++this.requestCounter}`;

      this.pendingRequests.set(id, { resolve, reject });

      this.worker!.postMessage({
        id,
        type: 'parse',
        content,
        fileName,
      });

      // Timeout after configured time
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error('Parse timeout'));
        }
      }, this.parseTimeout);
    });
  }

  /**
   * Clean up worker resources
   */
  destroy(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.pendingRequests.clear();
  }
}
