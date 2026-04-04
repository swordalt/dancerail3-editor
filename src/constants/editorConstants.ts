export const NOTE_TYPES: Record<number, { name: string, color: string, sound: string | null }> = {
  1: { name: 'Blue Tap', color: '#3b82f6', sound: 'hit.ogg' },
  2: { name: 'Yellow Tap', color: '#eab308', sound: 'hit.ogg' },
  3: { name: 'Orange Hold Start', color: '#f97316', sound: 'hit.ogg' },
  4: { name: 'Orange Hold End', color: '#f97316', sound: 'hit.ogg' },
  5: { name: 'Blue Hold Start', color: '#3b82f6', sound: 'hit.ogg' },
  6: { name: 'Blue Hold Center', color: '#93c5fd', sound: null },
  7: { name: 'Blue Hold End', color: '#3b82f6', sound: 'hit.ogg' },
  9: { name: 'Circle Flick', color: '#ef4444', sound: 'flick.ogg' },
  10: { name: 'Damage', color: '#a855f7', sound: 'hit.ogg' },
  11: { name: 'Orange Hold Center', color: '#fdba74', sound: null },
};

export const AVAILABLE_NOTE_TYPES = [1, 2, 3, 4, 5, 6, 7, 9, 10, 11];
