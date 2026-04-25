export interface NoteTypeDefinition {
  name: string;
  color: string;
  sound: string | null;
}

export const UNKNOWN_NOTE_TYPE: NoteTypeDefinition = {
  name: 'Unknown',
  color: '#ffffff',
  sound: null,
};

export const HOLD_CONNECTOR_TYPES = [3, 4, 5, 6, 7, 8, 10, 11, 17, 18, 19, 20, 21, 22, 23, 24];
export const HOLD_START_TYPES = [3, 5, 10];
export const HOLD_CENTER_TYPES = [6, 11, 17, 19, 21, 23];
export const HOLD_END_TYPES = [4, 7, 18, 20, 22, 24];

export const canTypeHaveParent = (type: number) => HOLD_CENTER_TYPES.includes(type) || HOLD_END_TYPES.includes(type);
export const shouldOmitParentForType = (type: number) => !canTypeHaveParent(type);

export const getConnectorFill = (noteType: number) => {
  const color = (NOTE_TYPES[noteType] || UNKNOWN_NOTE_TYPE).color;
  const alpha = [10, 17, 18].includes(noteType) ? '70' : '40';
  return `${color}${alpha}`;
};

export const NOTE_TYPES: Record<number, NoteTypeDefinition> = {
  1: { name: 'Blue Tap', color: '#3b82f6', sound: 'hit.ogg' },
  2: { name: 'Yellow Tap', color: '#eab308', sound: 'hit.ogg' },
  3: { name: 'Orange Hold Start', color: '#fdba74', sound: 'hit.ogg' },
  4: { name: 'Orange Hold End', color: '#fdba74', sound: 'hit.ogg' },
  5: { name: 'Blue Hold Start', color: '#93c5fd', sound: 'hit.ogg' },
  6: { name: 'Blue Hold Center', color: '#93c5fd', sound: null },
  7: { name: 'Blue Hold End', color: '#93c5fd', sound: 'hit.ogg' },
  9: { name: 'Circle Flick', color: '#22d3ee', sound: 'flick.ogg' },
  10: { name: 'Damage', color: '#7f1d1d', sound: 'hit.ogg' },
  11: { name: 'Orange Hold Center', color: '#fdba74', sound: null },
  13: { name: 'Flick Left', color: '#06b6d4', sound: 'flick.ogg' },
  14: { name: 'Flick Right', color: '#d946ef', sound: 'flick.ogg' },
  15: { name: 'Flick Up', color: '#86efac', sound: 'flick.ogg' },
  16: { name: 'Flick Down', color: '#a855f7', sound: 'flick.ogg' },
  17: { name: 'Damage Middle', color: '#7f1d1d', sound: null },
  18: { name: 'Damage End', color: '#7f1d1d', sound: 'hit.ogg' },
  19: { name: 'Green Hold Center', color: '#22c55e', sound: null },
  20: { name: 'Green Hold End', color: '#22c55e', sound: 'hit.ogg' },
  21: { name: 'Yellow Hold Center', color: '#eab308', sound: null },
  22: { name: 'Yellow Hold End', color: '#eab308', sound: 'hit.ogg' },
  23: { name: 'Pink Hold Center', color: '#ec4899', sound: null },
  24: { name: 'Pink Hold End', color: '#ec4899', sound: 'hit.ogg' },
};

export const AVAILABLE_NOTE_TYPES = [1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24];
