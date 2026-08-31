import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  FakeMediaRecorder,
  FakeMediaStream,
  FakeMediaStreamTrack,
} from "../test/setup";
import { useLocalRecording } from "./use-local-recording";

describe("useLocalRecording", () => {
  it("会使用当前媒体流生成可下载 Blob", () => {
    const stream = new FakeMediaStream([
      new FakeMediaStreamTrack("audio"),
      new FakeMediaStreamTrack("video"),
    ]);
    const recording = renderHook(() => useLocalRecording());

    let started = false;
    act(() => {
      started = recording.result.current.start(stream as unknown as MediaStream);
    });
    expect(started).toBe(true);
    expect(recording.result.current.status).toBe("recording");
    expect(FakeMediaRecorder.instances).toHaveLength(1);
    expect(FakeMediaRecorder.instances[0]?.start).toHaveBeenCalledWith(1000);

    act(() => {
      recording.result.current.stop();
    });
    expect(recording.result.current.status).toBe("ready");
    expect(recording.result.current.blob?.type).toBe("video/webm");
    expect(recording.result.current.blob?.size).toBeGreaterThan(0);
  });

  it("没有有效媒体轨道时拒绝开始录制", () => {
    const stream = new FakeMediaStream([
      new FakeMediaStreamTrack("video"),
    ]);
    stream.getTracks()[0]?.stop();
    const recording = renderHook(() => useLocalRecording());

    let started = true;
    act(() => {
      started = recording.result.current.start(stream as unknown as MediaStream);
    });

    expect(started).toBe(false);
    expect(recording.result.current.status).toBe("error");
    expect(recording.result.current.error).toContain("先开启摄像头或麦克风");
    expect(FakeMediaRecorder.instances).toHaveLength(0);
  });

  it("当前环境不支持 MediaRecorder 时给出明确错误", () => {
    const original = globalThis.MediaRecorder;
    Object.defineProperty(globalThis, "MediaRecorder", {
      configurable: true,
      value: undefined,
    });
    try {
      const stream = new FakeMediaStream([new FakeMediaStreamTrack("audio")]);
      const recording = renderHook(() => useLocalRecording());
      let started = true;
      act(() => {
        started = recording.result.current.start(stream as unknown as MediaStream);
      });
      expect(started).toBe(false);
      expect(recording.result.current.error).toContain("不支持本地录制");
    } finally {
      Object.defineProperty(globalThis, "MediaRecorder", {
        configurable: true,
        value: original,
      });
    }
  });

  it("组件卸载时会停止正在录制的 MediaRecorder", () => {
    const stream = new FakeMediaStream([new FakeMediaStreamTrack("audio")]);
    const recording = renderHook(() => useLocalRecording());

    act(() => {
      recording.result.current.start(stream as unknown as MediaStream);
    });
    recording.unmount();

    expect(FakeMediaRecorder.instances[0]?.stop).toHaveBeenCalledOnce();
  });

  it("页面离开时会停止正在录制的 MediaRecorder", () => {
    const stream = new FakeMediaStream([new FakeMediaStreamTrack("audio")]);
    const recording = renderHook(() => useLocalRecording());

    act(() => {
      recording.result.current.start(stream as unknown as MediaStream);
      window.dispatchEvent(new Event("pagehide"));
    });

    expect(FakeMediaRecorder.instances[0]?.stop).toHaveBeenCalledOnce();
  });
});
