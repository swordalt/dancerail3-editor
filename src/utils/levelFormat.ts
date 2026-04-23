import type { BpmChange, Note, ProjectData, SpeedChange } from '../types/editorTypes';
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
    if (line.startsWith('#OFFSET=')) {
      offset = parseFloat(line.split('=')[1]) * 1000;
      continue;
    }

    if (line.startsWith('#BPM [')) {
      const match = line.match(/#BPM \[(\d+)\]=(\d+\.?\d*);/);
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

    if (line.startsWith('#SC [')) {
      const match = line.match(/#SC \[(\d+)\]=(\d+\.?\d*);/);
      const sciMatch = lines[index + 1]?.match(/#SCI\[(\d+)\]=(\d+\.?\d*);/);
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

    if (!line.startsWith('<')) {
      continue;
    }

    const parts = line.match(/<(\d+)><(\d+)><(\d+\.?\d*)><(-?\d+)><(\d+)><(\d+)><(-?\d+)>/);
    if (!parts) {
      continue;
    }

    const id = parseInt(parts[1], 10);
    const type = parseInt(parts[2], 10);
    const beatPos = parseFloat(parts[3]);
    const lane = parseInt(parts[4], 10) / 2;
    const width = parseInt(parts[5], 10);
    const speed = parseFloat(parts[6]);
    const parsedParentId = parseInt(parts[7], 10);

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
      parentId: parsedParentId > 0 ? parsedParentId : null,
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
    content += `<${note.id}><${note.type}><${(measureCount + beatInMeasure / currentBeatsPerMeasure).toFixed(3)}><${note.lane * 2}><${note.width}><1><${note.parentId || 0}>\n`;
  });

  return content;
}
