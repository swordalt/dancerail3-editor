import type { ExportWorkerPayload, ExportWorkerResponse } from '../types/exportTypes';

interface PendingExportRequest {
  resolve: (result: { zipBuffer: ArrayBuffer; suggestedName: string }) => void;
  reject: (error: Error) => void;
}

let exportWorker: Worker | null = null;
let nextRequestId = 1;
const pendingRequests = new Map<number, PendingExportRequest>();

const createWorker = () => {
  const worker = new Worker(new URL('../workers/exportWorker.ts', import.meta.url), {
    type: 'module',
  });

  worker.onmessage = (event: MessageEvent<ExportWorkerResponse>) => {
    const response = event.data;
    const pendingRequest = pendingRequests.get(response.requestId);

    if (!pendingRequest) {
      return;
    }

    pendingRequests.delete(response.requestId);

    if (response.ok) {
      pendingRequest.resolve({
        zipBuffer: response.zipBuffer,
        suggestedName: response.suggestedName,
      });
      return;
    }

    pendingRequest.reject(new Error(response.error || 'Export worker failed'));
  };

  worker.onerror = (event) => {
    const error = new Error(event.message || 'Export worker failed');

    for (const pendingRequest of pendingRequests.values()) {
      pendingRequest.reject(error);
    }

    pendingRequests.clear();
    worker.terminate();
    if (exportWorker === worker) {
      exportWorker = null;
    }
  };

  return worker;
};

const getExportWorker = () => {
  if (!exportWorker) {
    exportWorker = createWorker();
  }

  return exportWorker;
};

export const warmExportWorker = () => {
  const requestId = nextRequestId;
  nextRequestId += 1;

  getExportWorker().postMessage({
    type: 'warmup',
    requestId,
  });
};

export const createExportZipInWorker = (payload: ExportWorkerPayload) => (
  new Promise<{ zipBuffer: ArrayBuffer; suggestedName: string }>((resolve, reject) => {
    const requestId = nextRequestId;
    nextRequestId += 1;

    pendingRequests.set(requestId, { resolve, reject });

    try {
      getExportWorker().postMessage({
        type: 'export',
        requestId,
        payload,
      });
    } catch (err) {
      pendingRequests.delete(requestId);
      reject(err instanceof Error ? err : new Error('Export worker failed'));
    }
  })
);
