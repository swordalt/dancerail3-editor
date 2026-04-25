import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowLeft, Settings, Play, Pause, Download, X, ChevronLeft, ChevronRight, Grid2x2, Grid2x2X, HelpCircle } from 'lucide-react';
import { convertBpmChangesToTime, getActiveChange, getBeatAtTime, getTimeAtBeat, formatTime } from './utils/editorUtils';
import EditorModal from './components/EditorModal';
import EditorCanvas from './components/EditorCanvas';
import { NOTE_TYPES, AVAILABLE_NOTE_TYPES, HOLD_CONNECTOR_TYPES, HOLD_CENTER_TYPES, HOLD_END_TYPES, HOLD_START_TYPES, UNKNOWN_NOTE_TYPE, getConnectorFill } from './constants/editorConstants';
import type { BpmChange, EditorFormData, EditorMode, Note, ProjectData, SelectionBox, SpeedChange } from './types/editorTypes';
import { createExportZipInWorker, warmExportWorker } from './utils/exportWorkerClient';

const HIT_SOUND_URL = new URL('../hit.ogg', import.meta.url).href;
const FLICK_SOUND_URL = new URL('../flick.ogg', import.meta.url).href;
const SOUND_URLS: Record<string, string> = {
  'hit.ogg': HIT_SOUND_URL,
  'flick.ogg': FLICK_SOUND_URL,
};
const HIT_SOUND_LOOKAHEAD_SECONDS = 0.12;
const HIT_SOUND_JUMP_TOLERANCE_SECONDS = 0.25;
const HOVER_PREVIEW_FRAME_INTERVAL_MS = 1000 / 30;
const PAUSED_TIMELINE_RENDER_DURATION_MS = 120;
const AUDIO_CLOCK_HANDOFF_DELAY_MS = 200;
const AUDIO_CLOCK_SYNC_TOLERANCE_SECONDS = 0.05;
const AUDIO_SEEK_TIMEOUT_MS = 10000;
const PLAYBACK_SPEED_OPTIONS = [1, 0.75, 0.5, 0.25, 1.25, 1.5, 1.75, 2] as const;
const DEFAULT_PIXELS_PER_BEAT = 150;
const MIN_PIXELS_PER_BEAT = 60;
const MAX_PIXELS_PER_BEAT = 320;
const EDITOR_SETTINGS_STORAGE_KEY = 'dancerail3-editor:settings';
const SIDE_PANEL_TRANSITION_MS = 300;
const STATISTICS_REFRESH_RATE_OPTIONS = ['15fps', '30fps', '60fps', 'max'] as const;
type StatisticsRefreshRate = typeof STATISTICS_REFRESH_RATE_OPTIONS[number];

interface EditorSettings {
  isExitWarningEnabled: boolean;
  isScrollDirectionInverted: boolean;
  statisticsRefreshRate: StatisticsRefreshRate;
  musicVolume: number;
  tapSoundVolume: number;
  flickSoundVolume: number;
  gridZoom: number;
  isXPositionGridEnabled: boolean;
  pixelsPerBeat: number;
}

const DEFAULT_EDITOR_SETTINGS: EditorSettings = {
  isExitWarningEnabled: true,
  isScrollDirectionInverted: false,
  statisticsRefreshRate: '30fps',
  musicVolume: 1,
  tapSoundVolume: 1,
  flickSoundVolume: 1,
  gridZoom: 1,
  isXPositionGridEnabled: true,
  pixelsPerBeat: DEFAULT_PIXELS_PER_BEAT,
};

const EDITOR_KEYBIND_GROUPS = [
  {
    title: 'Playback and Navigation',
    bindings: [
      { keys: ['Space'], description: 'Play or pause the song from the current editor time.' },
      { keys: ['Mouse wheel'], description: 'Move through the timeline. Scrolling stops playback before seeking.' },
    ],
  },
  {
    title: 'Grid and View',
    bindings: [
      { keys: ['W'], description: 'Increase snap precision.' },
      { keys: ['S'], description: 'Decrease snap precision.' },
      { keys: ['R'], description: 'Zoom the timeline in by increasing pixels per beat.' },
      { keys: ['F'], description: 'Zoom the timeline out by decreasing pixels per beat.' },
    ],
  },
  {
    title: 'Note Tools',
    bindings: [
      { keys: ['A'], description: 'Select the previous note type.' },
      { keys: ['D'], description: 'Select the next note type.' },
      { keys: ['Q'], description: 'Decrease the placement note width.' },
      { keys: ['E'], description: 'Increase the placement note width.' },
    ],
  },
  {
    title: 'Canvas Editing',
    bindings: [
      { keys: ['Left click'], description: 'Place the selected note type on the snapped grid position.' },
      { keys: ['Right click'], description: 'Delete the clicked note, or delete the selected group when clicking a selected note.' },
      { keys: ['Middle click note'], description: 'Select the clicked note.' },
      { keys: ['Middle drag empty space'], description: 'Draw a selection box.' },
      { keys: ['Ctrl', 'Left click note'], description: 'Toggle a note in or out of the current selection.' },
      { keys: ['Shift', 'Left click note'], description: 'Start moving the clicked note.' },
      { keys: ['Shift', 'Middle click note'], description: 'Start moving the clicked note.' },
      { keys: ['Delete'], description: 'Delete all selected notes.' },
      { keys: ['Backspace'], description: 'Delete all selected notes.' },
    ],
  },
  {
    title: 'Fields',
    bindings: [
      { keys: ['Enter'], description: 'Commit the current input value and leave the field.' },
    ],
  },
] as const;

const isPlainRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const isValidVolume = (value: unknown): value is number => (
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 2
);

const isValidGridZoom = (value: unknown): value is number => (
  typeof value === 'number' &&
  Number.isInteger(value) &&
  (value === 1 || (value >= 4 && value % 4 === 0))
);

const isValidPixelsPerBeat = (value: unknown): value is number => (
  typeof value === 'number' &&
  Number.isInteger(value) &&
  value >= MIN_PIXELS_PER_BEAT &&
  value <= MAX_PIXELS_PER_BEAT
);

const isValidStatisticsRefreshRate = (value: unknown): value is StatisticsRefreshRate => (
  typeof value === 'string' &&
  STATISTICS_REFRESH_RATE_OPTIONS.includes(value as StatisticsRefreshRate)
);

const getStatisticsRefreshIntervalMs = (refreshRate: StatisticsRefreshRate) => {
  if (refreshRate === 'max') {
    return 0;
  }

  return 1000 / Number(refreshRate.replace('fps', ''));
};

const loadEditorSettings = (): EditorSettings => {
  if (typeof window === 'undefined') return DEFAULT_EDITOR_SETTINGS;

  try {
    const storedSettings = window.localStorage.getItem(EDITOR_SETTINGS_STORAGE_KEY);
    if (!storedSettings) return DEFAULT_EDITOR_SETTINGS;

    const parsedSettings: unknown = JSON.parse(storedSettings);
    if (!isPlainRecord(parsedSettings)) return DEFAULT_EDITOR_SETTINGS;

    return {
      isExitWarningEnabled: typeof parsedSettings.isExitWarningEnabled === 'boolean'
        ? parsedSettings.isExitWarningEnabled
        : DEFAULT_EDITOR_SETTINGS.isExitWarningEnabled,
      isScrollDirectionInverted: typeof parsedSettings.isScrollDirectionInverted === 'boolean'
        ? parsedSettings.isScrollDirectionInverted
        : DEFAULT_EDITOR_SETTINGS.isScrollDirectionInverted,
      statisticsRefreshRate: isValidStatisticsRefreshRate(parsedSettings.statisticsRefreshRate)
        ? parsedSettings.statisticsRefreshRate
        : DEFAULT_EDITOR_SETTINGS.statisticsRefreshRate,
      musicVolume: isValidVolume(parsedSettings.musicVolume)
        ? parsedSettings.musicVolume
        : DEFAULT_EDITOR_SETTINGS.musicVolume,
      tapSoundVolume: isValidVolume(parsedSettings.tapSoundVolume)
        ? parsedSettings.tapSoundVolume
        : DEFAULT_EDITOR_SETTINGS.tapSoundVolume,
      flickSoundVolume: isValidVolume(parsedSettings.flickSoundVolume)
        ? parsedSettings.flickSoundVolume
        : DEFAULT_EDITOR_SETTINGS.flickSoundVolume,
      gridZoom: isValidGridZoom(parsedSettings.gridZoom)
        ? parsedSettings.gridZoom
        : DEFAULT_EDITOR_SETTINGS.gridZoom,
      isXPositionGridEnabled: typeof parsedSettings.isXPositionGridEnabled === 'boolean'
        ? parsedSettings.isXPositionGridEnabled
        : DEFAULT_EDITOR_SETTINGS.isXPositionGridEnabled,
      pixelsPerBeat: isValidPixelsPerBeat(parsedSettings.pixelsPerBeat)
        ? parsedSettings.pixelsPerBeat
        : DEFAULT_EDITOR_SETTINGS.pixelsPerBeat,
    };
  } catch {
    return DEFAULT_EDITOR_SETTINGS;
  }
};

const saveEditorSettings = (settings: EditorSettings) => {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(EDITOR_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage can be unavailable in private browsing or restricted iframe contexts.
  }
};

interface EditorProps {
  onBack: () => void;
  mode?: EditorMode;
  initialProjectData?: ProjectData | null;
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
  playbackStartTime: number;
  playbackStartPerformanceTime: number;
  playbackAudioClockReadyTime: number;
  playbackSpeed: number;
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

interface PendingDragUpdate {
  noteId: number;
  lane: number;
  time: number;
}

type OperationCategory = 'note' | 'timing' | 'speed' | 'metadata';

interface OperationHistoryEntry {
  id: number;
  timestamp: number;
  category: OperationCategory;
  title: string;
  detail: string;
}

const MAX_OPERATION_HISTORY_ENTRIES = 500;

const getNoteIdGroupKey = (note: Note, noteBeat: number) => {
  const centerPosition = note.lane + note.width / 4;
  return `${noteBeat.toFixed(6)}:${centerPosition.toFixed(6)}`;
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

const formatHistoryTimestamp = (timestamp: number) => (
  new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(timestamp)
);

const formatHistoryNumber = (value: number) => (
  Number.isInteger(value) ? value.toString() : Number(value.toFixed(3)).toString()
);

const formatPlaybackSpeed = (speed: number) => `${formatHistoryNumber(speed)}x`;

const applyAudioPlaybackSpeed = (audio: HTMLAudioElement, speed: number) => {
  const pitchedAudio = audio as HTMLAudioElement & {
    preservesPitch?: boolean;
    mozPreservesPitch?: boolean;
    webkitPreservesPitch?: boolean;
  };

  pitchedAudio.preservesPitch = false;
  pitchedAudio.mozPreservesPitch = false;
  pitchedAudio.webkitPreservesPitch = false;
  audio.playbackRate = speed;
};

const formatMaybeValue = (value: unknown) => (
  value === undefined || value === null || value === '' ? 'None' : String(value)
);

const formatNoteName = (note: Note) => NOTE_TYPES[note.type]?.name || `Type ${note.type}`;
const formatNoteLane = (lane: number) => formatHistoryNumber(lane + 1);
const APPEAR_MODE_OPTIONS = ['none', 'L', 'R', 'H', 'P'] as const;
const formatTimingPosition = (measure: number, beat: number) => (
  `Measure ${measure}, Beat ${beat}`
);

const operationCategoryStyles: Record<OperationCategory, string> = {
  note: 'border-sky-500/30 bg-sky-500/10 text-sky-200',
  timing: 'border-amber-500/30 bg-amber-500/10 text-amber-200',
  speed: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200',
  metadata: 'border-violet-500/30 bg-violet-500/10 text-violet-200',
};

interface VirtualizedChangeListProps<T> {
  items: T[];
  rowHeight: number;
  overscan?: number;
  className?: string;
  getKey: (item: T, index: number) => React.Key;
  renderRow: (item: T, index: number, style: React.CSSProperties) => React.ReactNode;
}

function VirtualizedChangeList<T>({
  items,
  rowHeight,
  overscan = 6,
  className = '',
  getKey,
  renderRow,
}: VirtualizedChangeListProps<T>) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const updateViewportHeight = () => setViewportHeight(viewport.clientHeight);
    updateViewportHeight();

    const resizeObserver = new ResizeObserver(updateViewportHeight);
    resizeObserver.observe(viewport);

    return () => resizeObserver.disconnect();
  }, []);

  const totalHeight = items.length * rowHeight;
  const startIndex = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const endIndex = Math.min(
    items.length,
    Math.ceil((scrollTop + viewportHeight) / rowHeight) + overscan
  );
  const visibleItems = items.slice(startIndex, endIndex);

  return (
    <div
      ref={viewportRef}
      className={`relative overflow-y-auto ${className}`}
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
    >
      <div className="relative" style={{ height: totalHeight }}>
        {visibleItems.map((item, visibleIndex) => {
          const index = startIndex + visibleIndex;

          return (
            <React.Fragment key={getKey(item, index)}>
              {renderRow(item, index, {
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                height: rowHeight,
                transform: `translateY(${index * rowHeight}px)`,
              })}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}

interface CommitInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'defaultValue' | 'onChange' | 'onBlur' | 'onKeyDown'> {
  value: string | number;
  onCommit: (value: string) => void;
}

function CommitInput({ value, onCommit, ...inputProps }: CommitInputProps) {
  const [draftValue, setDraftValue] = useState(String(value ?? ''));
  const lastCommittedDraftRef = useRef(String(value ?? ''));

  useEffect(() => {
    const nextValue = String(value ?? '');
    setDraftValue(nextValue);
    lastCommittedDraftRef.current = nextValue;
  }, [value]);

  const commitDraft = () => {
    if (draftValue === lastCommittedDraftRef.current) {
      return;
    }

    lastCommittedDraftRef.current = draftValue;
    onCommit(draftValue);
  };

  return (
    <input
      {...inputProps}
      value={draftValue}
      onChange={(event) => setDraftValue(event.target.value)}
      onBlur={commitDraft}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          commitDraft();
          event.currentTarget.blur();
        }
      }}
    />
  );
}

export default function Editor({ 
  onBack, 
  mode,
  initialProjectData = null,
  notes,
  setNotes,
  bpmChanges,
  setBpmChanges,
  speedChanges,
  setSpeedChanges,
  offset,
  setOffset
}: EditorProps) {
  const initialEditorSettings = useMemo(loadEditorSettings, []);
  const [isModalOpen, setIsModalOpen] = useState(mode === 'new');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);
  const [isPlaybackSpeedMenuOpen, setIsPlaybackSpeedMenuOpen] = useState(false);
  const [isStatisticsRefreshRateMenuOpen, setIsStatisticsRefreshRateMenuOpen] = useState(false);
  const [isExitWarningOpen, setIsExitWarningOpen] = useState(false);
  const [isExitWarningEnabled, setIsExitWarningEnabled] = useState(initialEditorSettings.isExitWarningEnabled);
  const [isScrollDirectionInverted, setIsScrollDirectionInverted] = useState(initialEditorSettings.isScrollDirectionInverted);
  const [statisticsRefreshRate, setStatisticsRefreshRate] = useState<StatisticsRefreshRate>(initialEditorSettings.statisticsRefreshRate);
  const [musicVolume, setMusicVolume] = useState(initialEditorSettings.musicVolume);
  const [tapSoundVolume, setTapSoundVolume] = useState(initialEditorSettings.tapSoundVolume);
  const [flickSoundVolume, setFlickSoundVolume] = useState(initialEditorSettings.flickSoundVolume);
  const [gridZoom, setGridZoom] = useState(initialEditorSettings.gridZoom);
  const [isXPositionGridEnabled, setIsXPositionGridEnabled] = useState(initialEditorSettings.isXPositionGridEnabled);
  const [pixelsPerBeat, setPixelsPerBeat] = useState(initialEditorSettings.pixelsPerBeat);
  const [activeLeftPanel, setActiveLeftPanel] = useState<'main' | 'editInfo' | 'speedChanges' | 'curveSC' | 'history' | 'bpmTiming'>('main');
  const [isLeftPanelCompact, setIsLeftPanelCompact] = useState(false);
  const [isRightPanelCompact, setIsRightPanelCompact] = useState(false);
  const [isLeftPanelContentVisible, setIsLeftPanelContentVisible] = useState(true);
  const [isRightPanelContentVisible, setIsRightPanelContentVisible] = useState(true);
  const [selectedNoteType, setSelectedNoteType] = useState<number>(1);
  const [noteWidth, setNoteWidth] = useState(4);
  const [currentParentInput, setCurrentParentInput] = useState('');
  const [hoverPreview, setHoverPreview] = useState<HoverPreview | null>(null);
  const [isCtrlHeld, setIsCtrlHeld] = useState(false);
  const [isShiftHeld, setIsShiftHeld] = useState(false);
  const [selectedNoteIds, setSelectedNoteIds] = useState<number[]>([]);
  const [draggingNoteId, setDraggingNoteId] = useState<number | null>(null);
  const [selectionBox, setSelectionBox] = useState<SelectionBox | null>(null);
  const [operationHistory, setOperationHistory] = useState<OperationHistoryEntry[]>([]);
  const nextNoteIdRef = useRef<number>(1);
  const nextOperationHistoryIdRef = useRef<number>(1);
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
  const canTypeHaveParent = (type: number) => HOLD_CENTER_TYPES.includes(type) || HOLD_END_TYPES.includes(type);
  const shouldOmitParentForType = (type: number) => !canTypeHaveParent(type);

  useEffect(() => {
    if (isLeftPanelCompact) {
      setIsLeftPanelContentVisible(false);
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setIsLeftPanelContentVisible(true);
    }, SIDE_PANEL_TRANSITION_MS);

    return () => window.clearTimeout(timeoutId);
  }, [isLeftPanelCompact]);

  useEffect(() => {
    if (isRightPanelCompact) {
      setIsRightPanelContentVisible(false);
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setIsRightPanelContentVisible(true);
    }, SIDE_PANEL_TRANSITION_MS);

    return () => window.clearTimeout(timeoutId);
  }, [isRightPanelCompact]);

  const toggleLeftPanelCompact = () => {
    setIsLeftPanelContentVisible(false);
    setIsLeftPanelCompact(current => !current);
  };

  const toggleRightPanelCompact = () => {
    setIsRightPanelContentVisible(false);
    setIsRightPanelCompact(current => !current);
  };

  useEffect(() => {
    saveEditorSettings({
      isExitWarningEnabled,
      isScrollDirectionInverted,
      statisticsRefreshRate,
      musicVolume,
      tapSoundVolume,
      flickSoundVolume,
      gridZoom,
      isXPositionGridEnabled,
      pixelsPerBeat,
    });
  }, [
    isExitWarningEnabled,
    isScrollDirectionInverted,
    statisticsRefreshRate,
    musicVolume,
    tapSoundVolume,
    flickSoundVolume,
    gridZoom,
    isXPositionGridEnabled,
    pixelsPerBeat,
  ]);

  useEffect(() => {
    if (formData.songIllustration) {
      const url = URL.createObjectURL(formData.songIllustration);
      setIllustrationPreview(url);
      return () => URL.revokeObjectURL(url);
    } else {
      setIllustrationPreview(null);
    }
  }, [formData.songIllustration]);

  const [projectData, setProjectData] = useState<ProjectData | null>(initialProjectData);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [liveStatsTime, setLiveStatsTime] = useState(0);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1);
  const [duration, setDuration] = useState(0);
  const [fps, setFps] = useState(0);
  const [renderedObjects, setRenderedObjects] = useState(0);
  const [isPausedTimelineRendering, setIsPausedTimelineRendering] = useState(false);
  
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
  const hoverPreviewTimeoutRef = useRef<number>();
  const pausedTimelineRenderTimeoutRef = useRef<number>();
  const pausedTimelineRenderUntilRef = useRef(0);
  const fpsFrameCountRef = useRef(0);
  const fpsWindowStartRef = useRef(performance.now());
  const renderedObjectsRef = useRef(0);
  const liveStatsLastUpdateRef = useRef(0);
  const timeDisplayRef = useRef<HTMLDivElement>(null);
  const progressBarRef = useRef<HTMLInputElement>(null);
  const isDraggingProgress = useRef(false);
  const pendingDragUpdateRef = useRef<PendingDragUpdate | null>(null);
  const dragStartNoteRef = useRef<Note | null>(null);
  const dragUpdateFrameRef = useRef<number>();
  const hoverPreviewRef = useRef<HoverPreview | null>(null);
  const playRequestIdRef = useRef(0);
  const playTimeoutRef = useRef<number>();

  const renderPausedTimelineAtFullFps = useCallback(() => {
    pausedTimelineRenderUntilRef.current = performance.now() + PAUSED_TIMELINE_RENDER_DURATION_MS;
    setIsPausedTimelineRendering(true);

    if (pausedTimelineRenderTimeoutRef.current !== undefined) {
      window.clearTimeout(pausedTimelineRenderTimeoutRef.current);
    }

    pausedTimelineRenderTimeoutRef.current = window.setTimeout(() => {
      pausedTimelineRenderTimeoutRef.current = undefined;
      if (performance.now() >= pausedTimelineRenderUntilRef.current) {
        setIsPausedTimelineRendering(false);
      }
    }, PAUSED_TIMELINE_RENDER_DURATION_MS);
  }, []);

  const openSettings = () => {
    setIsHelpOpen(false);
    setIsPlaybackSpeedMenuOpen(false);
    setIsStatisticsRefreshRateMenuOpen(false);
    setIsSettingsOpen(true);
  };

  const openHelp = () => {
    setIsSettingsOpen(false);
    setIsPlaybackSpeedMenuOpen(false);
    setIsStatisticsRefreshRateMenuOpen(false);
    setIsHelpOpen(true);
  };

  const openExitWarning = () => {
    if (!isExitWarningEnabled) {
      onBack();
      return;
    }

    setIsExitWarningOpen(true);
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
    playbackStartTime: 0,
    playbackStartPerformanceTime: 0,
    playbackAudioClockReadyTime: 0,
    playbackSpeed: 1,
    bpm: 120,
    bpmChanges: [{ measure: 0, beat: 0, bpm: 120, timeSignature: '4/4' }],
    speedChanges: [{ measure: 0, beat: 0, speedChange: 1 }],
    offset: 0,
    notes: [],
  });

  useEffect(() => {
    const warmWorker = () => warmExportWorker();

    if ('requestIdleCallback' in window) {
      const idleCallbackId = window.requestIdleCallback(warmWorker, { timeout: 1000 });
      return () => window.cancelIdleCallback(idleCallbackId);
    }

    const timeoutId = window.setTimeout(warmWorker, 250);
    return () => window.clearTimeout(timeoutId);
  }, []);

  useEffect(() => {
    setupMusicGain();
    if (musicGainRef.current) {
      musicGainRef.current.gain.value = musicVolume;
    }
  }, [musicVolume, projectData?.audioUrl, setupMusicGain]);

  useEffect(() => {
    stateRef.current.isPlaying = isPlaying;
    if (!isPlaying) {
      stateRef.current.currentTime = currentTime;
    }
    stateRef.current.bpm = projectData?.bpm || 120;
    stateRef.current.bpmChanges = bpmChanges;
    stateRef.current.offset = offset;
    stateRef.current.notes = notes;
    stateRef.current.speedChanges = speedChanges;
    stateRef.current.playbackSpeed = playbackSpeed;
  }, [isPlaying, currentTime, projectData, bpmChanges, offset, notes, speedChanges, playbackSpeed]);

  useEffect(() => {
    if (!isPlaying) {
      setLiveStatsTime(currentTime);
    }
  }, [currentTime, isPlaying]);

  const statisticsRefreshIntervalMs = useMemo(
    () => getStatisticsRefreshIntervalMs(statisticsRefreshRate),
    [statisticsRefreshRate],
  );

  useEffect(() => {
    if (draggingNoteId || selectionBox) {
      setHoverPreview(null);
    }
  }, [draggingNoteId, selectionBox]);

  useEffect(() => {
    hoverPreviewRef.current = hoverPreview;
  }, [hoverPreview]);

  useEffect(() => {
    if (isCtrlHeld || isShiftHeld) {
      setHoverPreview(null);
    }
  }, [isCtrlHeld, isShiftHeld]);

  useEffect(() => {
    if (mode === 'new') {
      setIsModalOpen(true);
    }
  }, [mode]);

  useEffect(() => {
    const maxNoteId = notes.reduce((maxId, note) => Math.max(maxId, note.id), 0);
    nextNoteIdRef.current = maxNoteId + 1;
  }, [notes]);

  const timedBpmChanges = useMemo(() => convertBpmChangesToTime(bpmChanges), [bpmChanges]);
  const hasExportIncompatibleTimeSignature = useMemo(
    () => bpmChanges.some(change => change.timeSignature.trim() !== '4/4'),
    [bpmChanges],
  );
  const selectedNoteIdSet = useMemo(() => new Set(selectedNoteIds), [selectedNoteIds]);

  const recordOperation = useCallback((entry: Omit<OperationHistoryEntry, 'id' | 'timestamp'>) => {
    const nextEntry: OperationHistoryEntry = {
      ...entry,
      id: nextOperationHistoryIdRef.current++,
      timestamp: Date.now(),
    };

    setOperationHistory(prev => [nextEntry, ...prev].slice(0, MAX_OPERATION_HISTORY_ENTRIES));
  }, []);

  const getNoteHistoryDetail = useCallback((note: Note) => {
    return `${formatNoteName(note)} #${note.id} at ${formatTime(note.time, timedBpmChanges)}, lane ${formatNoteLane(note.lane)}, width ${formatHistoryNumber(note.width)}`;
  }, [timedBpmChanges]);

  const noteRenderIndex = useMemo(() => {
    const notesById = new Map<number, Note>();
    const noteBeats = new Map<number, number>();
    const groupedNoteIds = new Map<string, number[]>();
    const groupedIdLabelsByNoteId = new Map<number, string>();

    notes.forEach((note) => {
      const noteBeat = getBeatAtTime(note.time, timedBpmChanges);

      notesById.set(note.id, note);
      noteBeats.set(note.id, noteBeat);

      const key = getNoteIdGroupKey(note, noteBeat);
      const groupedIds = groupedNoteIds.get(key);
      if (groupedIds) {
        groupedIds.push(note.id);
      } else {
        groupedNoteIds.set(key, [note.id]);
      }
    });

    groupedNoteIds.forEach((groupedIds) => {
      const label = formatGroupedIds(groupedIds);
      groupedIds.forEach((noteId) => {
        groupedIdLabelsByNoteId.set(noteId, label);
      });
    });

    const selectedParentNoteIds = new Set<number>();
    notes.forEach((note) => {
      if (selectedNoteIdSet.has(note.id) && canTypeHaveParent(note.type) && note.parentId !== null) {
        selectedParentNoteIds.add(note.parentId);
      }
    });

    return {
      notesById,
      noteBeats,
      groupedIdLabelsByNoteId,
      selectedParentNoteIds,
    };
  }, [notes, timedBpmChanges, selectedNoteIdSet]);

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
      dragStartNoteRef.current = null;
    };
    window.addEventListener('mouseup', handleMouseUp);
    return () => window.removeEventListener('mouseup', handleMouseUp);
  }, []);

  useEffect(() => {
    return () => {
      if (dragUpdateFrameRef.current) {
        cancelAnimationFrame(dragUpdateFrameRef.current);
      }
    };
  }, []);

  const handleConfirm = () => {
    const wasProjectCreated = !projectData;
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

    // Imported charts can exist before project metadata is set, so only seed BPMs for actual new projects.
    if (!projectData && mode === 'new') {
      setBpmChanges([{ measure: 0, beat: 0, bpm: nextBpm, timeSignature: '4/4' }]);
    }

    setIsModalOpen(false);
    if (activeLeftPanel === 'editInfo') {
      setActiveLeftPanel('main');
    }

    recordOperation({
      category: 'metadata',
      title: wasProjectCreated ? 'Created project metadata' : 'Updated chart metadata',
      detail: `${formData.songName || 'Untitled Project'} | BPM ${formatHistoryNumber(nextBpm)} | Difficulty ${formData.difficulty || 'None'}`,
    });
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
    const sortedChanges = timedBpmChanges;
    const targetBeat = getBeatAtTime(targetTime, sortedChanges);
    const snappedBeat = Math.round(targetBeat * gridZoom) / gridZoom;
    const newTime = getTimeAtBeat(snappedBeat, sortedChanges);
    
    setCurrentTime(newTime);
    stateRef.current.currentTime = newTime;
    stateRef.current.playbackStartTime = newTime;
    stateRef.current.playbackStartPerformanceTime = performance.now();
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
    renderPausedTimelineAtFullFps();
  }, [projectData, offset, gridZoom, renderPausedTimelineAtFullFps]);

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

  const getPlaybackTimeFromClock = (audio: HTMLAudioElement | null, offsetInSeconds: number) => {
    const now = performance.now();
    const projectedTime = Math.max(
      0,
      stateRef.current.playbackStartTime
        + ((now - stateRef.current.playbackStartPerformanceTime) / 1000) * stateRef.current.playbackSpeed,
    );

    if (audio && !audio.paused && !audio.seeking && now >= stateRef.current.playbackAudioClockReadyTime) {
      const audioTime = Math.max(0, audio.currentTime + offsetInSeconds);
      if (Math.abs(audioTime - projectedTime) <= AUDIO_CLOCK_SYNC_TOLERANCE_SECONDS) {
        return audioTime;
      }
    }

    return projectedTime;
  };

  const clearPlayTimeout = () => {
    if (playTimeoutRef.current !== undefined) {
      window.clearTimeout(playTimeoutRef.current);
      playTimeoutRef.current = undefined;
    }
  };

  const changePlaybackSpeed = (nextSpeed: number) => {
    const audio = audioRef.current;
    const now = performance.now();
    const offsetInSeconds = parseFloat(offset.toString()) / 1000;
    const playbackTime = getPlaybackTimeFromClock(audio, offsetInSeconds);

    stateRef.current.playbackSpeed = nextSpeed;
    stateRef.current.playbackStartTime = playbackTime;
    stateRef.current.playbackStartPerformanceTime = now;
    stateRef.current.playbackAudioClockReadyTime = now + AUDIO_CLOCK_HANDOFF_DELAY_MS;

    if (audio) {
      applyAudioPlaybackSpeed(audio, nextSpeed);
    }

    if (stateRef.current.isPlaying && audio && audio.paused && offsetInSeconds > 0) {
      clearPlayTimeout();
      const audioStartTime = playbackTime - offsetInSeconds;
      audio.currentTime = Math.max(0, audioStartTime);

      if (audioStartTime < 0) {
        playTimeoutRef.current = window.setTimeout(() => {
          playTimeoutRef.current = undefined;
          if (stateRef.current.isPlaying && audioRef.current) {
            applyAudioPlaybackSpeed(audioRef.current, stateRef.current.playbackSpeed);
            audioRef.current.play().catch(() => {});
          }
        }, (-audioStartTime / nextSpeed) * 1000);
      } else {
        audio.play().catch(() => {});
      }
    }

    setPlaybackSpeed(nextSpeed);
    setIsPlaybackSpeedMenuOpen(false);
  };

  const seekAudioToTime = (audio: HTMLAudioElement, time: number) => new Promise<void>((resolve) => {
    const targetTime = Math.max(0, time);
    let settled = false;
    let timeoutId: number | undefined;

    const finish = () => {
      if (settled) {
        return;
      }

      settled = true;
      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId);
      }
      audio.removeEventListener('seeked', finish);
      resolve();
    };

    audio.addEventListener('seeked', finish);
    timeoutId = window.setTimeout(finish, AUDIO_SEEK_TIMEOUT_MS);
    audio.currentTime = targetTime;

    if (!audio.seeking && Math.abs(audio.currentTime - targetTime) <= AUDIO_CLOCK_SYNC_TOLERANCE_SECONDS) {
      finish();
    }
  });

  const togglePlay = useCallback(async () => {
    if (!audioRef.current || !projectData) return;
    const offsetInSeconds = parseFloat(offset.toString()) / 1000;
    
    if (stateRef.current.isPlaying) {
      playRequestIdRef.current += 1;
      const playbackTime = Math.max(0, stateRef.current.currentTime);
      stopHitsounds();
      audioRef.current.pause();
      clearPlayTimeout();
      if (requestRef.current) {
        cancelAnimationFrame(requestRef.current);
        requestRef.current = undefined;
      }
      if (hoverPreviewTimeoutRef.current) {
        window.clearTimeout(hoverPreviewTimeoutRef.current);
        hoverPreviewTimeoutRef.current = undefined;
      }
      stateRef.current.isPlaying = false;
      setIsPlaying(false);

      // Snap back to the last whole beat the playhead passed.
      const sortedChanges = convertBpmChangesToTime(stateRef.current.bpmChanges);
      const currentBeat = getBeatAtTime(playbackTime, sortedChanges);
      const snappedBeat = Math.floor(currentBeat);
      const snappedTime = getTimeAtBeat(snappedBeat, sortedChanges);
      
      setCurrentTime(snappedTime);
      stateRef.current.currentTime = snappedTime;
      stateRef.current.playbackStartTime = snappedTime;
      stateRef.current.playbackStartPerformanceTime = performance.now();
      stateRef.current.playbackAudioClockReadyTime = 0;
      lastPlayedTimeRef.current = snappedTime;
      hitSoundCursorRef.current = findHitSoundCursor(snappedTime);
      audioRef.current.currentTime = Math.max(0, snappedTime - offsetInSeconds);
      if (timeDisplayRef.current) {
        timeDisplayRef.current.textContent = formatTime(snappedTime, sortedChanges);
      }
      if (progressBarRef.current && !isDraggingProgress.current) {
        progressBarRef.current.value = snappedTime.toString();
      }
    } else {
      const playRequestId = playRequestIdRef.current + 1;
      playRequestIdRef.current = playRequestId;
      const playbackStartTime = Math.max(0, stateRef.current.currentTime);
      const musicContext = setupMusicGain();
      if (musicContext?.state === 'suspended') {
        musicContext.resume().catch(() => {});
      }
      applyAudioPlaybackSpeed(audioRef.current, stateRef.current.playbackSpeed);
      void prepareHitSounds();
      hitSoundCursorRef.current = findHitSoundCursor(playbackStartTime);
      scheduledHitSoundKeysRef.current.clear();
      lastPlayedTimeRef.current = playbackStartTime;
      // Apply offset here. If delay (offset > 0), wait. If advance (offset < 0), seek.
      if (offsetInSeconds > 0) {
        // Delay music: Editor starts at current time, Music starts playing after offsetInSeconds past audio seek point
        const audioStartTime = playbackStartTime - offsetInSeconds;
        audioRef.current.currentTime = Math.max(0, audioStartTime);
        const audioDelaySeconds = Math.max(0, -audioStartTime) / stateRef.current.playbackSpeed;
        playTimeoutRef.current = window.setTimeout(() => {
          playTimeoutRef.current = undefined;
          if (playRequestIdRef.current === playRequestId && audioRef.current) {
            applyAudioPlaybackSpeed(audioRef.current, stateRef.current.playbackSpeed);
            audioRef.current.play().catch(() => {});
          }
        }, audioDelaySeconds * 1000);
      } else {
        // Advance music: Start music early
        await seekAudioToTime(audioRef.current, playbackStartTime - offsetInSeconds);
        if (playRequestIdRef.current !== playRequestId) {
          return;
        }
        await audioRef.current.play().catch(() => {});
      }
      if (playRequestIdRef.current !== playRequestId) {
        return;
      }
      stateRef.current.playbackStartTime = playbackStartTime;
      stateRef.current.playbackStartPerformanceTime = performance.now();
      stateRef.current.playbackAudioClockReadyTime = stateRef.current.playbackStartPerformanceTime + AUDIO_CLOCK_HANDOFF_DELAY_MS;
      stateRef.current.currentTime = playbackStartTime;
      stateRef.current.isPlaying = true;
      
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

      if (e.key === 'Shift') {
        setIsShiftHeld(true);
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        const noteIdsToDelete = new Set(selectedNoteIds);
        const deletedNotes = stateRef.current.notes.filter(n => noteIdsToDelete.has(n.id));
        if (deletedNotes.length > 0) {
          recordOperation({
            category: 'note',
            title: deletedNotes.length === 1 ? 'Deleted note' : `Deleted ${deletedNotes.length} notes`,
            detail: deletedNotes.length === 1
              ? getNoteHistoryDetail(deletedNotes[0])
              : `IDs ${formatGroupedIds(deletedNotes.map(note => note.id))}`,
          });
        }
        setNotes(prev => prev.filter(n => !noteIdsToDelete.has(n.id)));
        setSelectedNoteIds([]);
        setDraggingNoteId(null);
        setSelectionBox(null);
        setHoverPreview(null);
        pendingDragUpdateRef.current = null;
        dragStartNoteRef.current = null;
        return;
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

    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Control') {
        setIsCtrlHeld(false);
      }

      if (e.key === 'Shift') {
        setIsShiftHeld(false);
      }
    };

    const handleWindowBlur = () => {
      setIsCtrlHeld(false);
      setIsShiftHeld(false);
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
  }, [getNoteHistoryDetail, recordOperation, selectedNoteIds, togglePlay]);

  const drawGrid = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const now = performance.now();
    fpsFrameCountRef.current += 1;
    const elapsed = now - fpsWindowStartRef.current;
    if (elapsed >= 500) {
      setFps(Math.round((fpsFrameCountRef.current * 1000) / elapsed));
      fpsFrameCountRef.current = 0;
      fpsWindowStartRef.current = now;
    }

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

    if (!projectData) return;

    const sortedChanges = timedBpmChanges;
    const offsetInSeconds = parseFloat(offset.toString()) / 1000;

    let time = stateRef.current.currentTime;
    
    if (stateRef.current.isPlaying && audioRef.current) {
      time = getPlaybackTimeFromClock(audioRef.current, offsetInSeconds);
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

    // Draw x-position lanes when snap is enabled.
    if (isXPositionGridEnabled) {
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
        const sharesTimeWithSpeed = stateRef.current.speedChanges.some(sc => `${sc.measure}:${sc.beat}` === indicatorKey);
        ctx.fillStyle = '#f59e0b';
        ctx.font = '10px Inter, sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(`BPM: ${change.bpm} | ${change.timeSignature}`, indicatorX, y + (sharesTimeWithSpeed ? indicatorOffset : 0));
        objectCount += 1;
      }
    });

    // Draw speed change indicators on the right side, above BPM changes at the same time position.
    stateRef.current.speedChanges.forEach(sc => {
      // Approximation: assuming 4 beats per measure for SC indicator position
      const scBeat = sc.measure * 4 + sc.beat;
      const y = hitLineY - (scBeat - currentBeat) * pixelsPerBeat;
      
      if (y > 0 && y < height) {
        const sharesTimeWithBpm = bpmIndicatorKeys.has(`${sc.measure}:${sc.beat}`);
        ctx.fillStyle = '#06b6d4'; // teal-500
        ctx.font = '10px Inter, sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(`SC: ${sc.speedChange}x`, indicatorX, y - (sharesTimeWithBpm ? indicatorOffset : 0));
        objectCount += 1;
      }
    });

    // Draw hold connections before note bodies so linked notes render on top.
    stateRef.current.notes.forEach(note => {
      if (!HOLD_CONNECTOR_TYPES.includes(note.type) || HOLD_START_TYPES.includes(note.type) || note.parentId === null) {
        return;
      }

      const parentNote = noteRenderIndex.notesById.get(note.parentId);
      if (!parentNote) {
        return;
      }

      const noteBeat = noteRenderIndex.noteBeats.get(note.id);
      const parentBeat = noteRenderIndex.noteBeats.get(parentNote.id);
      if (noteBeat === undefined || parentBeat === undefined) {
        return;
      }

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

    // Draw notes
    stateRef.current.notes.forEach(note => {
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
        const groupedIdsLabel = noteRenderIndex.groupedIdLabelsByNoteId.get(note.id) ?? `${note.id}`;
        ctx.fillText(groupedIdsLabel, noteCenterX, y + 12);
        objectCount += 1;
      }
    });

    if (hoverPreview && !isCtrlHeld && !isShiftHeld) {
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

  }, [pixelsPerBeat, projectData, gridZoom, isXPositionGridEnabled, hoverPreview, isCtrlHeld, isShiftHeld, noteWidth, selectedNoteIdSet, selectedNoteType, selectionBox, timedBpmChanges, noteRenderIndex, offset]);

  const shouldAnimateCanvas = isPlaying || isPausedTimelineRendering || (!!hoverPreview && !isCtrlHeld && !isShiftHeld);

  const update = useCallback(() => {
    if (stateRef.current.isPlaying && audioRef.current) {
      const offsetInSeconds = parseFloat(offset.toString()) / 1000;
      const activePlaybackSpeed = stateRef.current.playbackSpeed;
      const currentTime = getPlaybackTimeFromClock(audioRef.current, offsetInSeconds);
      const now = performance.now();
      const scheduleUntil = currentTime + HIT_SOUND_LOOKAHEAD_SECONDS * activePlaybackSpeed;
      const lastTime = lastPlayedTimeRef.current;

      if (currentTime + HIT_SOUND_JUMP_TOLERANCE_SECONDS < lastTime) {
        hitSoundCursorRef.current = findHitSoundCursor(currentTime);
        scheduledHitSoundKeysRef.current.clear();
      }

      if (currentTime - lastTime > HIT_SOUND_JUMP_TOLERANCE_SECONDS) {
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
          playHitSound(event.soundUrl, (event.time - currentTime) / activePlaybackSpeed);
        }
        cursor += 1;
      }

      hitSoundCursorRef.current = cursor;
      
      lastPlayedTimeRef.current = scheduleUntil;

      if (now - liveStatsLastUpdateRef.current >= statisticsRefreshIntervalMs) {
        liveStatsLastUpdateRef.current = now;
        setLiveStatsTime(currentTime);
      }
    } else {
      lastPlayedTimeRef.current = stateRef.current.currentTime;
    }

    drawGrid();
    setRenderedObjects(renderedObjectsRef.current);
    if (stateRef.current.isPlaying) {
      requestRef.current = requestAnimationFrame(update);
    } else if (isPausedTimelineRendering && performance.now() < pausedTimelineRenderUntilRef.current) {
      requestRef.current = requestAnimationFrame(update);
    } else if (hoverPreview && !isCtrlHeld && !isShiftHeld) {
      hoverPreviewTimeoutRef.current = window.setTimeout(() => {
        hoverPreviewTimeoutRef.current = undefined;
        requestRef.current = requestAnimationFrame(update);
      }, HOVER_PREVIEW_FRAME_INTERVAL_MS);
    } else {
      requestRef.current = undefined;
    }
  }, [drawGrid, offset, playHitSound, hoverPreview, isCtrlHeld, isShiftHeld, isPausedTimelineRendering, statisticsRefreshIntervalMs]);

  useEffect(() => {
    if (!shouldAnimateCanvas) {
      fpsFrameCountRef.current = 0;
      fpsWindowStartRef.current = performance.now();
      setFps(0);
      setRenderedObjects(renderedObjectsRef.current);
      drawGrid();
      if (requestRef.current) {
        cancelAnimationFrame(requestRef.current);
        requestRef.current = undefined;
      }
      if (hoverPreviewTimeoutRef.current) {
        window.clearTimeout(hoverPreviewTimeoutRef.current);
        hoverPreviewTimeoutRef.current = undefined;
      }
      return;
    }

    if (!requestRef.current) {
      fpsFrameCountRef.current = 0;
      fpsWindowStartRef.current = performance.now();
      requestRef.current = requestAnimationFrame(update);
    }

    return () => {
      if (requestRef.current) {
        cancelAnimationFrame(requestRef.current);
        requestRef.current = undefined;
      }
      if (hoverPreviewTimeoutRef.current) {
        window.clearTimeout(hoverPreviewTimeoutRef.current);
        hoverPreviewTimeoutRef.current = undefined;
      }
    };
  }, [drawGrid, shouldAnimateCanvas, update]);

  useEffect(() => {
    return () => {
      if (pausedTimelineRenderTimeoutRef.current !== undefined) {
        window.clearTimeout(pausedTimelineRenderTimeoutRef.current);
        pausedTimelineRenderTimeoutRef.current = undefined;
      }
    };
  }, []);

  const getLaneFromCanvasX = (
    canvasX: number,
    gridStartX: number,
    laneWidth: number,
    laneCount: number,
  ) => {
    const rawLane = (canvasX - gridStartX) / laneWidth;

    if (isXPositionGridEnabled) {
      return Math.max(0, Math.min(laneCount - 0.5, Math.round(rawLane * 2) / 2));
    }

    return Number(Math.max(0, Math.min(laneCount, rawLane)).toFixed(3));
  };

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

    const hitNotes = stateRef.current.notes.filter((note) => {
      const noteBeat = noteRenderIndex.noteBeats.get(note.id) ?? getBeatAtTime(note.time, sortedChanges);
      const noteY = hitLineY - (noteBeat - currentBeat) * pixelsPerBeat;
      const noteStartX = startX + note.lane * laneWidth;
      const noteEndX = noteStartX + (laneWidth / 2) * note.width;
      return clickX >= noteStartX && clickX <= noteEndX && clickY >= noteY - 10 && clickY <= noteY + 10;
    });
    const clickedNote = hitNotes.reduce<Note | null>((highestNote, note) => (
      !highestNote || note.id > highestNote.id ? note : highestNote
    ), null);
    const ctrlClickedNote = hitNotes.reduce<Note | null>((selectedNote, note) => (
      selectedNoteIdSet.has(note.id) && (!selectedNote || note.id > selectedNote.id)
        ? note
        : selectedNote
    ), null) ?? clickedNote;

    if (e.button === 0) { // Left click
      if (e.ctrlKey) {
        if (ctrlClickedNote) {
          setSelectedNoteIds(prev => (
            prev.includes(ctrlClickedNote.id)
              ? prev.filter(id => id !== ctrlClickedNote.id)
              : [...prev, ctrlClickedNote.id]
          ));
        }
        return;
      }

      if (e.shiftKey && clickedNote) {
        setSelectedNoteIds([clickedNote.id]);
        setDraggingNoteId(clickedNote.id);
        dragStartNoteRef.current = clickedNote;
        return;
      }

      if (clickX >= startX && clickX < startX + gridWidth) {
        const lane = getLaneFromCanvasX(clickX, startX, laneWidth, lanes);
        const newId = nextNoteIdRef.current++;
        const isHoldConnector = HOLD_CONNECTOR_TYPES.includes(selectedNoteType);
        const isHoldStart = HOLD_START_TYPES.includes(selectedNoteType);
        const currentNotes = stateRef.current.notes;
        const currentId = Math.max(newId - 1, 0);
        const manualParentInputId =
          currentParentInput.trim() === '' ? null : parseInt(currentParentInput, 10);
        const manualParentId =
          manualParentInputId !== null
          && !Number.isNaN(manualParentInputId)
          && currentNotes.some(note => note.id === manualParentInputId)
            ? manualParentInputId
            : null;
        const autoParentId = isHoldConnector && !isHoldStart
          ? currentId > 0 && currentNotes.some(note => note.id === currentId)
            ? currentId
            : null
          : null;
        const parentId = isHoldConnector && !isHoldStart
          ? manualParentId ?? autoParentId
          : null;
        const placedNote: Note = {
          id: newId,
          time: snappedTime,
          lane,
          type: selectedNoteType,
          width: noteWidth,
          parentId,
        };

        setNotes(prev => [...prev, placedNote]);

        recordOperation({
          category: 'note',
          title: 'Placed note',
          detail: `${getNoteHistoryDetail(placedNote)}${parentId === null ? '' : `, parent #${parentId}`}`,
        });

        if (currentParentInput.trim() !== '') {
          setCurrentParentInput(newId.toString());
        }
      }
    } else if (e.button === 1) { // Middle click
      if (e.shiftKey) {
        if (clickedNote) {
          setDraggingNoteId(clickedNote.id);
          dragStartNoteRef.current = clickedNote;
        }
      } else if (clickedNote) {
        setSelectedNoteIds([clickedNote.id]);
      } else {
        setSelectionBox({ startX: clickX, startY: clickY, endX: clickX, endY: clickY });
        setSelectedNoteIds([]);
      }
    } else if (e.button === 2) { // Right click
      if (clickedNote) {
        const noteIdsToDelete = selectedNoteIdSet.has(clickedNote.id) ? selectedNoteIds : [clickedNote.id];
        const noteIdsToDeleteSet = new Set(noteIdsToDelete);
        const deletedNotes = stateRef.current.notes.filter(note => noteIdsToDeleteSet.has(note.id));
        if (deletedNotes.length > 0) {
          recordOperation({
            category: 'note',
            title: deletedNotes.length === 1 ? 'Deleted note' : `Deleted ${deletedNotes.length} notes`,
            detail: deletedNotes.length === 1
              ? getNoteHistoryDetail(deletedNotes[0])
              : `IDs ${formatGroupedIds(deletedNotes.map(note => note.id))}`,
          });
        }
        setNotes(prev => prev.filter(note => !noteIdsToDeleteSet.has(note.id)));
        setSelectedNoteIds(prev => prev.filter(id => !noteIdsToDeleteSet.has(id)));
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
    const sortedChanges = timedBpmChanges;
    const currentBeat = getBeatAtTime(stateRef.current.currentTime, sortedChanges);

    if (draggingNoteId) {
      const lane = getLaneFromCanvasX(clickX, startX, laneWidth, lanes);
      const clickBeat = currentBeat + (hitLineY - clickY) / pixelsPerBeat;
      
      const snap = gridZoom;
      const snappedBeat = Math.round(clickBeat * snap) / snap;
      
      if (snappedBeat < 0) return;
      
      const snappedTime = getTimeAtBeat(snappedBeat, sortedChanges);
      pendingDragUpdateRef.current = { noteId: draggingNoteId, lane, time: snappedTime };

      if (!dragUpdateFrameRef.current) {
        dragUpdateFrameRef.current = requestAnimationFrame(() => {
          dragUpdateFrameRef.current = undefined;
          const pendingUpdate = pendingDragUpdateRef.current;
          if (!pendingUpdate) {
            return;
          }

          setNotes((prev) => prev.map((note) => {
            if (note.id !== pendingUpdate.noteId) {
              return note;
            }

            if (note.time === pendingUpdate.time && note.lane === pendingUpdate.lane) {
              return note;
            }

            return { ...note, time: pendingUpdate.time, lane: pendingUpdate.lane };
          }));
        });
      }
    } else if (selectionBox) {
      setSelectionBox(prev => prev ? { ...prev, endX: clickX, endY: clickY } : null);
    } else if (e.ctrlKey || e.shiftKey || isCtrlHeld || isShiftHeld) {
      if (hoverPreviewRef.current !== null) {
        setHoverPreview(null);
      }
    } else if (clickX >= startX && clickX < startX + gridWidth) {
      const lane = getLaneFromCanvasX(clickX, startX, laneWidth, lanes);

      const clickBeat = currentBeat + (hitLineY - clickY) / pixelsPerBeat;
      const snappedBeat = Math.round(clickBeat * gridZoom) / gridZoom;

      if (snappedBeat < 0) {
        if (hoverPreviewRef.current !== null) {
          setHoverPreview(null);
        }
        return;
      }

      const snappedTime = getTimeAtBeat(snappedBeat, sortedChanges);
      const nextPreview = { lane, time: snappedTime };
      const currentPreview = hoverPreviewRef.current;
      if (!currentPreview || currentPreview.lane !== nextPreview.lane || Math.abs(currentPreview.time - nextPreview.time) > 0.000001) {
        setHoverPreview(nextPreview);
      }
    } else {
      if (hoverPreviewRef.current !== null) {
        setHoverPreview(null);
      }
    }
  };

  const handleCanvasMouseUp = () => {
    if (dragUpdateFrameRef.current) {
      cancelAnimationFrame(dragUpdateFrameRef.current);
      dragUpdateFrameRef.current = undefined;
    }
    const pendingUpdate = pendingDragUpdateRef.current;
    const dragStartNote = dragStartNoteRef.current;
    let dragEndNote = dragStartNote
      ? stateRef.current.notes.find(note => note.id === dragStartNote.id) || null
      : null;

    if (pendingUpdate) {
      if (dragStartNote && dragStartNote.id === pendingUpdate.noteId) {
        dragEndNote = { ...dragStartNote, time: pendingUpdate.time, lane: pendingUpdate.lane };
      }

      setNotes((prev) => prev.map((note) => {
        if (note.id !== pendingUpdate.noteId) {
          return note;
        }

        if (note.time === pendingUpdate.time && note.lane === pendingUpdate.lane) {
          return note;
        }

        return { ...note, time: pendingUpdate.time, lane: pendingUpdate.lane };
      }));
      pendingDragUpdateRef.current = null;
    }

    if (dragStartNote && dragEndNote && (dragStartNote.time !== dragEndNote.time || dragStartNote.lane !== dragEndNote.lane)) {
      recordOperation({
        category: 'note',
        title: 'Moved note',
        detail: `#${dragStartNote.id} from ${formatTime(dragStartNote.time, timedBpmChanges)}, lane ${formatNoteLane(dragStartNote.lane)} to ${formatTime(dragEndNote.time, timedBpmChanges)}, lane ${formatNoteLane(dragEndNote.lane)}`,
      });
    }
    dragStartNoteRef.current = null;

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
    const scrollDelta = isScrollDirectionInverted ? -e.deltaY : e.deltaY;
    const targetBeat = currentBeat + (scrollDelta / pixelsPerBeat);
    
    // Snap to grid
    const snappedBeat = Math.round(targetBeat * gridZoom) / gridZoom;
    const newTime = getTimeAtBeat(snappedBeat, sortedChanges);
    
    let clampedTime = Math.max(0, newTime);
    if (audioRef.current && audioRef.current.duration && clampedTime > audioRef.current.duration) {
      clampedTime = audioRef.current.duration;
    }
    
    setCurrentTime(clampedTime);
    stateRef.current.currentTime = clampedTime;
    stateRef.current.playbackStartTime = clampedTime;
    stateRef.current.playbackStartPerformanceTime = performance.now();
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
    renderPausedTimelineAtFullFps();
  };

  const saveZipData = async (zipBuffer: ArrayBuffer, suggestedName: string, errorLabel: string) => {
    const fallbackDownload = () => {
      const zipBlob = new Blob([zipBuffer], { type: 'application/zip' });
      const url = URL.createObjectURL(zipBlob);
      const anchor = document.createElement('a');

      anchor.href = url;
      anchor.download = suggestedName;
      anchor.click();
      URL.revokeObjectURL(url);
    };

    if ('showSaveFilePicker' in window) {
      try {
        const handle = await (window as any).showSaveFilePicker({
          suggestedName,
          types: [{
            description: 'ZIP Archive',
            accept: { 'application/zip': ['.zip'] },
          }],
        });
        const writable = await handle.createWritable();
        await writable.write(zipBuffer);
        await writable.close();
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          console.error(`${errorLabel} export failed`, err);
          fallbackDownload();
        }
      }
    } else {
      fallbackDownload();
    }
  };

  const exportDr3Viewer = async () => {
    if (!projectData || !projectData.songFile || hasExportIncompatibleTimeSignature) return;

    try {
      const { zipBuffer, suggestedName } = await createExportZipInWorker({
        format: 'dr3-viewer',
        projectData,
        notes,
        bpmChanges,
        speedChanges,
        offset,
      });
      await saveZipData(zipBuffer, suggestedName, 'DR3Viewer');
    } catch (err) {
      console.error('DR3Viewer export failed', err);
    }
  };

  const exportDr3Fp = async () => {
    if (!projectData || !projectData.songFile || hasExportIncompatibleTimeSignature) return;

    try {
      const { zipBuffer, suggestedName } = await createExportZipInWorker({
        format: 'dr3-fp',
        projectData,
        notes,
        bpmChanges,
        speedChanges,
        offset,
      });
      await saveZipData(zipBuffer, suggestedName, 'DR3FP');
    } catch (err) {
      console.error('DR3FP export failed', err);
    }
  };

  const currentId = Math.max(nextNoteIdRef.current - 1, 0);
  const currentParentId =
    currentParentInput.trim() === '' ? currentId : parseInt(currentParentInput, 10);
  const currentParentNote =
    currentParentId === 0 || Number.isNaN(currentParentId)
      ? null
      : notes.find((note) => note.id === currentParentId) || null;
  const selectedSingleNote =
    selectedNoteIds.length === 1
      ? notes.find((note) => note.id === selectedNoteIds[0]) || null
      : null;
  const canUseSelectedAsParent = selectedNoteIds.length === 1 && selectedSingleNote !== null;
  const selectedParentNote =
    selectedSingleNote?.parentId === null || selectedSingleNote?.parentId === undefined
      ? null
      : notes.find((note) => note.id === selectedSingleNote.parentId) || null;
  const canEditSelectedNoteParent = selectedSingleNote ? canTypeHaveParent(selectedSingleNote.type) : false;
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
  const currentEditorTimepos = getTimeposFromTime(liveStatsTime);
  const currentEditorBpm = getActiveChange(liveStatsTime, timedBpmChanges).bpm;
  const sortedSpeedChanges = [...speedChanges].sort((a, b) => (a.measure - b.measure) || (a.beat - b.beat));
  const currentEditorSpeed = sortedSpeedChanges.reduce((activeSpeed, change) => (
      change.measure + change.beat / 4 <= currentEditorTimepos
        ? change.speedChange
        : activeSpeed
    ), 1);
  const currentEditorDistanceState = sortedSpeedChanges.reduce((distanceState, change) => {
    const changeTimepos = change.measure + change.beat / 4;

    if (changeTimepos > currentEditorTimepos) {
      return distanceState;
    }

    const clampedChangeTimepos = Math.max(distanceState.timepos, changeTimepos);
    return {
      distance: distanceState.distance + distanceState.speed * (clampedChangeTimepos - distanceState.timepos),
      speed: change.speedChange,
      timepos: clampedChangeTimepos,
    };
  }, { distance: 0, speed: 1, timepos: 0 });
  const currentEditorDistance = currentEditorDistanceState.distance +
    currentEditorDistanceState.speed * Math.max(0, currentEditorTimepos - currentEditorDistanceState.timepos);
  const currentEditorCombo = notes.reduce((combo, note) => (
    note.time <= liveStatsTime ? combo + 1 : combo
  ), 0);
  const currentEditorScore = notes.length > 0
    ? Math.floor((3000000 / notes.length) * currentEditorCombo)
    : 0;
  const notePropertyInputClass = 'w-full p-2 text-sm bg-neutral-800 rounded border border-neutral-700 focus:border-indigo-500 outline-none disabled:cursor-not-allowed disabled:border-neutral-800 disabled:bg-neutral-900 disabled:text-neutral-600';
  const emptyCanvasMessage = mode === 'import'
    ? 'Provide the music file in Chart Metadata to start editing this imported chart.'
    : 'Fill in project details in Chart Metadata to start editing.';
  const updateSelectedNote = (updates: Partial<Note>) => {
    if (!selectedSingleNote) return;

    const nextType = updates.type ?? selectedSingleNote.type;
    const normalizedUpdates = shouldOmitParentForType(nextType)
      ? { ...updates, parentId: null }
      : updates;
    const changedFields = Object.entries(normalizedUpdates).filter(([key, value]) => (
      selectedSingleNote[key as keyof Note] !== value
    ));

    if (changedFields.length === 0) {
      return;
    }

    const fieldLabels: Partial<Record<keyof Note, string>> = {
      time: 'time',
      lane: 'lane',
      type: 'type',
      width: 'width',
      parentId: 'parent ID',
      speed: 'speed',
      appearMode: 'AppearMode',
    };
    const fieldDetails = changedFields.map(([key, value]) => {
      const typedKey = key as keyof Note;
      const label = fieldLabels[typedKey] || key;
      const previousValue = selectedSingleNote[typedKey];

      if (typedKey === 'time') {
        return `${label}: ${formatTime(Number(previousValue), timedBpmChanges)} -> ${formatTime(Number(value), timedBpmChanges)}`;
      }

      if (typedKey === 'lane') {
        return `${label}: ${formatNoteLane(Number(previousValue))} -> ${formatNoteLane(Number(value))}`;
      }

      if (typedKey === 'type') {
        return `${label}: ${NOTE_TYPES[Number(previousValue)]?.name || previousValue} -> ${NOTE_TYPES[Number(value)]?.name || value}`;
      }

      return `${label}: ${formatMaybeValue(previousValue)} -> ${formatMaybeValue(value)}`;
    }).join('; ');

    recordOperation({
      category: 'note',
      title: 'Modified note',
      detail: `#${selectedSingleNote.id} ${fieldDetails}`,
    });

    setNotes(prev => prev.map(note => (
      note.id === selectedSingleNote.id ? { ...note, ...normalizedUpdates } : note
    )));
  };
  const updateBpmChange = (index: number, updates: Partial<BpmChange>) => {
    const previousChange = bpmChanges[index];
    if (!previousChange) return;

    const nextChange = { ...previousChange, ...updates };
    const changedFields = Object.entries(updates).filter(([key, value]) => (
      previousChange[key as keyof BpmChange] !== value
    ));

    if (changedFields.length === 0) return;

    setBpmChanges(prev => prev.map((change, changeIndex) => (
      changeIndex === index ? nextChange : change
    )));

    recordOperation({
      category: 'timing',
      title: 'Modified BPM change',
      detail: `${formatTimingPosition(previousChange.measure, previousChange.beat)} | ${changedFields.map(([key, value]) => `${key}: ${previousChange[key as keyof BpmChange]} -> ${value}`).join('; ')}`,
    });
  };

  const deleteBpmChange = (index: number) => {
    const deletedChange = bpmChanges[index];
    if (!deletedChange) return;

    setBpmChanges(prev => prev.filter((_, changeIndex) => changeIndex !== index));
    recordOperation({
      category: 'timing',
      title: 'Deleted BPM change',
      detail: `${formatTimingPosition(deletedChange.measure, deletedChange.beat)} | BPM ${formatHistoryNumber(deletedChange.bpm)} | ${deletedChange.timeSignature}`,
    });
  };

  const addBpmChange = () => {
    const sortedChanges = [...bpmChanges].sort((a, b) => (a.measure - b.measure) || (a.beat - b.beat));
    const lastChange = sortedChanges[sortedChanges.length - 1];
    const totalBeats = getBeatAtTime(currentTime, convertBpmChangesToTime(bpmChanges));
    const activeChange = getActiveChange(currentTime, convertBpmChangesToTime(bpmChanges));
    const beatsPerMeasure = parseInt(activeChange.timeSignature.split('/')[0]) || 4;
    const measure = Math.floor(totalBeats / beatsPerMeasure);
    const beat = Math.floor(totalBeats % beatsPerMeasure);
    const newChange = {
      measure,
      beat,
      bpm: lastChange ? lastChange.bpm : 120,
      timeSignature: lastChange ? lastChange.timeSignature : '4/4',
    };

    setBpmChanges([...bpmChanges, newChange]);
    recordOperation({
      category: 'timing',
      title: 'Added BPM change',
      detail: `${formatTimingPosition(newChange.measure, newChange.beat)} | BPM ${formatHistoryNumber(newChange.bpm)} | ${newChange.timeSignature}`,
    });
  };

  const updateSpeedChange = (index: number, updates: Partial<SpeedChange>) => {
    const previousChange = speedChanges[index];
    if (!previousChange) return;

    const nextChange = { ...previousChange, ...updates };
    const changedFields = Object.entries(updates).filter(([key, value]) => (
      previousChange[key as keyof SpeedChange] !== value
    ));

    if (changedFields.length === 0) return;

    setSpeedChanges(prev => prev.map((change, changeIndex) => (
      changeIndex === index ? nextChange : change
    )));

    recordOperation({
      category: 'speed',
      title: 'Modified speed change',
      detail: `${formatTimingPosition(previousChange.measure, previousChange.beat)} | ${changedFields.map(([key, value]) => `${key}: ${previousChange[key as keyof SpeedChange]} -> ${value}`).join('; ')}`,
    });
  };

  const deleteSpeedChange = (index: number) => {
    const deletedChange = speedChanges[index];
    if (!deletedChange) return;

    setSpeedChanges(prev => prev.filter((_, changeIndex) => changeIndex !== index));
    recordOperation({
      category: 'speed',
      title: 'Deleted speed change',
      detail: `${formatTimingPosition(deletedChange.measure, deletedChange.beat)} | ${formatHistoryNumber(deletedChange.speedChange)}x`,
    });
  };

  const addSpeedChange = () => {
    const totalBeats = getBeatAtTime(currentTime, convertBpmChangesToTime(bpmChanges));
    const activeChange = getActiveChange(currentTime, convertBpmChangesToTime(bpmChanges));
    const beatsPerMeasure = parseInt(activeChange.timeSignature.split('/')[0]) || 4;
    const newChange = {
      measure: Math.floor(totalBeats / beatsPerMeasure),
      beat: Math.floor(totalBeats % beatsPerMeasure),
      speedChange: 1,
    };

    setSpeedChanges([...speedChanges, newChange]);
    recordOperation({
      category: 'speed',
      title: 'Added speed change',
      detail: `${formatTimingPosition(newChange.measure, newChange.beat)} | ${formatHistoryNumber(newChange.speedChange)}x`,
    });
  };

  const updateOffset = (value: string | number) => {
    const previousOffset = offset;
    setOffset(value);

    if (previousOffset !== value) {
      recordOperation({
        category: 'timing',
        title: 'Modified offset',
        detail: `${formatMaybeValue(previousOffset)} ms -> ${formatMaybeValue(value)} ms`,
      });
    }
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
    stateRef.current.playbackStartTime = clampedTime;
    stateRef.current.playbackStartPerformanceTime = performance.now();
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
    if (progressBarRef.current && !isDraggingProgress.current) {
      progressBarRef.current.value = clampedTime.toString();
    }
    renderPausedTimelineAtFullFps();
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
      className="h-screen overflow-hidden bg-neutral-950 text-neutral-50 flex flex-col font-sans"
    >
      {projectData?.audioUrl && (
        <audio 
          ref={audioRef} 
          src={projectData.audioUrl} 
          onEnded={() => setIsPlaying(false)} 
          onLoadedMetadata={(e) => {
            setDuration(e.currentTarget.duration);
            applyAudioPlaybackSpeed(e.currentTarget, stateRef.current.playbackSpeed);
          }}
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
      />

      <AnimatePresence>
        {isExitWarningOpen && (
          <motion.div
            className="fixed inset-0 z-[70] flex items-center justify-center bg-black/55 p-4 backdrop-blur-md"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onMouseDown={() => setIsExitWarningOpen(false)}
          >
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-labelledby="exit-warning-title"
              className="flex w-full max-w-md flex-col overflow-hidden rounded-3xl border border-white/10 bg-neutral-950/90 shadow-2xl shadow-black/50"
              initial={{ opacity: 0, y: 28, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.96 }}
              transition={{ type: 'spring', stiffness: 320, damping: 30 }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <div className="border-b border-white/10 bg-gradient-to-br from-neutral-900 to-neutral-950 px-6 py-5">
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-amber-400/80">Warning</p>
                <h2 id="exit-warning-title" className="mt-2 text-2xl font-semibold text-white">Leave the editor?</h2>
              </div>

              <div className="px-6 py-6">
                <p className="text-sm leading-6 text-neutral-300">
                  All unsaved or unexported work will be lost if you go back to the landing page.
                </p>
              </div>

              <div className="flex gap-3 border-t border-white/10 p-4">
                <button
                  onClick={() => {
                    setIsExitWarningOpen(false);
                    onBack();
                  }}
                  className="flex-1 rounded-2xl bg-red-500 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-red-400"
                >
                  Quit
                </button>
                <button
                  onClick={() => setIsExitWarningOpen(false)}
                  className="flex-1 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-semibold text-neutral-200 transition-colors hover:bg-white/[0.08]"
                >
                  Cancel
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}

        {isSettingsOpen && (
          <motion.div
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/55 p-4 backdrop-blur-md"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onMouseDown={() => {
              setIsSettingsOpen(false);
              setIsStatisticsRefreshRateMenuOpen(false);
            }}
          >
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-labelledby="settings-title"
              className="flex max-h-[85vh] min-h-[22rem] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-white/10 bg-neutral-950/90 shadow-2xl shadow-black/50"
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

              <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-6 py-6">
                <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                  <div className="mb-5 flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-semibold text-white">Editor</h3>
                      <p className="mt-1 text-xs text-neutral-500">Control editor behavior and navigation safeguards.</p>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-white/10 bg-neutral-950/60 p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-sm font-medium text-white">Back to Landing warning</p>
                        <p className="mt-1 text-xs leading-5 text-neutral-500">
                          Show a confirmation popup before leaving the editor and discarding unexported work.
                        </p>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={isExitWarningEnabled}
                        aria-label="Toggle Back to Landing warning"
                        onClick={() => setIsExitWarningEnabled((current) => !current)}
                        className={`relative inline-flex h-7 w-14 shrink-0 items-center rounded-full border transition-colors ${
                          isExitWarningEnabled
                            ? 'border-emerald-300/40 bg-emerald-500/90'
                            : 'border-white/10 bg-neutral-800'
                        }`}
                      >
                        <span className="sr-only">Back to Landing warning</span>
                        <span
                          className={`absolute left-1 top-1/2 h-5 w-5 -translate-y-1/2 rounded-full bg-white shadow-sm transition-transform ${
                            isExitWarningEnabled ? 'translate-x-7' : 'translate-x-0'
                          }`}
                        />
                      </button>
                    </div>
                  </div>

                  <div className="mt-4 rounded-2xl border border-white/10 bg-neutral-950/60 p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-sm font-medium text-white">Invert Scroll Direction</p>
                        <p className="mt-1 text-xs leading-5 text-neutral-500">
                          Reverse mouse wheel scrolling when moving through the editor canvas.
                        </p>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={isScrollDirectionInverted}
                        aria-label="Toggle inverted canvas scroll direction"
                        onClick={() => setIsScrollDirectionInverted((current) => !current)}
                        className={`relative inline-flex h-7 w-14 shrink-0 items-center rounded-full border transition-colors ${
                          isScrollDirectionInverted
                            ? 'border-emerald-300/40 bg-emerald-500/90'
                            : 'border-white/10 bg-neutral-800'
                        }`}
                      >
                        <span className="sr-only">Invert Scroll Direction</span>
                        <span
                          className={`absolute left-1 top-1/2 h-5 w-5 -translate-y-1/2 rounded-full bg-white shadow-sm transition-transform ${
                            isScrollDirectionInverted ? 'translate-x-7' : 'translate-x-0'
                          }`}
                        />
                      </button>
                    </div>
                  </div>

                  <div className="mt-4 rounded-2xl border border-white/10 bg-neutral-950/60 p-4">
                    <div className="mb-3">
                      <p className="text-sm font-medium text-white">Statistics Refresh Rate</p>
                      <p className="mt-1 text-xs leading-5 text-neutral-500">
                        Limit how often live statistics update in the properties window.
                      </p>
                    </div>
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => setIsStatisticsRefreshRateMenuOpen(current => !current)}
                        className="flex w-full items-center justify-between rounded-lg border border-white/10 bg-neutral-900 px-3 py-2 text-left font-mono text-sm text-neutral-200 outline-none transition-colors hover:bg-neutral-800 focus:border-indigo-500"
                        aria-haspopup="menu"
                        aria-expanded={isStatisticsRefreshRateMenuOpen}
                      >
                        <span>{statisticsRefreshRate}</span>
                        <ChevronRight className={`h-4 w-4 text-neutral-500 transition-transform ${isStatisticsRefreshRateMenuOpen ? 'rotate-90' : ''}`} />
                      </button>
                      {isStatisticsRefreshRateMenuOpen && (
                        <div
                          className="absolute left-0 right-0 top-full z-50 mt-2 rounded-lg border border-neutral-700 bg-neutral-950 p-1 shadow-2xl shadow-black/40"
                          role="menu"
                        >
                          {STATISTICS_REFRESH_RATE_OPTIONS.map((refreshRate) => (
                            <button
                              key={refreshRate}
                              type="button"
                              onClick={() => {
                                setStatisticsRefreshRate(refreshRate);
                                setIsStatisticsRefreshRateMenuOpen(false);
                              }}
                              className={`w-full rounded px-3 py-2 text-left font-mono text-sm transition-colors ${
                                statisticsRefreshRate === refreshRate
                                  ? 'bg-indigo-500/20 text-indigo-200'
                                  : 'text-neutral-200 hover:bg-neutral-800'
                              }`}
                              role="menuitem"
                            >
                              {refreshRate}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </section>

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
                  onClick={() => {
                    setIsSettingsOpen(false);
                    setIsStatisticsRefreshRateMenuOpen(false);
                  }}
                  className="w-full rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-neutral-950 transition-colors hover:bg-neutral-200"
                >
                  Close
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}

        {isHelpOpen && (
          <motion.div
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/55 p-4 backdrop-blur-md"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onMouseDown={() => setIsHelpOpen(false)}
          >
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-labelledby="hotkeys-title"
              className="flex max-h-[85vh] min-h-[22rem] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-white/10 bg-neutral-950/90 shadow-2xl shadow-black/50"
              initial={{ opacity: 0, y: 28, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.96 }}
              transition={{ type: 'spring', stiffness: 320, damping: 30 }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <div className="border-b border-white/10 bg-gradient-to-br from-neutral-900 to-neutral-950 px-6 py-5">
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-neutral-500">Editor</p>
                <h2 id="hotkeys-title" className="mt-2 text-2xl font-semibold text-white">Hotkeys</h2>
              </div>

              <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-6 py-6">
                {EDITOR_KEYBIND_GROUPS.map(group => (
                  <section key={group.title} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                    <h3 className="mb-4 text-sm font-semibold text-white">{group.title}</h3>
                    <div className="space-y-3">
                      {group.bindings.map(binding => (
                        <div
                          key={`${group.title}-${binding.keys.join('-')}`}
                          className="grid gap-3 rounded-2xl border border-white/10 bg-neutral-950/60 p-4 sm:grid-cols-[13rem_minmax(0,1fr)]"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            {binding.keys.map((key, index) => (
                              <React.Fragment key={key}>
                                {index > 0 && <span className="text-xs text-neutral-600">+</span>}
                                <kbd className="rounded-lg border border-white/10 bg-neutral-900 px-2 py-1 font-mono text-xs font-semibold text-neutral-200 shadow-inner shadow-black/30">
                                  {key}
                                </kbd>
                              </React.Fragment>
                            ))}
                          </div>
                          <p className="text-sm leading-6 text-neutral-300">{binding.description}</p>
                        </div>
                      ))}
                    </div>
                  </section>
                ))}
              </div>

              <div className="border-t border-white/10 p-4">
                <button
                  onClick={() => setIsHelpOpen(false)}
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
            onClick={openExitWarning}
            className="p-2 hover:bg-neutral-800 rounded-lg transition-colors text-neutral-400 hover:text-white"
            title="Back to Landing"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="h-4 w-px bg-neutral-800" />
          <h1 className="font-medium text-sm truncate">{projectData?.songName || 'Untitled Project'}</h1>
        </div>
        
        {/* Transport */}
        <div className="flex-1 flex items-center justify-center px-4 max-w-xl gap-3">
          {projectData && (
            <>
              <button
                type="button"
                onClick={() => setIsXPositionGridEnabled(prev => !prev)}
                className={`shrink-0 p-2 rounded-lg transition-colors ${isXPositionGridEnabled ? 'hover:bg-neutral-800 text-neutral-400 hover:text-white' : 'bg-indigo-500/20 text-indigo-300 hover:bg-indigo-500/30'}`}
                title={isXPositionGridEnabled ? 'Disable x-position grid' : 'Enable x-position grid'}
                aria-pressed={!isXPositionGridEnabled}
                aria-label={isXPositionGridEnabled ? 'Disable x-position grid' : 'Enable x-position grid'}
              >
                {isXPositionGridEnabled ? <Grid2x2 className="w-4 h-4" /> : <Grid2x2X className="w-4 h-4" />}
              </button>
              <div className="flex min-w-0 flex-1 items-center gap-3 rounded-xl border border-neutral-800 bg-neutral-950/40 px-2 py-1.5">
                <button
                  onClick={togglePlay}
                  className={`shrink-0 p-2 rounded-lg transition-colors ${isPlaying ? 'bg-emerald-500/20 text-emerald-400' : 'hover:bg-neutral-800 text-neutral-400 hover:text-emerald-400'}`}
                  title={isPlaying ? "Pause (Space)" : "Play (Space)"}
                >
                  {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                </button>
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
                  className="min-w-0 flex-1 h-1.5 bg-neutral-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                />
                <div ref={timeDisplayRef} className="shrink-0 text-sm font-mono text-neutral-400">
                  {formatTime(currentTime, convertBpmChangesToTime(bpmChanges))}
                </div>
              </div>
            </>
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
            </>
          )}
          <div className="relative">
            <button
              type="button"
              onClick={() => {
                setIsExportMenuOpen(false);
                setIsPlaybackSpeedMenuOpen(current => !current);
              }}
              className="min-w-14 rounded-lg px-2 py-1.5 font-mono text-sm text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-white"
              title="Playback speed"
              aria-haspopup="menu"
              aria-expanded={isPlaybackSpeedMenuOpen}
            >
              {formatPlaybackSpeed(playbackSpeed)}
            </button>
            {isPlaybackSpeedMenuOpen && (
              <div
                className="absolute right-0 top-full z-50 mt-2 w-24 rounded-lg border border-neutral-700 bg-neutral-950 p-1 shadow-2xl shadow-black/40"
                role="menu"
              >
                {PLAYBACK_SPEED_OPTIONS.map(speed => (
                  <button
                    key={speed}
                    type="button"
                    onClick={() => changePlaybackSpeed(speed)}
                    className={`w-full rounded px-3 py-2 text-right font-mono text-sm transition-colors ${
                      playbackSpeed === speed
                        ? 'bg-indigo-500/20 text-indigo-200'
                        : 'text-neutral-200 hover:bg-neutral-800'
                    }`}
                    role="menuitem"
                  >
                    {formatPlaybackSpeed(speed)}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            type="button"
            onPointerDown={(e) => {
              e.preventDefault();
              openHelp();
            }}
            className="p-2 hover:bg-neutral-800 rounded-lg transition-colors text-neutral-400 hover:text-white"
            title="Hotkeys"
            aria-label="Open hotkeys help"
            aria-haspopup="dialog"
            aria-expanded={isHelpOpen}
          >
            <HelpCircle className="w-4 h-4" />
          </button>
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
          <div className="relative ml-2">
            <button
              type="button"
              onClick={() => setIsExportMenuOpen(current => !current)}
              className="flex items-center gap-2 px-3 py-1.5 bg-indigo-500 hover:bg-indigo-600 text-white rounded-lg transition-colors text-sm font-medium"
              title="Export Level"
              aria-haspopup="menu"
              aria-expanded={isExportMenuOpen}
            >
              <Download className="w-4 h-4" />
              Export
            </button>
            {isExportMenuOpen && (
              <div
                className="absolute right-0 top-full z-50 mt-2 w-64 rounded-lg border border-neutral-700 bg-neutral-950 p-2 shadow-2xl shadow-black/40"
                role="menu"
              >
                {hasExportIncompatibleTimeSignature && (
                  <p className="mb-2 rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs leading-5 text-amber-200">
                    Export is incompatible with DR3Viewer and DR3FP formats due to unique time signatures.
                  </p>
                )}
                <button
                  type="button"
                  disabled={hasExportIncompatibleTimeSignature || !projectData?.songFile}
                  onClick={() => {
                    setIsExportMenuOpen(false);
                    void exportDr3Viewer();
                  }}
                  className="w-full rounded px-3 py-2 text-left text-sm text-neutral-200 transition-colors hover:bg-neutral-800 disabled:cursor-not-allowed disabled:text-neutral-500 disabled:hover:bg-transparent"
                  role="menuitem"
                >
                  DR3Viewer format
                </button>
                <button
                  type="button"
                  disabled={hasExportIncompatibleTimeSignature || !projectData?.songFile}
                  onClick={() => {
                    setIsExportMenuOpen(false);
                    void exportDr3Fp();
                  }}
                  className="w-full rounded px-3 py-2 text-left text-sm text-neutral-200 transition-colors hover:bg-neutral-800 disabled:cursor-not-allowed disabled:text-neutral-500 disabled:hover:bg-transparent"
                  role="menuitem"
                >
                  DR3FP format
                </button>
              </div>
            )}
          </div>
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
          <div className={`p-2 border-b border-neutral-800 flex ${isLeftPanelContentVisible ? 'justify-start' : 'justify-center'}`}>
            <button
              onClick={toggleLeftPanelCompact}
              className={`flex items-center gap-2 rounded text-neutral-400 hover:bg-neutral-800 hover:text-white transition-colors ${isLeftPanelContentVisible ? 'px-2 py-1 text-xs font-medium' : 'p-1'}`}
            >
              {isLeftPanelCompact ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
              {isLeftPanelContentVisible && <span>Collapse Window</span>}
            </button>
          </div>
          {isLeftPanelContentVisible && activeLeftPanel === 'main' && (
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
                        ? 'Auto-select current ID when placing.'
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
                      disabled={!canUseSelectedAsParent}
                      className="flex-1 px-2 py-1.5 text-xs text-neutral-300 bg-neutral-800 hover:bg-neutral-700 disabled:bg-neutral-900 disabled:text-neutral-600 rounded transition-colors"
                    >
                      Use Selected
                    </button>
                  </div>
                  <div className="text-xs text-neutral-500 mt-2">
                    Current ID: {currentId}
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

          {isLeftPanelContentVisible && activeLeftPanel === 'editInfo' && (
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

          {isLeftPanelContentVisible && activeLeftPanel === 'bpmTiming' && (
            <div className="p-4 flex flex-col h-full overflow-hidden min-h-0">
              <div className="flex items-center gap-2 mb-4 shrink-0">
                <button onClick={() => setActiveLeftPanel('main')} className="p-1 hover:bg-neutral-800 rounded text-neutral-400 hover:text-white transition-colors">
                  <ArrowLeft className="w-4 h-4" />
                </button>
                <div className="text-xs font-semibold text-neutral-500 uppercase tracking-wider">BPM / Timing</div>
              </div>
              <div className="flex flex-col gap-4 overflow-hidden flex-1 pr-1 pb-4 min-h-0">
                <div className="shrink-0">
                  <label className="block text-xs text-neutral-400 mb-1">Offset (ms)</label>
                  <CommitInput type="number" value={offset} className="w-full p-2 text-sm bg-neutral-800 rounded border border-neutral-700 focus:border-indigo-500 outline-none" onCommit={(val) => {
                    if (val === '-' || val === "") updateOffset(val);
                    else {
                      const num = parseFloat(val);
                      updateOffset(isNaN(num) ? 0 : num);
                    }
                  }} />
                </div>
                <div className="flex flex-1 min-h-0 flex-col">
                  <p className="mb-3 rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs leading-5 text-amber-200">
                    Export currently only supports BPM changes with 4/4 time signatures.
                  </p>
                  <label className="block shrink-0 text-xs text-neutral-400 mb-1">BPM Changes</label>
                  <div className="grid grid-cols-[2.5rem_2.5rem_3rem_3rem_1.5rem] gap-1 pb-2 text-left text-sm text-neutral-500">
                    <div>Meas</div>
                    <div>Beat</div>
                    <div>BPM</div>
                    <div>Sig</div>
                    <div />
                  </div>
                  <VirtualizedChangeList
                    items={bpmChanges}
                    rowHeight={36}
                    getKey={(_, index) => index}
                    className="min-h-0 flex-1 pr-1 text-sm text-neutral-300"
                    renderRow={(change, index, style) => (
                      <div style={style} className="grid grid-cols-[2.5rem_2.5rem_3rem_3rem_1.5rem] items-center gap-1">
                        <CommitInput type="number" value={change.measure} className="w-10 p-1 bg-neutral-800 rounded border border-neutral-700" onCommit={(value) => {
                            updateBpmChange(index, { measure: parseInt(value) || 0 });
                          }} />
                        <CommitInput type="number" value={change.beat} className="w-10 p-1 bg-neutral-800 rounded border border-neutral-700" onCommit={(value) => {
                            updateBpmChange(index, { beat: parseInt(value) || 0 });
                          }} />
                        <CommitInput type="number" value={change.bpm} className="w-12 p-1 bg-neutral-800 rounded border border-neutral-700" onCommit={(value) => {
                            updateBpmChange(index, { bpm: parseFloat(value) || 120 });
                          }} />
                        <CommitInput type="text" value={change.timeSignature} className="w-12 p-1 bg-neutral-800 rounded border border-neutral-700" onCommit={(value) => {
                            updateBpmChange(index, { timeSignature: value });
                          }} />
                        <div>
                          {index > 0 && (
                            <button onClick={() => {
                              deleteBpmChange(index);
                            }} className="text-red-400 hover:text-red-300">
                              <X className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  />
                  <button onClick={addBpmChange} className="w-full shrink-0 p-2 bg-neutral-800 hover:bg-neutral-700 text-white rounded text-sm mt-2 transition-colors">Add BPM Change</button>
                </div>
              </div>
            </div>
          )}

          {isLeftPanelContentVisible && activeLeftPanel === 'speedChanges' && (
            <div className="p-4 flex flex-col h-full overflow-hidden min-h-0">
              <div className="flex items-center gap-2 mb-4 shrink-0">
                <button onClick={() => setActiveLeftPanel('main')} className="p-1 hover:bg-neutral-800 rounded text-neutral-400 hover:text-white transition-colors">
                  <ArrowLeft className="w-4 h-4" />
                </button>
                <div className="text-xs font-semibold text-neutral-500 uppercase tracking-wider">Speed Changes</div>
              </div>
              <div className="flex flex-col overflow-hidden flex-1 pr-1 pb-4 min-h-0">
                <div className="grid grid-cols-[2.5rem_2.5rem_3rem_1.5rem] gap-1 pb-2 text-left text-sm text-neutral-500">
                  <div>Meas</div>
                  <div>Beat</div>
                  <div>Speed</div>
                  <div />
                </div>
                <VirtualizedChangeList
                  items={speedChanges}
                  rowHeight={36}
                  getKey={(_, index) => index}
                  className="min-h-0 flex-1 pr-1 text-sm text-neutral-300"
                  renderRow={(change, index, style) => (
                    <div style={style} className="grid grid-cols-[2.5rem_2.5rem_3rem_1.5rem] items-center gap-1">
                      <CommitInput type="number" value={change.measure} className="w-10 p-1 bg-neutral-800 rounded border border-neutral-700" onCommit={(value) => {
                          updateSpeedChange(index, { measure: parseInt(value) || 0 });
                        }} />
                      <CommitInput type="number" value={change.beat} className="w-10 p-1 bg-neutral-800 rounded border border-neutral-700" onCommit={(value) => {
                          updateSpeedChange(index, { beat: parseInt(value) || 0 });
                        }} />
                      <CommitInput type="number" step="0.1" value={change.speedChange} className="w-12 p-1 bg-neutral-800 rounded border border-neutral-700" onCommit={(value) => {
                          const val = parseFloat(value);
                          updateSpeedChange(index, { speedChange: isNaN(val) ? 1 : val });
                        }} />
                      <div>
                        {index > 0 && (
                          <button onClick={() => {
                            deleteSpeedChange(index);
                          }} className="text-red-400 hover:text-red-300">
                            <X className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                />
                <button onClick={addSpeedChange} className="w-full shrink-0 p-2 bg-neutral-800 hover:bg-neutral-700 text-white rounded text-sm mt-2 transition-colors">Add Speed Change</button>
              </div>
            </div>
          )}

          {isLeftPanelContentVisible && ['curveSC', 'history'].includes(activeLeftPanel) && (
            <div className="p-4 flex flex-col h-full overflow-hidden min-h-0">
              <div className="flex items-center gap-2 mb-4 shrink-0">
                <button onClick={() => setActiveLeftPanel('main')} className="p-1 hover:bg-neutral-800 rounded text-neutral-400 hover:text-white transition-colors">
                  <ArrowLeft className="w-4 h-4" />
                </button>
                <div className="text-xs font-semibold text-neutral-500 uppercase tracking-wider">
                  {activeLeftPanel === 'curveSC' ? 'Curve SC' : 'History'}
                </div>
              </div>
              {activeLeftPanel === 'curveSC' ? (
                <div className="flex-1 flex items-center justify-center text-sm text-neutral-600 border border-dashed border-neutral-800 rounded-lg p-4 text-center">
                  Not implemented yet
                </div>
              ) : operationHistory.length === 0 ? (
                <div className="flex-1 flex items-center justify-center text-sm text-neutral-600 border border-dashed border-neutral-800 rounded-lg p-4 text-center">
                  No operations recorded yet
                </div>
              ) : (
                <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                  <ol className="flex flex-col gap-2">
                    {operationHistory.map(entry => (
                      <li
                        key={entry.id}
                        className="rounded-lg border border-neutral-800 bg-neutral-950/40 p-3"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 text-sm font-medium text-neutral-200">
                            {entry.title}
                          </div>
                          <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase ${operationCategoryStyles[entry.category]}`}>
                            {entry.category}
                          </span>
                        </div>
                        <div className="mt-1 break-words text-xs leading-5 text-neutral-400">
                          {entry.detail}
                        </div>
                        <div className="mt-2 flex items-center justify-between text-[11px] text-neutral-600">
                          <span>#{entry.id}</span>
                          <time dateTime={new Date(entry.timestamp).toISOString()}>
                            {formatHistoryTimestamp(entry.timestamp)}
                          </time>
                        </div>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
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
              <p>{emptyCanvasMessage}</p>
            </div>
          ) : (
            <EditorCanvas 
              canvasRef={canvasRef}
              containerRef={containerRef}
              projectData={projectData}
              bpmChanges={bpmChanges}
              speedChanges={speedChanges}
              gridZoom={gridZoom}
              pixelsPerBeat={pixelsPerBeat}
              currentTime={currentTime}
              offset={offset}
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
          <div className={`p-2 border-b border-neutral-800 flex ${isRightPanelContentVisible ? 'justify-start' : 'justify-center'}`}>
            <button
              onClick={toggleRightPanelCompact}
              className={`flex items-center gap-2 rounded text-neutral-400 hover:bg-neutral-800 hover:text-white transition-colors ${isRightPanelContentVisible ? 'px-2 py-1 text-xs font-medium' : 'p-1'}`}
            >
              {isRightPanelCompact ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
              {isRightPanelContentVisible && <span>Collapse Window</span>}
            </button>
          </div>
          {isRightPanelContentVisible && (
            <div className="p-4 flex flex-col gap-4 overflow-y-auto">
              <div className="text-xs font-semibold text-neutral-500 uppercase tracking-wider">Properties</div>
              {selectedSingleNote ? (
                <div className="flex flex-col gap-3">
                  <button
                    type="button"
                    onClick={() => setSelectedNoteIds([])}
                    className="flex w-full items-center justify-center gap-2 rounded border border-neutral-700 bg-neutral-800 px-3 py-2 text-xs font-medium text-neutral-300 transition-colors hover:bg-neutral-700 hover:text-white"
                  >
                    <X className="h-3.5 w-3.5" />
                    <span>Deselect All</span>
                  </button>

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
                    <CommitInput
                      type="number"
                      step="0.001"
                      min="0"
                      value={Number(selectedNoteTimepos.toFixed(3))}
                      className={notePropertyInputClass}
                      onCommit={(value) => updateSelectedNote({ time: getTimeFromTimepos(Math.max(0, Number(value) || 0)) })}
                    />
                  </label>

                  <label className="block">
                    <span className="mb-1 block text-xs text-neutral-400">Lane</span>
                    <CommitInput
                      type="number"
                      min="1"
                      max="8"
                      step="0.01"
                      value={selectedSingleNote.lane + 1}
                      className={notePropertyInputClass}
                      onCommit={(value) => {
                        const lane = Math.max(1, Math.min(8, Number(value) || 1)) - 1;
                        updateSelectedNote({ lane });
                      }}
                    />
                  </label>

                  <label className="block">
                    <span className="mb-1 block text-xs text-neutral-400">Width</span>
                    <CommitInput
                      type="number"
                      min="1"
                      max="16"
                      step="0.01"
                      value={selectedSingleNote.width}
                      className={notePropertyInputClass}
                      onCommit={(value) => {
                        const width = Math.max(1, Math.min(16, Number(value) || 1));
                        updateSelectedNote({ width });
                      }}
                    />
                  </label>

                  <label className="block">
                    <span className="mb-1 block text-xs text-neutral-400">Parent ID</span>
                    <div className="flex gap-2">
                      <CommitInput
                        type="number"
                        min="0"
                        value={selectedSingleNote.parentId ?? ''}
                        placeholder="None"
                        className={notePropertyInputClass}
                        disabled={!canEditSelectedNoteParent}
                        onCommit={(value) => {
                          const trimmedValue = value.trim();
                          updateSelectedNote({ parentId: trimmedValue === '' ? null : Math.max(0, Number(trimmedValue) || 0) });
                        }}
                      />
                      <button
                        type="button"
                        disabled={!canEditSelectedNoteParent || !selectedParentNote}
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
                    <CommitInput
                      type="text"
                      value={selectedSingleNote.speed ?? ''}
                      placeholder="Default"
                      className={notePropertyInputClass}
                      onCommit={(value) => {
                        const normalizedValue = value.replace(/\s+/g, '');
                        updateSelectedNote({ speed: normalizedValue === '' ? undefined : normalizedValue });
                      }}
                    />
                  </label>

                  <label className="block">
                    <span className="mb-1 block text-xs text-neutral-400">AppearMode</span>
                    <select
                      value={selectedSingleNote.appearMode ?? 'none'}
                      className={notePropertyInputClass}
                      onChange={(e) => {
                        const nextAppearMode = e.target.value;
                        updateSelectedNote({
                          appearMode: nextAppearMode === 'none'
                            ? undefined
                            : nextAppearMode as Note['appearMode'],
                        });
                      }}
                    >
                      {APPEAR_MODE_OPTIONS.map((appearMode) => (
                        <option key={appearMode} value={appearMode}>
                          {appearMode}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              ) : (
                selectedNoteIds.length > 1 ? (
                  <div className="flex flex-col gap-3">
                    <button
                      type="button"
                      onClick={() => setSelectedNoteIds([])}
                      className="flex w-full items-center justify-center gap-2 rounded border border-neutral-700 bg-neutral-800 px-3 py-2 text-xs font-medium text-neutral-300 transition-colors hover:bg-neutral-700 hover:text-white"
                    >
                      <X className="h-3.5 w-3.5" />
                      <span>Deselect All</span>
                    </button>
                    <div className="flex-1 flex items-center justify-center text-sm text-neutral-600 border border-dashed border-neutral-800 rounded-lg p-4 text-center">
                      {`${selectedNoteIds.length} notes selected`}
                    </div>
                  </div>
                ) : (
                  <div className="rounded-lg border border-neutral-800 bg-neutral-950/40 p-3">
                    <div className="text-sm font-medium text-neutral-200">Chart Summary</div>
                    <div className="mt-3 flex flex-col divide-y divide-neutral-800 text-sm">
                      <div className="flex items-center justify-between py-2 first:pt-0">
                        <span className="text-neutral-400">Total Notes</span>
                        <span className="font-mono text-neutral-100">{notes.length}</span>
                      </div>
                      <div className="flex items-center justify-between py-2">
                        <span className="text-neutral-400">BPM Changes</span>
                        <span className="font-mono text-neutral-100">{bpmChanges.length}</span>
                      </div>
                      <div className="flex items-center justify-between py-2 last:pb-0">
                        <span className="text-neutral-400">Speed Changes</span>
                        <span className="font-mono text-neutral-100">{speedChanges.length}</span>
                      </div>
                      <div className="mt-2 flex items-center justify-between border-t border-neutral-800 py-2 pt-4">
                        <span className="text-neutral-400">Current BPM</span>
                        <span className="font-mono text-neutral-100">{formatHistoryNumber(currentEditorBpm)}</span>
                      </div>
                      <div className="flex items-center justify-between py-2 last:pb-0">
                        <span className="text-neutral-400">Current Speed</span>
                        <span className="font-mono text-neutral-100">{formatHistoryNumber(currentEditorSpeed)}x</span>
                      </div>
                      <div className="flex items-center justify-between py-2 last:pb-0">
                        <span className="text-neutral-400">Current Distance</span>
                        <span className="font-mono text-neutral-100">{currentEditorDistance.toFixed(3)}</span>
                      </div>
                      <div className="mt-2 flex items-center justify-between border-t border-neutral-800 py-2 pt-4">
                        <span className="text-neutral-400">Current Combo</span>
                        <span className="font-mono text-neutral-100">{currentEditorCombo}</span>
                      </div>
                      <div className="flex items-center justify-between py-2 last:pb-0">
                        <span className="text-neutral-400">Current Score</span>
                        <span className="font-mono text-neutral-100">{currentEditorScore}</span>
                      </div>
                    </div>
                  </div>
                )
              )}
            </div>
          )}
        </aside>
      </main>
    </motion.div>
  );
}
