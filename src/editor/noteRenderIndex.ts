import { HOLD_CONNECTOR_TYPES, HOLD_START_TYPES, canTypeHaveParent } from '../constants/editorConstants';
import type { Note, TimedBpmChange } from '../types/editorTypes';
import { getBeatAtTime } from '../utils/editorUtils';
import { formatGroupedIds } from './editorHistory';

export interface NoteBeatEntry {
  note: Note;
  beat: number;
}

export interface HoldConnectorSegment {
  note: Note;
  parentNote: Note;
  noteBeat: number;
  parentBeat: number;
  minBeat: number;
  maxBeat: number;
}

export interface NoteRenderIndex {
  notesById: Map<number, Note>;
  noteBeats: Map<number, number>;
  noteBeatEntries: NoteBeatEntry[];
  holdConnectorSegments: HoldConnectorSegment[];
  groupedIdLabelsByNoteId: Map<number, string>;
  selectedParentNoteIds: Set<number>;
}

const findFirstNoteBeatEntryIndex = (entries: NoteBeatEntry[], beat: number) => {
  let low = 0;
  let high = entries.length;

  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (entries[mid].beat < beat) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  return low;
};

export const getNoteBeatEntriesInRange = (
  entries: NoteBeatEntry[],
  startBeat: number,
  endBeat: number,
) => {
  const matchingEntries: NoteBeatEntry[] = [];
  const firstEntryIndex = findFirstNoteBeatEntryIndex(entries, startBeat);

  for (let index = firstEntryIndex; index < entries.length; index += 1) {
    const entry = entries[index];
    if (entry.beat > endBeat) {
      break;
    }

    matchingEntries.push(entry);
  }

  return matchingEntries;
};

const getNoteIdGroupKey = (note: Note, noteBeat: number) => {
  const centerPosition = note.lane + note.width / 4;
  return `${noteBeat.toFixed(6)}:${centerPosition.toFixed(6)}`;
};

export const buildNoteRenderIndex = (
  notes: Note[],
  timedBpmChanges: TimedBpmChange[],
  selectedNoteIdSet: Set<number>,
): NoteRenderIndex => {
  const notesById = new Map<number, Note>();
  const noteBeats = new Map<number, number>();
  const noteBeatEntries: NoteBeatEntry[] = [];
  const holdConnectorSegments: HoldConnectorSegment[] = [];
  const groupedNoteIds = new Map<string, number[]>();
  const groupedIdLabelsByNoteId = new Map<number, string>();

  notes.forEach((note) => {
    const noteBeat = getBeatAtTime(note.time, timedBpmChanges);

    notesById.set(note.id, note);
    noteBeats.set(note.id, noteBeat);
    noteBeatEntries.push({ note, beat: noteBeat });

    const key = getNoteIdGroupKey(note, noteBeat);
    const groupedIds = groupedNoteIds.get(key);
    if (groupedIds) {
      groupedIds.push(note.id);
    } else {
      groupedNoteIds.set(key, [note.id]);
    }
  });

  noteBeatEntries.sort((a, b) => (a.beat - b.beat) || (a.note.id - b.note.id));

  groupedNoteIds.forEach((groupedIds) => {
    const label = formatGroupedIds(groupedIds);
    groupedIds.forEach((noteId) => {
      groupedIdLabelsByNoteId.set(noteId, label);
    });
  });

  const selectedParentNoteIds = new Set<number>();
  notes.forEach((note) => {
    if (selectedNoteIdSet.has(note.id) && canTypeHaveParent(note.type) && note.parentId !== null) {
      selectedParentNoteIds.add(note.parentId);
    }

    if (!HOLD_CONNECTOR_TYPES.includes(note.type) || HOLD_START_TYPES.includes(note.type) || note.parentId === null) {
      return;
    }

    const parentNote = notesById.get(note.parentId);
    const noteBeat = noteBeats.get(note.id);
    const parentBeat = parentNote ? noteBeats.get(parentNote.id) : undefined;

    if (!parentNote || noteBeat === undefined || parentBeat === undefined) {
      return;
    }

    holdConnectorSegments.push({
      note,
      parentNote,
      noteBeat,
      parentBeat,
      minBeat: Math.min(noteBeat, parentBeat),
      maxBeat: Math.max(noteBeat, parentBeat),
    });
  });

  holdConnectorSegments.sort((a, b) => (a.minBeat - b.minBeat) || (a.note.id - b.note.id));

  return {
    notesById,
    noteBeats,
    noteBeatEntries,
    holdConnectorSegments,
    groupedIdLabelsByNoteId,
    selectedParentNoteIds,
  };
};
