import { buildLevelText } from '../utils/levelFormat';
import { createZipBuffer } from '../utils/zipExport';
import type { ExportWorkerPayload, ExportWorkerRequest, ExportWorkerResponse } from '../types/exportTypes';
import type { BpmChange } from '../types/editorTypes';

const getFileExtension = (file: File) => {
  const extension = file.name.split('.').pop();
  return extension && extension !== file.name ? extension : 'bin';
};

const getFirstBpm = (bpmChanges: BpmChange[], fallbackBpm: number | undefined) => {
  const firstChange = [...bpmChanges]
    .sort((a, b) => (a.measure - b.measure) || (a.beat - b.beat))[0];

  return firstChange?.bpm ?? fallbackBpm ?? 120;
};

const createExportZip = async (payload: ExportWorkerPayload) => {
  const { format, projectData, notes, bpmChanges, speedChanges, offset } = payload;

  if (!projectData.songFile) {
    throw new Error('Cannot export without a song file.');
  }

  const songId = projectData.songId || 'level';
  const difficulty = projectData.difficulty || '0';
  const chartText = buildLevelText({
    projectData,
    notes,
    bpmChanges,
    speedChanges,
    offset,
  });

  if (format === 'dr3-viewer') {
    const entries = [
      {
        name: `${songId}.${difficulty}.txt`,
        data: chartText,
      },
      {
        name: `${songId}.${getFileExtension(projectData.songFile)}`,
        data: projectData.songFile,
      },
    ];

    if (projectData.songIllustration) {
      entries.push({
        name: `${songId}.${getFileExtension(projectData.songIllustration)}`,
        data: projectData.songIllustration,
      });
    }

    return {
      zipBuffer: await createZipBuffer(entries),
      suggestedName: `${songId}.${difficulty}.zip`,
    };
  }

  const infoText = `${projectData.songName || ''}\n${projectData.songArtist || ''}\n${getFirstBpm(bpmChanges, projectData.bpm)}\n`;
  const entries = [
    {
      name: 'info.txt',
      data: infoText,
    },
    {
      name: `${difficulty}.txt`,
      data: chartText,
    },
    {
      name: `base.${getFileExtension(projectData.songFile)}`,
      data: projectData.songFile,
    },
  ];

  if (projectData.songIllustration) {
    entries.push({
      name: `base.${getFileExtension(projectData.songIllustration)}`,
      data: projectData.songIllustration,
    });
  }

  return {
    zipBuffer: await createZipBuffer(entries),
    suggestedName: `${songId}.zip`,
  };
};

self.onmessage = async (event: MessageEvent<ExportWorkerRequest>) => {
  const request = event.data;

  if (request.type === 'warmup') {
    return;
  }

  try {
    const result = await createExportZip(request.payload);
    const response: ExportWorkerResponse = {
      requestId: request.requestId,
      ok: true,
      ...result,
    };

    self.postMessage(response, [result.zipBuffer]);
  } catch (err) {
    const response: ExportWorkerResponse = {
      requestId: request.requestId,
      ok: false,
      error: err instanceof Error ? err.message : 'Export worker failed',
    };

    self.postMessage(response);
  }
};
