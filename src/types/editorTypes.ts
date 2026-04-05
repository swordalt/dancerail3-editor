export interface Note {
  id: number;
  time: number;
  lane: number;
  type: number;
  width: number;
  parentId: number | null;
}

export interface SelectionBox {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}

export interface BpmChange {
  measure: number;
  beat: number;
  bpm: number;
  timeSignature: string;
}

export interface TimeChange {
  time: number;
  bpm: number;
  timeSignature: string;
}

export interface ProjectFormData {
  songId: string;
  songName: string;
  songArtist: string;
  songBpm: string;
  difficulty: string;
  songFile: File | null;
  songIllustration: File | null;
}

export interface ProjectData extends ProjectFormData {
  bpm: number;
  audioUrl: string;
}

export interface EditorRuntimeState {
  isPlaying: boolean;
  currentTime: number;
  bpm: number;
  bpmChanges: BpmChange[];
  offset: number;
  notes: Note[];
}

export interface NotePreview {
  lane: number;
  time: number;
}
