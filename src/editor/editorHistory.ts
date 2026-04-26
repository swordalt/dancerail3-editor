import { NOTE_TYPES } from '../constants/editorConstants';
import type { Note } from '../types/editorTypes';

export type OperationCategory = 'note' | 'timing' | 'speed' | 'metadata';

export interface OperationHistoryEntry {
  id: number;
  timestamp: number;
  category: OperationCategory;
  title: string;
  detail: string;
}

export const MAX_OPERATION_HISTORY_ENTRIES = 500;

export const formatGroupedIds = (ids: number[]) => {
  const sortedIds = [...ids].sort((a, b) => a - b);
  const segments: string[] = [];
  let rangeStart = sortedIds[0];
  let previousId = sortedIds[0];

  for (let index = 1; index <= sortedIds.length; index += 1) {
    const currentId = sortedIds[index];
    const continuesRange = currentId === previousId + 1;

    if (continuesRange) {
      previousId = currentId;
      continue;
    }

    segments.push(
      rangeStart === previousId ? `${rangeStart}` : `${rangeStart}-${previousId}`,
    );

    rangeStart = currentId;
    previousId = currentId;
  }

  return segments.join(',');
};

export const formatHistoryTimestamp = (timestamp: number) => (
  new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(timestamp)
);

export const formatHistoryNumber = (value: number) => (
  Number.isInteger(value) ? value.toString() : Number(value.toFixed(3)).toString()
);

export const formatPlaybackSpeed = (speed: number) => `${formatHistoryNumber(speed)}x`;

export const formatMaybeValue = (value: unknown) => (
  value === undefined || value === null || value === '' ? 'None' : String(value)
);

export const formatNoteName = (note: Note) => NOTE_TYPES[note.type]?.name || `Type ${note.type}`;

export const formatNoteLane = (lane: number) => formatHistoryNumber(lane);

export const formatTimingPosition = (timepos: number) => `Timepos ${formatHistoryNumber(timepos)}`;

export const operationCategoryStyles: Record<OperationCategory, string> = {
  note: 'border-sky-500/30 bg-sky-500/10 text-sky-200',
  timing: 'border-amber-500/30 bg-amber-500/10 text-amber-200',
  speed: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200',
  metadata: 'border-violet-500/30 bg-violet-500/10 text-violet-200',
};
