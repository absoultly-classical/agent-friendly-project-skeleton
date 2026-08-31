import { useCallback, useEffect, useRef, useState } from "react";

export type LocalRecordingStatus = "idle" | "recording" | "ready" | "error";

const recordingMimeTypes = [
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
  "audio/webm",
];

function chooseMimeType() {
  if (typeof MediaRecorder === "undefined") return "";
  if (typeof MediaRecorder.isTypeSupported !== "function") {
    return "video/webm";
  }
  return recordingMimeTypes.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
}

export function useLocalRecording() {
  const [status, setStatus] = useState<LocalRecordingStatus>("idle");
  const [error, setError] = useState("");
  const [blob, setBlob] = useState<Blob | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const operationRef = useRef(0);

  const reset = useCallback(() => {
    operationRef.current += 1;
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (recorder?.state === "recording") {
      try {
        recorder.stop();
      } catch {
        // The recorder may already have been stopped by the user agent.
      }
    }
    chunksRef.current = [];
    setStatus("idle");
    setError("");
    setBlob(null);
  }, []);

  const start = useCallback((stream: MediaStream | null) => {
    if (recorderRef.current?.state === "recording") return false;
    if (!stream?.getTracks().some((track) => track.readyState !== "ended")) {
      setError("请先开启摄像头或麦克风，再开始录制。");
      setStatus("error");
      return false;
    }
    if (typeof MediaRecorder === "undefined") {
      setError("当前环境不支持本地录制。");
      setStatus("error");
      return false;
    }

    const operation = ++operationRef.current;
    const mimeType = chooseMimeType();
    let recorder: MediaRecorder;
    try {
      recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
    } catch (recordingError) {
      console.error(recordingError);
      setError("无法开始本地录制，请检查媒体设备是否仍然可用。");
      setStatus("error");
      return false;
    }

    chunksRef.current = [];
    setBlob(null);
    setError("");
    recorderRef.current = recorder;
    recorder.ondataavailable = (event) => {
      if (operationRef.current !== operation || event.data.size === 0) return;
      chunksRef.current.push(event.data);
    };
    recorder.onerror = () => {
      if (operationRef.current !== operation) return;
      operationRef.current += 1;
      recorderRef.current = null;
      chunksRef.current = [];
      setError("本地录制发生异常，请重新开始录制。");
      setStatus("error");
    };
    recorder.onstop = () => {
      if (operationRef.current !== operation) return;
      recorderRef.current = null;
      const output = new Blob(chunksRef.current, {
        type: recorder.mimeType || mimeType || "video/webm",
      });
      chunksRef.current = [];
      if (output.size === 0) {
        setError("录制未产生有效媒体内容，请重新开始。");
        setStatus("error");
        return;
      }
      setBlob(output);
      setError("");
      setStatus("ready");
    };
    try {
      recorder.start(1000);
      setStatus("recording");
      return true;
    } catch (recordingError) {
      console.error(recordingError);
      recorderRef.current = null;
      setError("无法开始本地录制，请重新加入会议后重试。");
      setStatus("error");
      return false;
    }
  }, []);

  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state !== "recording") return false;
    try {
      recorder.stop();
      return true;
    } catch (recordingError) {
      console.error(recordingError);
      recorderRef.current = null;
      setError("无法完成本地录制，请重新加入会议后重试。");
      setStatus("error");
      return false;
    }
  }, []);

  useEffect(() => () => {
    operationRef.current += 1;
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (recorder?.state === "recording") {
      try {
        recorder.stop();
      } catch {
        // Cleanup must not block component unmount.
      }
    }
  }, []);

  useEffect(() => {
    const handlePageHide = () => {
      const recorder = recorderRef.current;
      if (!recorder || recorder.state !== "recording") return;
      try {
        recorder.stop();
      } catch {
        recorderRef.current = null;
      }
    };
    window.addEventListener("pagehide", handlePageHide);
    return () => window.removeEventListener("pagehide", handlePageHide);
  }, []);

  return { status, error, blob, start, stop, reset };
}
