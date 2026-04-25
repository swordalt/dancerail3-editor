import type { BpmChange, Note, ProjectData, SpeedChange } from './editorTypes';

export type ExportFormat = 'dr3-viewer' | 'dr3-fp';

export interface ExportWorkerPayload {
  format: ExportFormat;
  projectData: ProjectData;
  notes: Note[];
  bpmChanges: BpmChange[];
  speedChanges: SpeedChange[];
  offset: string | number;
}

export interface ExportWorkerExportRequest {
  type: 'export';
  requestId: number;
  payload: ExportWorkerPayload;
}

export interface ExportWorkerWarmupRequest {
  type: 'warmup';
  requestId: number;
}

export type ExportWorkerRequest = ExportWorkerExportRequest | ExportWorkerWarmupRequest;

export interface ExportWorkerSuccess {
  requestId: number;
  ok: true;
  zipBuffer: ArrayBuffer;
  suggestedName: string;
}

export interface ExportWorkerFailure {
  requestId: number;
  ok: false;
  error: string;
}

export type ExportWorkerResponse = ExportWorkerSuccess | ExportWorkerFailure;
