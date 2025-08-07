/**
 * Web Worker for parser module
 */

import { FileParser } from './parser.js';
import { Result } from './types.js';

interface WorkerMessage {
  id: string;
  type: 'parse';
  content: string;
  fileName: string;
}

interface WorkerResponse {
  id: string;
  result: Result;
}

const parser = new FileParser();

self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
  const { id, type, content, fileName } = event.data;

  if (type === 'parse') {
    try {
      const result = await parser.parseFile(content, fileName);

      const response: WorkerResponse = {
        id,
        result,
      };

      self.postMessage(response);
    } catch (error) {
      const response: WorkerResponse = {
        id,
        result: {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown worker error',
        },
      };

      self.postMessage(response);
    }
  }
};
