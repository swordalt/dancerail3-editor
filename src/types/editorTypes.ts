export type EditorMode = 'new' | 'import';

export interface ViewState {
  page: 'landing' | 'editor';
  mode?: EditorMode;
}

export interface Note {
  id: number;
  time: number;
  lane: number;
  type: number;
  width: number;
  parentId: number | null;
  speed?: string;
}

export interface BpmChange {
  measure: number;
  beat: number;
  bpm: number;
  timeSignature: string;
}

export interface TimedBpmChange {
  time: number;
  startBeat: number;
  bpm: number;
  timeSignature: string;
}

export interface SpeedChange {
  measure: number;
  beat: number;
  speedChange: number;
}

export interface SelectionBox {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}

export interface EditorFormData {
  songId: string;
  songName: string;
  songArtist: string;
  songBpm: string;
  difficulty: string;
  songFile: File | null;
  songIllustration: File | null;
}

export interface ProjectData extends EditorFormData {
  bpm: number;
  audioUrl: string;
}
