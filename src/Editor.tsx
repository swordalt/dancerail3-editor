import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowLeft, Settings, Play, Pause, Save, X, Upload } from 'lucide-react';
import { convertBpmChangesToTime, getActiveChange, getBeatAtTime, getTimeAtBeat, formatTime } from './utils/editorUtils';
import EditorModal from './components/EditorModal';
import EditorCanvas from './components/EditorCanvas';
import { NOTE_TYPES, AVAILABLE_NOTE_TYPES } from './constants/editorConstants';
import type { BpmChange, EditorRuntimeState, Note, NotePreview, ProjectData, ProjectFormData, SelectionBox } from './types/editorTypes';

export default function Editor({ onBack, mode }: { onBack: () => void, mode?: 'new' | 'import' }) {
  const [isModalOpen, setIsModalOpen] = useState(mode === 'new');
  const [gridZoom, setGridZoom] = useState(1);
  const [activeLeftPanel, setActiveLeftPanel] = useState<'main' | 'editInfo' | 'curveNotes' | 'curveSC' | 'history' | 'bpmTiming'>('main');
  const [selectedNoteType, setSelectedNoteType] = useState<number>(1);
  const [noteWidth, setNoteWidth] = useState(4);
  const [notes, setNotes] = useState<Note[]>([]);
  const [selectedNoteIds, setSelectedNoteIds] = useState<number[]>([]);
  const [draggingNoteId, setDraggingNoteId] = useState<number | null>(null);
  const [selectionBox, setSelectionBox] = useState<SelectionBox | null>(null);
  const [hoverPreview, setHoverPreview] = useState<NotePreview | null>(null);
  const nextNoteIdRef = useRef<number>(1);
  const [formData, setFormData] = useState<ProjectFormData>({
    songId: '',
    songName: '',
    songArtist: '',
    songBpm: '',
    difficulty: '1',
    songFile: null as File | null,
    songIllustration: null as File | null,
  });
  const [illustrationPreview, setIllustrationPreview] = useState<string | null>(null);

  useEffect(() => {
    if (formData.songIllustration) {
      const url = URL.createObjectURL(formData.songIllustration);
      setIllustrationPreview(url);
      return () => URL.revokeObjectURL(url);
    } else {
      setIllustrationPreview(null);
    }
  }, [formData.songIllustration]);

  const [projectData, setProjectData] = useState<ProjectData | null>(null);
  const [bpmChanges, setBpmChanges] = useState<BpmChange[]>([{measure: 0, beat: 0, bpm: 120, timeSignature: '4/4'}]);
  const [offset, setOffset] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  
  const audioRef = useRef<HTMLAudioElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const timeDisplayRef = useRef<HTMLDivElement>(null);
  const progressBarRef = useRef<HTMLInputElement>(null);
  const isDraggingProgress = useRef(false);

  const stateRef = useRef<EditorRuntimeState>({
    isPlaying: false,
    currentTime: 0,
    bpm: 120,
    bpmChanges: [{measure: 0, beat: 0, bpm: 120, timeSignature: '4/4'}],
    offset: 0,
    notes: [] as Note[],
  });

  useEffect(() => {
    stateRef.current.isPlaying = isPlaying;
    stateRef.current.currentTime = currentTime;
    stateRef.current.bpm = projectData?.bpm || 120;
    stateRef.current.bpmChanges = bpmChanges;
    stateRef.current.offset = offset;
    stateRef.current.notes = notes;
  }, [isPlaying, currentTime, projectData, bpmChanges, offset, notes]);

  useEffect(() => {
    if (mode === 'new') {
      setIsModalOpen(true);
    }
  }, [mode]);

  useEffect(() => {
    const handleMouseUp = () => {
      setDraggingNoteId(null);
    };
    window.addEventListener('mouseup', handleMouseUp);
    return () => window.removeEventListener('mouseup', handleMouseUp);
  }, []);

  const handleConfirm = () => {
    let audioUrl = projectData?.audioUrl || '';
    if (formData.songFile && formData.songFile !== projectData?.songFile) {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      audioUrl = URL.createObjectURL(formData.songFile);
    }
    const initialBpm = parseFloat(formData.songBpm) || 120;
    setProjectData({
      ...formData,
      bpm: initialBpm,
      audioUrl
    });
    setBpmChanges([{measure: 0, beat: 0, bpm: initialBpm, timeSignature: '4/4'}]);
    setIsModalOpen(false);
    if (activeLeftPanel === 'editInfo') {
      setActiveLeftPanel('main');
    }
  };

  const handleEditInfo = () => {
    if (projectData) {
      setFormData({
        songId: projectData.songId,
        songName: projectData.songName,
        songArtist: projectData.songArtist,
        songBpm: projectData.bpm.toString(),
        difficulty: projectData.difficulty,
        songFile: projectData.songFile,
        songIllustration: projectData.songIllustration,
      });
      setActiveLeftPanel('editInfo');
    }
  };

  const handleSeekChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newTime = parseFloat(e.target.value);
    setCurrentTime(newTime);
    stateRef.current.currentTime = newTime;
    if (audioRef.current) {
      audioRef.current.currentTime = newTime;
    }
    if (timeDisplayRef.current && projectData) {
      timeDisplayRef.current.textContent = formatTime(newTime, convertBpmChangesToTime(stateRef.current.bpmChanges));
    }
  }, [projectData]);

  const togglePlay = useCallback(() => {
    if (!audioRef.current || !projectData) return;
    if (stateRef.current.isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
      
      // Snap to nearest beat
      const bpm = stateRef.current.bpm;
      const currentBeat = audioRef.current.currentTime * (bpm / 60);
      const snappedBeat = Math.round(currentBeat);
      const snappedTime = snappedBeat * (60 / bpm);
      
      setCurrentTime(snappedTime);
      stateRef.current.currentTime = snappedTime;
      audioRef.current.currentTime = snappedTime;
    } else {
      audioRef.current.currentTime = stateRef.current.currentTime;
      audioRef.current.play();
      setIsPlaying(true);
    }
  }, [projectData]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      
      if (e.code === 'Space') {
        e.preventDefault();
        togglePlay();
      }
      
      if (e.key.toLowerCase() === 'w') {
        setGridZoom(prev => {
          if (prev < 4) return 4;
          return prev + 4;
        });
      }
      
      if (e.key.toLowerCase() === 's') {
        setGridZoom(prev => {
          if (prev <= 4) return 1;
          return prev - 4;
        });
      }

      if (e.key.toLowerCase() === 'a') {
        setSelectedNoteType(prev => {
          const idx = AVAILABLE_NOTE_TYPES.indexOf(prev);
          return AVAILABLE_NOTE_TYPES[(idx - 1 + AVAILABLE_NOTE_TYPES.length) % AVAILABLE_NOTE_TYPES.length];
        });
      }

      if (e.key.toLowerCase() === 'd') {
        setSelectedNoteType(prev => {
          const idx = AVAILABLE_NOTE_TYPES.indexOf(prev);
          return AVAILABLE_NOTE_TYPES[(idx + 1) % AVAILABLE_NOTE_TYPES.length];
        });
      }

      if (e.key.toLowerCase() === 'q') {
        setNoteWidth(prev => Math.max(1, prev - 1));
      }

      if (e.key.toLowerCase() === 'e') {
        setNoteWidth(prev => Math.min(16, prev + 1));
      }

      if (e.key === 'Delete') {
        setNotes(prev => prev.filter(n => !selectedNoteIds.includes(n.id)));
        setSelectedNoteIds([]);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [togglePlay]);

  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || !projectData) return;

    const rect = canvas.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    const { width, height } = canvas;
    const lanes = 8;
    const laneWidth = Math.min(60, width / (lanes + 2));
    const gridWidth = lanes * laneWidth;
    const startX = (width - gridWidth) / 2;

    const pixelsPerBeat = 150;
    const hitLineY = height - 150;
    
    const sortedChanges = convertBpmChangesToTime(stateRef.current.bpmChanges);
    const currentBeat = getBeatAtTime(stateRef.current.currentTime, sortedChanges);
    
    const clickBeat = currentBeat + (hitLineY - clickY) / pixelsPerBeat;
    
    // Snap to grid
    const snap = gridZoom;
    const snappedBeat = Math.round(clickBeat * snap) / snap;
    
    if (snappedBeat < 0) return;
    
    const snappedTime = getTimeAtBeat(snappedBeat, sortedChanges);

    const clickedNote = [...stateRef.current.notes].reverse().find(n => {
      const noteBeat = getBeatAtTime(n.time, sortedChanges);
      const noteY = hitLineY - (noteBeat - currentBeat) * pixelsPerBeat;
      const noteStartX = startX + n.lane * laneWidth;
      const noteEndX = noteStartX + (laneWidth / 2) * n.width;
      
      return clickX >= noteStartX && clickX <= noteEndX && clickY >= noteY - 10 && clickY <= noteY + 10;
    });

    if (e.button === 0) { // Left click
        if (clickX >= startX && clickX < startX + gridWidth) {
          const lane = Math.floor((clickX - startX) / laneWidth);
          const newId = nextNoteIdRef.current++;
          setNotes(prev => {
            const filtered = prev.filter(n => !(Math.abs(n.time - snappedTime) < 0.001 && n.lane === lane));
            const sortedNotes = [...filtered].sort((a, b) => a.time - b.time);
            const parentIndex = sortedNotes.findIndex(n => n.time > snappedTime) - 1;
            const parentId = parentIndex >= 0 ? sortedNotes[parentIndex].id : (sortedNotes.length > 0 ? sortedNotes[sortedNotes.length - 1].id : null);
            
            return [...filtered, { id: newId, time: snappedTime, lane, type: selectedNoteType, width: noteWidth, parentId }];
          });
        }
    } else if (e.button === 1) { // Middle click
      if (e.ctrlKey) {
        if (clickedNote) {
          setDraggingNoteId(clickedNote.id);
        }
      } else if (clickedNote) {
        setSelectedNoteIds([clickedNote.id]);
      } else {
        setSelectionBox({ startX: clickX, startY: clickY, endX: clickX, endY: clickY });
        setSelectedNoteIds([]);
      }
    } else if (e.button === 2) { // Right click
      if (clickedNote) {
        setNotes(prev => prev.filter(n => n.id !== clickedNote.id));
        setSelectedNoteIds(prev => prev.filter(id => id !== clickedNote.id));
      }
    }
  };

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || !projectData) return;

    const rect = canvas.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    if (draggingNoteId) {
      const { width, height } = canvas;
      const lanes = 8;
      const laneWidth = Math.min(60, width / (lanes + 2));
      const gridWidth = lanes * laneWidth;
      const startX = (width - gridWidth) / 2;

      let lane = Math.floor((clickX - startX) / laneWidth);
      lane = Math.max(0, Math.min(lanes - 1, lane));
      
      const pixelsPerBeat = 150;
      const hitLineY = height - 150;
      
      const sortedChanges = convertBpmChangesToTime(stateRef.current.bpmChanges);
      const currentBeat = getBeatAtTime(stateRef.current.currentTime, sortedChanges);
      
      const clickBeat = currentBeat + (hitLineY - clickY) / pixelsPerBeat;
      
      const snap = gridZoom;
      const snappedBeat = Math.round(clickBeat * snap) / snap;
      
      if (snappedBeat < 0) return;
      
      const snappedTime = getTimeAtBeat(snappedBeat, sortedChanges);

      setNotes(prev => prev.map(n => 
        n.id === draggingNoteId 
          ? { ...n, time: snappedTime, lane } 
          : n
      ));
      setHoverPreview({ lane, time: snappedTime });
    } else if (selectionBox) {
      setSelectionBox(prev => prev ? { ...prev, endX: clickX, endY: clickY } : null);
    } else {
      const { width, height } = canvas;
      const lanes = 8;
      const laneWidth = Math.min(60, width / (lanes + 2));
      const gridWidth = lanes * laneWidth;
      const startX = (width - gridWidth) / 2;

      if (clickX < startX || clickX > startX + gridWidth) {
        setHoverPreview(null);
        return;
      }

      let lane = Math.floor((clickX - startX) / laneWidth);
      lane = Math.max(0, Math.min(lanes - 1, lane));

      const pixelsPerBeat = 150;
      const hitLineY = height - 150;
      const sortedChanges = convertBpmChangesToTime(stateRef.current.bpmChanges);
      const currentBeat = getBeatAtTime(stateRef.current.currentTime, sortedChanges);
      const clickBeat = currentBeat + (hitLineY - clickY) / pixelsPerBeat;
      const snap = gridZoom;
      const snappedBeat = Math.round(clickBeat * snap) / snap;

      if (snappedBeat < 0) {
        setHoverPreview(null);
        return;
      }

      const snappedTime = getTimeAtBeat(snappedBeat, sortedChanges);
      setHoverPreview({ lane, time: snappedTime });
    }
  };

  const handleCanvasMouseUp = () => {
    if (selectionBox) {
      const canvas = canvasRef.current;
      if (canvas) {
        const { width, height } = canvas;
        const lanes = 8;
        const laneWidth = Math.min(60, width / (lanes + 2));
        const gridWidth = lanes * laneWidth;
        const startX = (width - gridWidth) / 2;
        const pixelsPerBeat = 150;
        const hitLineY = height - 150;
        const sortedChanges = convertBpmChangesToTime(stateRef.current.bpmChanges);
        const currentBeat = getBeatAtTime(stateRef.current.currentTime, sortedChanges);

        const minX = Math.min(selectionBox.startX, selectionBox.endX);
        const maxX = Math.max(selectionBox.startX, selectionBox.endX);
        const minY = Math.min(selectionBox.startY, selectionBox.endY);
        const maxY = Math.max(selectionBox.startY, selectionBox.endY);

        const selected = stateRef.current.notes.filter(n => {
          const noteBeat = getBeatAtTime(n.time, sortedChanges);
          const noteY = hitLineY - (noteBeat - currentBeat) * pixelsPerBeat;
          const noteStartX = startX + n.lane * laneWidth;
          const noteEndX = noteStartX + (laneWidth / 2) * n.width;
          
          return noteStartX >= minX && noteEndX <= maxX && noteY >= minY && noteY <= maxY;
        });
        setSelectedNoteIds(selected.map(n => n.id));
      }
    }
    setDraggingNoteId(null);
    setSelectionBox(null);
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
  };

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (!projectData) return;
    
    if (stateRef.current.isPlaying) {
      togglePlay();
    }
    
    const pixelsPerBeat = 150;
    const getActiveBpm = (time: number, changes: {time: number, bpm: number, timeSignature: string}[]) => {
      const sortedChanges = [...changes].sort((a, b) => a.time - b.time);
      let activeBpm = sortedChanges[0].bpm;
      for (const change of sortedChanges) {
        if (time >= change.time) {
          activeBpm = change.bpm;
        } else {
          break;
        }
      }
      return activeBpm;
    };
    const bpm = getActiveBpm(stateRef.current.currentTime, convertBpmChangesToTime(stateRef.current.bpmChanges));
    const timeChange = (e.deltaY / pixelsPerBeat) * (60 / bpm);
    
    let newTime = stateRef.current.currentTime + timeChange;
    if (newTime < 0) newTime = 0;
    if (audioRef.current && audioRef.current.duration && newTime > audioRef.current.duration) {
      newTime = audioRef.current.duration;
    }
    
    setCurrentTime(newTime);
    stateRef.current.currentTime = newTime;
    if (audioRef.current) {
      audioRef.current.currentTime = newTime;
    }
    if (timeDisplayRef.current) {
      timeDisplayRef.current.textContent = formatTime(newTime, convertBpmChangesToTime(stateRef.current.bpmChanges));
    }
    if (progressBarRef.current && !isDraggingProgress.current) {
      progressBarRef.current.value = newTime.toString();
    }
  };

  const saveLevel = async () => {
    if (!projectData) return;
    const bpm = projectData.bpm || 120;
    let content = `#OFFSET=${offset};\n`;
    content += `#BEAT=1;\n`;
    content += `#BPM_NUMBER=1;\n`;
    content += `#BPM [0]=${bpm};\n`;
    content += `#BPMS[0]=0;\n`;
    content += `#SCN=1;\n`;
    content += `#SC [0]=1;\n`;
    content += `#SCI[0]=0;\n`;
    
    const sortedChanges = convertBpmChangesToTime(bpmChanges);
    
    notes.forEach(note => {
      const totalBeats = getBeatAtTime(note.time, sortedChanges);
      
      let currentMeasureBeat = 0;
      let measureCount = 0;
      let currentBeatsPerMeasure = 4;
      
      while (measureCount < 10000) {
        const timeAtMeasure = getTimeAtBeat(currentMeasureBeat, sortedChanges);
        const activeChange = getActiveChange(timeAtMeasure + 0.001, sortedChanges);
        currentBeatsPerMeasure = parseInt(activeChange.timeSignature.split('/')[0]) || 4;
        
        if (totalBeats < currentMeasureBeat + currentBeatsPerMeasure) {
          break;
        }
        
        currentMeasureBeat += currentBeatsPerMeasure;
        measureCount++;
      }
      
      const beatInMeasure = totalBeats - currentMeasureBeat;
      content += `<${note.id}><${note.type}><${(measureCount + beatInMeasure / currentBeatsPerMeasure).toFixed(3)}><${note.lane}><${note.width}><1><${note.parentId || 0}>\n`;
    });
    
    const fallbackDownload = (content: string) => {
      const blob = new Blob([content], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${projectData.songId || 'level'}.txt`;
      a.click();
      URL.revokeObjectURL(url);
    };

    if ('showSaveFilePicker' in window) {
      try {
        const handle = await (window as any).showSaveFilePicker({
          suggestedName: `${projectData.songId || 'level'}.txt`,
          types: [{
            description: 'Text File',
            accept: {'text/plain': ['.txt']},
          }],
        });
        const writable = await handle.createWritable();
        await writable.write(content);
        await writable.close();
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          console.error('Save failed', err);
          fallbackDownload(content);
        }
      }
    } else {
      fallbackDownload(content);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 1.05 }}
      transition={{ duration: 0.3 }}
      className="min-h-screen bg-neutral-950 text-neutral-50 flex flex-col font-sans"
    >
      {projectData?.audioUrl && (
        <audio 
          ref={audioRef} 
          src={projectData.audioUrl} 
          onEnded={() => setIsPlaying(false)} 
          onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        />
      )}

      {/* Modal */}
      <EditorModal 
        isOpen={isModalOpen} 
        onClose={() => {
          if (mode === 'new') {
            alert('Please complete the project setup.');
            return;
          }
          setIsModalOpen(false);
        }}
        onConfirm={() => {
          if (!formData.songId || !formData.songFile || !formData.songBpm) {
            alert('Please fill in all required fields: Song ID, Audio File, and Song BPM.');
            return;
          }
          handleConfirm();
        }}
        formData={formData}
        setFormData={setFormData}
        mode={mode}
      />

      {/* Top Navigation Bar */}
      <header className="h-14 border-b border-neutral-800 bg-neutral-900/50 flex items-center justify-between px-4 shrink-0">
        <div className="flex items-center gap-4 w-1/3">
          <button
            onClick={onBack}
            className="p-2 hover:bg-neutral-800 rounded-lg transition-colors text-neutral-400 hover:text-white"
            title="Back to Landing"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="h-4 w-px bg-neutral-800" />
          <h1 className="font-medium text-sm truncate">{projectData?.songName || 'Untitled Project'}</h1>
        </div>
        
        {/* Progress Bar */}
        <div className="flex-1 flex items-center justify-center px-4 max-w-xl">
          {projectData && (
            <input 
              ref={progressBarRef}
              type="range" 
              min={0} 
              max={duration || 100} 
              step={0.01}
              defaultValue={0}
              onMouseDown={() => { isDraggingProgress.current = true; }}
              onMouseUp={() => { isDraggingProgress.current = false; }}
              onTouchStart={() => { isDraggingProgress.current = true; }}
              onTouchEnd={() => { isDraggingProgress.current = false; }}
              onChange={handleSeekChange}
              className="w-full h-1.5 bg-neutral-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
            />
          )}
        </div>

        <div className="flex items-center gap-2 w-1/3 justify-end">
          {projectData && (
            <>
              <div className="text-sm font-mono text-neutral-400 mr-2">
                1/{gridZoom}
              </div>
              <div ref={timeDisplayRef} className="text-sm font-mono text-neutral-400 mr-4">
                {formatTime(currentTime, convertBpmChangesToTime(bpmChanges))}
              </div>
            </>
          )}
          <button className="p-2 hover:bg-neutral-800 rounded-lg transition-colors text-neutral-400 hover:text-white" title="Settings">
            <Settings className="w-4 h-4" />
          </button>
          <button 
            onClick={saveLevel}
            className="p-2 hover:bg-neutral-800 rounded-lg transition-colors text-neutral-400 hover:text-white"
            title="Save Level"
          >
            <Save className="w-4 h-4" />
          </button>
          <button 
            onClick={togglePlay}
            className={`p-2 rounded-lg transition-colors ${isPlaying ? 'bg-emerald-500/20 text-emerald-400' : 'hover:bg-neutral-800 text-neutral-400 hover:text-emerald-400'}`} 
            title={isPlaying ? "Pause (Space)" : "Play (Space)"}
          >
            {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
          </button>
          <button className="flex items-center gap-2 px-3 py-1.5 bg-indigo-500 hover:bg-indigo-600 text-white rounded-lg transition-colors text-sm font-medium ml-2">
            <Save className="w-4 h-4" />
            Save
          </button>
        </div>
      </header>

      {/* Main Editor Area */}
      <main className="flex-1 flex overflow-hidden">
        {/* Left Sidebar - General Functions */}
        <aside className="w-64 border-r border-neutral-800 bg-neutral-900/30 flex flex-col">
          {activeLeftPanel === 'main' && (
            <div className="p-4 flex flex-col gap-4 h-full">
              <div className="text-xs font-semibold text-neutral-500 uppercase tracking-wider">General Functions</div>
              <div className="flex flex-col gap-2 flex-1">
                <button 
                  onClick={handleEditInfo}
                  className="w-full text-left px-3 py-2 text-sm text-neutral-300 hover:text-white hover:bg-neutral-800 rounded-lg transition-colors"
                >
                  Chart Metadata
                </button>
                <button onClick={() => setActiveLeftPanel('bpmTiming')} className="w-full text-left px-3 py-2 text-sm text-neutral-300 hover:text-white hover:bg-neutral-800 rounded-lg transition-colors">
                  BPM / Timing
                </button>
                <button onClick={() => setActiveLeftPanel('curveNotes')} className="w-full text-left px-3 py-2 text-sm text-neutral-300 hover:text-white hover:bg-neutral-800 rounded-lg transition-colors">
                  Curve Notes
                </button>
                <button onClick={() => setActiveLeftPanel('curveSC')} className="w-full text-left px-3 py-2 text-sm text-neutral-300 hover:text-white hover:bg-neutral-800 rounded-lg transition-colors">
                  Curve SC
                </button>
                <button onClick={() => setActiveLeftPanel('history')} className="w-full text-left px-3 py-2 text-sm text-neutral-300 hover:text-white hover:bg-neutral-800 rounded-lg transition-colors">
                  Operation History
                </button>
              </div>
              
              <div className="mt-auto pt-4 border-t border-neutral-800">
                <div className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-2">Selected Note</div>
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded shadow-sm border border-neutral-700 flex items-center justify-center" style={{ backgroundColor: NOTE_TYPES[selectedNoteType]?.color || '#3b82f6' }}>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-sm font-medium text-neutral-300">{NOTE_TYPES[selectedNoteType]?.name || 'Unknown'}</span>
                    <span className="text-xs text-neutral-400">Width: {noteWidth} / 16</span>
                  </div>
                </div>
                <div className="text-xs text-neutral-500 mt-2">Press A/D to switch type</div>
                <div className="text-xs text-neutral-500 mt-1">Press Q/E to change width</div>
              </div>
            </div>
          )}

          {activeLeftPanel === 'editInfo' && (
            <div className="p-4 flex flex-col h-full overflow-hidden">
              <div className="flex items-center gap-2 mb-4 shrink-0">
                <button onClick={() => setActiveLeftPanel('main')} className="p-1 hover:bg-neutral-800 rounded text-neutral-400 hover:text-white transition-colors">
                  <ArrowLeft className="w-4 h-4" />
                </button>
                <div className="text-xs font-semibold text-neutral-500 uppercase tracking-wider">Edit Info</div>
              </div>
              <div className="flex flex-col gap-3 overflow-y-auto flex-1 pr-1 pb-4">
                <div>
                  <label className="block text-xs text-neutral-400 mb-1">Song ID</label>
                  <input type="text" value={formData.songId} className="w-full p-2 text-sm bg-neutral-800 rounded border border-neutral-700 focus:border-indigo-500 outline-none" onChange={(e) => setFormData({...formData, songId: e.target.value})} />
                </div>
                <div>
                  <label className="block text-xs text-neutral-400 mb-1">Song Name</label>
                  <input type="text" value={formData.songName} className="w-full p-2 text-sm bg-neutral-800 rounded border border-neutral-700 focus:border-indigo-500 outline-none" onChange={(e) => setFormData({...formData, songName: e.target.value})} />
                </div>
                <div>
                  <label className="block text-xs text-neutral-400 mb-1">Song Artist</label>
                  <input type="text" value={formData.songArtist} className="w-full p-2 text-sm bg-neutral-800 rounded border border-neutral-700 focus:border-indigo-500 outline-none" onChange={(e) => setFormData({...formData, songArtist: e.target.value})} />
                </div>
                <div>
                  <label className="block text-xs text-neutral-400 mb-1">Difficulty</label>
                  <input type="number" value={formData.difficulty} className="w-full p-2 text-sm bg-neutral-800 rounded border border-neutral-700 focus:border-indigo-500 outline-none" onChange={(e) => setFormData({...formData, difficulty: e.target.value})} />
                </div>
                <div>
                  <label className="block text-xs text-neutral-400 mb-1">Audio File</label>
                  <label className="flex flex-col items-center justify-center w-full h-12 border-2 border-dashed border-neutral-700 rounded cursor-pointer hover:border-indigo-500 hover:bg-neutral-800/50 transition-colors">
                    <p className="text-xs text-neutral-400 truncate w-full px-2 text-center">
                      {formData.songFile ? <span className="font-semibold text-indigo-400">{formData.songFile.name}</span> : <span>Upload audio</span>}
                    </p>
                    <input type="file" accept="audio/*" className="hidden" onChange={(e) => setFormData({...formData, songFile: e.target.files?.[0] || null})} />
                  </label>
                </div>
                <div>
                  <label className="block text-xs text-neutral-400 mb-1">Illustration</label>
                  <label className="group flex flex-col items-center justify-center w-full h-20 border-2 border-dashed border-neutral-700 rounded cursor-pointer hover:border-indigo-500 hover:bg-neutral-800/50 transition-colors relative overflow-hidden">
                    {illustrationPreview && (
                      <>
                        <img src={illustrationPreview} alt="Preview" className="absolute inset-0 w-full h-full object-cover" />
                        <div className="absolute inset-0 bg-neutral-900/70 group-hover:bg-neutral-900/50 transition-colors" />
                      </>
                    )}
                    <p className="text-xs text-neutral-300 truncate w-full px-2 text-center relative z-10">
                      {formData.songIllustration ? <span className="font-semibold text-indigo-300">{formData.songIllustration.name}</span> : <span>Upload image</span>}
                    </p>
                    <input type="file" accept="image/*" className="hidden" onChange={(e) => setFormData({...formData, songIllustration: e.target.files?.[0] || null})} />
                  </label>
                </div>
                <button onClick={handleConfirm} className="w-full p-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-sm font-semibold mt-2 transition-colors shrink-0">Save Changes</button>
              </div>
            </div>
          )}

          {activeLeftPanel === 'bpmTiming' && (
            <div className="p-4 flex flex-col h-full">
              <div className="flex items-center gap-2 mb-4 shrink-0">
                <button onClick={() => setActiveLeftPanel('main')} className="p-1 hover:bg-neutral-800 rounded text-neutral-400 hover:text-white transition-colors">
                  <ArrowLeft className="w-4 h-4" />
                </button>
                <div className="text-xs font-semibold text-neutral-500 uppercase tracking-wider">BPM / Timing</div>
              </div>
              <div className="flex flex-col gap-4 overflow-y-auto flex-1 pr-1 pb-4">
                <div>
                  <label className="block text-xs text-neutral-400 mb-1">Offset (ms)</label>
                  <input type="number" value={offset} className="w-full p-2 text-sm bg-neutral-800 rounded border border-neutral-700 focus:border-indigo-500 outline-none" onChange={(e) => setOffset(parseFloat(e.target.value) || 0)} />
                </div>
                <div>
                  <label className="block text-xs text-neutral-400 mb-1">BPM Changes</label>
                  <table className="w-full text-sm text-neutral-300">
                    <thead>
                      <tr className="text-left text-neutral-500">
                        <th className="pb-2">Meas</th>
                        <th className="pb-2">Beat</th>
                        <th className="pb-2">BPM</th>
                        <th className="pb-2">Sig</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bpmChanges.map((change, index) => (
                        <tr key={index}>
                          <td className="py-1"><input type="number" value={change.measure} className="w-10 p-1 bg-neutral-800 rounded border border-neutral-700" onChange={(e) => {
                            const newChanges = [...bpmChanges];
                            newChanges[index].measure = parseInt(e.target.value) || 0;
                            setBpmChanges(newChanges);
                          }} /></td>
                          <td className="py-1"><input type="number" value={change.beat} className="w-10 p-1 bg-neutral-800 rounded border border-neutral-700" onChange={(e) => {
                            const newChanges = [...bpmChanges];
                            newChanges[index].beat = parseInt(e.target.value) || 0;
                            setBpmChanges(newChanges);
                          }} /></td>
                          <td className="py-1"><input type="number" value={change.bpm} className="w-12 p-1 bg-neutral-800 rounded border border-neutral-700" onChange={(e) => {
                            const newChanges = [...bpmChanges];
                            newChanges[index].bpm = parseFloat(e.target.value) || 120;
                            setBpmChanges(newChanges);
                          }} /></td>
                          <td className="py-1"><input type="text" value={change.timeSignature} className="w-12 p-1 bg-neutral-800 rounded border border-neutral-700" onChange={(e) => {
                            const newChanges = [...bpmChanges];
                            newChanges[index].timeSignature = e.target.value;
                            setBpmChanges(newChanges);
                          }} /></td>
                          <td className="py-1">
                            {index > 0 && (
                              <button onClick={() => {
                                const newChanges = bpmChanges.filter((_, i) => i !== index);
                                setBpmChanges(newChanges);
                              }} className="text-red-400 hover:text-red-300">
                                <X className="w-4 h-4" />
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <button onClick={() => {
                    const sortedChanges = [...bpmChanges].sort((a, b) => (a.measure - b.measure) || (a.beat - b.beat));
                    const lastChange = sortedChanges[sortedChanges.length - 1];
                    
                    // Need to calculate current measure and beat
                    const totalBeats = getBeatAtTime(currentTime, convertBpmChangesToTime(bpmChanges));
                    const activeChange = getActiveChange(currentTime, convertBpmChangesToTime(bpmChanges));
                    const beatsPerMeasure = parseInt(activeChange.timeSignature.split('/')[0]) || 4;
                    
                    const measure = Math.floor(totalBeats / beatsPerMeasure);
                    const beat = Math.floor(totalBeats % beatsPerMeasure);

                    setBpmChanges([...bpmChanges, {
                      measure: measure,
                      beat: beat,
                      bpm: lastChange ? lastChange.bpm : 120, 
                      timeSignature: lastChange ? lastChange.timeSignature : '4/4'
                    }]);
                  }} className="w-full p-2 bg-neutral-800 hover:bg-neutral-700 text-white rounded text-sm mt-2 transition-colors">Add BPM Change</button>
                </div>
              </div>
            </div>
          )}

          {['curveNotes', 'curveSC', 'history'].includes(activeLeftPanel) && (
            <div className="p-4 flex flex-col h-full">
              <div className="flex items-center gap-2 mb-4 shrink-0">
                <button onClick={() => setActiveLeftPanel('main')} className="p-1 hover:bg-neutral-800 rounded text-neutral-400 hover:text-white transition-colors">
                  <ArrowLeft className="w-4 h-4" />
                </button>
                <div className="text-xs font-semibold text-neutral-500 uppercase tracking-wider">
                  {activeLeftPanel === 'curveNotes' ? 'Curve Notes' : activeLeftPanel === 'curveSC' ? 'Curve SC' : 'History'}
                </div>
              </div>
              <div className="flex-1 flex items-center justify-center text-sm text-neutral-600 border border-dashed border-neutral-800 rounded-lg p-4 text-center">
                Not implemented yet
              </div>
            </div>
          )}
        </aside>

        {/* Center - Canvas */}
        <section 
          ref={containerRef}
          className="flex-1 bg-neutral-950 relative flex items-center justify-center overflow-hidden"
          onWheel={handleWheel}
        >
          {!projectData ? (
            <div className="text-neutral-500 z-10 flex flex-col items-center gap-4">
              <div className="w-16 h-16 border-2 border-dashed border-neutral-700 rounded-full flex items-center justify-center">
                <span className="text-2xl">🎵</span>
              </div>
              <p>Fill in project details to start editing</p>
            </div>
          ) : (
            <EditorCanvas 
              canvasRef={canvasRef}
              containerRef={containerRef}
              projectData={projectData}
              gridZoom={gridZoom}
              stateRef={stateRef}
              selectedNoteIds={selectedNoteIds}
              selectionBox={selectionBox}
              timeDisplayRef={timeDisplayRef}
              progressBarRef={progressBarRef}
              isDraggingProgress={isDraggingProgress}
              audioRef={audioRef}
              onMouseDown={handleCanvasMouseDown}
              onMouseMove={handleCanvasMouseMove}
              onMouseUp={handleCanvasMouseUp}
              onMouseLeave={() => {
                handleCanvasMouseUp();
                setHoverPreview(null);
              }}
              onContextMenu={handleContextMenu}
              hoverPreview={hoverPreview}
              selectedNoteType={selectedNoteType}
              noteWidth={noteWidth}
            />
          )}
        </section>

        {/* Right Sidebar - Properties */}
        <aside className="w-64 border-l border-neutral-800 bg-neutral-900/30 p-4 flex flex-col gap-4">
          <div className="text-xs font-semibold text-neutral-500 uppercase tracking-wider">Properties</div>
          <div className="flex-1 flex items-center justify-center text-sm text-neutral-600 border border-dashed border-neutral-800 rounded-lg p-4 text-center">
            Select a note to edit its properties
          </div>
        </aside>
      </main>
    </motion.div>
  );
}
