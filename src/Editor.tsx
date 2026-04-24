import React, { useState, useEffect, useRef, useCallback } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowLeft, Settings, Play, Pause, Save, X, ChevronLeft, ChevronRight } from 'lucide-react';
import { convertBpmChangesToTime, getActiveChange, getBeatAtTime, getTimeAtBeat, formatTime } from './utils/editorUtils';
import EditorModal from './components/EditorModal';
import EditorCanvas from './components/EditorCanvas';
import { NOTE_TYPES, AVAILABLE_NOTE_TYPES, HOLD_CONNECTOR_TYPES, HOLD_CENTER_TYPES, HOLD_END_TYPES, HOLD_START_TYPES, UNKNOWN_NOTE_TYPE, getConnectorFill } from './constants/editorConstants';
import type { BpmChange, EditorFormData, EditorMode, Note, ProjectData, SelectionBox, SpeedChange } from './types/editorTypes';
import { buildLevelText } from './utils/levelFormat';

const HIT_SOUND_URL = new URL('../hit.ogg', import.meta.url).href;
const FLICK_SOUND_URL = new URL('../flick.ogg', import.meta.url).href;
const SOUND_URLS: Record<string, string> = {
  'hit.ogg': HIT_SOUND_URL,
  'flick.ogg': FLICK_SOUND_URL,
};
const HIT_SOUND_LOOKAHEAD_SECONDS = 0.12;
const HIT_SOUND_JUMP_TOLERANCE_SECONDS = 0.25;

interface EditorProps {
  onBack: () => void;
  mode?: EditorMode;
  notes: Note[];
  setNotes: React.Dispatch<React.SetStateAction<Note[]>>;
  bpmChanges: BpmChange[];
  setBpmChanges: React.Dispatch<React.SetStateAction<BpmChange[]>>;
  speedChanges: SpeedChange[];
  setSpeedChanges: React.Dispatch<React.SetStateAction<SpeedChange[]>>;
  offset: string | number;
  setOffset: React.Dispatch<React.SetStateAction<string | number>>;
}

interface EditorRuntimeState {
  isPlaying: boolean;
  currentTime: number;
  bpm: number;
  bpmChanges: BpmChange[];
  speedChanges: SpeedChange[];
  offset: string | number;
  notes: Note[];
}

interface HoverPreview {
  lane: number;
  time: number;
}

interface HitSoundEvent {
  time: number;
  soundUrl: string;
  key: string;
}

const getPreviousHoldConnectorId = (notes: Note[], time: number) => {
  const previousHoldConnector = notes
    .filter(note => HOLD_CONNECTOR_TYPES.includes(note.type) && note.time < time)
    .sort((a, b) => (a.time - b.time) || (a.id - b.id))
    .at(-1);

  return previousHoldConnector?.id ?? null;
};

export default function Editor({ 
  onBack, 
  mode,
  notes,
  setNotes,
  bpmChanges,
  setBpmChanges,
  speedChanges,
  setSpeedChanges,
  offset,
  setOffset
}: EditorProps) {
  const DEFAULT_PIXELS_PER_BEAT = 150;
  const MIN_PIXELS_PER_BEAT = 60;
  const MAX_PIXELS_PER_BEAT = 320;
  const [isModalOpen, setIsModalOpen] = useState(mode === 'new');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [musicVolume, setMusicVolume] = useState(1);
  const [tapSoundVolume, setTapSoundVolume] = useState(1);
  const [flickSoundVolume, setFlickSoundVolume] = useState(1);
  const [gridZoom, setGridZoom] = useState(1);
  const [pixelsPerBeat, setPixelsPerBeat] = useState(DEFAULT_PIXELS_PER_BEAT);
  const [activeLeftPanel, setActiveLeftPanel] = useState<'main' | 'editInfo' | 'speedChanges' | 'curveSC' | 'history' | 'bpmTiming'>('main');
  const [isLeftPanelCompact, setIsLeftPanelCompact] = useState(false);
  const [isRightPanelCompact, setIsRightPanelCompact] = useState(false);
  const [selectedNoteType, setSelectedNoteType] = useState<number>(1);
  const [noteWidth, setNoteWidth] = useState(4);
  const [currentParentInput, setCurrentParentInput] = useState('');
  const [hoverPreview, setHoverPreview] = useState<HoverPreview | null>(null);
  const [isCtrlHeld, setIsCtrlHeld] = useState(false);
  const [selectedNoteIds, setSelectedNoteIds] = useState<number[]>([]);
  const [draggingNoteId, setDraggingNoteId] = useState<number | null>(null);
  const [selectionBox, setSelectionBox] = useState<SelectionBox | null>(null);
  const nextNoteIdRef = useRef<number>(1);
  const lastPlayedTimeRef = useRef<number>(0);
  const [formData, setFormData] = useState<EditorFormData>({
    songId: '',
    songName: '',
    songArtist: '',
    songBpm: '',
    difficulty: '1',
    songFile: null as File | null,
    songIllustration: null as File | null,
  });
  const [illustrationPreview, setIllustrationPreview] = useState<string | null>(null);
  const shouldOmitParentForType = (type: number) => HOLD_START_TYPES.includes(type);

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
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [fps, setFps] = useState(0);
  const [renderedObjects, setRenderedObjects] = useState(0);
  
  const audioRef = useRef<HTMLAudioElement>(null);
  const musicAudioContextRef = useRef<AudioContext | null>(null);
  const musicSourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const musicGainRef = useRef<GainNode | null>(null);
  const hitSoundContextRef = useRef<AudioContext | null>(null);
  const hitSoundBuffersRef = useRef<Map<string, AudioBuffer>>(new Map());
  const hitSoundLoadPromisesRef = useRef<Map<string, Promise<AudioBuffer | null>>>(new Map());
  const activeHitSounds = useRef<Set<AudioBufferSourceNode>>(new Set());
  const hitSoundEventsRef = useRef<HitSoundEvent[]>([]);
  const hitSoundCursorRef = useRef(0);
  const scheduledHitSoundKeysRef = useRef<Set<string>>(new Set());
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const requestRef = useRef<number>();
  const fpsFrameCountRef = useRef(0);
  const fpsWindowStartRef = useRef(performance.now());
  const renderedObjectsRef = useRef(0);
  const timeDisplayRef = useRef<HTMLDivElement>(null);
  const progressBarRef = useRef<HTMLInputElement>(null);
  const isDraggingProgress = useRef(false);

  const openSettings = () => {
    setIsSettingsOpen(true);
  };

  const getAudioContextCtor = () => {
    return window.AudioContext ||
      (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext ||
      null;
  };

  const setupMusicGain = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return null;

    if (!musicAudioContextRef.current) {
      const AudioContextCtor = getAudioContextCtor();
      if (!AudioContextCtor) return null;

      const context = new AudioContextCtor({ latencyHint: 'interactive' });
      const source = context.createMediaElementSource(audio);
      const gain = context.createGain();

      source.connect(gain);
      gain.connect(context.destination);

      musicAudioContextRef.current = context;
      musicSourceRef.current = source;
      musicGainRef.current = gain;
      audio.volume = 1;
    }

    return musicAudioContextRef.current;
  }, []);

  const stateRef = useRef<EditorRuntimeState>({
    isPlaying: false,
    currentTime: 0,
    bpm: 120,
    bpmChanges: [{ measure: 0, beat: 0, bpm: 120, timeSignature: '4/4' }],
    speedChanges: [{ measure: 0, beat: 0, speedChange: 1 }],
    offset: 0,
    notes: [],
  });

  useEffect(() => {
    setupMusicGain();
    if (musicGainRef.current) {
      musicGainRef.current.gain.value = musicVolume;
    }
  }, [musicVolume, projectData?.audioUrl, setupMusicGain]);

  useEffect(() => {
    stateRef.current.isPlaying = isPlaying;
    stateRef.current.currentTime = currentTime;
    stateRef.current.bpm = projectData?.bpm || 120;
    stateRef.current.bpmChanges = bpmChanges;
    stateRef.current.offset = offset;
    stateRef.current.notes = notes;
    stateRef.current.speedChanges = speedChanges;
  }, [isPlaying, currentTime, projectData, bpmChanges, offset, notes, speedChanges]);

  useEffect(() => {
    if (draggingNoteId || selectionBox) {
      setHoverPreview(null);
    }
  }, [draggingNoteId, selectionBox]);

  useEffect(() => {
    if (isCtrlHeld) {
      setHoverPreview(null);
    }
  }, [isCtrlHeld]);

  useEffect(() => {
    if (mode === 'new') {
      setIsModalOpen(true);
    }
  }, [mode]);

  useEffect(() => {
    const maxNoteId = notes.reduce((maxId, note) => Math.max(maxId, note.id), 0);
    nextNoteIdRef.current = maxNoteId + 1;
  }, [notes]);

  useEffect(() => {
    const hitSoundEventsByKey = new Map<string, HitSoundEvent>();

    notes.forEach(note => {
      const noteTypeInfo = NOTE_TYPES[note.type];
      if (!noteTypeInfo?.sound) return;

      const soundUrl = SOUND_URLS[noteTypeInfo.sound] || noteTypeInfo.sound;
      const key = `${note.time}-${note.type}`;
      if (!hitSoundEventsByKey.has(key)) {
        hitSoundEventsByKey.set(key, { time: note.time, soundUrl, key });
      }
    });

    hitSoundEventsRef.current = Array.from(hitSoundEventsByKey.values()).sort((a, b) => a.time - b.time);
    hitSoundCursorRef.current = 0;
    scheduledHitSoundKeysRef.current.clear();
    lastPlayedTimeRef.current = stateRef.current.currentTime;
  }, [notes]);

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
    const parsedBpm = parseFloat(formData.songBpm);
    const fallbackBpm = projectData?.bpm || bpmChanges[0]?.bpm || 120;
    const nextBpm = Number.isFinite(parsedBpm) ? parsedBpm : fallbackBpm;

    setProjectData({
      ...formData,
      songBpm: nextBpm.toString(),
      bpm: nextBpm,
      audioUrl
    });

    // Only initialize timing data when creating a fresh project.
    if (!projectData) {
      setBpmChanges([{ measure: 0, beat: 0, bpm: nextBpm, timeSignature: '4/4' }]);
    }

    setIsModalOpen(false);
    if (activeLeftPanel === 'editInfo') {
      setActiveLeftPanel('main');
    }
  };

  const handleEditInfo = () => {
    setFormData({
      songId: projectData?.songId || '',
      songName: projectData?.songName || '',
      songArtist: projectData?.songArtist || '',
      songBpm: projectData?.bpm?.toString() || '',
      difficulty: projectData?.difficulty || '1',
      songFile: projectData?.songFile || null,
      songIllustration: projectData?.songIllustration || null,
    });
    setActiveLeftPanel('editInfo');
  };

  const getHitSoundContext = useCallback(() => {
    if (hitSoundContextRef.current) return hitSoundContextRef.current;

    const AudioContextCtor = getAudioContextCtor();
    if (!AudioContextCtor) return null;

    const context = new AudioContextCtor({ latencyHint: 'interactive' });
    hitSoundContextRef.current = context;
    return context;
  }, []);

  const loadHitSoundBuffer = useCallback(async (soundUrl: string) => {
    const cachedBuffer = hitSoundBuffersRef.current.get(soundUrl);
    if (cachedBuffer) return cachedBuffer;

    const existingLoad = hitSoundLoadPromisesRef.current.get(soundUrl);
    if (existingLoad) return existingLoad;

    const loadPromise = (async () => {
      const context = getHitSoundContext();
      if (!context) return null;

      try {
        const response = await fetch(soundUrl);
        const audioData = await response.arrayBuffer();
        const buffer = await context.decodeAudioData(audioData);
        hitSoundBuffersRef.current.set(soundUrl, buffer);
        return buffer;
      } catch (error) {
        console.warn('Failed to load hitsound:', soundUrl, error);
        return null;
      } finally {
        hitSoundLoadPromisesRef.current.delete(soundUrl);
      }
    })();

    hitSoundLoadPromisesRef.current.set(soundUrl, loadPromise);
    return loadPromise;
  }, [getHitSoundContext]);

  const playHitSound = useCallback((soundUrl: string, delaySeconds = 0) => {
    const context = getHitSoundContext();
    const buffer = hitSoundBuffersRef.current.get(soundUrl);
    if (!context || !buffer) {
      void loadHitSoundBuffer(soundUrl);
      return;
    }

    const source = context.createBufferSource();
    const gain = context.createGain();
    gain.gain.value = soundUrl === FLICK_SOUND_URL ? flickSoundVolume : tapSoundVolume;
    source.buffer = buffer;
    source.connect(gain);
    gain.connect(context.destination);

    activeHitSounds.current.add(source);
    source.onended = () => {
      activeHitSounds.current.delete(source);
      source.disconnect();
      gain.disconnect();
    };

    source.start(context.currentTime + Math.max(0, delaySeconds));
  }, [flickSoundVolume, getHitSoundContext, loadHitSoundBuffer, tapSoundVolume]);

  const prepareHitSounds = useCallback(() => {
    const context = getHitSoundContext();
    if (context?.state === 'suspended') {
      context.resume().catch(() => {});
    }

    return Promise.all(
      Object.values(SOUND_URLS).map(soundUrl => loadHitSoundBuffer(soundUrl)),
    );
  }, [getHitSoundContext, loadHitSoundBuffer]);

  useEffect(() => {
    void prepareHitSounds();

    return () => {
      activeHitSounds.current.forEach(source => {
        try {
          source.stop();
        } catch {
          // Source may have already ended.
        }
      });
      activeHitSounds.current.clear();
      hitSoundContextRef.current?.close().catch(() => {});
      hitSoundContextRef.current = null;
      musicAudioContextRef.current?.close().catch(() => {});
      musicAudioContextRef.current = null;
      musicSourceRef.current = null;
      musicGainRef.current = null;
    };
  }, [prepareHitSounds]);

  const handleSeekChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    stopHitsounds();
    const targetTime = parseFloat(e.target.value);

    // Snap to grid
    const sortedChanges = convertBpmChangesToTime(stateRef.current.bpmChanges);
    const targetBeat = getBeatAtTime(targetTime, sortedChanges);
    const snappedBeat = Math.round(targetBeat * gridZoom) / gridZoom;
    const newTime = getTimeAtBeat(snappedBeat, sortedChanges);
    
    setCurrentTime(newTime);
    stateRef.current.currentTime = newTime;
    lastPlayedTimeRef.current = newTime;
    hitSoundCursorRef.current = findHitSoundCursor(newTime);
    scheduledHitSoundKeysRef.current.clear();
    
    const offsetInSeconds = parseFloat(offset.toString()) / 1000;
    if (audioRef.current) {
      audioRef.current.currentTime = Math.max(0, newTime - offsetInSeconds);
    }
    if (timeDisplayRef.current && projectData) {
      timeDisplayRef.current.textContent = formatTime(newTime, sortedChanges);
    }
  }, [projectData, offset, gridZoom]);

  const stopHitsounds = () => {
    activeHitSounds.current.forEach(source => {
      try {
        source.stop();
      } catch {
        // Source may have already ended.
      }
    });
    activeHitSounds.current.clear();
    scheduledHitSoundKeysRef.current.clear();
  };

  const findHitSoundCursor = (time: number) => {
    const events = hitSoundEventsRef.current;
    let low = 0;
    let high = events.length;

    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (events[mid].time <= time) {
        low = mid + 1;
      } else {
        high = mid;
      }
    }

    return low;
  };

  const togglePlay = useCallback(() => {
    if (!audioRef.current || !projectData) return;
    const offsetInSeconds = parseFloat(offset.toString()) / 1000;
    
    if (stateRef.current.isPlaying) {
      stopHitsounds();
      audioRef.current.pause();
      // Clear any pending timeout if they were about to play
      if (window.hasOwnProperty('playTimeout')) {
        clearTimeout((window as any).playTimeout);
      }
      setIsPlaying(false);
      
      console.log('Paused, audioTime:', audioRef.current.currentTime);
      
      // Snap to nearest beat
      const sortedChanges = convertBpmChangesToTime(stateRef.current.bpmChanges);
      const activeChange = getActiveChange(audioRef.current.currentTime + offsetInSeconds, sortedChanges);
      const bpm = activeChange.bpm;
      
      const currentBeat = (audioRef.current.currentTime + Math.max(0, offsetInSeconds)) * (bpm / 60);
      const snappedBeat = Math.round(currentBeat);
      const snappedTime = getTimeAtBeat(snappedBeat, sortedChanges);
      
      setCurrentTime(snappedTime);
      stateRef.current.currentTime = snappedTime;
      lastPlayedTimeRef.current = snappedTime;
      hitSoundCursorRef.current = findHitSoundCursor(snappedTime);
      audioRef.current.currentTime = Math.max(0, snappedTime - offsetInSeconds);
    } else {
      const musicContext = setupMusicGain();
      if (musicContext?.state === 'suspended') {
        musicContext.resume().catch(() => {});
      }
      void prepareHitSounds();
      hitSoundCursorRef.current = findHitSoundCursor(stateRef.current.currentTime);
      scheduledHitSoundKeysRef.current.clear();
      lastPlayedTimeRef.current = stateRef.current.currentTime;

      // Apply offset here. If delay (offset > 0), wait. If advance (offset < 0), seek.
      if (offsetInSeconds > 0) {
        // Delay music: Editor starts at current time, Music starts playing after offsetInSeconds past audio seek point
        audioRef.current.currentTime = Math.max(0, stateRef.current.currentTime - offsetInSeconds);
        (window as any).playTimeout = setTimeout(() => {
            if (audioRef.current) audioRef.current.play();
        }, offsetInSeconds * 1000);
      } else {
        // Advance music: Start music early
        audioRef.current.currentTime = Math.max(0, stateRef.current.currentTime - offsetInSeconds);
        audioRef.current.play();
      }
      
      setIsPlaying(true);
    }
  }, [prepareHitSounds, projectData, offset, setupMusicGain]);

  useEffect(() => {
    const isOnlyKeyPressed = (e: KeyboardEvent) => (
      !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey
    );

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;

      if (e.key === 'Control') {
        setIsCtrlHeld(true);
      }

      if (!isOnlyKeyPressed(e)) return;
      
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

      if (e.key.toLowerCase() === 'r') {
        setPixelsPerBeat(prev => Math.min(MAX_PIXELS_PER_BEAT, prev + 20));
      }

      if (e.key.toLowerCase() === 'f') {
        setPixelsPerBeat(prev => Math.max(MIN_PIXELS_PER_BEAT, prev - 20));
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

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Control') {
        setIsCtrlHeld(false);
      }
    };

    const handleWindowBlur = () => {
      setIsCtrlHeld(false);
      setHoverPreview(null);
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleWindowBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleWindowBlur);
    };
  }, [togglePlay]);

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
    if (!ctx) return;

    const { width, height } = canvas;
    ctx.clearRect(0, 0, width, height);
    let objectCount = 0;

    const drawInvertedTriangle = (
      centerX: number,
      centerY: number,
      sideLength: number,
    ) => {
      const triangleHeight = (Math.sqrt(3) / 2) * sideLength;

      ctx.beginPath();
      ctx.moveTo(centerX - sideLength / 2, centerY - triangleHeight / 2);
      ctx.lineTo(centerX + sideLength / 2, centerY - triangleHeight / 2);
      ctx.lineTo(centerX, centerY + triangleHeight / 2);
      ctx.closePath();
      ctx.fill();
    };

    const drawCircleMark = (
      centerX: number,
      centerY: number,
      radius: number,
    ) => {
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
      ctx.stroke();
    };

    const drawArrow = (
      centerX: number,
      centerY: number,
      direction: 'left' | 'right' | 'up' | 'down',
      size: number,
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
      centerX: number,
      centerY: number,
      letter: 'S' | 'C' | 'E' | '?',
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

    if (!projectData) return;

    const sortedChanges = convertBpmChangesToTime(stateRef.current.bpmChanges);
    const offsetInSeconds = parseFloat(offset.toString()) / 1000;

    const activeChange = getActiveChange(stateRef.current.currentTime, sortedChanges);
    const bpm = activeChange.bpm;
    let time = stateRef.current.currentTime;
    
    if (stateRef.current.isPlaying && audioRef.current) {
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
      objectCount += 1;
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
      objectCount += 1;
      
      if (isMeasureLine) {
        ctx.fillStyle = '#888';
        ctx.font = '12px Inter, sans-serif';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${measureNumbers.get(Math.round(b))}`, startX - 10, y);
        objectCount += 1;
      }
    }

    // Draw BPM/Time Signature change indicators
    sortedChanges.forEach(change => {
      const changeBeat = getBeatAtTime(change.time, sortedChanges);
      const y = hitLineY - (changeBeat - currentBeat) * pixelsPerBeat;
      
      // Only draw indicators that are not at time 0 (as they are implied)
      if (change.time > 0 && y > 0 && y < height) {
        ctx.fillStyle = '#f59e0b';
        ctx.font = '10px Inter, sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(`BPM: ${change.bpm} | ${change.timeSignature}`, startX + gridWidth + 10, y);
        objectCount += 1;
      }
    });

    // Draw Speed change indicators
    stateRef.current.speedChanges.forEach(sc => {
      // Approximation: assuming 4 beats per measure for SC indicator position
      const scBeat = sc.measure * 4 + sc.beat;
      const y = hitLineY - (scBeat - currentBeat) * pixelsPerBeat;
      
      if (y > 0 && y < height) {
        ctx.fillStyle = '#06b6d4'; // teal-500
        ctx.font = '10px Inter, sans-serif';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText(`SC: ${sc.speedChange.toFixed(1)}x`, startX - 10, y);
        objectCount += 1;
      }
    });

    // Draw hold connections before note bodies so linked notes render on top.
    stateRef.current.notes.forEach(note => {
      if (!HOLD_CONNECTOR_TYPES.includes(note.type) || HOLD_START_TYPES.includes(note.type) || note.parentId === null) {
        return;
      }

      const parentNote = stateRef.current.notes.find(n => n.id === note.parentId);
      if (!parentNote) {
        return;
      }

      const noteBeat = getBeatAtTime(note.time, sortedChanges);
      const parentBeat = getBeatAtTime(parentNote.time, sortedChanges);
      const noteY = hitLineY - (noteBeat - currentBeat) * pixelsPerBeat;
      const parentY = hitLineY - (parentBeat - currentBeat) * pixelsPerBeat;

      const noteWidthPx = (laneWidth / 2) * note.width;
      const parentWidthPx = (laneWidth / 2) * parentNote.width;
      const noteLeftX = startX + note.lane * laneWidth + 2;
      const noteRightX = noteLeftX + noteWidthPx - 4;
      const parentLeftX = startX + parentNote.lane * laneWidth + 2;
      const parentRightX = parentLeftX + parentWidthPx - 4;

      ctx.fillStyle = getConnectorFill(note.type);
      ctx.beginPath();
      ctx.moveTo(parentLeftX, parentY);
      ctx.lineTo(parentRightX, parentY);
      ctx.lineTo(noteRightX, noteY);
      ctx.lineTo(noteLeftX, noteY);
      ctx.closePath();
      ctx.fill();
      objectCount += 1;
    });

    const notesAtPosition = new Map<string, number[]>();
    stateRef.current.notes.forEach((note) => {
      const key = `${note.time.toFixed(6)}:${note.lane}`;
      const groupedIds = notesAtPosition.get(key);
      if (groupedIds) {
        groupedIds.push(note.id);
      } else {
        notesAtPosition.set(key, [note.id]);
      }
    });
    const selectedParentNoteIds = new Set(
      stateRef.current.notes
        .filter((note) => selectedNoteIds.includes(note.id) && note.parentId !== null)
        .map((note) => note.parentId as number),
    );

    // Draw notes
    stateRef.current.notes.forEach(note => {
      const noteBeat = getBeatAtTime(note.time, sortedChanges);
      const y = hitLineY - (noteBeat - currentBeat) * pixelsPerBeat;
      
      if (y > -50 && y < height + 50) {
        const x = startX + note.lane * laneWidth;
        const notePixelWidth = (laneWidth / 2) * note.width;
        const noteCenterX = x + notePixelWidth / 2;
        
        const noteTypeInfo = NOTE_TYPES[note.type] || UNKNOWN_NOTE_TYPE;
        ctx.fillStyle = noteTypeInfo.color;
        ctx.fillRect(x + 2, y - 10, notePixelWidth - 4, 20);
        
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.strokeRect(x + 2, y - 10, notePixelWidth - 4, 20);

        if (note.type === 1 || note.type === 2) {
          ctx.fillStyle = '#ffffff';
          drawInvertedTriangle(x + notePixelWidth / 2, y, Math.min(notePixelWidth - 12, 12));
        }

        if (note.type === 9) {
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 2;
          drawCircleMark(noteCenterX, y, Math.min((notePixelWidth - 12) / 2, 6));
        }

        if (HOLD_START_TYPES.includes(note.type)) {
          drawNoteLetter(noteCenterX, y, 'S');
        }

        if (HOLD_CENTER_TYPES.includes(note.type)) {
          drawNoteLetter(noteCenterX, y, 'C');
        }

        if (HOLD_END_TYPES.includes(note.type)) {
          drawNoteLetter(noteCenterX, y, 'E');
        }

        if (!(note.type in NOTE_TYPES)) {
          drawNoteLetter(noteCenterX, y, '?');
        }

        if ([13, 14, 15, 16].includes(note.type)) {
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 2;

          if (note.type === 13) {
            drawArrow(noteCenterX, y, 'left', 10);
          }

          if (note.type === 14) {
            drawArrow(noteCenterX, y, 'right', 10);
          }

          if (note.type === 15) {
            drawArrow(noteCenterX, y, 'up', 10);
          }

          if (note.type === 16) {
            drawArrow(noteCenterX, y, 'down', 10);
          }
        }

        // Highlight if selected
        if (selectedNoteIds.includes(note.id)) {
          ctx.setLineDash([]);
          ctx.strokeStyle = '#ff00ff';
          ctx.lineWidth = 4;
          ctx.strokeRect(x, y - 12, notePixelWidth, 24);
        } else if (selectedParentNoteIds.has(note.id)) {
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
        const groupedIds = notesAtPosition.get(`${note.time.toFixed(6)}:${note.lane}`) || [note.id];
        ctx.fillText(formatGroupedIds(groupedIds), x + notePixelWidth / 2, y + 12);
        objectCount += 1;
      }
    });

    if (hoverPreview && !isCtrlHeld) {
      const previewBeat = getBeatAtTime(hoverPreview.time, sortedChanges);
      const previewY = hitLineY - (previewBeat - currentBeat) * pixelsPerBeat;

      if (previewY > -50 && previewY < height + 50) {
        const previewX = startX + hoverPreview.lane * laneWidth;
        const previewPixelWidth = (laneWidth / 2) * noteWidth;
        const previewCenterX = previewX + previewPixelWidth / 2;
        const previewTypeInfo = NOTE_TYPES[selectedNoteType] || UNKNOWN_NOTE_TYPE;
        const pulse = (Math.sin(performance.now() / 220) + 1) / 2;
        const fillAlpha = 0.12 + pulse * 0.12;
        const outlineAlpha = 0.35 + pulse * 0.35;

        ctx.save();
        ctx.globalAlpha = fillAlpha;
        ctx.fillStyle = previewTypeInfo.color;
        ctx.fillRect(previewX + 2, previewY - 10, previewPixelWidth - 4, 20);
        if (selectedNoteType === 1 || selectedNoteType === 2) {
          ctx.fillStyle = '#ffffff';
          drawInvertedTriangle(
            previewCenterX,
            previewY,
            Math.min(previewPixelWidth - 12, 12),
          );
        }
        if (selectedNoteType === 9) {
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 2;
          drawCircleMark(
            previewCenterX,
            previewY,
            Math.min((previewPixelWidth - 12) / 2, 6),
          );
        }
        if (HOLD_START_TYPES.includes(selectedNoteType)) {
          drawNoteLetter(previewCenterX, previewY, 'S');
        }
        if (HOLD_CENTER_TYPES.includes(selectedNoteType)) {
          drawNoteLetter(previewCenterX, previewY, 'C');
        }
        if (HOLD_END_TYPES.includes(selectedNoteType)) {
          drawNoteLetter(previewCenterX, previewY, 'E');
        }
        if (!(selectedNoteType in NOTE_TYPES)) {
          drawNoteLetter(previewCenterX, previewY, '?');
        }
        if ([13, 14, 15, 16].includes(selectedNoteType)) {
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 2;

          if (selectedNoteType === 13) {
            drawArrow(previewCenterX, previewY, 'left', 10);
          }

          if (selectedNoteType === 14) {
            drawArrow(previewCenterX, previewY, 'right', 10);
          }

          if (selectedNoteType === 15) {
            drawArrow(previewCenterX, previewY, 'up', 10);
          }

          if (selectedNoteType === 16) {
            drawArrow(previewCenterX, previewY, 'down', 10);
          }
        }
        ctx.globalAlpha = outlineAlpha;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.strokeRect(previewX + 2, previewY - 10, previewPixelWidth - 4, 20);
        ctx.setLineDash([6, 4]);
        ctx.strokeStyle = '#ffffff';
        ctx.strokeRect(previewX, previewY - 12, previewPixelWidth, 24);
        ctx.restore();
        objectCount += 1;
      }
    }

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
      objectCount += 1;
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
    objectCount += 1;
    renderedObjectsRef.current = objectCount;

  }, [pixelsPerBeat, projectData, gridZoom, hoverPreview, isCtrlHeld, noteWidth, selectedNoteIds, selectedNoteType, selectionBox]);

  const update = useCallback(() => {
    const now = performance.now();
    fpsFrameCountRef.current += 1;
    const elapsed = now - fpsWindowStartRef.current;
    if (elapsed >= 500) {
      setFps(Math.round((fpsFrameCountRef.current * 1000) / elapsed));
      fpsFrameCountRef.current = 0;
      fpsWindowStartRef.current = now;
      setRenderedObjects(renderedObjectsRef.current);
    }

    if (stateRef.current.isPlaying && audioRef.current) {
      const offsetInSeconds = parseFloat(offset.toString()) / 1000;
      const currentTime = audioRef.current.currentTime + offsetInSeconds;
      const scheduleUntil = currentTime + HIT_SOUND_LOOKAHEAD_SECONDS;
      const lastTime = lastPlayedTimeRef.current;

      if (currentTime + HIT_SOUND_JUMP_TOLERANCE_SECONDS < lastTime) {
        hitSoundCursorRef.current = findHitSoundCursor(currentTime);
        scheduledHitSoundKeysRef.current.clear();
      }

      const events = hitSoundEventsRef.current;
      let cursor = hitSoundCursorRef.current;

      while (cursor < events.length && events[cursor].time <= lastTime) {
        cursor += 1;
      }

      while (cursor < events.length && events[cursor].time <= scheduleUntil) {
        const event = events[cursor];
        if (!scheduledHitSoundKeysRef.current.has(event.key)) {
          scheduledHitSoundKeysRef.current.add(event.key);
          playHitSound(event.soundUrl, event.time - currentTime);
        }
        cursor += 1;
      }

      hitSoundCursorRef.current = cursor;
      
      lastPlayedTimeRef.current = scheduleUntil;
    } else {
      lastPlayedTimeRef.current = stateRef.current.currentTime;
    }

    drawGrid();
    requestRef.current = requestAnimationFrame(update);
  }, [drawGrid, offset, playHitSound]); // Added offset to dependencies

  useEffect(() => {
    requestRef.current = requestAnimationFrame(update);
    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [update]);

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

    const hitLineY = height - 150;
    
    const sortedChanges = convertBpmChangesToTime(stateRef.current.bpmChanges);
    const currentBeat = getBeatAtTime(stateRef.current.currentTime, sortedChanges);
    
    const clickBeat = currentBeat + (hitLineY - clickY) / pixelsPerBeat;
    
    // Snap to grid
    const snap = gridZoom;
    const snappedBeat = Math.round(clickBeat * snap) / snap;
    
    if (snappedBeat < 0) return;
    
    const snappedTime = getTimeAtBeat(snappedBeat, sortedChanges);

    const clickedNote = stateRef.current.notes.reduce<Note | null>((highestNote, note) => {
      const noteBeat = getBeatAtTime(note.time, sortedChanges);
      const noteY = hitLineY - (noteBeat - currentBeat) * pixelsPerBeat;
      const noteStartX = startX + note.lane * laneWidth;
      const noteEndX = noteStartX + (laneWidth / 2) * note.width;
      const isHit = clickX >= noteStartX && clickX <= noteEndX && clickY >= noteY - 10 && clickY <= noteY + 10;

      if (!isHit) {
        return highestNote;
      }

      if (!highestNote || note.id > highestNote.id) {
        return note;
      }

      return highestNote;
    }, null);

    if (e.button === 0) { // Left click
      if (e.ctrlKey && clickedNote) {
        setSelectedNoteIds([clickedNote.id]);
        setDraggingNoteId(clickedNote.id);
        return;
      }

      if (clickX >= startX && clickX < startX + gridWidth) {
        const lane = Math.floor((clickX - startX) / laneWidth);
        const newId = nextNoteIdRef.current++;
        const isHoldConnector = HOLD_CONNECTOR_TYPES.includes(selectedNoteType);
        const isHoldStart = HOLD_START_TYPES.includes(selectedNoteType);
        setNotes(prev => {
          const filtered = prev.filter(n => !(Math.abs(n.time - snappedTime) < 0.001 && n.lane === lane));
          const manualParentId =
            currentParentNote && filtered.some(note => note.id === currentParentNote.id)
              ? currentParentNote.id
              : null;
          const autoParentId = isHoldConnector && !isHoldStart
            ? getPreviousHoldConnectorId(filtered, snappedTime)
            : null;
          const parentId = isHoldConnector && !isHoldStart
            ? manualParentId ?? autoParentId
            : null;
          
          return [...filtered, { id: newId, time: snappedTime, lane, type: selectedNoteType, width: noteWidth, parentId }];
        });

        if (isHoldConnector && currentParentInput.trim() !== '') {
          setCurrentParentInput(newId.toString());
        }
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

    const { width, height } = canvas;
    const lanes = 8;
    const laneWidth = Math.min(60, width / (lanes + 2));
    const gridWidth = lanes * laneWidth;
    const startX = (width - gridWidth) / 2;
    const hitLineY = height - 150;
    const sortedChanges = convertBpmChangesToTime(stateRef.current.bpmChanges);
    const currentBeat = getBeatAtTime(stateRef.current.currentTime, sortedChanges);

    if (draggingNoteId) {
      const lane = Math.floor((clickX - startX) / laneWidth);
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
    } else if (selectionBox) {
      setSelectionBox(prev => prev ? { ...prev, endX: clickX, endY: clickY } : null);
    } else if (e.ctrlKey || isCtrlHeld) {
      setHoverPreview(null);
    } else if (clickX >= startX && clickX < startX + gridWidth) {
      let lane = Math.floor((clickX - startX) / laneWidth);
      lane = Math.max(0, Math.min(lanes - 1, lane));

      const clickBeat = currentBeat + (hitLineY - clickY) / pixelsPerBeat;
      const snappedBeat = Math.round(clickBeat * gridZoom) / gridZoom;

      if (snappedBeat < 0) {
        setHoverPreview(null);
        return;
      }

      const snappedTime = getTimeAtBeat(snappedBeat, sortedChanges);
      setHoverPreview({ lane, time: snappedTime });
    } else {
      setHoverPreview(null);
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

  const handleCanvasMouseLeave = () => {
    setHoverPreview(null);
    handleCanvasMouseUp();
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
  };

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (!projectData) return;
    
    if (stateRef.current.isPlaying) {
      togglePlay();
    }
    
    const sortedChanges = convertBpmChangesToTime(stateRef.current.bpmChanges);
    const currentBeat = getBeatAtTime(stateRef.current.currentTime, sortedChanges);
    const targetBeat = currentBeat + (e.deltaY / pixelsPerBeat);
    
    // Snap to grid
    const snappedBeat = Math.round(targetBeat * gridZoom) / gridZoom;
    const newTime = getTimeAtBeat(snappedBeat, sortedChanges);
    
    let clampedTime = Math.max(0, newTime);
    if (audioRef.current && audioRef.current.duration && clampedTime > audioRef.current.duration) {
      clampedTime = audioRef.current.duration;
    }
    
    setCurrentTime(clampedTime);
    stateRef.current.currentTime = clampedTime;
    lastPlayedTimeRef.current = clampedTime;
    hitSoundCursorRef.current = findHitSoundCursor(clampedTime);
    scheduledHitSoundKeysRef.current.clear();
    if (audioRef.current) {
      const offsetInSeconds = parseFloat(offset.toString()) / 1000;
      audioRef.current.currentTime = Math.max(0, clampedTime - offsetInSeconds);
    }
    if (timeDisplayRef.current) {
      timeDisplayRef.current.textContent = formatTime(clampedTime, sortedChanges);
    }
    if (progressBarRef.current && !isDraggingProgress.current) {
      progressBarRef.current.value = newTime.toString();
    }
  };

  const saveLevel = async () => {
    if (!projectData) return;
    const content = buildLevelText({
      projectData,
      notes,
      bpmChanges,
      speedChanges,
      offset,
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

  const currentParentId =
    currentParentInput.trim() === '' ? null : parseInt(currentParentInput, 10);
  const currentParentNote =
    currentParentId === null || Number.isNaN(currentParentId)
      ? null
      : notes.find((note) => note.id === currentParentId) || null;
  const selectedSingleNote =
    selectedNoteIds.length === 1
      ? notes.find((note) => note.id === selectedNoteIds[0]) || null
      : null;
  const selectedParentNote =
    selectedSingleNote?.parentId === null || selectedSingleNote?.parentId === undefined
      ? null
      : notes.find((note) => note.id === selectedSingleNote.parentId) || null;
  const timedBpmChanges = convertBpmChangesToTime(bpmChanges);
  const getTimeposFromTime = (time: number) => {
    const totalBeats = getBeatAtTime(time, timedBpmChanges);
    let currentMeasureBeat = 0;
    let measureCount = 0;
    let currentBeatsPerMeasure = 4;

    while (measureCount < 10000) {
      const timeAtMeasure = getTimeAtBeat(currentMeasureBeat, timedBpmChanges);
      const activeChange = getActiveChange(timeAtMeasure + 0.001, timedBpmChanges);
      currentBeatsPerMeasure = parseInt(activeChange.timeSignature.split('/')[0], 10) || 4;

      if (totalBeats < currentMeasureBeat + currentBeatsPerMeasure) {
        break;
      }

      currentMeasureBeat += currentBeatsPerMeasure;
      measureCount++;
    }

    const beatInMeasure = totalBeats - currentMeasureBeat;
    return measureCount + beatInMeasure / currentBeatsPerMeasure;
  };
  const getTimeFromTimepos = (timepos: number) => {
    const measureCount = Math.max(0, Math.floor(timepos));
    const measureDecimal = Math.max(0, timepos - measureCount);
    let currentMeasureBeat = 0;
    let currentBeatsPerMeasure = 4;

    for (let measure = 0; measure <= measureCount; measure++) {
      const timeAtMeasure = getTimeAtBeat(currentMeasureBeat, timedBpmChanges);
      const activeChange = getActiveChange(timeAtMeasure + 0.001, timedBpmChanges);
      currentBeatsPerMeasure = parseInt(activeChange.timeSignature.split('/')[0], 10) || 4;

      if (measure < measureCount) {
        currentMeasureBeat += currentBeatsPerMeasure;
      }
    }

    return getTimeAtBeat(currentMeasureBeat + measureDecimal * currentBeatsPerMeasure, timedBpmChanges);
  };
  const selectedNoteTimepos = selectedSingleNote ? getTimeposFromTime(selectedSingleNote.time) : 0;
  const notePropertyInputClass = 'w-full p-2 text-sm bg-neutral-800 rounded border border-neutral-700 focus:border-indigo-500 outline-none';
  const updateSelectedNote = (updates: Partial<Note>) => {
    if (!selectedSingleNote) return;

    const nextType = updates.type ?? selectedSingleNote.type;
    const normalizedUpdates = shouldOmitParentForType(nextType)
      ? { ...updates, parentId: null }
      : updates;

    setNotes(prev => prev.map(note => (
      note.id === selectedSingleNote.id ? { ...note, ...normalizedUpdates } : note
    )));
  };
  const jumpToNoteTime = (time: number) => {
    if (stateRef.current.isPlaying) {
      togglePlay();
    }

    let clampedTime = Math.max(0, time);
    if (audioRef.current && audioRef.current.duration && clampedTime > audioRef.current.duration) {
      clampedTime = audioRef.current.duration;
    }

    setCurrentTime(clampedTime);
    stateRef.current.currentTime = clampedTime;
    lastPlayedTimeRef.current = clampedTime;
    hitSoundCursorRef.current = findHitSoundCursor(clampedTime);
    scheduledHitSoundKeysRef.current.clear();

    if (audioRef.current) {
      const offsetInSeconds = parseFloat(offset.toString()) / 1000;
      audioRef.current.currentTime = Math.max(0, clampedTime - offsetInSeconds);
    }

    if (timeDisplayRef.current) {
      timeDisplayRef.current.textContent = formatTime(clampedTime, timedBpmChanges);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
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

      <AnimatePresence>
        {isSettingsOpen && (
          <motion.div
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/55 p-4 backdrop-blur-md"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onMouseDown={() => setIsSettingsOpen(false)}
          >
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-labelledby="settings-title"
              className="flex min-h-[22rem] w-full max-w-md flex-col overflow-hidden rounded-3xl border border-white/10 bg-neutral-950/90 shadow-2xl shadow-black/50"
              initial={{ opacity: 0, y: 28, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.96 }}
              transition={{ type: 'spring', stiffness: 320, damping: 30 }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <div className="border-b border-white/10 bg-gradient-to-br from-neutral-900 to-neutral-950 px-6 py-5">
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-neutral-500">Editor</p>
                <h2 id="settings-title" className="mt-2 text-2xl font-semibold text-white">Settings</h2>
              </div>

              <div className="flex flex-1 flex-col gap-5 px-6 py-6">
                <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                  <div className="mb-5 flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-semibold text-white">Audio</h3>
                      <p className="mt-1 text-xs text-neutral-500">Balance music playback and editor hit sounds.</p>
                    </div>
                  </div>

                  <div className="space-y-5">
                    <label className="block">
                      <div className="mb-2 flex items-center justify-between text-sm">
                        <span className="text-neutral-300">Music volume</span>
                        <span className="font-mono text-xs text-neutral-500">{Math.round(musicVolume * 100)}%</span>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="2"
                        step="0.01"
                        value={musicVolume}
                        onChange={(e) => setMusicVolume(Number(e.target.value))}
                        className="h-2 w-full cursor-pointer appearance-none rounded-full bg-neutral-800 accent-indigo-500"
                      />
                    </label>

                    <label className="block">
                      <div className="mb-2 flex items-center justify-between text-sm">
                        <span className="text-neutral-300">Taps volume</span>
                        <span className="font-mono text-xs text-neutral-500">{Math.round(tapSoundVolume * 100)}%</span>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="2"
                        step="0.01"
                        value={tapSoundVolume}
                        onChange={(e) => setTapSoundVolume(Number(e.target.value))}
                        aria-label="Taps volume"
                        className="h-2 w-full cursor-pointer appearance-none rounded-full bg-neutral-800 accent-indigo-500"
                      />
                    </label>

                    <label className="block">
                      <div className="mb-2 flex items-center justify-between text-sm">
                        <span className="text-neutral-300">Flicks volume</span>
                        <span className="font-mono text-xs text-neutral-500">{Math.round(flickSoundVolume * 100)}%</span>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="2"
                        step="0.01"
                        value={flickSoundVolume}
                        onChange={(e) => setFlickSoundVolume(Number(e.target.value))}
                        aria-label="Flicks volume"
                        className="h-2 w-full cursor-pointer appearance-none rounded-full bg-neutral-800 accent-indigo-500"
                      />
                    </label>
                  </div>
                </section>
              </div>

              <div className="border-t border-white/10 p-4">
                <button
                  onClick={() => setIsSettingsOpen(false)}
                  className="w-full rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-neutral-950 transition-colors hover:bg-neutral-200"
                >
                  Close
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

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
              <div className="text-sm font-mono text-neutral-400 w-20 text-left">
                Snap <span className="inline-block w-8 text-center">1/{gridZoom}</span>
              </div>
              <div className="text-sm font-mono text-neutral-400 w-24 text-left">
                Zoom <span className="inline-block w-10 text-center">{pixelsPerBeat}px</span>
              </div>
              <div ref={timeDisplayRef} className="text-sm font-mono text-neutral-400 mr-4">
                {formatTime(currentTime, convertBpmChangesToTime(bpmChanges))}
              </div>
            </>
          )}
          <button
            type="button"
            onPointerDown={(e) => {
              e.preventDefault();
              openSettings();
            }}
            className="p-2 hover:bg-neutral-800 rounded-lg transition-colors text-neutral-400 hover:text-white"
            title="Settings"
            aria-haspopup="dialog"
            aria-expanded={isSettingsOpen}
          >
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

      {projectData && (
        <div
          className="group fixed bottom-4 right-4 z-40 select-none"
          tabIndex={0}
          aria-label={`Performance statistics: ${fps} FPS, ${renderedObjects} rendered objects`}
        >
          <div className="pointer-events-none absolute bottom-full right-0 mb-2 min-w-40 translate-y-1 rounded-xl border border-neutral-700 bg-neutral-950/95 px-3 py-2 text-right font-mono text-xs text-neutral-300 opacity-0 shadow-2xl shadow-black/40 backdrop-blur transition-all duration-150 group-hover:translate-y-0 group-hover:opacity-100 group-focus:translate-y-0 group-focus:opacity-100">
            Rendered objects <span className="ml-2 text-white">{renderedObjects}</span>
          </div>
          <div className="rounded-xl border border-neutral-700 bg-neutral-950/90 px-3 py-2 font-mono text-sm text-neutral-300 shadow-2xl shadow-black/40 backdrop-blur">
            FPS <span className="ml-2 inline-block min-w-8 text-right text-white">{fps}</span>
          </div>
        </div>
      )}

      {/* Main Editor Area */}
      <main className="flex-1 flex overflow-hidden min-h-0">
        {/* Left Sidebar - General Functions */}
        <aside className={`${isLeftPanelCompact ? 'w-12' : 'w-64'} shrink-0 border-r border-neutral-800 bg-neutral-900/30 flex flex-col transition-all duration-300 overflow-hidden`}>
          <div className="p-2 border-b border-neutral-800 flex justify-center">
            <button onClick={() => setIsLeftPanelCompact(!isLeftPanelCompact)} className="p-1 hover:bg-neutral-800 rounded text-neutral-400 hover:text-white transition-colors">
              {isLeftPanelCompact ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
            </button>
          </div>
          {!isLeftPanelCompact && activeLeftPanel === 'main' && (
            <div className="p-4 flex flex-col gap-4 h-full overflow-y-auto min-h-0">
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
                <button onClick={() => setActiveLeftPanel('speedChanges')} className="w-full text-left px-3 py-2 text-sm text-neutral-300 hover:text-white hover:bg-neutral-800 rounded-lg transition-colors">
                  Speed Changes
                </button>
                <button onClick={() => setActiveLeftPanel('curveSC')} className="w-full text-left px-3 py-2 text-sm text-neutral-300 hover:text-white hover:bg-neutral-800 rounded-lg transition-colors">
                  Curve SC
                </button>
                <button onClick={() => setActiveLeftPanel('history')} className="w-full text-left px-3 py-2 text-sm text-neutral-300 hover:text-white hover:bg-neutral-800 rounded-lg transition-colors">
                  Operation History
                </button>
              </div>
              
              <div className="mt-auto pt-4 border-t border-neutral-800">
                <div className="mb-4">
                  <div className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-2">Current Parent</div>
                  <input
                    type="number"
                    min="0"
                    value={currentParentInput}
                    placeholder="Auto"
                    className="w-full p-2 text-sm bg-neutral-800 rounded border border-neutral-700 focus:border-indigo-500 outline-none"
                    onChange={(e) => setCurrentParentInput(e.target.value)}
                  />
                  <div className="text-xs text-neutral-400 mt-2">
                    {currentParentNote
                      ? `ID ${currentParentNote.id} | Lane ${currentParentNote.lane + 1} | Type ${NOTE_TYPES[currentParentNote.type]?.name || currentParentNote.type}`
                      : currentParentInput.trim() === ''
                        ? 'Auto-select previous note when placing.'
                        : 'No note exists with that ID.'}
                  </div>
                  <div className="flex gap-2 mt-2">
                    <button
                      onClick={() => setCurrentParentInput('')}
                      className="flex-1 px-2 py-1.5 text-xs text-neutral-300 bg-neutral-800 hover:bg-neutral-700 rounded transition-colors"
                    >
                      Auto
                    </button>
                    <button
                      onClick={() => {
                        if (selectedSingleNote) {
                          setCurrentParentInput(selectedSingleNote.id.toString());
                        }
                      }}
                      disabled={!selectedSingleNote}
                      className="flex-1 px-2 py-1.5 text-xs text-neutral-300 bg-neutral-800 hover:bg-neutral-700 disabled:bg-neutral-900 disabled:text-neutral-600 rounded transition-colors"
                    >
                      Use Selected
                    </button>
                  </div>
                  <div className="text-xs text-neutral-500 mt-2">
                    Current ID: {Math.max(nextNoteIdRef.current - 1, 0)}
                  </div>
                </div>

                <div className="pt-4 border-t border-neutral-800">
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
            </div>
          )}

          {activeLeftPanel === 'editInfo' && (
            <div className="p-4 flex flex-col h-full overflow-hidden min-h-0">
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
            <div className="p-4 flex flex-col h-full overflow-hidden min-h-0">
              <div className="flex items-center gap-2 mb-4 shrink-0">
                <button onClick={() => setActiveLeftPanel('main')} className="p-1 hover:bg-neutral-800 rounded text-neutral-400 hover:text-white transition-colors">
                  <ArrowLeft className="w-4 h-4" />
                </button>
                <div className="text-xs font-semibold text-neutral-500 uppercase tracking-wider">BPM / Timing</div>
              </div>
              <div className="flex flex-col gap-4 overflow-y-auto flex-1 pr-1 pb-4 min-h-0">
                <div>
                  <label className="block text-xs text-neutral-400 mb-1">Offset (ms)</label>
                  <input type="number" value={offset} className="w-full p-2 text-sm bg-neutral-800 rounded border border-neutral-700 focus:border-indigo-500 outline-none" onChange={(e) => {
                    const val = e.target.value;
                    if (val === '-' || val === "") setOffset(val);
                    else {
                      const num = parseFloat(val);
                      setOffset(isNaN(num) ? 0 : num);
                    }
                  }} />
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

          {activeLeftPanel === 'speedChanges' && (
            <div className="p-4 flex flex-col h-full overflow-hidden min-h-0">
              <div className="flex items-center gap-2 mb-4 shrink-0">
                <button onClick={() => setActiveLeftPanel('main')} className="p-1 hover:bg-neutral-800 rounded text-neutral-400 hover:text-white transition-colors">
                  <ArrowLeft className="w-4 h-4" />
                </button>
                <div className="text-xs font-semibold text-neutral-500 uppercase tracking-wider">Speed Changes</div>
              </div>
              <div className="flex flex-col gap-4 overflow-y-auto flex-1 pr-1 pb-4 min-h-0">
                <table className="w-full text-sm text-neutral-300">
                  <thead>
                    <tr className="text-left text-neutral-500">
                      <th className="pb-2">Meas</th>
                      <th className="pb-2">Beat</th>
                      <th className="pb-2">Speed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {speedChanges.map((change, index) => (
                      <tr key={index}>
                        <td className="py-1"><input type="number" value={change.measure} className="w-10 p-1 bg-neutral-800 rounded border border-neutral-700" onChange={(e) => {
                          const newChanges = [...speedChanges];
                          newChanges[index].measure = parseInt(e.target.value) || 0;
                          setSpeedChanges(newChanges);
                        }} /></td>
                        <td className="py-1"><input type="number" value={change.beat} className="w-10 p-1 bg-neutral-800 rounded border border-neutral-700" onChange={(e) => {
                          const newChanges = [...speedChanges];
                          newChanges[index].beat = parseInt(e.target.value) || 0;
                          setSpeedChanges(newChanges);
                        }} /></td>
                        <td className="py-1"><input type="number" step="0.1" value={change.speedChange} className="w-12 p-1 bg-neutral-800 rounded border border-neutral-700" onChange={(e) => {
                          const newChanges = [...speedChanges];
                          const val = parseFloat(e.target.value);
                          newChanges[index].speedChange = isNaN(val) ? 1 : val;
                          setSpeedChanges(newChanges);
                        }} /></td>
                        <td className="py-1">
                          {index > 0 && (
                            <button onClick={() => {
                              const newChanges = speedChanges.filter((_, i) => i !== index);
                              setSpeedChanges(newChanges);
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
                  const totalBeats = getBeatAtTime(currentTime, convertBpmChangesToTime(bpmChanges));
                  const activeChange = getActiveChange(currentTime, convertBpmChangesToTime(bpmChanges));
                  const beatsPerMeasure = parseInt(activeChange.timeSignature.split('/')[0]) || 4;
                  
                  const measure = Math.floor(totalBeats / beatsPerMeasure);
                  const beat = Math.floor(totalBeats % beatsPerMeasure);

                  setSpeedChanges([...speedChanges, {
                    measure: measure,
                    beat: beat,
                    speedChange: 1
                  }]);
                }} className="w-full p-2 bg-neutral-800 hover:bg-neutral-700 text-white rounded text-sm mt-2 transition-colors">Add Speed Change</button>
              </div>
            </div>
          )}

          {['curveSC', 'history'].includes(activeLeftPanel) && (
            <div className="p-4 flex flex-col h-full">
              <div className="flex items-center gap-2 mb-4 shrink-0">
                <button onClick={() => setActiveLeftPanel('main')} className="p-1 hover:bg-neutral-800 rounded text-neutral-400 hover:text-white transition-colors">
                  <ArrowLeft className="w-4 h-4" />
                </button>
                <div className="text-xs font-semibold text-neutral-500 uppercase tracking-wider">
                  {activeLeftPanel === 'curveSC' ? 'Curve SC' : 'History'}
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
              pixelsPerBeat={pixelsPerBeat}
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
              onMouseLeave={handleCanvasMouseLeave}
              onContextMenu={handleContextMenu}
            />
          )}
        </section>

        {/* Right Sidebar - Properties */}
        <aside className={`${isRightPanelCompact ? 'w-12' : 'w-64'} shrink-0 border-l border-neutral-800 bg-neutral-900/30 flex flex-col transition-all duration-300 overflow-hidden`}>
          <div className="p-2 border-b border-neutral-800 flex justify-center">
            <button onClick={() => setIsRightPanelCompact(!isRightPanelCompact)} className="p-1 hover:bg-neutral-800 rounded text-neutral-400 hover:text-white transition-colors">
              {isRightPanelCompact ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            </button>
          </div>
          {!isRightPanelCompact && (
            <div className="p-4 flex flex-col gap-4 overflow-y-auto">
              <div className="text-xs font-semibold text-neutral-500 uppercase tracking-wider">Properties</div>
              {selectedSingleNote ? (
                <div className="flex flex-col gap-3">
                  <div className="rounded-lg border border-neutral-800 bg-neutral-950/40 p-3">
                    <div className="flex items-center gap-3">
                      <div
                        className="h-8 w-8 rounded border border-neutral-700"
                        style={{ backgroundColor: NOTE_TYPES[selectedSingleNote.type]?.color || UNKNOWN_NOTE_TYPE.color }}
                      />
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-neutral-200">
                          {NOTE_TYPES[selectedSingleNote.type]?.name || UNKNOWN_NOTE_TYPE.name}
                        </div>
                        <div className="text-xs text-neutral-500">ID {selectedSingleNote.id}</div>
                      </div>
                    </div>
                  </div>

                  <label className="block">
                    <span className="mb-1 block text-xs text-neutral-400">Type</span>
                    <select
                      value={selectedSingleNote.type}
                      className={notePropertyInputClass}
                      onChange={(e) => updateSelectedNote({ type: Number(e.target.value) })}
                    >
                      {AVAILABLE_NOTE_TYPES.map(type => (
                        <option key={type} value={type}>
                          {type} - {NOTE_TYPES[type]?.name || UNKNOWN_NOTE_TYPE.name}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="block">
                    <span className="mb-1 block text-xs text-neutral-400">Timepos (measure/decimal)</span>
                    <input
                      type="number"
                      step="0.001"
                      min="0"
                      value={Number(selectedNoteTimepos.toFixed(3))}
                      className={notePropertyInputClass}
                      onChange={(e) => updateSelectedNote({ time: getTimeFromTimepos(Math.max(0, Number(e.target.value) || 0)) })}
                    />
                  </label>

                  <label className="block">
                    <span className="mb-1 block text-xs text-neutral-400">Lane</span>
                    <input
                      type="number"
                      min="1"
                      max="8"
                      step="0.01"
                      value={selectedSingleNote.lane + 1}
                      className={notePropertyInputClass}
                      onChange={(e) => {
                        const lane = Math.max(1, Math.min(8, Number(e.target.value) || 1)) - 1;
                        updateSelectedNote({ lane });
                      }}
                    />
                  </label>

                  <label className="block">
                    <span className="mb-1 block text-xs text-neutral-400">Width</span>
                    <input
                      type="number"
                      min="1"
                      max="16"
                      step="0.01"
                      value={selectedSingleNote.width}
                      className={notePropertyInputClass}
                      onChange={(e) => {
                        const width = Math.max(1, Math.min(16, Number(e.target.value) || 1));
                        updateSelectedNote({ width });
                      }}
                    />
                  </label>

                  <label className="block">
                    <span className="mb-1 block text-xs text-neutral-400">Parent ID</span>
                    <div className="flex gap-2">
                      <input
                        type="number"
                        min="0"
                        value={selectedSingleNote.parentId ?? ''}
                        placeholder="None"
                        className={notePropertyInputClass}
                        onChange={(e) => {
                          const value = e.target.value.trim();
                          updateSelectedNote({ parentId: value === '' ? null : Math.max(0, Number(value) || 0) });
                        }}
                      />
                      <button
                        type="button"
                        disabled={!selectedParentNote}
                        onClick={() => {
                          if (selectedParentNote) {
                            jumpToNoteTime(selectedParentNote.time);
                          }
                        }}
                        className="shrink-0 rounded border border-neutral-700 bg-neutral-800 px-3 py-2 text-xs font-medium text-neutral-300 transition-colors hover:bg-neutral-700 hover:text-white disabled:cursor-not-allowed disabled:border-neutral-800 disabled:bg-neutral-900 disabled:text-neutral-600"
                      >
                        Jump To
                      </button>
                    </div>
                  </label>

                  <label className="block">
                    <span className="mb-1 block text-xs text-neutral-400">Speed</span>
                    <input
                      type="text"
                      value={selectedSingleNote.speed ?? ''}
                      placeholder="Default"
                      className={notePropertyInputClass}
                      onChange={(e) => {
                        const value = e.target.value.replace(/\s+/g, '');
                        updateSelectedNote({ speed: value === '' ? undefined : value });
                      }}
                    />
                  </label>
                </div>
              ) : (
                <div className="flex-1 flex items-center justify-center text-sm text-neutral-600 border border-dashed border-neutral-800 rounded-lg p-4 text-center">
                  {selectedNoteIds.length > 1
                    ? `${selectedNoteIds.length} notes selected`
                    : 'Ctrl-click a note to edit its properties'}
                </div>
              )}
            </div>
          )}
        </aside>
      </main>
    </motion.div>
  );
}
