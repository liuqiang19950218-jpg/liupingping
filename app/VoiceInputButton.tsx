"use client";

import { useEffect, useRef, useState } from "react";
import { appendVoiceTranscript, speechRecognitionConstructor, voiceErrorMessage, type SpeechRecognitionLike } from "../lib/voice-input";
import "./voice-input.css";

declare global {
  interface Window {
    SpeechRecognition?: import("../lib/voice-input").SpeechRecognitionConstructor;
    webkitSpeechRecognition?: import("../lib/voice-input").SpeechRecognitionConstructor;
  }
}

export function VoiceInputButton({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const [recording, setRecording] = useState(false);
  const [message, setMessage] = useState("");
  const stop = () => { recognitionRef.current?.stop(); recognitionRef.current = null; setRecording(false); };
  useEffect(() => () => recognitionRef.current?.stop(), []);
  const toggle = () => {
    if (recognitionRef.current) return stop();
    const Recognition = speechRecognitionConstructor(window);
    if (!Recognition) return setMessage("当前浏览器暂不支持语音输入，请使用键盘填写。");
    const recognition = new Recognition();
    let transcript = "";
    recognition.lang = "zh-CN";
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onresult = (event) => { for (let index = event.resultIndex; index < event.results.length; index += 1) if (event.results[index].isFinal) transcript += event.results[index][0].transcript; };
    recognition.onerror = (event) => setMessage(voiceErrorMessage(event.error));
    recognition.onend = () => { if (transcript.trim()) onChange(appendVoiceTranscript(value, transcript)); recognitionRef.current = null; setRecording(false); };
    try { recognition.start(); recognitionRef.current = recognition; setRecording(true); setMessage(""); } catch { setMessage("语音识别暂时不可用，请重试。"); }
  };
  return <span className="voice-input-control"><button type="button" className={`voice-input-button${recording ? " is-recording" : ""}`} onClick={toggle} aria-pressed={recording} aria-label={recording ? "停止语音输入" : "语音输入"}><span aria-hidden="true">🎤</span>{recording ? "正在听…" : "语音输入"}</button>{message && <small className="voice-input-hint" role="status">{message}</small>}</span>;
}
