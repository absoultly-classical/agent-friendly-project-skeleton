import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  createRandomIdentifier,
  MAX_PENDING_ICE_CANDIDATES,
  normalizeRoomId,
  useLocalWebRTC,
} from "./use-local-webrtc";
import {
  FakeBroadcastChannel,
  FakeMediaStream,
  FakeMediaStreamTrack,
  FakePeerConnection,
  broadcastToRoom,
  dispatchDeviceChange,
  enumerateDevicesMock,
  getDisplayMediaMock,
  getUserMediaMock,
} from "../test/setup";

async function join(result: ReturnType<typeof renderMeetingHook>["result"]) {
  await act(async () => {
    await result.current.join();
  });
}

function renderMeetingHook() {
  return renderHook(() => useLocalWebRTC());
}

async function connectTwoMeetings(room = "821406233") {
  const first = renderMeetingHook();
  const second = renderMeetingHook();

  act(() => {
    first.result.current.setRoomId(room);
    second.result.current.setRoomId(room);
  });
  await join(first.result);
  await join(second.result);
  await waitFor(() => {
    expect(first.result.current.status).toBe("connected");
    expect(second.result.current.status).toBe("connected");
  });

  return { first, second };
}

describe("useLocalWebRTC", () => {
  it("只归一化房间号分隔符并拒绝其他字符", () => {
    expect(normalizeRoomId("999 888-777")).toBe("999888777");
    expect(normalizeRoomId("123abc456")).toBe("");
    expect(normalizeRoomId("123_456" as string)).toBe("");
  });

  it("在调用媒体设备前拒绝无效房间号", async () => {
    const meeting = renderMeetingHook();
    act(() => meeting.result.current.setRoomId("12"));

    await join(meeting.result);

    expect(meeting.result.current.status).toBe("error");
    expect(meeting.result.current.error).toContain("至少 6 位");
    expect(getUserMediaMock).not.toHaveBeenCalled();
  });

  it("加入成功后会把带分隔符的房间号回写为规范值", async () => {
    const meeting = renderMeetingHook();
    act(() => meeting.result.current.setRoomId("765-432 1"));

    await join(meeting.result);

    expect(meeting.result.current.roomId).toBe("7654321");
    expect(meeting.result.current.status).toBe("waiting");
  });

  it("将媒体权限失败转换为可见错误状态", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    getUserMediaMock.mockRejectedValueOnce(
      new DOMException("permission denied", "NotAllowedError"),
    );
    const meeting = renderMeetingHook();

    await join(meeting.result);

    expect(meeting.result.current.status).toBe("error");
    expect(meeting.result.current.error).toContain("摄像头或麦克风");
    expect(meeting.result.current.localStream).toBeNull();
  });

  it("加入房间后采集音视频并等待同房间成员", async () => {
    const meeting = renderMeetingHook();

    await join(meeting.result);

    expect(meeting.result.current.status).toBe("waiting");
    expect(meeting.result.current.localStream?.getAudioTracks()).toHaveLength(1);
    expect(meeting.result.current.localStream?.getVideoTracks()).toHaveLength(1);
    expect(getUserMediaMock).toHaveBeenCalledWith({
      audio: true,
      video: { width: { ideal: 1280 }, height: { ideal: 720 } },
    });
  });

  it("离会重入时会轮换 peer 标识", async () => {
    const meeting = renderMeetingHook();
    const postMessage = vi.spyOn(
      (window.BroadcastChannel as unknown as typeof FakeBroadcastChannel).prototype,
      "postMessage",
    );

    await join(meeting.result);
    const firstHello = postMessage.mock.calls
      .map(([message]) => message as { type?: string; from?: string })
      .find((message) => message.type === "hello")?.from;
    expect(firstHello).toBeTruthy();

    act(() => meeting.result.current.leave());
    postMessage.mockClear();
    await join(meeting.result);
    const secondHello = postMessage.mock.calls
      .map(([message]) => message as { type?: string; from?: string })
      .find((message) => message.type === "hello")?.from;

    expect(secondHello).toBeTruthy();
    expect(secondHello).not.toBe(firstHello);
  });

  it("同房间的两个会话自动完成 offer/answer 协商", async () => {
    const { first, second } = await connectTwoMeetings();

    expect(first.result.current.status).toBe("connected");
    expect(second.result.current.status).toBe("connected");
    expect(FakePeerConnection.instances).toHaveLength(2);
    expect(
      FakePeerConnection.instances.map((peer) => peer.localDescription?.type),
    ).toEqual(expect.arrayContaining(["offer", "answer"]));
  });

  it("重复的远端 offer 只会生成一次 answer", async () => {
    const meeting = renderMeetingHook();
    await join(meeting.result);
    const postMessage = vi.spyOn(
      (window.BroadcastChannel as unknown as typeof FakeBroadcastChannel).prototype,
      "postMessage",
    );

    broadcastToRoom("learning-meeting:821406233", {
      type: "offer",
      from: "repeat-offer-peer",
      description: { type: "offer", sdp: "offer:repeat" },
    });
    broadcastToRoom("learning-meeting:821406233", {
      type: "offer",
      from: "repeat-offer-peer",
      description: { type: "offer", sdp: "offer:repeat" },
    });

    await waitFor(() => {
      const answers = postMessage.mock.calls.filter(
        ([message]) =>
          (message as { type?: string }).type === "answer",
      );
      expect(answers).toHaveLength(1);
    });
  });

  it("重复的远端 answer 不会再次设置远端描述", async () => {
    const postMessage = vi.spyOn(
      (window.BroadcastChannel as unknown as typeof FakeBroadcastChannel).prototype,
      "postMessage",
    );
    const setRemoteDescription = vi.spyOn(
      FakePeerConnection.prototype,
      "setRemoteDescription",
    );
    const { first } = await connectTwoMeetings("246813579");
    const answer = postMessage.mock.calls
      .map(([message]) => message as { type?: string; target?: string })
      .find((message) => message.type === "answer");
    expect(answer).toBeTruthy();
    const callsBefore = setRemoteDescription.mock.calls.length;

    broadcastToRoom("learning-meeting:246813579", answer);
    broadcastToRoom("learning-meeting:246813579", answer);
    await act(async () => {
      await Promise.resolve();
    });

    expect(setRemoteDescription.mock.calls.length).toBe(callsBefore);
    expect(first.result.current.status).toBe("connected");
  });

  it("信令入队后远端身份变化时会丢弃旧来源消息", async () => {
    const meeting = renderMeetingHook();
    await join(meeting.result);
    const setRemoteDescription = vi.spyOn(
      FakePeerConnection.prototype,
      "setRemoteDescription",
    );

    broadcastToRoom("learning-meeting:821406233", {
      type: "hello",
      from: "peer-a",
    });
    broadcastToRoom("learning-meeting:821406233", {
      type: "offer",
      from: "peer-b",
      description: { type: "offer", sdp: "offer:stale-queue" },
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(setRemoteDescription).not.toHaveBeenCalledWith(
      expect.objectContaining({ sdp: "offer:stale-queue" }),
    );
    expect(meeting.result.current.error).toBe("");
  });

  it("连接失败会清理旧 peer 并进入可重新加入状态", async () => {
    const { first } = await connectTwoMeetings();
    const oldPeer = FakePeerConnection.instances[0];
    const localTracks = first.result.current.localStream
      ?.getTracks() as unknown as FakeMediaStreamTrack[];

    await act(async () => {
      await first.result.current.toggleSharing();
    });
    const screenStream = await getDisplayMediaMock.mock.results[0].value;
    const screenTrack = screenStream.getVideoTracks()[0] as FakeMediaStreamTrack;

    act(() => {
      oldPeer.connectionState = "failed";
      oldPeer.onconnectionstatechange?.();
    });

    expect(oldPeer.connectionState).toBe("closed");
    expect(first.result.current.status).toBe("error");
    expect(first.result.current.error).toContain("连接已断开");
    expect(first.result.current.remoteStream).toBeNull();
    expect(first.result.current.localStream).toBeNull();
    expect(localTracks.every((track) => track.stopped)).toBe(true);
    expect(first.result.current.sharing).toBe(false);
    expect(screenTrack.stopped).toBe(true);

    await join(first.result);
    await waitFor(() => expect(first.result.current.status).toBe("connected"));
    expect(FakePeerConnection.instances.length).toBeGreaterThan(2);
  });

  it("连接建立后会忽略其他同房间对端的干扰信令", async () => {
    const { first, second } = await connectTwoMeetings();

    broadcastToRoom("learning-meeting:821406233", {
      type: "offer",
      from: "unexpected-peer",
      description: { type: "offer", sdp: "offer:unexpected" },
    });
    broadcastToRoom("learning-meeting:821406233", {
      type: "leave",
      from: "unexpected-peer",
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(first.result.current.status).toBe("connected");
    expect(second.result.current.status).toBe("connected");
    expect(first.result.current.error).toBe("");
    expect(second.result.current.error).toBe("");
  });

  it("ICE 候选早于远端描述到达时会暂存并在协商后应用", async () => {
    const first = renderMeetingHook();
    act(() => first.result.current.setRoomId("7654321"));
    await join(first.result);

    broadcastToRoom("learning-meeting:7654321", {
      type: "ice",
      from: "remote-peer",
      candidate: {
        candidate: "candidate:out-of-order",
        sdpMid: "0",
        sdpMLineIndex: 0,
      },
    });
    await act(async () => {
      await Promise.resolve();
    });

    broadcastToRoom("learning-meeting:7654321", {
      type: "offer",
      from: "remote-peer",
      description: { type: "offer", sdp: "offer:remote-peer" },
    });

    const firstPeer = FakePeerConnection.instances[0];
    await waitFor(() =>
      expect(firstPeer.addedIceCandidates).toEqual([
        {
          candidate: "candidate:out-of-order",
          sdpMid: "0",
          sdpMLineIndex: 0,
        },
      ]),
    );
  });

  it("待处理 ICE 只会应用到发送它的对端", async () => {
    const meeting = renderMeetingHook();
    await join(meeting.result);

    broadcastToRoom("learning-meeting:821406233", {
      type: "ice",
      from: "stale-peer",
      candidate: { candidate: "candidate:stale", sdpMLineIndex: 0 },
    });
    broadcastToRoom("learning-meeting:821406233", {
      type: "ice",
      from: "fresh-peer",
      candidate: { candidate: "candidate:fresh", sdpMLineIndex: 0 },
    });
    broadcastToRoom("learning-meeting:821406233", {
      type: "offer",
      from: "fresh-peer",
      description: { type: "offer", sdp: "offer:fresh-peer" },
    });

    await waitFor(() => expect(FakePeerConnection.instances).toHaveLength(1));
    const peer = FakePeerConnection.instances[0];
    await waitFor(() =>
      expect(peer.addedIceCandidates).toEqual([
        { candidate: "candidate:fresh", sdpMLineIndex: 0 },
      ]),
    );
  });

  it("待处理 ICE 队列有上限并丢弃最早的候选", async () => {
    const meeting = renderMeetingHook();
    await join(meeting.result);

    for (let index = 0; index < MAX_PENDING_ICE_CANDIDATES + 2; index += 1) {
      broadcastToRoom("learning-meeting:821406233", {
        type: "ice",
        from: "bounded-peer",
        candidate: {
          candidate: `candidate:bounded-${index}`,
          sdpMLineIndex: 0,
        },
      });
    }
    broadcastToRoom("learning-meeting:821406233", {
      type: "offer",
      from: "bounded-peer",
      description: { type: "offer", sdp: "offer:bounded-peer" },
    });

    await waitFor(() => expect(FakePeerConnection.instances).toHaveLength(1));
    const peer = FakePeerConnection.instances[0];
    await waitFor(() =>
      expect(peer.addedIceCandidates).toHaveLength(MAX_PENDING_ICE_CANDIDATES),
    );
    expect(peer.addedIceCandidates[0]?.candidate).toBe(
      "candidate:bounded-2",
    );
  });

  it("远端离会后不会把旧的待处理 ICE 带入新连接", async () => {
    const first = renderMeetingHook();
    await join(first.result);

    const staleCandidate = {
      candidate: "candidate:stale-after-leave",
      sdpMid: "0",
      sdpMLineIndex: 0,
    };
    broadcastToRoom("learning-meeting:821406233", {
      type: "ice",
      from: "remote-peer",
      candidate: staleCandidate,
    });
    await act(async () => {
      await Promise.resolve();
    });

    broadcastToRoom("learning-meeting:821406233", {
      type: "leave",
      from: "remote-peer",
    });
    await act(async () => {
      await Promise.resolve();
    });

    const second = renderMeetingHook();
    await join(second.result);
    await waitFor(() => {
      expect(first.result.current.status).toBe("connected");
      expect(second.result.current.status).toBe("connected");
    });

    const freshPeer = FakePeerConnection.instances.at(-1);
    expect(freshPeer?.addedIceCandidates).not.toContainEqual(staleCandidate);
  });

  it("畸形 WebRTC 信令会被忽略而不会破坏当前会话", async () => {
    const meeting = renderMeetingHook();
    await join(meeting.result);

    broadcastToRoom("learning-meeting:821406233", null);
    broadcastToRoom("learning-meeting:821406233", {
      type: "offer",
      from: "malformed-offer",
      description: "not-a-description",
    });
    broadcastToRoom("learning-meeting:821406233", {
      type: "ice",
      from: "malformed-ice",
      candidate: "not-a-candidate",
    });
    broadcastToRoom("learning-meeting:821406233", {
      type: "leave",
      from: 123,
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(meeting.result.current.status).toBe("waiting");
    expect(meeting.result.current.error).toBe("");
  });

  it("超大 WebRTC 信令会被忽略而不会交给 peer", async () => {
    const meeting = renderMeetingHook();
    await join(meeting.result);
    const setRemoteDescription = vi.spyOn(
      FakePeerConnection.prototype,
      "setRemoteDescription",
    );

    broadcastToRoom("learning-meeting:821406233", {
      type: "offer",
      from: "oversized-sdp-peer",
      description: { type: "offer", sdp: "x".repeat(200001) },
    });
    broadcastToRoom("learning-meeting:821406233", {
      type: "ice",
      from: "oversized-candidate-peer",
      candidate: { candidate: "x".repeat(4097) },
    });
    broadcastToRoom("learning-meeting:821406233", {
      type: "hello",
      from: "x".repeat(129),
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(setRemoteDescription).not.toHaveBeenCalled();
    expect(meeting.result.current.status).toBe("waiting");
  });

  it("协商失败会清理当前资源，并允许重新加入", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const meeting = renderMeetingHook();
    await join(meeting.result);
    const stream = meeting.result.current.localStream as unknown as FakeMediaStream;
    const tracks = stream.getTracks();
    const setRemoteDescription = vi.spyOn(
      FakePeerConnection.prototype,
      "setRemoteDescription",
    );
    setRemoteDescription.mockRejectedValueOnce(new Error("bad description"));

    broadcastToRoom("learning-meeting:821406233", {
      type: "offer",
      from: "failed-peer",
      description: { type: "offer", sdp: "offer:failed" },
    });

    await waitFor(() => {
      expect(meeting.result.current.status).toBe("error");
      expect(meeting.result.current.error).toContain("连接协商失败");
    });
    expect(meeting.result.current.localStream).toBeNull();
    expect(tracks.every((track) => track.stopped)).toBe(true);
    expect(FakePeerConnection.instances.at(-1)?.connectionState).toBe("closed");

    await join(meeting.result);
    expect(meeting.result.current.status).toBe("waiting");
    expect(meeting.result.current.error).toBe("");
  });

  it("旧协商在离会并重新加入后失败不会覆盖新会话", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const meeting = renderMeetingHook();
    await join(meeting.result);
    let rejectDescription!: (error: Error) => void;
    const pendingDescription = new Promise<void>((_, reject) => {
      rejectDescription = reject;
    });
    const setRemoteDescription = vi.spyOn(
      FakePeerConnection.prototype,
      "setRemoteDescription",
    );
    setRemoteDescription.mockImplementationOnce(async () => pendingDescription);

    broadcastToRoom("learning-meeting:821406233", {
      type: "offer",
      from: "stale-peer",
      description: { type: "offer", sdp: "offer:stale" },
    });
    await waitFor(() => expect(setRemoteDescription).toHaveBeenCalled());

    act(() => meeting.result.current.leave());
    await join(meeting.result);
    rejectDescription(new Error("stale description failed"));
    await act(async () => {
      await Promise.resolve();
    });

    expect(meeting.result.current.status).toBe("waiting");
    expect(meeting.result.current.error).toBe("");
    expect(meeting.result.current.localStream).not.toBeNull();
  });

  it("离会重入后会忽略旧 peer 的连接状态和 ICE 回调", async () => {
    const meeting = renderMeetingHook();
    await join(meeting.result);
    broadcastToRoom("learning-meeting:821406233", {
      type: "offer",
      from: "stale-peer-callback",
      description: { type: "offer", sdp: "offer:stale-callback" },
    });
    await waitFor(() => expect(FakePeerConnection.instances).toHaveLength(1));
    const oldPeer = FakePeerConnection.instances[0];
    const channelConstructor = window.BroadcastChannel as unknown as {
      prototype: { postMessage: (message: unknown) => void };
    };
    const postMessage = vi.spyOn(channelConstructor.prototype, "postMessage");

    act(() => meeting.result.current.leave());
    await join(meeting.result);
    postMessage.mockClear();

    act(() => {
      oldPeer.connectionState = "connected";
      oldPeer.onconnectionstatechange?.();
      oldPeer.onicecandidate?.({
        candidate: {
          candidate: "candidate:stale",
          sdpMLineIndex: 0,
        },
      } as unknown as RTCPeerConnectionIceEvent);
    });

    expect(meeting.result.current.status).toBe("waiting");
    expect(postMessage).not.toHaveBeenCalled();
  });

  it("协商失败会通知对端清理连接并回到等待状态", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const first = renderMeetingHook();
    const second = renderMeetingHook();
    const room = "864209753";
    act(() => {
      first.result.current.setRoomId(room);
      second.result.current.setRoomId(room);
    });
    await join(first.result);
    const setRemoteDescription = vi.spyOn(
      FakePeerConnection.prototype,
      "setRemoteDescription",
    );
    setRemoteDescription.mockRejectedValueOnce(new Error("bad description"));

    await join(second.result);
    await waitFor(() => {
      expect([first.result.current.status, second.result.current.status]).toContain(
        "error",
      );
      expect([first.result.current.status, second.result.current.status]).toContain(
        "waiting",
      );
    });
    expect(first.result.current.status).not.toBe(second.result.current.status);
  });

  it("远端最后一条媒体轨道结束后会清空远端流", async () => {
    const { first } = await connectTwoMeetings();
    const peer = FakePeerConnection.instances[0];
    const remoteTrack = new FakeMediaStreamTrack("video", "remote-camera");
    const remoteStream = new FakeMediaStream([remoteTrack]);

    act(() => {
      peer.ontrack?.({
        track: remoteTrack,
        streams: [remoteStream],
      } as unknown as RTCTrackEvent);
    });
    expect(first.result.current.remoteStream).toBe(remoteStream);

    act(() => remoteTrack.end());
    expect(first.result.current.remoteStream).toBeNull();
  });

  it("不同房间保持隔离，不创建点对点连接", async () => {
    const first = renderMeetingHook();
    const second = renderMeetingHook();
    act(() => second.result.current.setRoomId("999999999"));

    await join(first.result);
    await join(second.result);
    await act(async () => Promise.resolve());

    expect(first.result.current.status).toBe("waiting");
    expect(second.result.current.status).toBe("waiting");
    expect(FakePeerConnection.instances).toHaveLength(0);
  });

  it("静音和关闭摄像头直接修改本地轨道", async () => {
    const meeting = renderMeetingHook();
    await join(meeting.result);
    const audioTrack = meeting.result.current.localStream
      ?.getAudioTracks()[0] as unknown as FakeMediaStreamTrack;
    const videoTrack = meeting.result.current.localStream
      ?.getVideoTracks()[0] as unknown as FakeMediaStreamTrack;

    act(() => {
      meeting.result.current.toggleMic();
      meeting.result.current.toggleCamera();
    });

    expect(audioTrack.enabled).toBe(false);
    expect(videoTrack.enabled).toBe(false);
    expect(meeting.result.current.micOn).toBe(false);
    expect(meeting.result.current.cameraOn).toBe(false);
  });

  it("设备变化会刷新设备列表并移除已不存在的选择", async () => {
    const meeting = renderMeetingHook();
    await join(meeting.result);

    await act(async () => {
      await meeting.result.current.switchCamera("camera-secondary");
    });
    expect(meeting.result.current.cameraId).toBe("camera-secondary");

    enumerateDevicesMock.mockResolvedValueOnce([
      { deviceId: "camera-default", kind: "videoinput", label: "新摄像头" },
      {
        deviceId: "microphone-default",
        kind: "audioinput",
        label: "新麦克风",
      },
    ] as MediaDeviceInfo[]);
    act(() => dispatchDeviceChange());

    await waitFor(() => {
      expect(meeting.result.current.devices[0]?.label).toBe("新摄像头");
      expect(meeting.result.current.cameraId).toBe("");
    });
  });

  it("旧设备枚举结果不会覆盖离会重入后的设备列表和选择", async () => {
    const meeting = renderMeetingHook();
    let resolveOldEnumeration!: (devices: MediaDeviceInfo[]) => void;
    const oldEnumeration = new Promise<MediaDeviceInfo[]>((resolve) => {
      resolveOldEnumeration = resolve;
    });
    enumerateDevicesMock
      .mockImplementationOnce(async () => oldEnumeration)
      .mockImplementationOnce(async () =>
        [
          { deviceId: "camera-new", kind: "videoinput", label: "新摄像头" },
          {
            deviceId: "microphone-new",
            kind: "audioinput",
            label: "新麦克风",
          },
        ] as MediaDeviceInfo[],
      );

    let oldJoin!: Promise<void>;
    await act(async () => {
      oldJoin = meeting.result.current.join();
      await Promise.resolve();
    });
    await waitFor(() => expect(enumerateDevicesMock).toHaveBeenCalledOnce());

    act(() => meeting.result.current.leave());
    await join(meeting.result);
    act(() => meeting.result.current.setCameraId("camera-new"));

    resolveOldEnumeration([
      { deviceId: "camera-old", kind: "videoinput", label: "旧摄像头" },
      {
        deviceId: "microphone-old",
        kind: "audioinput",
        label: "旧麦克风",
      },
    ] as MediaDeviceInfo[]);
    await act(async () => {
      await oldJoin;
    });

    expect(meeting.result.current.devices[0]?.deviceId).toBe("camera-new");
    expect(meeting.result.current.cameraId).toBe("camera-new");
  });

  it("startMuted 会保留麦克风采集但关闭音频轨道", async () => {
    const meeting = renderMeetingHook();

    await act(async () => {
      await meeting.result.current.join({ startMuted: true });
    });

    expect(getUserMediaMock).toHaveBeenCalledWith({
      audio: true,
      video: { width: { ideal: 1280 }, height: { ideal: 720 } },
    });
    expect(meeting.result.current.micOn).toBe(false);
    const stream = await getUserMediaMock.mock.results[0].value;
    expect(stream.getAudioTracks()[0].enabled).toBe(false);

    act(() => meeting.result.current.toggleMic());
    expect(stream.getAudioTracks()[0].enabled).toBe(true);
  });

  it("没有视频轨道时不会启动屏幕共享", async () => {
    const meeting = renderMeetingHook();
    await act(async () => {
      await meeting.result.current.join({ video: false });
    });

    await act(async () => {
      await meeting.result.current.toggleSharing();
    });

    expect(getDisplayMediaMock).not.toHaveBeenCalled();
    expect(meeting.result.current.sharing).toBe(false);
    expect(meeting.result.current.error).toContain("开启摄像头后才能共享屏幕");
  });

  it("音频和视频都关闭时可以无媒体入会且不请求设备权限", async () => {
    const meeting = renderMeetingHook();

    await act(async () => {
      await meeting.result.current.join({ audio: false, video: false });
    });

    expect(meeting.result.current.status).toBe("waiting");
    expect(meeting.result.current.error).toBe("");
    expect(meeting.result.current.localStream?.getTracks()).toHaveLength(0);
    expect(getUserMediaMock).not.toHaveBeenCalled();
  });

  it("缺少 randomUUID 时仍能生成 peer 标识并加入会议", async () => {
    const cryptoObject = globalThis.crypto as Crypto;
    const originalRandomUUID = cryptoObject.randomUUID;
    Object.defineProperty(cryptoObject, "randomUUID", {
      configurable: true,
      value: undefined,
    });

    try {
      expect(createRandomIdentifier()).toMatch(/^[0-9a-f]+$/);
      const meeting = renderMeetingHook();
      await join(meeting.result);
      expect(meeting.result.current.status).toBe("waiting");
    } finally {
      Object.defineProperty(cryptoObject, "randomUUID", {
        configurable: true,
        value: originalRandomUUID,
      });
    }
  });

  it("缺少 Web Crypto 随机 API 时仍能生成本地标识", () => {
    const cryptoObject = globalThis.crypto as Crypto;
    const originalRandomUUID = cryptoObject.randomUUID;
    const originalGetRandomValues = cryptoObject.getRandomValues;
    Object.defineProperties(cryptoObject, {
      randomUUID: { configurable: true, value: undefined },
      getRandomValues: { configurable: true, value: undefined },
    });

    try {
      expect(createRandomIdentifier()).toMatch(/^[0-9a-f]+$/);
    } finally {
      Object.defineProperties(cryptoObject, {
        randomUUID: { configurable: true, value: originalRandomUUID },
        getRandomValues: { configurable: true, value: originalGetRandomValues },
      });
    }
  });

  it("无媒体入会时设备切换不会凭空创建媒体轨道", async () => {
    const meeting = renderMeetingHook();
    await act(async () => {
      await meeting.result.current.join({ audio: false, video: false });
    });

    await act(async () => {
      await meeting.result.current.switchCamera("camera-secondary");
    });
    expect(meeting.result.current.error).toContain("当前未开启摄像头");
    await act(async () => {
      await meeting.result.current.switchMicrophone("microphone-secondary");
    });

    expect(meeting.result.current.error).toContain("当前未开启麦克风");
    expect(meeting.result.current.localStream?.getTracks()).toHaveLength(0);
    expect(getUserMediaMock).not.toHaveBeenCalled();
  });

  it("在调用媒体设备前拒绝过长房间号", async () => {
    const meeting = renderMeetingHook();
    act(() => meeting.result.current.setRoomId("1".repeat(19)));

    await join(meeting.result);

    expect(meeting.result.current.status).toBe("error");
    expect(meeting.result.current.error).toContain("不能超过 18 位");
    expect(getUserMediaMock).not.toHaveBeenCalled();
  });

  it("在调用媒体设备前拒绝包含非法字符的房间号", async () => {
    const meeting = renderMeetingHook();
    act(() => meeting.result.current.setRoomId("123abc456"));

    await join(meeting.result);

    expect(meeting.result.current.status).toBe("error");
    expect(meeting.result.current.error).toContain("只能包含数字");
    expect(getUserMediaMock).not.toHaveBeenCalled();
  });

  it("无媒体入会不依赖 getUserMedia 能力", async () => {
    const mediaDevices = navigator.mediaDevices;
    const originalGetUserMedia = mediaDevices.getUserMedia;
    Object.defineProperty(mediaDevices, "getUserMedia", {
      configurable: true,
      value: undefined,
    });

    try {
      const meeting = renderMeetingHook();
      await act(async () => {
        await meeting.result.current.join({ audio: false, video: false });
      });

      expect(meeting.result.current.status).toBe("waiting");
      expect(meeting.result.current.error).toBe("");
    } finally {
      Object.defineProperty(mediaDevices, "getUserMedia", {
        configurable: true,
        value: originalGetUserMedia,
      });
    }
  });

  it("开启媒体但 getUserMedia 不可用时会提示不支持", async () => {
    const mediaDevices = navigator.mediaDevices;
    const originalGetUserMedia = mediaDevices.getUserMedia;
    Object.defineProperty(mediaDevices, "getUserMedia", {
      configurable: true,
      value: undefined,
    });

    try {
      const meeting = renderMeetingHook();
      await act(async () => {
        await meeting.result.current.join({ audio: true, video: false });
      });

      expect(meeting.result.current.status).toBe("error");
      expect(meeting.result.current.error).toContain("不支持本地 WebRTC");
    } finally {
      Object.defineProperty(mediaDevices, "getUserMedia", {
        configurable: true,
        value: originalGetUserMedia,
      });
    }
  });

  it("本地媒体轨道意外结束时会同步控制状态并提示恢复", async () => {
    const meeting = renderMeetingHook();
    await join(meeting.result);
    const stream = meeting.result.current.localStream as unknown as FakeMediaStream;
    const audioTrack = stream.getAudioTracks()[0];
    const videoTrack = stream.getVideoTracks()[0];

    act(() => audioTrack.end());
    expect(meeting.result.current.micOn).toBe(false);
    expect(meeting.result.current.error).toContain("麦克风已断开");

    act(() => videoTrack.end());
    expect(meeting.result.current.cameraOn).toBe(false);
    expect(meeting.result.current.error).toContain("摄像头已断开");
  });

  it("共享屏幕时替换视频发送轨道，停止后恢复摄像头", async () => {
    const { first } = await connectTwoMeetings();
    const cameraTrack = first.result.current.localStream
      ?.getVideoTracks()[0] as unknown as FakeMediaStreamTrack;
    const peer = FakePeerConnection.instances.find((candidate) =>
      candidate
        .getSenders()
        .some((sender) => sender.track?.id === cameraTrack.id),
    );
    const videoSender = peer
      ?.getSenders()
      .find((sender) => sender.track?.kind === "video");

    await act(async () => {
      await first.result.current.toggleSharing();
    });
    const displayStream = await getDisplayMediaMock.mock.results[0].value;
    const displayTrack = displayStream.getVideoTracks()[0];
    expect(first.result.current.sharing).toBe(true);
    expect(videoSender?.track).toBe(displayTrack);

    await act(async () => {
      await first.result.current.toggleSharing();
    });
    expect(first.result.current.sharing).toBe(false);
    expect(videoSender?.track).toBe(cameraTrack);
    expect((displayTrack as unknown as FakeMediaStreamTrack).stopped).toBe(true);
  });

  it("录制源在共享期间使用屏幕视频并保留本地音频", async () => {
    const meeting = renderMeetingHook();
    await join(meeting.result);
    const cameraTrack = meeting.result.current.localStream
      ?.getVideoTracks()[0] as unknown as FakeMediaStreamTrack;
    const microphoneTrack = meeting.result.current.localStream
      ?.getAudioTracks()[0] as unknown as FakeMediaStreamTrack;

    const beforeShare = meeting.result.current.getRecordingStream();
    expect(beforeShare?.getVideoTracks()[0]).toBe(cameraTrack);
    expect(beforeShare?.getAudioTracks()[0]).toBe(microphoneTrack);

    await act(async () => {
      await meeting.result.current.toggleSharing();
    });
    const displayStream = await getDisplayMediaMock.mock.results[0].value;
    const displayTrack = displayStream.getVideoTracks()[0];
    const duringShare = meeting.result.current.getRecordingStream();
    expect(duringShare?.getVideoTracks()[0]).toBe(displayTrack);
    expect(duringShare?.getAudioTracks()[0]).toBe(microphoneTrack);

    await act(async () => {
      await meeting.result.current.toggleSharing();
    });
    expect(meeting.result.current.getRecordingStream()?.getVideoTracks()[0]).toBe(
      cameraTrack,
    );
  });

  it("建立连接前先共享屏幕时，peer 直接发送屏幕轨道", async () => {
    const first = renderMeetingHook();
    const second = renderMeetingHook();
    const room = "975318642";
    act(() => {
      first.result.current.setRoomId(room);
      second.result.current.setRoomId(room);
    });
    await join(first.result);

    await act(async () => {
      await first.result.current.toggleSharing();
    });
    const displayStream = await getDisplayMediaMock.mock.results[0].value;
    const displayTrack = displayStream.getVideoTracks()[0] as unknown as MediaStreamTrack;
    const cameraTrack = first.result.current.localStream
      ?.getVideoTracks()[0] as unknown as MediaStreamTrack;

    await join(second.result);
    await waitFor(() => {
      expect(first.result.current.status).toBe("connected");
      expect(second.result.current.status).toBe("connected");
    });

    const firstPeer = FakePeerConnection.instances.find((peer) =>
      peer.getSenders().some((sender) => sender.track === displayTrack),
    );
    expect(firstPeer).toBeTruthy();
    expect(
      firstPeer?.getSenders().filter((sender) => sender.track?.kind === "video"),
    ).toHaveLength(1);
    expect(firstPeer?.getSenders().find((sender) => sender.track?.kind === "video")?.track)
      .toBe(displayTrack);
    expect(firstPeer?.getSenders().some((sender) => sender.track === cameraTrack)).toBe(false);
  });

  it("屏幕共享期间切换摄像头不会打断屏幕轨道，停止后恢复新摄像头", async () => {
    const { first } = await connectTwoMeetings();
    const oldCamera = first.result.current.localStream
      ?.getVideoTracks()[0] as unknown as FakeMediaStreamTrack;
    const peer = FakePeerConnection.instances.find((candidate) =>
      candidate
        .getSenders()
        .some((sender) => sender.track?.id === oldCamera.id),
    );
    const videoSender = peer
      ?.getSenders()
      .find((sender) => sender.track?.kind === "video");

    await act(async () => {
      await first.result.current.toggleSharing();
    });
    const displayStream = await getDisplayMediaMock.mock.results[0].value;
    const displayTrack = displayStream.getVideoTracks()[0];

    await act(async () => {
      await first.result.current.switchCamera("camera-secondary");
    });

    const nextCamera = first.result.current.localStream
      ?.getVideoTracks()[0] as unknown as FakeMediaStreamTrack;
    expect(nextCamera.deviceId).toBe("camera-secondary");
    expect(oldCamera.stopped).toBe(true);
    expect(first.result.current.sharing).toBe(true);
    expect(videoSender?.track).toBe(displayTrack);

    await act(async () => {
      await first.result.current.toggleSharing();
    });
    expect(first.result.current.sharing).toBe(false);
    expect(videoSender?.track).toBe(nextCamera);
    expect((displayTrack as unknown as FakeMediaStreamTrack).stopped).toBe(true);
  });

  it("摄像头轨道结束时停止共享会保留屏幕流并提示无法恢复摄像头", async () => {
    const meeting = renderMeetingHook();
    await join(meeting.result);
    await act(async () => {
      await meeting.result.current.toggleSharing();
    });
    const displayStream = await getDisplayMediaMock.mock.results[0].value;
    const displayTrack = displayStream.getVideoTracks()[0] as FakeMediaStreamTrack;
    const cameraTrack = meeting.result.current.localStream
      ?.getVideoTracks()[0] as unknown as FakeMediaStreamTrack;

    act(() => cameraTrack.end());
    await act(async () => {
      await meeting.result.current.toggleSharing();
    });

    expect(meeting.result.current.sharing).toBe(true);
    expect(displayTrack.stopped).toBe(false);
    expect(meeting.result.current.error).toContain("无法恢复摄像头");
  });

  it("旧会话的屏幕轨道结束时不会清理新会话共享", async () => {
    const meeting = renderMeetingHook();
    await join(meeting.result);

    await act(async () => {
      await meeting.result.current.toggleSharing();
    });
    const oldScreen = await getDisplayMediaMock.mock.results[0].value;
    const oldScreenTrack = oldScreen.getVideoTracks()[0] as FakeMediaStreamTrack;

    act(() => meeting.result.current.leave());
    await join(meeting.result);
    await act(async () => {
      await meeting.result.current.toggleSharing();
    });
    const newScreen = await getDisplayMediaMock.mock.results[1].value;
    const newScreenTrack = newScreen.getVideoTracks()[0] as FakeMediaStreamTrack;

    act(() => oldScreenTrack.end());

    expect(meeting.result.current.sharing).toBe(true);
    expect(newScreenTrack.stopped).toBe(false);
  });

  it("快速连续共享屏幕时只保留最后一次请求的轨道", async () => {
    const meeting = renderMeetingHook();
    await join(meeting.result);
    let resolveFirst!: (stream: MediaStream) => void;
    let resolveSecond!: (stream: MediaStream) => void;
    const firstPending = new Promise<MediaStream>((resolve) => {
      resolveFirst = resolve;
    });
    const secondPending = new Promise<MediaStream>((resolve) => {
      resolveSecond = resolve;
    });
    getDisplayMediaMock
      .mockImplementationOnce(async () => firstPending)
      .mockImplementationOnce(async () => secondPending);

    let firstShare!: Promise<void>;
    let secondShare!: Promise<void>;
    await act(async () => {
      firstShare = meeting.result.current.toggleSharing();
      await Promise.resolve();
    });
    await act(async () => {
      secondShare = meeting.result.current.toggleSharing();
      await Promise.resolve();
    });

    const firstStream = new FakeMediaStream([
      new FakeMediaStreamTrack("video", "display-first"),
    ]);
    const firstTrack = firstStream.getVideoTracks()[0];
    resolveFirst(firstStream as unknown as MediaStream);
    await act(async () => {
      await firstShare;
    });
    expect(firstTrack.stopped).toBe(true);

    const secondStream = new FakeMediaStream([
      new FakeMediaStreamTrack("video", "display-second"),
    ]);
    const secondTrack = secondStream.getVideoTracks()[0];
    resolveSecond(secondStream as unknown as MediaStream);
    await act(async () => {
      await secondShare;
    });

    expect(meeting.result.current.sharing).toBe(true);
    expect(secondTrack.stopped).toBe(false);
  });

  it("屏幕轨道替换失败时会停止新流并保留当前状态", async () => {
    const { first: meeting } = await connectTwoMeetings();
    const sender = FakePeerConnection.instances[0]
      ?.getSenders()
      .find((candidate) => candidate.track?.kind === "video");
    const replaceTrack = sender?.replaceTrack as unknown as {
      mockRejectedValueOnce: (error: Error) => unknown;
    };
    replaceTrack?.mockRejectedValueOnce(new Error("sender unavailable"));

    await act(async () => {
      await meeting.result.current.toggleSharing();
    });

    const displayStream = await getDisplayMediaMock.mock.results[0].value;
    expect(displayStream.getVideoTracks()[0].stopped).toBe(true);
    expect(meeting.result.current.sharing).toBe(false);
    expect(meeting.result.current.error).toContain("无法开始屏幕共享");
  });

  it("屏幕轨道已替换但随后失败时会恢复摄像头发送轨道", async () => {
    const { first: meeting } = await connectTwoMeetings();
    const oldCamera = meeting.result.current.localStream
      ?.getVideoTracks()[0] as unknown as FakeMediaStreamTrack;
    const peer = FakePeerConnection.instances.find((candidate) =>
      candidate.getSenders().some((sender) => sender.track?.id === oldCamera.id),
    );
    const sender = peer
      ?.getSenders()
      .find((candidate) => candidate.track?.kind === "video");
    expect(sender).toBeTruthy();
    const senderState = sender as unknown as { track: FakeMediaStreamTrack | null };
    vi.spyOn(sender as RTCRtpSender, "replaceTrack").mockImplementationOnce(
      async (track) => {
        senderState.track = track as unknown as FakeMediaStreamTrack;
        throw new Error("screen replacement committed then failed");
      },
    );
    const displayStream = new FakeMediaStream([
      new FakeMediaStreamTrack("video", "display-rollback"),
    ]);
    getDisplayMediaMock.mockImplementationOnce(
      async () => displayStream as unknown as MediaStream,
    );

    await act(async () => {
      await meeting.result.current.toggleSharing();
    });

    expect(sender?.track).toBe(oldCamera);
    expect(displayStream.getVideoTracks()[0].stopped).toBe(true);
    expect(meeting.result.current.sharing).toBe(false);
    expect(meeting.result.current.error).toContain("无法开始屏幕共享");
  });

  it("停止屏幕共享失败时保留共享并提示恢复失败", async () => {
    const { first: meeting } = await connectTwoMeetings();
    await act(async () => {
      await meeting.result.current.toggleSharing();
    });
    const sender = FakePeerConnection.instances[0]
      ?.getSenders()
      .find((candidate) => candidate.track?.kind === "video");
    const replaceTrack = sender?.replaceTrack as unknown as {
      mockRejectedValueOnce: (error: Error) => unknown;
    };
    replaceTrack?.mockRejectedValueOnce(new Error("camera unavailable"));

    await act(async () => {
      await meeting.result.current.toggleSharing();
    });

    expect(meeting.result.current.sharing).toBe(true);
    expect(meeting.result.current.error).toContain("无法恢复摄像头");
  });

  it("停止共享已恢复摄像头但随后失败时会恢复屏幕发送轨道", async () => {
    const { first: meeting } = await connectTwoMeetings();
    await act(async () => {
      await meeting.result.current.toggleSharing();
    });
    const peer = FakePeerConnection.instances.find((candidate) =>
      candidate.getSenders().some(
        (sender) =>
          sender.track?.kind === "video" &&
          (sender.track as unknown as FakeMediaStreamTrack | null)?.deviceId ===
            "display-default",
      ),
    );
    const sender = peer
      ?.getSenders()
      .find((candidate) => candidate.track?.kind === "video");
    const screenTrack = sender?.track as unknown as FakeMediaStreamTrack;
    expect(sender).toBeTruthy();
    const senderState = sender as unknown as { track: FakeMediaStreamTrack | null };
    vi.spyOn(sender as RTCRtpSender, "replaceTrack").mockImplementationOnce(
      async (track) => {
        senderState.track = track as unknown as FakeMediaStreamTrack;
        throw new Error("camera restoration committed then failed");
      },
    );

    await act(async () => {
      await meeting.result.current.toggleSharing();
    });

    expect(sender?.track).toBe(screenTrack);
    expect(screenTrack.stopped).toBe(false);
    expect(meeting.result.current.sharing).toBe(true);
    expect(meeting.result.current.error).toContain("无法恢复摄像头");
  });

  it("切换设备时替换发送轨道并停止旧轨道", async () => {
    const { first } = await connectTwoMeetings();
    const oldVideo = first.result.current.localStream
      ?.getVideoTracks()[0] as unknown as FakeMediaStreamTrack;
    const oldAudio = first.result.current.localStream
      ?.getAudioTracks()[0] as unknown as FakeMediaStreamTrack;

    await act(async () => {
      await first.result.current.switchCamera("camera-secondary");
      await first.result.current.switchMicrophone("microphone-secondary");
    });

    const nextVideo = first.result.current.localStream
      ?.getVideoTracks()[0] as unknown as FakeMediaStreamTrack;
    const nextAudio = first.result.current.localStream
      ?.getAudioTracks()[0] as unknown as FakeMediaStreamTrack;
    expect(nextVideo.deviceId).toBe("camera-secondary");
    expect(nextAudio.deviceId).toBe("microphone-secondary");
    expect(oldVideo.stopped).toBe(true);
    expect(oldAudio.stopped).toBe(true);

    await act(async () => {
      await first.result.current.switchCamera("");
      await first.result.current.switchMicrophone("");
    });

    const defaultVideo = first.result.current.localStream
      ?.getVideoTracks()[0] as unknown as FakeMediaStreamTrack;
    const defaultAudio = first.result.current.localStream
      ?.getAudioTracks()[0] as unknown as FakeMediaStreamTrack;
    expect(defaultVideo.deviceId).toBe("camera-default");
    expect(defaultAudio.deviceId).toBe("microphone-default");
    expect(first.result.current.cameraId).toBe("");
    expect(first.result.current.microphoneId).toBe("");
    expect(nextVideo.stopped).toBe(true);
    expect(nextAudio.stopped).toBe(true);
  });

  it("快速连续切换摄像头时只提交最后请求并停止过期轨道", async () => {
    const meeting = renderMeetingHook();
    await join(meeting.result);
    let resolveFirst!: (stream: MediaStream) => void;
    let resolveSecond!: (stream: MediaStream) => void;
    const firstPending = new Promise<MediaStream>((resolve) => {
      resolveFirst = resolve;
    });
    const secondPending = new Promise<MediaStream>((resolve) => {
      resolveSecond = resolve;
    });
    getUserMediaMock
      .mockImplementationOnce(async () => firstPending)
      .mockImplementationOnce(async () => secondPending);

    let firstSwitch!: Promise<void>;
    let secondSwitch!: Promise<void>;
    await act(async () => {
      firstSwitch = meeting.result.current.switchCamera("camera-first");
      await Promise.resolve();
    });
    await act(async () => {
      secondSwitch = meeting.result.current.switchCamera("camera-second");
      await Promise.resolve();
    });

    const firstStream = new FakeMediaStream([
      new FakeMediaStreamTrack("video", "camera-first"),
    ]);
    const firstTrack = firstStream.getVideoTracks()[0];
    resolveFirst(firstStream as unknown as MediaStream);
    await act(async () => {
      await firstSwitch;
    });
    expect(firstTrack.stopped).toBe(true);

    const secondStream = new FakeMediaStream([
      new FakeMediaStreamTrack("video", "camera-second"),
    ]);
    const secondTrack = secondStream.getVideoTracks()[0];
    resolveSecond(secondStream as unknown as MediaStream);
    await act(async () => {
      await secondSwitch;
    });

    expect(
      (meeting.result.current.localStream?.getVideoTracks()[0] as unknown as FakeMediaStreamTrack)
        .deviceId,
    ).toBe("camera-second");
    expect(secondTrack.stopped).toBe(false);
  });

  it("快速连续切换麦克风时只提交最后请求并停止过期轨道", async () => {
    const meeting = renderMeetingHook();
    await join(meeting.result);
    let resolveFirst!: (stream: MediaStream) => void;
    let resolveSecond!: (stream: MediaStream) => void;
    const firstPending = new Promise<MediaStream>((resolve) => {
      resolveFirst = resolve;
    });
    const secondPending = new Promise<MediaStream>((resolve) => {
      resolveSecond = resolve;
    });
    getUserMediaMock
      .mockImplementationOnce(async () => firstPending)
      .mockImplementationOnce(async () => secondPending);

    let firstSwitch!: Promise<void>;
    let secondSwitch!: Promise<void>;
    await act(async () => {
      firstSwitch = meeting.result.current.switchMicrophone("microphone-first");
      await Promise.resolve();
    });
    await act(async () => {
      secondSwitch = meeting.result.current.switchMicrophone("microphone-second");
      await Promise.resolve();
    });

    const firstStream = new FakeMediaStream([
      new FakeMediaStreamTrack("audio", "microphone-first"),
    ]);
    const firstTrack = firstStream.getAudioTracks()[0];
    resolveFirst(firstStream as unknown as MediaStream);
    await act(async () => {
      await firstSwitch;
    });
    expect(firstTrack.stopped).toBe(true);

    const secondStream = new FakeMediaStream([
      new FakeMediaStreamTrack("audio", "microphone-second"),
    ]);
    const secondTrack = secondStream.getAudioTracks()[0];
    resolveSecond(secondStream as unknown as MediaStream);
    await act(async () => {
      await secondSwitch;
    });

    expect(
      (meeting.result.current.localStream?.getAudioTracks()[0] as unknown as FakeMediaStreamTrack)
        .deviceId,
    ).toBe("microphone-second");
    expect(secondTrack.stopped).toBe(false);
  });

  it("过期摄像头替换已提交时会恢复当前发送轨道", async () => {
    const { first: meeting } = await connectTwoMeetings();
    const oldCamera = meeting.result.current.localStream
      ?.getVideoTracks()[0] as unknown as FakeMediaStreamTrack;
    const peer = FakePeerConnection.instances.find((candidate) =>
      candidate.getSenders().some((sender) => sender.track?.id === oldCamera.id),
    );
    const sender = peer
      ?.getSenders()
      .find((candidate) => candidate.track?.kind === "video");
    expect(sender).toBeTruthy();

    let resolveFirst!: (stream: MediaStream) => void;
    let resolveSecond!: (stream: MediaStream) => void;
    const firstPending = new Promise<MediaStream>((resolve) => {
      resolveFirst = resolve;
    });
    const secondPending = new Promise<MediaStream>((resolve) => {
      resolveSecond = resolve;
    });
    getUserMediaMock
      .mockImplementationOnce(async () => firstPending)
      .mockImplementationOnce(async () => secondPending);

    let firstSwitch!: Promise<void>;
    let secondSwitch!: Promise<void>;
    await act(async () => {
      firstSwitch = meeting.result.current.switchCamera("camera-first");
      await Promise.resolve();
    });
    await act(async () => {
      secondSwitch = meeting.result.current.switchCamera("camera-second");
      await Promise.resolve();
    });

    const firstStream = new FakeMediaStream([
      new FakeMediaStreamTrack("video", "camera-first"),
    ]);
    const firstTrack = firstStream.getVideoTracks()[0];
    resolveFirst(firstStream as unknown as MediaStream);
    await act(async () => {
      await firstSwitch;
    });

    expect(firstTrack.stopped).toBe(true);
    expect(sender?.track).toBe(oldCamera);

    const secondStream = new FakeMediaStream([
      new FakeMediaStreamTrack("video", "camera-second"),
    ]);
    const secondTrack = secondStream.getVideoTracks()[0];
    resolveSecond(secondStream as unknown as MediaStream);
    await act(async () => {
      await secondSwitch;
    });

    expect(sender?.track).toBe(secondTrack);
  });

  it("设备切换失败时保留旧轨道并恢复选择值，成功后清除错误", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const meeting = renderMeetingHook();
    await join(meeting.result);
    const oldVideo = meeting.result.current.localStream
      ?.getVideoTracks()[0] as unknown as FakeMediaStreamTrack;
    const oldAudio = meeting.result.current.localStream
      ?.getAudioTracks()[0] as unknown as FakeMediaStreamTrack;

    getUserMediaMock.mockRejectedValueOnce(
      new DOMException("camera missing", "NotFoundError"),
    );
    await act(async () => {
      await meeting.result.current.switchCamera("camera-missing");
    });
    expect(meeting.result.current.cameraId).toBe("");
    expect(meeting.result.current.localStream?.getVideoTracks()[0]).toBe(oldVideo);
    expect(oldVideo.stopped).toBe(false);
    expect(meeting.result.current.error).toContain("切换摄像头");

    getUserMediaMock.mockRejectedValueOnce(
      new DOMException("microphone missing", "NotFoundError"),
    );
    await act(async () => {
      await meeting.result.current.switchMicrophone("microphone-missing");
    });
    expect(meeting.result.current.microphoneId).toBe("");
    expect(meeting.result.current.localStream?.getAudioTracks()[0]).toBe(oldAudio);
    expect(oldAudio.stopped).toBe(false);
    expect(meeting.result.current.error).toContain("切换麦克风");

    await act(async () => {
      await meeting.result.current.switchCamera("camera-secondary");
    });
    expect(meeting.result.current.cameraId).toBe("camera-secondary");
    expect(meeting.result.current.error).toBe("");
  });

  it("摄像头发送轨道已替换但随后失败时会回滚到旧轨道", async () => {
    const { first: meeting } = await connectTwoMeetings();
    const oldVideo = meeting.result.current.localStream
      ?.getVideoTracks()[0] as unknown as FakeMediaStreamTrack;
    const peer = FakePeerConnection.instances.find((candidate) =>
      candidate.getSenders().some((sender) => sender.track?.id === oldVideo.id),
    );
    const sender = peer
      ?.getSenders()
      .find((candidate) => candidate.track?.kind === "video");
    const senderState = sender as unknown as { track: FakeMediaStreamTrack | null };
    const replacement = new FakeMediaStream([
      new FakeMediaStreamTrack("video", "camera-rollback"),
    ]);
    vi.spyOn(sender as RTCRtpSender, "replaceTrack").mockImplementationOnce(
      async (track) => {
        senderState.track = track as unknown as FakeMediaStreamTrack;
        throw new Error("camera replacement committed then failed");
      },
    );
    getUserMediaMock.mockImplementationOnce(
      async () => replacement as unknown as MediaStream,
    );

    await act(async () => {
      await meeting.result.current.switchCamera("camera-rollback");
    });

    expect(sender?.track).toBe(oldVideo);
    expect(replacement.getVideoTracks()[0].stopped).toBe(true);
    expect(meeting.result.current.localStream?.getVideoTracks()[0]).toBe(oldVideo);
    expect(meeting.result.current.cameraId).toBe("");
    expect(meeting.result.current.error).toContain("无法切换摄像头");
  });

  it("麦克风发送轨道已替换但随后失败时会回滚到旧轨道", async () => {
    const { first: meeting } = await connectTwoMeetings();
    const oldAudio = meeting.result.current.localStream
      ?.getAudioTracks()[0] as unknown as FakeMediaStreamTrack;
    const peer = FakePeerConnection.instances.find((candidate) =>
      candidate.getSenders().some((sender) => sender.track?.id === oldAudio.id),
    );
    const sender = peer
      ?.getSenders()
      .find((candidate) => candidate.track?.kind === "audio");
    const senderState = sender as unknown as { track: FakeMediaStreamTrack | null };
    const replacement = new FakeMediaStream([
      new FakeMediaStreamTrack("audio", "microphone-rollback"),
    ]);
    vi.spyOn(sender as RTCRtpSender, "replaceTrack").mockImplementationOnce(
      async (track) => {
        senderState.track = track as unknown as FakeMediaStreamTrack;
        throw new Error("microphone replacement committed then failed");
      },
    );
    getUserMediaMock.mockImplementationOnce(
      async () => replacement as unknown as MediaStream,
    );

    await act(async () => {
      await meeting.result.current.switchMicrophone("microphone-rollback");
    });

    expect(sender?.track).toBe(oldAudio);
    expect(replacement.getAudioTracks()[0].stopped).toBe(true);
    expect(meeting.result.current.localStream?.getAudioTracks()[0]).toBe(oldAudio);
    expect(meeting.result.current.microphoneId).toBe("");
    expect(meeting.result.current.error).toContain("无法切换麦克风");
  });

  it("离会会清理媒体资源，并让另一端回到等待状态", async () => {
    const { first, second } = await connectTwoMeetings();
    const localTracks = first.result.current.localStream
      ?.getTracks() as unknown as FakeMediaStreamTrack[];

    act(() => first.result.current.leave());

    expect(first.result.current.status).toBe("idle");
    expect(first.result.current.localStream).toBeNull();
    expect(localTracks.every((track) => track.stopped)).toBe(true);
    await waitFor(() => expect(second.result.current.status).toBe("waiting"));
  });

  it("页面离开时会清理当前本地会话", async () => {
    const meeting = renderMeetingHook();
    await join(meeting.result);
    const localTracks = meeting.result.current.localStream
      ?.getTracks() as unknown as FakeMediaStreamTrack[];

    act(() => window.dispatchEvent(new Event("pagehide")));

    expect(meeting.result.current.status).toBe("idle");
    expect(meeting.result.current.localStream).toBeNull();
    expect(localTracks.every((track) => track.stopped)).toBe(true);
  });

  it("页面进入 BFCache 时不会误清理本地会话", async () => {
    const meeting = renderMeetingHook();
    await join(meeting.result);
    const localStream = meeting.result.current.localStream;
    const event = new Event("pagehide") as PageTransitionEvent;
    Object.defineProperty(event, "persisted", { value: true });

    act(() => window.dispatchEvent(event));

    expect(meeting.result.current.status).toBe("waiting");
    expect(meeting.result.current.localStream).toBe(localStream);
  });

  it("轮换 peer 标识后仍可重新连接同一房间", async () => {
    const { first, second } = await connectTwoMeetings();

    act(() => first.result.current.leave());
    await waitFor(() => expect(second.result.current.status).toBe("waiting"));

    await join(first.result);
    await waitFor(() => {
      expect(first.result.current.status).toBe("connected");
      expect(second.result.current.status).toBe("connected");
    });
  });

  it("离会后才返回的媒体请求不会重新写入当前会话", async () => {
    const meeting = renderMeetingHook();
    let resolveMedia!: (stream: MediaStream) => void;
    const pendingMedia = new Promise<MediaStream>((resolve) => {
      resolveMedia = resolve;
    });
    getUserMediaMock.mockImplementationOnce(async () => pendingMedia);

    let joinPromise!: Promise<void>;
    await act(async () => {
      joinPromise = meeting.result.current.join();
      await Promise.resolve();
    });
    act(() => meeting.result.current.leave());

    const staleStream = new FakeMediaStream([
      new FakeMediaStreamTrack("audio"),
      new FakeMediaStreamTrack("video"),
    ]);
    resolveMedia(staleStream as unknown as MediaStream);
    await act(async () => {
      await joinPromise;
    });

    expect(meeting.result.current.status).toBe("idle");
    expect(meeting.result.current.localStream).toBeNull();
    expect(
      staleStream
        .getTracks()
        .every((track) => (track as FakeMediaStreamTrack).stopped),
    ).toBe(true);
  });

  it("离会后才返回的设备切换和共享轨道会被停止", async () => {
    const meeting = renderMeetingHook();
    await join(meeting.result);

    let resolveReplacement!: (stream: MediaStream) => void;
    const pendingReplacement = new Promise<MediaStream>((resolve) => {
      resolveReplacement = resolve;
    });
    getUserMediaMock.mockImplementationOnce(async () => pendingReplacement);
    let switchPromise!: Promise<void>;
    await act(async () => {
      switchPromise = meeting.result.current.switchCamera("camera-secondary");
      await Promise.resolve();
    });
    act(() => meeting.result.current.leave());

    const staleReplacement = new FakeMediaStream([
      new FakeMediaStreamTrack("video", "camera-secondary"),
    ]);
    resolveReplacement(staleReplacement as unknown as MediaStream);
    await act(async () => {
      await switchPromise;
    });

    expect(
      staleReplacement
        .getTracks()
        .every((track) => (track as FakeMediaStreamTrack).stopped),
    ).toBe(true);

    const secondMeeting = renderMeetingHook();
    await join(secondMeeting.result);
    let resolveScreen!: (stream: MediaStream) => void;
    const pendingScreen = new Promise<MediaStream>((resolve) => {
      resolveScreen = resolve;
    });
    getDisplayMediaMock.mockImplementationOnce(async () => pendingScreen);
    let sharePromise!: Promise<void>;
    await act(async () => {
      sharePromise = secondMeeting.result.current.toggleSharing();
      await Promise.resolve();
    });
    act(() => secondMeeting.result.current.leave());

    const staleScreen = new FakeMediaStream([
      new FakeMediaStreamTrack("video", "display-secondary"),
    ]);
    resolveScreen(staleScreen as unknown as MediaStream);
    await act(async () => {
      await sharePromise;
    });

    expect(
      staleScreen
        .getTracks()
        .every((track) => (track as FakeMediaStreamTrack).stopped),
    ).toBe(true);
  });

  it("过期的设备切换失败时仍会停止替代轨道", async () => {
    const { first: meeting } = await connectTwoMeetings();
    const oldCamera = meeting.result.current.localStream
      ?.getVideoTracks()[0] as unknown as FakeMediaStreamTrack;
    const peer = FakePeerConnection.instances.find((candidate) =>
      candidate.getSenders().some((sender) => sender.track?.id === oldCamera.id),
    );
    const sender = peer
      ?.getSenders()
      .find((candidate) => candidate.track?.kind === "video");
    expect(sender).toBeTruthy();

    let resolveFirst!: (stream: MediaStream) => void;
    let resolveSecond!: (stream: MediaStream) => void;
    const firstPending = new Promise<MediaStream>((resolve) => {
      resolveFirst = resolve;
    });
    const secondPending = new Promise<MediaStream>((resolve) => {
      resolveSecond = resolve;
    });
    getUserMediaMock
      .mockImplementationOnce(async () => firstPending)
      .mockImplementationOnce(async () => secondPending);

    let rejectFirstReplace!: (error: Error) => void;
    const firstReplace = new Promise<void>((_, reject) => {
      rejectFirstReplace = reject;
    });
    const senderState = sender as unknown as { track: FakeMediaStreamTrack | null };
    vi.spyOn(sender as RTCRtpSender, "replaceTrack")
      .mockImplementationOnce(async () => firstReplace)
      .mockImplementation(async (track) => {
        senderState.track = track as unknown as FakeMediaStreamTrack | null;
      });

    const firstReplacement = new FakeMediaStream([
      new FakeMediaStreamTrack("video", "camera-first-error"),
    ]);
    const firstTrack = firstReplacement.getVideoTracks()[0];
    let firstSwitch!: Promise<void>;
    await act(async () => {
      firstSwitch = meeting.result.current.switchCamera("camera-first-error");
      await Promise.resolve();
    });
    resolveFirst(firstReplacement as unknown as MediaStream);
    await waitFor(() => expect(sender?.replaceTrack).toHaveBeenCalled());

    let secondSwitch!: Promise<void>;
    await act(async () => {
      secondSwitch = meeting.result.current.switchCamera("camera-second-success");
      await Promise.resolve();
    });
    rejectFirstReplace(new Error("stale sender failure"));
    await act(async () => {
      await firstSwitch;
    });
    expect(firstTrack.stopped).toBe(true);

    const secondReplacement = new FakeMediaStream([
      new FakeMediaStreamTrack("video", "camera-second-success"),
    ]);
    resolveSecond(secondReplacement as unknown as MediaStream);
    await act(async () => {
      await secondSwitch;
    });
    expect(
      (meeting.result.current.localStream?.getVideoTracks()[0] as unknown as FakeMediaStreamTrack)
        .deviceId,
    ).toBe("camera-second-success");
  });

  it("过期的屏幕共享失败不会污染重新加入后的会话", async () => {
    const meeting = renderMeetingHook();
    await join(meeting.result);
    let rejectScreen!: (error: Error) => void;
    const pendingScreen = new Promise<MediaStream>((_, reject) => {
      rejectScreen = reject;
    });
    getDisplayMediaMock.mockImplementationOnce(async () => pendingScreen);

    let sharePromise!: Promise<void>;
    await act(async () => {
      sharePromise = meeting.result.current.toggleSharing();
      await Promise.resolve();
    });
    act(() => meeting.result.current.leave());
    await join(meeting.result);

    rejectScreen(new Error("stale screen failure"));
    await act(async () => {
      await sharePromise;
    });

    expect(meeting.result.current.status).toBe("waiting");
    expect(meeting.result.current.error).toBe("");
    expect(meeting.result.current.sharing).toBe(false);
  });

  it("设备切换完成时读取最新的麦克风和摄像头开关状态", async () => {
    const meeting = renderMeetingHook();
    await join(meeting.result);

    let resolveCamera!: (stream: MediaStream) => void;
    const pendingCamera = new Promise<MediaStream>((resolve) => {
      resolveCamera = resolve;
    });
    getUserMediaMock.mockImplementationOnce(async () => pendingCamera);
    let cameraSwitch!: Promise<void>;
    await act(async () => {
      cameraSwitch = meeting.result.current.switchCamera("camera-latest");
      await Promise.resolve();
    });
    act(() => meeting.result.current.toggleCamera());

    const cameraReplacement = new FakeMediaStream([
      new FakeMediaStreamTrack("video", "camera-latest"),
    ]);
    resolveCamera(cameraReplacement as unknown as MediaStream);
    await act(async () => {
      await cameraSwitch;
    });
    expect(meeting.result.current.cameraOn).toBe(false);
    expect(cameraReplacement.getVideoTracks()[0].enabled).toBe(false);

    let resolveMicrophone!: (stream: MediaStream) => void;
    const pendingMicrophone = new Promise<MediaStream>((resolve) => {
      resolveMicrophone = resolve;
    });
    getUserMediaMock.mockImplementationOnce(async () => pendingMicrophone);
    let microphoneSwitch!: Promise<void>;
    await act(async () => {
      microphoneSwitch = meeting.result.current.switchMicrophone("microphone-latest");
      await Promise.resolve();
    });
    act(() => meeting.result.current.toggleMic());

    const microphoneReplacement = new FakeMediaStream([
      new FakeMediaStreamTrack("audio", "microphone-latest"),
    ]);
    resolveMicrophone(microphoneReplacement as unknown as MediaStream);
    await act(async () => {
      await microphoneSwitch;
    });
    expect(meeting.result.current.micOn).toBe(false);
    expect(microphoneReplacement.getAudioTracks()[0].enabled).toBe(false);
  });
});
