import type { BpmChange, TimedBpmChange } from '../types/editorTypes';

export const convertBpmChangesToTime = (changes: BpmChange[]): TimedBpmChange[] => {
  const sortedChanges = [...changes].sort((a, b) => (a.measure - b.measure) || (a.beat - b.beat));
  const timeChanges: TimedBpmChange[] = [];
  
  let currentTime = 0;
  let lastMeasure = 0;
  let lastBeat = 0;
  let lastBpm = 120;
  let lastTimeSignature = '4/4';
  
  for (const change of sortedChanges) {
    const beatsPerMeasure = parseInt(lastTimeSignature.split('/')[0]) || 4;
    const beatsToNextChange = (change.measure - lastMeasure) * beatsPerMeasure + (change.beat - lastBeat);
    
    currentTime += beatsToNextChange * (60 / lastBpm);
    
    timeChanges.push({time: currentTime, bpm: change.bpm, timeSignature: change.timeSignature});
    
    lastMeasure = change.measure;
    lastBeat = change.beat;
    lastBpm = change.bpm;
    lastTimeSignature = change.timeSignature;
  }
  
  return timeChanges;
};

export const getActiveChange = (time: number, changes: TimedBpmChange[]) => {
  const sortedChanges = [...changes].sort((a, b) => a.time - b.time);
  let activeChange = sortedChanges[0];
  for (const change of sortedChanges) {
    if (time >= change.time) {
      activeChange = change;
    } else {
      break;
    }
  }
  return activeChange;
};

export const getBeatAtTime = (time: number, changes: TimedBpmChange[]) => {
  const sortedChanges = [...changes].sort((a, b) => a.time - b.time);
  let accumulatedBeats = 0;
  let lastTime = 0;
  
  for (const change of sortedChanges) {
    if (time <= change.time) {
      const bpm = getActiveChange(lastTime, sortedChanges).bpm;
      accumulatedBeats += (time - lastTime) * (bpm / 60);
      return accumulatedBeats;
    } else {
      const bpm = getActiveChange(lastTime, sortedChanges).bpm;
      accumulatedBeats += (change.time - lastTime) * (bpm / 60);
      lastTime = change.time;
    }
  }
  
  const bpm = getActiveChange(lastTime, sortedChanges).bpm;
  accumulatedBeats += (time - lastTime) * (bpm / 60);
  return accumulatedBeats;
};

export const getTimeAtBeat = (beat: number, changes: TimedBpmChange[]) => {
  const sortedChanges = [...changes].sort((a, b) => a.time - b.time);
  let accumulatedBeats = 0;
  let lastTime = 0;
  
  for (const change of sortedChanges) {
    const bpm = getActiveChange(lastTime, sortedChanges).bpm;
    const beatsInInterval = (change.time - lastTime) * (bpm / 60);
    
    if (beat <= accumulatedBeats + beatsInInterval) {
      return lastTime + (beat - accumulatedBeats) / (bpm / 60);
    }
    
    accumulatedBeats += beatsInInterval;
    lastTime = change.time;
  }
  
  const bpm = getActiveChange(lastTime, sortedChanges).bpm;
  return lastTime + (beat - accumulatedBeats) / (bpm / 60);
};

export const formatTime = (time: number, changes: TimedBpmChange[]) => {
  if (!changes || changes.length === 0) return '0:0.00/4';
  
  const totalBeats = getBeatAtTime(time, changes);
  
  let currentMeasureBeat = 0;
  let measureCount = 0;
  let currentBeatsPerMeasure = 4;
  
  while (measureCount < 10000) {
    const timeAtMeasure = getTimeAtBeat(currentMeasureBeat, changes);
    const activeChange = getActiveChange(timeAtMeasure + 0.001, changes);
    currentBeatsPerMeasure = parseInt(activeChange.timeSignature.split('/')[0]) || 4;
    
    if (totalBeats < currentMeasureBeat + currentBeatsPerMeasure) {
      break;
    }
    
    currentMeasureBeat += currentBeatsPerMeasure;
    measureCount++;
  }
  
  const beatInMeasure = totalBeats - currentMeasureBeat;
  return `${measureCount}:${beatInMeasure.toFixed(2)}/${currentBeatsPerMeasure}`;
};
