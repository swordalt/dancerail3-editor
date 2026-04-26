import React, { useRef, useState } from 'react';
import { AnimatePresence } from 'motion/react';
import Editor from './Editor';
import LandingPage from './components/LandingPage';
import type { BpmChange, Note, ProjectData, SpeedChange, ViewState } from './types/editorTypes';
import { parseLevelText } from './utils/levelFormat';

const DEFAULT_BPM_CHANGES: BpmChange[] = [{ timepos: 0, bpm: 120, timeSignature: '4/4' }];
const DEFAULT_SPEED_CHANGES: SpeedChange[] = [{ timepos: 0, speedChange: 1 }];
const EXAMPLES = [
  {
    id: 'poppy',
    label: 'Poppy - Tier11 [Official]',
    difficulty: '11',
    levelUrl: new URL('../example/poppy/poppy.11.txt', import.meta.url).href,
    audioUrl: new URL('../example/poppy/poppy.ogg', import.meta.url).href,
    infoUrl: new URL('../example/poppy/info.txt', import.meta.url).href,
    audioFileName: 'poppy.ogg',
  },
  {
    id: 'galaxycollapse',
    label: 'Galaxy Collapse - Tier20 [Official]',
    difficulty: '20',
    levelUrl: new URL('../example/galaxycollapse/galaxycollapse.txt', import.meta.url).href,
    audioUrl: new URL('../example/galaxycollapse/galaxycollapse.mp3', import.meta.url).href,
    infoUrl: new URL('../example/galaxycollapse/info.txt', import.meta.url).href,
    audioFileName: 'galaxycollapse.mp3',
  },
] as const;
const AUDIO_EXTENSIONS = new Set(['aac', 'flac', 'm4a', 'mp3', 'ogg', 'wav', 'webm']);
const IMAGE_EXTENSIONS = new Set(['avif', 'gif', 'jpeg', 'jpg', 'png', 'svg', 'webp']);

const getFileExtension = (fileName: string) => {
  const extension = fileName.split('.').pop()?.toLowerCase();
  return extension && extension !== fileName.toLowerCase() ? extension : '';
};

const getFileBaseName = (fileName: string) => {
  const normalizedName = fileName.split('/').pop() || fileName;
  const extension = getFileExtension(normalizedName);
  return extension ? normalizedName.slice(0, -(extension.length + 1)) : normalizedName;
};

const getZipBaseName = (fileName: string) => (
  fileName.toLowerCase().endsWith('.zip') ? fileName.slice(0, -4) : getFileBaseName(fileName)
);

const getMimeType = (extension: string) => {
  const mimeTypes: Record<string, string> = {
    aac: 'audio/aac',
    avif: 'image/avif',
    flac: 'audio/flac',
    gif: 'image/gif',
    jpeg: 'image/jpeg',
    jpg: 'image/jpeg',
    m4a: 'audio/mp4',
    mp3: 'audio/mpeg',
    ogg: 'audio/ogg',
    png: 'image/png',
    svg: 'image/svg+xml',
    wav: 'audio/wav',
    webm: 'audio/webm',
    webp: 'image/webp',
  };

  return mimeTypes[extension] || 'application/octet-stream';
};

const sortByName = <T extends { name: string }>(files: T[]) => (
  [...files].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
);

const hasDuplicateExtension = (files: { name: string }[]) => {
  const extensionCounts = new Map<string, number>();

  files.forEach((file) => {
    const extension = getFileExtension(file.name);
    if (!extension) return;

    extensionCounts.set(extension, (extensionCounts.get(extension) || 0) + 1);
  });

  return [...extensionCounts.values()].some(count => count > 1);
};

const getDefaultBpmChanges = (): BpmChange[] => DEFAULT_BPM_CHANGES.map(change => ({ ...change }));
const getDefaultSpeedChanges = (): SpeedChange[] => DEFAULT_SPEED_CHANGES.map(change => ({ ...change }));

export default function App() {
  const [view, setView] = useState<ViewState>({ page: 'landing' });
  const [notes, setNotes] = useState<Note[]>([]);
  const [bpmChanges, setBpmChanges] = useState<BpmChange[]>(DEFAULT_BPM_CHANGES);
  const [speedChanges, setSpeedChanges] = useState<SpeedChange[]>(DEFAULT_SPEED_CHANGES);
  const [offset, setOffset] = useState<string | number>(0);
  const [initialProjectData, setInitialProjectData] = useState<ProjectData | null>(null);
  const [isExampleLoading, setIsExampleLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const resetEditorState = () => {
    setNotes([]);
    setBpmChanges(getDefaultBpmChanges());
    setSpeedChanges(getDefaultSpeedChanges());
    setOffset(0);
    setInitialProjectData(null);
  };

  const handleImportClick = () => {
    resetEditorState();
    fileInputRef.current?.click();
  };

  const handleLevelImport = (text: string) => {
    const parsedLevel = parseLevelText(text);

    setNotes(parsedLevel.notes);
    setBpmChanges(parsedLevel.bpmChanges.length > 0 ? parsedLevel.bpmChanges : getDefaultBpmChanges());
    setSpeedChanges(parsedLevel.speedChanges.length > 0 ? parsedLevel.speedChanges : getDefaultSpeedChanges());
    setOffset(parsedLevel.offset);

    return parsedLevel;
  };

  const showZipImportNotice = () => {
    alert('Some files could not be imported automatically. Please import or manage the files yourself in Chart Metadata.');
  };

  const handleZipImport = async (file: File) => {
    try {
      const { default: JSZip } = await import('jszip');
      const zip = await JSZip.loadAsync(file);
      const zipFiles = Object.values(zip.files)
        .filter((entry) => !entry.dir)
        .map((entry) => ({
          entry,
          name: entry.name.split('/').pop() || entry.name,
          extension: getFileExtension(entry.name),
        }));
      const textFiles = sortByName(zipFiles.filter(({ extension }) => extension === 'txt'));
      const audioFiles = sortByName(zipFiles.filter(({ extension }) => AUDIO_EXTENSIONS.has(extension)));
      const imageFiles = sortByName(zipFiles.filter(({ extension }) => IMAGE_EXTENSIONS.has(extension)));
      const chartFiles = textFiles.filter(({ name }) => name.toLowerCase() !== 'info.txt');
      const chartFile = (chartFiles[0] || textFiles[0]) ?? null;
      const audioFileEntry = audioFiles[0] ?? null;
      const imageFileEntry = imageFiles[0] ?? null;
      const infoFile = textFiles.find(({ name }) => name.toLowerCase() === 'info.txt') ?? null;
      const isMissingRequiredFile = !chartFile || !audioFileEntry;
      const hasAmbiguousRequiredFile = hasDuplicateExtension([...textFiles, ...audioFiles]);
      const shouldShowNotice =
        hasAmbiguousRequiredFile ||
        isMissingRequiredFile;

      if (!chartFile) {
        showZipImportNotice();
        return;
      }

      const chartText = await chartFile.entry.async('text');
      const parsedLevel = handleLevelImport(chartText);
      const nextBpmChanges = parsedLevel.bpmChanges.length > 0 ? parsedLevel.bpmChanges : getDefaultBpmChanges();
      const firstBpm = nextBpmChanges[0]?.bpm || 120;
      const zipBaseName = getZipBaseName(file.name);
      const chartBaseName = getFileBaseName(chartFile.name);
      const chartNameParts = chartBaseName.split('.');
      const inferredDifficulty = chartNameParts.length > 1
        ? chartNameParts[chartNameParts.length - 1]
        : chartBaseName;

      if (audioFileEntry) {
        const [audioBlob, imageBlob, infoText] = await Promise.all([
          audioFileEntry.entry.async('blob'),
          imageFileEntry ? imageFileEntry.entry.async('blob') : Promise.resolve(null),
          infoFile ? infoFile.entry.async('text') : Promise.resolve(''),
        ]);
        const audioFile = new File(
          [audioBlob],
          audioFileEntry.name,
          { type: getMimeType(audioFileEntry.extension) },
        );
        const imageFile = imageFileEntry && imageBlob
          ? new File(
              [imageBlob],
              imageFileEntry.name,
              { type: getMimeType(imageFileEntry.extension) },
            )
          : null;
        const [infoTitle = '', infoArtist = '', infoBpm = ''] = infoText
          .split(/\r?\n/)
          .map((line) => line.trim());
        const audioBaseName = getFileBaseName(audioFileEntry.name);
        const songId = audioBaseName.toLowerCase() === 'base' ? zipBaseName : audioBaseName;
        const bpm = parseFloat(infoBpm) || firstBpm;

        setInitialProjectData({
          chartFormat: 'Official',
          songId,
          songName: infoTitle || songId,
          songArtist: infoArtist,
          songBpm: bpm.toString(),
          difficulty: inferredDifficulty || '0',
          songFile: audioFile,
          songIllustration: imageFile,
          bpm,
          audioUrl: URL.createObjectURL(audioFile),
        });
      } else {
        setInitialProjectData(null);
      }

      setView({ page: 'editor', mode: 'import' });

      if (shouldShowNotice) {
        window.setTimeout(showZipImportNotice, 0);
      }
    } catch (error) {
      console.error(error);
      showZipImportNotice();
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      resetEditorState();
      if (file.name.toLowerCase().endsWith('.zip')) {
        void handleZipImport(file);
      } else if (file.name.toLowerCase().endsWith('.txt')) {
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

  const handleExampleSelect = async (exampleId: string) => {
    const example = EXAMPLES.find((entry) => entry.id === exampleId);
    if (!example) return;

    setIsExampleLoading(true);

    try {
      const [levelResponse, infoResponse, audioResponse] = await Promise.all([
        fetch(example.levelUrl),
        fetch(example.infoUrl),
        fetch(example.audioUrl),
      ]);

      if (!levelResponse.ok) {
        throw new Error(`Unable to load example chart: ${levelResponse.status}`);
      }
      if (!infoResponse.ok) {
        throw new Error(`Unable to load example metadata: ${infoResponse.status}`);
      }
      if (!audioResponse.ok) {
        throw new Error(`Unable to load example audio: ${audioResponse.status}`);
      }

      const [text, infoText, audioBlob] = await Promise.all([
        levelResponse.text(),
        infoResponse.text(),
        audioResponse.blob(),
      ]);
      const [exampleName = 'Poppy', exampleArtist = ''] = infoText
        .split(/\r?\n/)
        .map((line) => line.trim());
      const parsedLevel = parseLevelText(text);
      const nextBpmChanges = parsedLevel.bpmChanges.length > 0 ? parsedLevel.bpmChanges : getDefaultBpmChanges();
      const nextSpeedChanges = parsedLevel.speedChanges.length > 0 ? parsedLevel.speedChanges : getDefaultSpeedChanges();
      const exampleBpm = nextBpmChanges[0]?.bpm || 120;
      const exampleAudioFile = new File([audioBlob], example.audioFileName, { type: audioBlob.type || getMimeType(getFileExtension(example.audioFileName)) });

      setNotes(parsedLevel.notes);
      setBpmChanges(nextBpmChanges);
      setSpeedChanges(nextSpeedChanges);
      setOffset(parsedLevel.offset);
      setInitialProjectData({
        chartFormat: 'Official',
        songId: example.id,
        songName: exampleName || example.label,
        songArtist: exampleArtist,
        songBpm: exampleBpm.toString(),
        difficulty: example.difficulty,
        songFile: exampleAudioFile,
        songIllustration: null,
        bpm: exampleBpm,
        audioUrl: example.audioUrl,
      });
      setView({ page: 'editor', mode: 'import' });
    } catch (error) {
      console.error(error);
      alert('The example project could not be loaded.');
    } finally {
      setIsExampleLoading(false);
    }
  };

  return (
    <AnimatePresence mode="wait">
      {view.page === 'landing' ? (
        <LandingPage
          fileInputRef={fileInputRef}
          onCreateProject={() => {
            resetEditorState();
            setView({ page: 'editor', mode: 'new' });
          }}
          onImportClick={handleImportClick}
          examples={EXAMPLES}
          onExampleSelect={handleExampleSelect}
          onFileChange={handleFileChange}
          isExampleLoading={isExampleLoading}
        />
      ) : (
        <Editor 
          onBack={() => setView({ page: 'landing' })} 
          mode={view.mode}
          initialProjectData={initialProjectData}
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
