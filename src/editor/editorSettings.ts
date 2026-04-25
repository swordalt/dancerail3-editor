export const DEFAULT_PIXELS_PER_BEAT = 150;
export const MIN_PIXELS_PER_BEAT = 60;
export const MAX_PIXELS_PER_BEAT = 320;
export const EDITOR_SETTINGS_STORAGE_KEY = 'dancerail3-editor:settings';
export const STATISTICS_REFRESH_RATE_OPTIONS = ['15fps', '30fps', '60fps', 'max'] as const;

export type StatisticsRefreshRate = typeof STATISTICS_REFRESH_RATE_OPTIONS[number];

export interface EditorSettings {
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

export const DEFAULT_EDITOR_SETTINGS: EditorSettings = {
  isExitWarningEnabled: true,
  isScrollDirectionInverted: false,
  statisticsRefreshRate: '30fps',
  musicVolume: 1,
  tapSoundVolume: 1,
  flickSoundVolume: 1,
  gridZoom: 4,
  isXPositionGridEnabled: true,
  pixelsPerBeat: DEFAULT_PIXELS_PER_BEAT,
};

const isPlainRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const isValidVolume = (value: unknown): value is number => (
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 2
);

const isValidGridZoom = (value: unknown): value is number => (
  typeof value === 'number' &&
  Number.isInteger(value) &&
  value >= 0
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

export const getStatisticsRefreshIntervalMs = (refreshRate: StatisticsRefreshRate) => {
  if (refreshRate === 'max') {
    return 0;
  }

  return 1000 / Number(refreshRate.replace('fps', ''));
};

export const loadEditorSettings = (): EditorSettings => {
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

export const saveEditorSettings = (settings: EditorSettings) => {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(EDITOR_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage can be unavailable in private browsing or restricted iframe contexts.
  }
};
