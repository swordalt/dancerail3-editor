import type { BpmChange, TimedBpmChange } from '../types/editorTypes';

const DEFAULT_BPM = 120;
const DEFAULT_TIME_SIGNATURE = '4/4';

const getBeatsPerMeasure = (timeSignature: string) => parseInt(timeSignature.split('/')[0], 10) || 4;

export const getBpmChangeTimepos = (change: BpmChange) => {
  if (Number.isFinite(change.timepos)) {
    return change.timepos;
  }

  const legacyChange = change as BpmChange & { measure?: number; beat?: number };
  return (legacyChange.measure ?? 0) + (legacyChange.beat ?? 0) / 4;
};

const findLastChangeIndexByTime = (time: number, changes: TimedBpmChange[]) => {
  let low = 0;
  let high = changes.length - 1;
  let result = 0;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (changes[mid].time <= time) {
      result = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return result;
};

const findLastChangeIndexByBeat = (beat: number, changes: TimedBpmChange[]) => {
  let low = 0;
  let high = changes.length - 1;
  let result = 0;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (changes[mid].startBeat <= beat) {
      result = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return result;
};

export const convertBpmChangesToTime = (changes: BpmChange[]): TimedBpmChange[] => {
  const sortedChanges = [...changes].sort((a, b) => getBpmChangeTimepos(a) - getBpmChangeTimepos(b));
  const timeChanges: TimedBpmChange[] = [];
  
  let currentTime = 0;
  let currentBeat = 0;
  let lastTimepos = 0;
  let lastBpm = DEFAULT_BPM;
  let lastTimeSignature = DEFAULT_TIME_SIGNATURE;

  if (sortedChanges.length === 0 || getBpmChangeTimepos(sortedChanges[0]) !== 0) {
    timeChanges.push({
      time: 0,
      startBeat: 0,
      bpm: DEFAULT_BPM,
      timeSignature: DEFAULT_TIME_SIGNATURE,
    });
  }
  
  for (const change of sortedChanges) {
    const changeTimepos = getBpmChangeTimepos(change);
    const beatsPerMeasure = getBeatsPerMeasure(lastTimeSignature);
    const beatsToNextChange = (changeTimepos - lastTimepos) * beatsPerMeasure;
    
    currentTime += beatsToNextChange * (60 / lastBpm);
    currentBeat += beatsToNextChange;
    
    timeChanges.push({
      time: currentTime,
      startBeat: currentBeat,
      bpm: change.bpm,
      timeSignature: change.timeSignature,
    });
    
    lastTimepos = changeTimepos;
    lastBpm = change.bpm;
    lastTimeSignature = change.timeSignature;
  }
  
  return timeChanges;
};

export const getActiveChange = (time: number, changes: TimedBpmChange[]) => {
  if (changes.length === 0) {
    return {
      time: 0,
      startBeat: 0,
      bpm: DEFAULT_BPM,
      timeSignature: DEFAULT_TIME_SIGNATURE,
    };
  }

  return changes[findLastChangeIndexByTime(time, changes)];
};

export const getBeatAtTime = (time: number, changes: TimedBpmChange[]) => {
  if (changes.length === 0) {
    return time * (DEFAULT_BPM / 60);
  }

  const activeChange = changes[findLastChangeIndexByTime(time, changes)];
  return activeChange.startBeat + (time - activeChange.time) * (activeChange.bpm / 60);
};

export const getTimeAtBeat = (beat: number, changes: TimedBpmChange[]) => {
  if (changes.length === 0) {
    return beat / (DEFAULT_BPM / 60);
  }

  const activeChange = changes[findLastChangeIndexByBeat(beat, changes)];
  return activeChange.time + (beat - activeChange.startBeat) / (activeChange.bpm / 60);
};

export const formatTime = (time: number, changes: TimedBpmChange[]) => {
  if (!changes || changes.length === 0) return '0:0/4';
  
  const totalBeats = getBeatAtTime(time, changes);
  
  let currentMeasureBeat = 0;
  let measureCount = 0;
  let currentBeatsPerMeasure = 4;
  
  while (measureCount < 10000) {
    const timeAtMeasure = getTimeAtBeat(currentMeasureBeat, changes);
    const activeChange = getActiveChange(timeAtMeasure + 0.001, changes);
    currentBeatsPerMeasure = getBeatsPerMeasure(activeChange.timeSignature);
    
    if (totalBeats < currentMeasureBeat + currentBeatsPerMeasure) {
      break;
    }
    
    currentMeasureBeat += currentBeatsPerMeasure;
    measureCount++;
  }
  
  const beatInMeasure = totalBeats - currentMeasureBeat;
  const roundedBeatInMeasure = Math.round(beatInMeasure);

  if (roundedBeatInMeasure >= currentBeatsPerMeasure) {
    return `${measureCount + 1}:1/${currentBeatsPerMeasure}`;
  }

  return `${measureCount}:${roundedBeatInMeasure + 1}/${currentBeatsPerMeasure}`;
};
