import type { BpmChange, Note, ProjectData, SpeedChange } from '../types/editorTypes';
import { HOLD_START_TYPES } from '../constants/editorConstants';
import { convertBpmChangesToTime, getActiveChange, getBeatAtTime, getTimeAtBeat } from './editorUtils';

interface ParsedLevelData {
  notes: Note[];
  bpmChanges: BpmChange[];
  speedChanges: SpeedChange[];
  offset: number;
}

export function parseLevelText(text: string): ParsedLevelData {
  const lines = text.split('\n');
  const notes: Note[] = [];
  const bpmChanges: BpmChange[] = [];
  const speedChanges: SpeedChange[] = [];
  let offset = 0;

  for (const [index, line] of lines.entries()) {
    const normalizedLine = line.trim();

    if (normalizedLine.startsWith('#OFFSET=')) {
      offset = parseFloat(normalizedLine.split('=')[1]) * 1000;
      continue;
    }

    if (normalizedLine.startsWith('#BPM [')) {
      const match = normalizedLine.match(/#BPM \[(\d+)\]=(\d+\.?\d*);/);
      if (match) {
        bpmChanges.push({
          measure: 0,
          beat: 0,
          bpm: parseFloat(match[2]),
          timeSignature: '4/4',
        });
      }
      continue;
    }

    if (normalizedLine.startsWith('#SC [')) {
      const match = normalizedLine.match(/#SC \[(\d+)\]=(\d+\.?\d*);/);
      const sciMatch = lines[index + 1]?.trim().match(/#SCI\[(\d+)\]=(\d+\.?\d*);/);
      if (match && sciMatch) {
        const speedChange = parseFloat(match[2]);
        const sci = parseFloat(sciMatch[2]);
        speedChanges.push({
          measure: Math.floor(sci),
          beat: (sci % 1) * 4,
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
    const lane = parseFloat(columns[3]) / 2;
    const width = parseFloat(columns[4]);
    const speed = columns[5].replace(/\s+/g, '');
    const parsedParentId = parseInt(columns[6], 10);

    if ([id, type, beatPos, lane, width, parsedParentId].some((value) => Number.isNaN(value)) || speed === '') {
      continue;
    }

    const timedBpmChanges = convertBpmChangesToTime(
      bpmChanges.length > 0
        ? bpmChanges
        : [{ measure: 0, beat: 0, bpm: 120, timeSignature: '4/4' }],
    );

    notes.push({
      id,
      time: getTimeAtBeat(beatPos * 4, timedBpmChanges),
      lane,
      type,
      width,
      speed,
      parentId: parsedParentId >= 0 ? parsedParentId : null,
    });
  }

  return { notes, bpmChanges, speedChanges, offset };
}

export function buildLevelText(params: {
  projectData: ProjectData;
  notes: Note[];
  bpmChanges: BpmChange[];
  speedChanges: SpeedChange[];
  offset: string | number;
}): string {
  const { projectData, notes, bpmChanges, speedChanges, offset } = params;
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

  let content = `#OFFSET=${parseFloat(offset.toString()) / 1000};\n`;
  content += '#BEAT=1;\n';
  content += '#BPM_NUMBER=1;\n';
  content += `#BPM [0]=${projectData.bpm || 120};\n`;
  content += '#BPMS[0]=0;\n';
  content += `#SCN=${speedChanges.length};\n`;

  speedChanges.forEach((change, index) => {
    content += `#SC [${index}]=${change.speedChange};\n`;
    content += `#SCI[${index}]=${(change.measure + change.beat / 4).toFixed(3)};\n`;
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
    content += `<${note.id}><${note.type}><${(measureCount + beatInMeasure / currentBeatsPerMeasure).toFixed(3)}><${formatNoteValue(note.lane * 2)}><${formatNoteValue(note.width)}><${getSerializedSpeed(note)}><${getSerializedParentId(note)}>\n`;
  });

  return content;
}
