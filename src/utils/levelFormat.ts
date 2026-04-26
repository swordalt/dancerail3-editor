import type { BpmChange, Note, ProjectData, SpeedChange } from '../types/editorTypes';
import { HOLD_START_TYPES } from '../constants/editorConstants';
import { convertBpmChangesToTime, getActiveChange, getBeatAtTime, getBpmChangeTimepos, getTimeAtBeat } from './editorUtils';

interface ParsedLevelData {
  notes: Note[];
  bpmChanges: BpmChange[];
  speedChanges: SpeedChange[];
  offset: number;
}

const DEFAULT_BPM_CHANGE: BpmChange = {
  timepos: 0,
  bpm: 120,
  timeSignature: '4/4',
};

const APPEAR_MODES = new Set(['L', 'R', 'H', 'P']);

const parseIndexedNumericValue = (line: string, prefix: string) => {
  const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = line.match(new RegExp(`^${escapedPrefix}\\[(\\d+)\\]=(\\d+\\.?\\d*);$`));
  if (!match) {
    return null;
  }

  return {
    index: parseInt(match[1], 10),
    value: parseFloat(match[2]),
  };
};

const convertTimeposToBpmChange = (timepos: number, bpm: number): BpmChange => {
  return {
    timepos,
    bpm,
    timeSignature: '4/4',
  };
};

export function parseLevelText(text: string): ParsedLevelData {
  const lines = text.split('\n');
  const notes: Note[] = [];
  const bpmValues = new Map<number, number>();
  const bpmPositions = new Map<number, number>();
  const speedChanges: SpeedChange[] = [];
  let offset = 0;

  for (const [index, line] of lines.entries()) {
    const normalizedLine = line.trim();

    if (normalizedLine.startsWith('#OFFSET=')) {
      offset = parseFloat(normalizedLine.split('=')[1]) * -1000;
      continue;
    }

    const bpmValueEntry = parseIndexedNumericValue(normalizedLine, '#BPM ');
    if (bpmValueEntry) {
      bpmValues.set(bpmValueEntry.index, bpmValueEntry.value);
      continue;
    }

    const bpmPositionEntry = parseIndexedNumericValue(normalizedLine, '#BPMS');
    if (bpmPositionEntry) {
      bpmPositions.set(bpmPositionEntry.index, bpmPositionEntry.value);
      continue;
    }

    if (normalizedLine.startsWith('#SC [')) {
      const match = normalizedLine.match(/#SC \[(\d+)\]=(-?\d+\.?\d*);/);
      const sciMatch = lines[index + 1]?.trim().match(/#SCI\[(\d+)\]=(\d+\.?\d*);/);
      if (match && sciMatch) {
        const speedChange = parseFloat(match[2]);
        const sci = parseFloat(sciMatch[2]);
        speedChanges.push({
          timepos: sci,
          speedChange,
        });
      }
      continue;
    }

    if (!normalizedLine.startsWith('<')) {
      continue;
    }

    const columns = [...normalizedLine.matchAll(/<([^>]*)>/g)].map((match) => match[1]);
    if (columns.length < 7) {
      continue;
    }

    const id = parseInt(columns[0], 10);
    const type = parseInt(columns[1], 10);
    const beatPos = parseFloat(columns[2]);
    const lane = parseFloat(columns[3]);
    const width = parseFloat(columns[4]);
    const speed = columns[5].replace(/\s+/g, '');
    const parsedParentId = parseInt(columns[6], 10);
    const importedAppearMode = columns[7]?.trim().toUpperCase();
    const appearMode = importedAppearMode && APPEAR_MODES.has(importedAppearMode)
      ? importedAppearMode as Note['appearMode']
      : undefined;

    if ([id, type, beatPos, lane, width, parsedParentId].some((value) => Number.isNaN(value)) || speed === '') {
      continue;
    }

    const bpmChanges = Array.from(bpmValues.entries())
      .map(([entryIndex, bpm]) => convertTimeposToBpmChange(bpmPositions.get(entryIndex) ?? 0, bpm))
      .sort((a, b) => getBpmChangeTimepos(a) - getBpmChangeTimepos(b))
      .filter((change, entryIndex, changes) => {
        if (entryIndex === 0) {
          return true;
        }

        const previous = changes[entryIndex - 1];
        return getBpmChangeTimepos(previous) !== getBpmChangeTimepos(change) || previous.bpm !== change.bpm;
      });

    const timedBpmChanges = convertBpmChangesToTime(
      bpmChanges.length > 0
        ? bpmChanges
        : [DEFAULT_BPM_CHANGE],
    );

    notes.push({
      id,
      time: getTimeAtBeat(beatPos * 4, timedBpmChanges),
      lane,
      type,
      width,
      speed,
      parentId: parsedParentId >= 0 ? parsedParentId : null,
      appearMode,
    });
  }

  const bpmChanges = Array.from(bpmValues.entries())
    .map(([index, bpm]) => convertTimeposToBpmChange(bpmPositions.get(index) ?? 0, bpm))
    .sort((a, b) => getBpmChangeTimepos(a) - getBpmChangeTimepos(b))
    .filter((change, index, changes) => {
      if (index === 0) {
        return true;
      }

      const previous = changes[index - 1];
      return getBpmChangeTimepos(previous) !== getBpmChangeTimepos(change) || previous.bpm !== change.bpm;
    });

  return { notes, bpmChanges, speedChanges, offset };
}

export function buildLevelText(params: {
  projectData: ProjectData;
  notes: Note[];
  bpmChanges: BpmChange[];
  speedChanges: SpeedChange[];
  offset: string | number;
}): string {
  const { notes, bpmChanges, speedChanges, offset } = params;
  const formatNoteValue = (value: number) => Number(value.toFixed(3)).toString();
  const getSerializedParentId = (note: Note) => (HOLD_START_TYPES.includes(note.type) ? 0 : (note.parentId ?? 0));
  const getSerializedSpeed = (note: Note) => {
    const normalizedSpeed = note.speed?.replace(/\s+/g, '');
    if (!normalizedSpeed) {
      return '1';
    }

    const numericSpeed = Number(normalizedSpeed);
    return Number.isFinite(numericSpeed) ? formatNoteValue(numericSpeed) : normalizedSpeed;
  };
  const normalizedBpmChanges = [...(bpmChanges.length > 0 ? bpmChanges : [DEFAULT_BPM_CHANGE])]
    .sort((a, b) => getBpmChangeTimepos(a) - getBpmChangeTimepos(b));
  const formatTimepos = (change: BpmChange) => getBpmChangeTimepos(change).toFixed(3);

  let content = `#OFFSET=${parseFloat(offset.toString()) / -1000};\n`;
  content += '#BEAT=1;\n';
  content += `#BPM_NUMBER=${normalizedBpmChanges.length};\n`;
  normalizedBpmChanges.forEach((change, index) => {
    content += `#BPM [${index}]=${change.bpm};\n`;
    content += `#BPMS[${index}]=${formatTimepos(change)};\n`;
  });
  content += `#SCN=${speedChanges.length};\n`;

  speedChanges.forEach((change, index) => {
    content += `#SC [${index}]=${change.speedChange};\n`;
    content += `#SCI[${index}]=${change.timepos.toFixed(3)};\n`;
  });

  const sortedChanges = convertBpmChangesToTime(bpmChanges);

  notes.forEach((note) => {
    const totalBeats = getBeatAtTime(note.time, sortedChanges);

    let currentMeasureBeat = 0;
    let measureCount = 0;
    let currentBeatsPerMeasure = 4;

    while (measureCount < 10000) {
      const timeAtMeasure = getTimeAtBeat(currentMeasureBeat, sortedChanges);
      const activeChange = getActiveChange(timeAtMeasure + 0.001, sortedChanges);
      currentBeatsPerMeasure = parseInt(activeChange.timeSignature.split('/')[0], 10) || 4;

      if (totalBeats < currentMeasureBeat + currentBeatsPerMeasure) {
        break;
      }

      currentMeasureBeat += currentBeatsPerMeasure;
      measureCount++;
    }

    const beatInMeasure = totalBeats - currentMeasureBeat;
    const serializedAppearMode = note.appearMode && APPEAR_MODES.has(note.appearMode)
      ? `<${note.appearMode}>`
      : '';
    content += `<${note.id}><${note.type}><${(measureCount + beatInMeasure / currentBeatsPerMeasure).toFixed(3)}><${formatNoteValue(note.lane)}><${formatNoteValue(note.width)}><${getSerializedSpeed(note)}><${getSerializedParentId(note)}>${serializedAppearMode}\n`;
  });

  return content;
}
