export type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((event: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
};

export type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

export const appendVoiceTranscript = (value: string, transcript: string) => {
  const finalTranscript = transcript.trim();
  return finalTranscript ? (value.trim() ? `${value}\n${finalTranscript}` : finalTranscript) : value;
};

export const voiceErrorMessage = (error: string) => ({
  "not-allowed": "无法使用麦克风，请检查浏览器麦克风权限。",
  "audio-capture": "无法访问麦克风，请检查设备后重试。",
  "no-speech": "未识别到语音，请重试。",
  network: "语音识别暂时不可用，请检查网络后重试。",
  aborted: "语音识别已停止。",
}[error] ?? "语音识别暂时不可用，请重试。");

export const speechRecognitionConstructor = (target: Window): SpeechRecognitionConstructor | null => target.SpeechRecognition ?? target.webkitSpeechRecognition ?? null;
