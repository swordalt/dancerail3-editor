import React, { useEffect, useRef, useCallback } from 'react';
import { NOTE_TYPES } from '../constants/editorConstants';
import { convertBpmChangesToTime, getActiveChange, getBeatAtTime, getTimeAtBeat, formatTime } from '../utils/editorUtils';
import type { EditorRuntimeState, NotePreview, ProjectData, SelectionBox } from '../types/editorTypes';

interface EditorCanvasProps {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  containerRef: React.RefObject<HTMLDivElement | null>;
  projectData: ProjectData | null;
  gridZoom: number;
  stateRef: React.MutableRefObject<EditorRuntimeState>;
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
  notePreview: NotePreview | null;
  selectedNoteType: number;
  noteWidth: number;
}

const HOLD_TYPES = [3, 4, 5, 6, 7, 11];

export default function EditorCanvas({
  canvasRef,
  containerRef,
  projectData,
  gridZoom,
  stateRef,
  selectedNoteIds,
  selectionBox,
  timeDisplayRef,
  progressBarRef,
  isDraggingProgress,
  audioRef,
  onMouseDown,
  onMouseMove,
  onMouseUp,
  onMouseLeave,
  onContextMenu,
  notePreview,
  selectedNoteType,
  noteWidth,
}: EditorCanvasProps) {
  const animationFrameRef = useRef<number | null>(null);
  const lastPlayedTimeRef = useRef<number>(0);

  const drawGrid = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const rect = container.getBoundingClientRect();
    if (canvas.width !== rect.width || canvas.height !== rect.height) {
      canvas.width = rect.width;
      canvas.height = rect.height;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx || !projectData) return;

    const { width, height } = canvas;
    ctx.clearRect(0, 0, width, height);

    const sortedChanges = convertBpmChangesToTime(stateRef.current.bpmChanges);

    let time = stateRef.current.currentTime;
    if (stateRef.current.isPlaying && audioRef.current) {
      time = audioRef.current.currentTime;
      stateRef.current.currentTime = time;
    }

    if (timeDisplayRef.current) {
      timeDisplayRef.current.textContent = formatTime(time, sortedChanges);
    }

    if (progressBarRef.current && !isDraggingProgress.current) {
      progressBarRef.current.value = time.toString();
    }

    const currentBeat = getBeatAtTime(time, sortedChanges);
    const pixelsPerBeat = 150;
    const hitLineY = height - 150;

    const lanes = 8;
    const laneWidth = Math.min(60, width / (lanes + 2));
    const gridWidth = lanes * laneWidth;
    const startX = (width - gridWidth) / 2;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.fillRect(startX, 0, gridWidth, height);

    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1;
    for (let i = 0; i <= lanes; i++) {
      const x = startX + i * laneWidth;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }

    const beatsVisibleAbove = hitLineY / pixelsPerBeat;
    const beatsVisibleBelow = (height - hitLineY) / pixelsPerBeat;

    const startBeat = Math.floor(currentBeat - beatsVisibleBelow);
    const endBeat = Math.ceil(currentBeat + beatsVisibleAbove);

    const measureBoundaries = new Set<number>();
    const measureNumbers = new Map<number, number>();
    let currentMeasureBeat = 0;
    let measureCount = 0;

    while (currentMeasureBeat <= endBeat) {
      measureBoundaries.add(currentMeasureBeat);
      measureNumbers.set(currentMeasureBeat, measureCount);

      const timeAtMeasure = getTimeAtBeat(currentMeasureBeat, sortedChanges);
      const activeChange = getActiveChange(timeAtMeasure + 0.001, sortedChanges);
      const beatsPerMeasure = parseInt(activeChange.timeSignature.split('/')[0]) || 4;

      currentMeasureBeat += beatsPerMeasure;
      measureCount++;
    }

    const subdivisions = gridZoom;
    const step = 1 / subdivisions;

    for (let b = startBeat; b <= endBeat; b += step) {
      if (b < 0) continue;
      const y = hitLineY - (b - currentBeat) * pixelsPerBeat;

      const isBeatLine = Math.abs(Math.round(b) - b) < 0.001;
      const isMeasureLine = isBeatLine && measureBoundaries.has(Math.round(b));

      ctx.beginPath();
      ctx.moveTo(startX, y);
      ctx.lineTo(startX + gridWidth, y);

      if (isMeasureLine) {
        ctx.strokeStyle = '#666';
        ctx.lineWidth = 2;
      } else if (isBeatLine) {
        ctx.strokeStyle = '#444';
        ctx.lineWidth = 1;
      } else {
        ctx.strokeStyle = '#222';
        ctx.lineWidth = 0.5;
      }
      ctx.stroke();

      if (isMeasureLine) {
        ctx.fillStyle = '#888';
        ctx.font = '12px Inter, sans-serif';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${measureNumbers.get(Math.round(b))}`, startX - 10, y);
      }
    }

    sortedChanges.forEach(change => {
      const changeBeat = getBeatAtTime(change.time, sortedChanges);
      const y = hitLineY - (changeBeat - currentBeat) * pixelsPerBeat;

      if (change.time > 0 && y > 0 && y < height) {
        ctx.fillStyle = '#f59e0b';
        ctx.font = '10px Inter, sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(`BPM: ${change.bpm} | ${change.timeSignature}`, startX + gridWidth + 10, y);
      }
    });

    stateRef.current.notes.forEach(note => {
      if (HOLD_TYPES.includes(note.type) && note.parentId !== null) {
        const parentNote = stateRef.current.notes.find(n => n.id === note.parentId);
        if (parentNote && HOLD_TYPES.includes(parentNote.type)) {
          const noteBeat = getBeatAtTime(note.time, sortedChanges);
          const parentBeat = getBeatAtTime(parentNote.time, sortedChanges);

          const y1 = hitLineY - (noteBeat - currentBeat) * pixelsPerBeat;
          const y2 = hitLineY - (parentBeat - currentBeat) * pixelsPerBeat;

          const isVisible =
            (y1 > -50 && y1 < height + 50) ||
            (y2 > -50 && y2 < height + 50) ||
            (y1 <= -50 && y2 >= height + 50) ||
            (y2 <= -50 && y1 >= height + 50);

          if (!isVisible) return;

          const notePixelWidth = (laneWidth / 2) * note.width;
          const parentPixelWidth = (laneWidth / 2) * parentNote.width;

          const x1Left = startX + note.lane * laneWidth + 2;
          const x1Right = x1Left + notePixelWidth - 4;
          const x2Left = startX + parentNote.lane * laneWidth + 2;
          const x2Right = x2Left + parentPixelWidth - 4;

          const noteTypeInfo = NOTE_TYPES[note.type] || NOTE_TYPES[1];
          ctx.fillStyle = `${noteTypeInfo.color}80`;

          ctx.beginPath();
          ctx.moveTo(x1Left, y1);
          ctx.lineTo(x1Right, y1);
          ctx.lineTo(x2Right, y2);
          ctx.lineTo(x2Left, y2);
          ctx.closePath();
          ctx.fill();

          ctx.strokeStyle = noteTypeInfo.color;
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }
    });

    stateRef.current.notes.forEach(note => {
      const noteBeat = getBeatAtTime(note.time, sortedChanges);
      const y = hitLineY - (noteBeat - currentBeat) * pixelsPerBeat;

      if (y > -50 && y < height + 50) {
        const x = startX + note.lane * laneWidth;
        const notePixelWidth = (laneWidth / 2) * note.width;

        const noteTypeInfo = NOTE_TYPES[note.type] || NOTE_TYPES[1];
        ctx.fillStyle = noteTypeInfo.color;
        ctx.fillRect(x + 2, y - 10, notePixelWidth - 4, 20);

        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.strokeRect(x + 2, y - 10, notePixelWidth - 4, 20);

        if (selectedNoteIds.includes(note.id)) {
          ctx.strokeStyle = '#ff00ff';
          ctx.lineWidth = 4;
          ctx.strokeRect(x, y - 12, notePixelWidth, 24);
        }

        ctx.fillStyle = '#ffffff';
        ctx.font = '10px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(note.id.toString(), x + notePixelWidth / 2, y + 12);
      }
    });

    if (notePreview) {
      const previewBeat = getBeatAtTime(notePreview.time, sortedChanges);
      const previewY = hitLineY - (previewBeat - currentBeat) * pixelsPerBeat;

      if (previewY > -50 && previewY < height + 50) {
        const previewX = startX + notePreview.lane * laneWidth;
        const previewPixelWidth = (laneWidth / 2) * noteWidth;
        const previewTypeInfo = NOTE_TYPES[selectedNoteType] || NOTE_TYPES[1];

        ctx.strokeStyle = `${previewTypeInfo.color}aa`;
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 4]);
        ctx.strokeRect(previewX + 2, previewY - 10, previewPixelWidth - 4, 20);
        ctx.setLineDash([]);
      }
    }

    if (selectionBox) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 5]);
      ctx.strokeRect(
        Math.min(selectionBox.startX, selectionBox.endX),
        Math.min(selectionBox.startY, selectionBox.endY),
        Math.abs(selectionBox.endX - selectionBox.startX),
        Math.abs(selectionBox.endY - selectionBox.startY),
      );
      ctx.setLineDash([]);
    }

    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(startX, hitLineY);
    ctx.lineTo(startX + gridWidth, hitLineY);
    ctx.stroke();

    ctx.shadowColor = '#fff';
    ctx.shadowBlur = 10;
    ctx.stroke();
    ctx.shadowBlur = 0;
  }, [projectData, gridZoom, selectedNoteIds, selectionBox, notePreview, selectedNoteType, noteWidth, canvasRef, containerRef, stateRef, timeDisplayRef, progressBarRef, isDraggingProgress, audioRef]);

  useEffect(() => {
    const step = () => {
      if (stateRef.current.isPlaying && audioRef.current) {
        const currentTime = audioRef.current.currentTime;
        const lastTime = lastPlayedTimeRef.current;

        stateRef.current.notes.forEach(note => {
          if (note.time > lastTime && note.time <= currentTime) {
            const noteTypeInfo = NOTE_TYPES[note.type];
            if (noteTypeInfo?.sound) {
              const hitSound = new Audio(noteTypeInfo.sound);
              hitSound.volume = 0.5;
              hitSound.play().catch(() => {});
            }
          }
        });

        lastPlayedTimeRef.current = currentTime;
      } else {
        lastPlayedTimeRef.current = stateRef.current.currentTime;
      }

      drawGrid();
      animationFrameRef.current = requestAnimationFrame(step);
    };

    animationFrameRef.current = requestAnimationFrame(step);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [drawGrid, stateRef, audioRef]);

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
