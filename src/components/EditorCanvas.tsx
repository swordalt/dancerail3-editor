import React, { useEffect, useCallback, useMemo } from 'react';
import { NOTE_TYPES, HOLD_CONNECTOR_TYPES, HOLD_CENTER_TYPES, HOLD_END_TYPES, HOLD_START_TYPES, UNKNOWN_NOTE_TYPE, getConnectorFill } from '../constants/editorConstants';
import { convertBpmChangesToTime, getActiveChange, getBeatAtTime, getTimeAtBeat, formatTime } from '../utils/editorUtils';
import type { BpmChange, Note, ProjectData, SelectionBox, SpeedChange } from '../types/editorTypes';

interface EditorCanvasState {
  isPlaying: boolean;
  currentTime: number;
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
  canvasRef, containerRef, projectData, bpmChanges, speedChanges, gridZoom, pixelsPerBeat, currentTime, offset, stateRef, selectedNoteIds, selectionBox, timeDisplayRef, progressBarRef, isDraggingProgress, audioRef,
  onMouseDown, onMouseMove, onMouseUp, onMouseLeave, onContextMenu
}: EditorCanvasProps) {
  const sortedChanges = useMemo(
    () => convertBpmChangesToTime(bpmChanges),
    [bpmChanges],
  );
  const selectedNoteIdSet = useMemo(() => new Set(selectedNoteIds), [selectedNoteIds]);

  const drawArrow = (
    ctx: CanvasRenderingContext2D,
    centerX: number,
    centerY: number,
    direction: 'left' | 'right' | 'up' | 'down',
    size: number
  ) => {
    const tail = size * 0.85;
    const wing = size * 0.45;

    ctx.beginPath();

    switch (direction) {
      case 'left':
        ctx.moveTo(centerX + tail / 2, centerY);
        ctx.lineTo(centerX - tail / 2, centerY);
        ctx.lineTo(centerX - tail / 2 + wing, centerY - wing);
        ctx.moveTo(centerX - tail / 2, centerY);
        ctx.lineTo(centerX - tail / 2 + wing, centerY + wing);
        break;
      case 'right':
        ctx.moveTo(centerX - tail / 2, centerY);
        ctx.lineTo(centerX + tail / 2, centerY);
        ctx.lineTo(centerX + tail / 2 - wing, centerY - wing);
        ctx.moveTo(centerX + tail / 2, centerY);
        ctx.lineTo(centerX + tail / 2 - wing, centerY + wing);
        break;
      case 'up':
        ctx.moveTo(centerX, centerY + tail / 2);
        ctx.lineTo(centerX, centerY - tail / 2);
        ctx.lineTo(centerX - wing, centerY - tail / 2 + wing);
        ctx.moveTo(centerX, centerY - tail / 2);
        ctx.lineTo(centerX + wing, centerY - tail / 2 + wing);
        break;
      case 'down':
        ctx.moveTo(centerX, centerY - tail / 2);
        ctx.lineTo(centerX, centerY + tail / 2);
        ctx.lineTo(centerX - wing, centerY + tail / 2 - wing);
        ctx.moveTo(centerX, centerY + tail / 2);
        ctx.lineTo(centerX + wing, centerY + tail / 2 - wing);
        break;
    }

    ctx.stroke();
  };

  const drawNoteLetter = (
    ctx: CanvasRenderingContext2D,
    centerX: number,
    centerY: number,
    letter: 'S' | 'C' | 'E' | '?'
  ) => {
    ctx.fillStyle = letter === '?' ? '#000000' : '#ffffff';
    ctx.font = 'bold 12px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(letter, centerX, centerY);
  };

  const formatGroupedIds = (ids: number[]) => {
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

  const noteRenderIndex = useMemo(() => {
    const notesById = new Map<number, Note>();
    const noteBeats = new Map<number, number>();
    const groupedNoteIds = new Map<string, number[]>();

    stateRef.current.notes.forEach((note) => {
      notesById.set(note.id, note);
      noteBeats.set(note.id, getBeatAtTime(note.time, sortedChanges));

      const key = `${note.time.toFixed(6)}:${note.lane}`;
      const groupedIds = groupedNoteIds.get(key);
      if (groupedIds) {
        groupedIds.push(note.id);
      } else {
        groupedNoteIds.set(key, [note.id]);
      }
    });

    const groupedIdLabels = new Map<string, string>();
    groupedNoteIds.forEach((groupedIds, key) => {
      groupedIdLabels.set(key, formatGroupedIds(groupedIds));
    });

    const selectedParentNoteIds = new Set<number>();
    stateRef.current.notes.forEach((note) => {
      if (selectedNoteIdSet.has(note.id) && note.parentId !== null) {
        selectedParentNoteIds.add(note.parentId);
      }
    });

    return {
      notesById,
      noteBeats,
      groupedIdLabels,
      selectedParentNoteIds,
    };
  }, [selectedNoteIdSet, sortedChanges, stateRef.current.notes]);
  
  const drawGrid = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const rect = container.getBoundingClientRect();
    const displayWidth = Math.max(1, Math.floor(rect.width));
    const displayHeight = Math.max(1, Math.floor(rect.height));
    const dpr = window.devicePixelRatio || 1;
    const pixelWidth = Math.floor(displayWidth * dpr);
    const pixelHeight = Math.floor(displayHeight * dpr);

    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
      canvas.style.width = `${displayWidth}px`;
      canvas.style.height = `${displayHeight}px`;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = displayWidth;
    const height = displayHeight;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    if (!projectData) return;

    const activeChange = getActiveChange(stateRef.current.currentTime, sortedChanges);
    const bpm = activeChange.bpm;
    let time = stateRef.current.currentTime;
    
    if (stateRef.current.isPlaying && audioRef.current) {
      const offsetInSeconds = parseFloat(offset.toString()) / 1000;
      time = audioRef.current.currentTime + offsetInSeconds;
      stateRef.current.currentTime = time;
    }

    if (timeDisplayRef.current) {
      timeDisplayRef.current.textContent = formatTime(time, sortedChanges);
    }
    if (progressBarRef.current && !isDraggingProgress.current) {
      progressBarRef.current.value = time.toString();
    }

    const currentBeat = getBeatAtTime(time, sortedChanges);
    const hitLineY = height - 150;

    const lanes = 8;
    const laneWidth = Math.min(60, width / (lanes + 2));
    const gridWidth = lanes * laneWidth;
    const startX = (width - gridWidth) / 2;

    // Draw background for the grid area
    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.fillRect(startX, 0, gridWidth, height);

    // Draw lanes
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1;
    for (let i = 0; i <= lanes; i++) {
      const x = startX + i * laneWidth;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }

    // Draw beats
    const beatsVisibleAbove = hitLineY / pixelsPerBeat;
    const beatsVisibleBelow = (height - hitLineY) / pixelsPerBeat;
    
    const startBeat = Math.floor(currentBeat - beatsVisibleBelow);
    const endBeat = Math.ceil(currentBeat + beatsVisibleAbove);

    // Pre-calculate measure boundaries
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

    // Draw beats and subdivisions
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

    const indicatorX = startX + gridWidth + 10;
    const indicatorOffset = 6;
    const bpmIndicatorKeys = new Set<string>();

    // Draw BPM/Time Signature change indicators on the right side.
    sortedChanges.forEach(change => {
      const changeBeat = getBeatAtTime(change.time, sortedChanges);
      const y = hitLineY - (changeBeat - currentBeat) * pixelsPerBeat;

      // Only draw indicators that are not at time 0 (as they are implied)
      if (change.time > 0 && y > 0 && y < height) {
        const indicatorKey = `${change.measure}:${change.beat}`;
        bpmIndicatorKeys.add(indicatorKey);
        const sharesTimeWithSpeed = speedChanges.some(sc => `${sc.measure}:${sc.beat}` === indicatorKey);
        ctx.fillStyle = '#f59e0b';
        ctx.font = '10px Inter, sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(`BPM: ${change.bpm} | ${change.timeSignature}`, indicatorX, y + (sharesTimeWithSpeed ? indicatorOffset : 0));
      }
    });

    // Draw speed change indicators on the right side, above BPM changes at the same time position.
    speedChanges.forEach(sc => {
      const scBeat = sc.measure * 4 + sc.beat;
      const y = hitLineY - (scBeat - currentBeat) * pixelsPerBeat;

      if (y > 0 && y < height) {
        const sharesTimeWithBpm = bpmIndicatorKeys.has(`${sc.measure}:${sc.beat}`);
        ctx.fillStyle = '#06b6d4';
        ctx.font = '10px Inter, sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(`SC: ${sc.speedChange.toFixed(1)}x`, indicatorX, y - (sharesTimeWithBpm ? indicatorOffset : 0));
      }
    });

    // Draw hold connections
    stateRef.current.notes.forEach((note) => {
      if (HOLD_CONNECTOR_TYPES.includes(note.type) && !HOLD_START_TYPES.includes(note.type) && note.parentId !== null) {
        const parentNote = noteRenderIndex.notesById.get(note.parentId);
        if (parentNote) {
          const noteBeat = noteRenderIndex.noteBeats.get(note.id);
          const parentBeat = noteRenderIndex.noteBeats.get(parentNote.id);
          if (noteBeat === undefined || parentBeat === undefined) {
            return;
          }
          
          const y1 = hitLineY - (noteBeat - currentBeat) * pixelsPerBeat;
          const y2 = hitLineY - (parentBeat - currentBeat) * pixelsPerBeat;
          
          // Draw polygon between parent (y2) and child (y1)
          const notePixelWidth = (laneWidth / 2) * note.width;
          const parentPixelWidth = (laneWidth / 2) * parentNote.width;
          
          const x1_left = startX + note.lane * laneWidth + 2;
          const x1_right = x1_left + notePixelWidth - 4;
          const x2_left = startX + parentNote.lane * laneWidth + 2;
          const x2_right = x2_left + parentPixelWidth - 4;
          
          ctx.fillStyle = getConnectorFill(note.type);
          ctx.beginPath();
          ctx.moveTo(x2_left, y2);
          ctx.lineTo(x2_right, y2);
          ctx.lineTo(x1_right, y1);
          ctx.lineTo(x1_left, y1);
          ctx.closePath();
          ctx.fill();
        }
      }
    });

    // Draw notes
    stateRef.current.notes.forEach((note) => {
      const noteBeat = noteRenderIndex.noteBeats.get(note.id);
      if (noteBeat === undefined) {
        return;
      }

      const y = hitLineY - (noteBeat - currentBeat) * pixelsPerBeat;
      
      if (y > -50 && y < height + 50) {
        const x = startX + note.lane * laneWidth;
        const notePixelWidth = (laneWidth / 2) * note.width;
        const noteCenterX = x + notePixelWidth / 2;
        
        const noteTypeInfo = NOTE_TYPES[note.type] || UNKNOWN_NOTE_TYPE;
        ctx.fillStyle = noteTypeInfo.color;
        // Draw note
        if (note.type === 9) {
          // Circle flick: solid center with an outer ring so it reads as distinct in the editor.
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(noteCenterX, y, 14, 0, 2 * Math.PI);
          ctx.stroke();

          ctx.beginPath();
          ctx.arc(noteCenterX, y, 9, 0, 2 * Math.PI);
          ctx.fill();
          ctx.stroke();

          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 2;
        } else {
          ctx.fillRect(x + 2, y - 10, notePixelWidth - 4, 20);
          
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 2;
          ctx.strokeRect(x + 2, y - 10, notePixelWidth - 4, 20);
        }

        if ([9, 13, 14, 15, 16].includes(note.type)) {
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 2;

          if (note.type === 9) {
            drawArrow(ctx, noteCenterX - 11, y, 'left', 8);
            drawArrow(ctx, noteCenterX + 11, y, 'right', 8);
          }

          if (note.type === 13) {
            drawArrow(ctx, noteCenterX, y, 'left', 12);
          }

          if (note.type === 14) {
            drawArrow(ctx, noteCenterX, y, 'right', 12);
          }

          if (note.type === 15) {
            drawArrow(ctx, noteCenterX, y, 'up', 12);
          }

          if (note.type === 16) {
            drawArrow(ctx, noteCenterX, y, 'down', 12);
          }
        }

        if (HOLD_START_TYPES.includes(note.type)) {
          drawNoteLetter(ctx, noteCenterX, y, 'S');
        }

        if (HOLD_CENTER_TYPES.includes(note.type)) {
          drawNoteLetter(ctx, noteCenterX, y, 'C');
        }

        if (HOLD_END_TYPES.includes(note.type)) {
          drawNoteLetter(ctx, noteCenterX, y, 'E');
        }

        if (!(note.type in NOTE_TYPES)) {
          drawNoteLetter(ctx, noteCenterX, y, '?');
        }

        // Highlight if selected
        if (selectedNoteIdSet.has(note.id)) {
          ctx.setLineDash([]);
          ctx.strokeStyle = '#ff00ff';
          ctx.lineWidth = 4;
          ctx.strokeRect(x, y - 12, notePixelWidth, 24);
        } else if (noteRenderIndex.selectedParentNoteIds.has(note.id)) {
          ctx.setLineDash([6, 4]);
          ctx.strokeStyle = '#ff00ff';
          ctx.lineWidth = 3;
          ctx.strokeRect(x, y - 12, notePixelWidth, 24);
          ctx.setLineDash([]);
        }

        // Draw note ID
        ctx.fillStyle = '#ffffff';
        ctx.font = '10px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        const groupedIdsLabel = noteRenderIndex.groupedIdLabels.get(`${note.time.toFixed(6)}:${note.lane}`) ?? `${note.id}`;
        ctx.fillText(groupedIdsLabel, x + notePixelWidth / 2, y + 12);
      }
    });

    // Draw selection box
    if (selectionBox) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 5]);
      ctx.strokeRect(
        Math.min(selectionBox.startX, selectionBox.endX),
        Math.min(selectionBox.startY, selectionBox.endY),
        Math.abs(selectionBox.endX - selectionBox.startX),
        Math.abs(selectionBox.endY - selectionBox.startY)
      );
      ctx.setLineDash([]);
    }

    // Draw hit line
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

  }, [pixelsPerBeat, projectData, gridZoom, currentTime, selectionBox, canvasRef, containerRef, offset, speedChanges, stateRef, timeDisplayRef, progressBarRef, isDraggingProgress, audioRef, noteRenderIndex, selectedNoteIdSet, sortedChanges]);

  useEffect(() => {
    drawGrid();
  }, [drawGrid]);

  return <canvas 
    ref={canvasRef} 
    className="absolute inset-0 w-full h-full cursor-crosshair"
    onMouseDown={onMouseDown}
    onMouseMove={onMouseMove}
    onMouseUp={onMouseUp}
    onMouseLeave={onMouseLeave}
    onContextMenu={onContextMenu}
  />;
}
