import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useLocalWebRTC } from "./use-local-webrtc";
import {
  FakeMediaStreamTrack,
  FakePeerConnection,
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
  it("在调用媒体设备前拒绝无效房间号", async () => {
    const meeting = renderMeetingHook();
    act(() => meeting.result.current.setRoomId("12-ab"));

    await join(meeting.result);

    expect(meeting.result.current.status).toBe("error");
    expect(meeting.result.current.error).toContain("至少 6 位");
    expect(getUserMediaMock).not.toHaveBeenCalled();
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

  it("同房间的两个会话自动完成 offer/answer 协商", async () => {
    const { first, second } = await connectTwoMeetings();

    expect(first.result.current.status).toBe("connected");
    expect(second.result.current.status).toBe("connected");
    expect(FakePeerConnection.instances).toHaveLength(2);
    expect(
      FakePeerConnection.instances.map((peer) => peer.localDescription?.type),
    ).toEqual(expect.arrayContaining(["offer", "answer"]));
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
});
