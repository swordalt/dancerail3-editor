import React from 'react';
import type { BpmChange, Note, ProjectData, SelectionBox, SpeedChange } from '../types/editorTypes';

interface EditorCanvasState {
  isPlaying: boolean;
  currentTime: number;
  playbackStartTime: number;
  playbackStartPerformanceTime: number;
  playbackAudioClockReadyTime: number;
  bpm: number;
  bpmChanges: BpmChange[];
  speedChanges: SpeedChange[];
  offset: string | number;
  notes: Note[];
}

interface EditorCanvasProps {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  containerRef: React.RefObject<HTMLDivElement | null>;
  projectData: ProjectData | null;
  bpmChanges: BpmChange[];
  speedChanges: SpeedChange[];
  gridZoom: number;
  pixelsPerBeat: number;
  currentTime: number;
  offset: string | number;
  stateRef: React.MutableRefObject<EditorCanvasState>;
  selectedNoteIds: number[];
  selectionBox: SelectionBox | null;
  timeDisplayRef: React.RefObject<HTMLDivElement | null>;
  progressBarRef: React.RefObject<HTMLInputElement | null>;
  isDraggingProgress: React.MutableRefObject<boolean>;
  audioRef: React.RefObject<HTMLAudioElement | null>;
  onMouseDown: (e: React.MouseEvent<HTMLCanvasElement>) => void;
  onMouseMove: (e: React.MouseEvent<HTMLCanvasElement>) => void;
  onMouseUp: () => void;
  onMouseLeave: () => void;
  onContextMenu: (e: React.MouseEvent<HTMLCanvasElement>) => void;
}

export default function EditorCanvas({
  canvasRef,
  onMouseDown,
  onMouseMove,
  onMouseUp,
  onMouseLeave,
  onContextMenu,
}: EditorCanvasProps) {
  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full cursor-crosshair"
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseLeave}
      onContextMenu={onContextMenu}
    />
  );
}
