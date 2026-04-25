export const applyAudioPlaybackSpeed = (audio: HTMLAudioElement, speed: number) => {
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
