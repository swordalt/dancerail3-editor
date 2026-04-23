import React, { useRef, useState } from 'react';
import { AnimatePresence } from 'motion/react';
import Editor from './Editor';
import LandingPage from './components/LandingPage';
import type { BpmChange, Note, SpeedChange, ViewState } from './types/editorTypes';
import { parseLevelText } from './utils/levelFormat';

const DEFAULT_BPM_CHANGES: BpmChange[] = [{ measure: 0, beat: 0, bpm: 120, timeSignature: '4/4' }];
const DEFAULT_SPEED_CHANGES: SpeedChange[] = [{ measure: 0, beat: 0, speedChange: 1 }];

export default function App() {
  const [view, setView] = useState<ViewState>({ page: 'landing' });
  const [notes, setNotes] = useState<Note[]>([]);
  const [bpmChanges, setBpmChanges] = useState<BpmChange[]>(DEFAULT_BPM_CHANGES);
  const [speedChanges, setSpeedChanges] = useState<SpeedChange[]>(DEFAULT_SPEED_CHANGES);
  const [offset, setOffset] = useState<string | number>(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleLevelImport = (text: string) => {
    const parsedLevel = parseLevelText(text);

    setNotes(parsedLevel.notes);
    setBpmChanges(parsedLevel.bpmChanges.length > 0 ? parsedLevel.bpmChanges : DEFAULT_BPM_CHANGES);
    setSpeedChanges(parsedLevel.speedChanges.length > 0 ? parsedLevel.speedChanges : DEFAULT_SPEED_CHANGES);
    setOffset(parsedLevel.offset);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.name.endsWith('.txt')) {
        const reader = new FileReader();
        reader.onload = (e) => {
          handleLevelImport(e.target?.result as string);
          setView({page: 'editor', mode: 'import'});
        };
        reader.readAsText(file);
      } else {
        console.log('Selected file:', file.name);
        setView({page: 'editor', mode: 'import'});
      }
    }
    // Reset input so the same file can be selected again if needed
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <AnimatePresence mode="wait">
      {view.page === 'landing' ? (
        <LandingPage
          fileInputRef={fileInputRef}
          onCreateProject={() => setView({ page: 'editor', mode: 'new' })}
          onImportClick={handleImportClick}
          onFileChange={handleFileChange}
        />
      ) : (
        <Editor 
          onBack={() => setView({ page: 'landing' })} 
          mode={view.mode}
          notes={notes}
          setNotes={setNotes}
          bpmChanges={bpmChanges}
          setBpmChanges={setBpmChanges}
          speedChanges={speedChanges}
          setSpeedChanges={setSpeedChanges}
          offset={offset}
          setOffset={setOffset}
        />
      )}
    </AnimatePresence>
  );
}
