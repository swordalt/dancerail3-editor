export type EditorMode = 'new' | 'import';
export type ChartFormat = 'Official' | 'DR3Custom';

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
  appearMode?: 'L' | 'R' | 'H' | 'P';
}

export interface BpmChange {
  timepos: number;
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
  timepos: number;
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
  chartFormat: ChartFormat;
  bpm: number;
  audioUrl: string;
}
