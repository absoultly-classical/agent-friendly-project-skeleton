import { afterEach, beforeEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

type TrackKind = "audio" | "video";

let trackSequence = 0;
let peerSequence = 0;

export class FakeMediaStreamTrack {
  readonly id: string;
  readonly kind: TrackKind;
  readonly deviceId: string;
  enabled = true;
  readyState: MediaStreamTrackState = "live";
  stopped = false;
  onended: ((event: Event) => unknown) | null = null;

  constructor(kind: TrackKind, deviceId = `${kind}-default`) {
    this.kind = kind;
    this.deviceId = deviceId;
    this.id = `${kind}-track-${++trackSequence}`;
  }

  stop() {
    this.stopped = true;
    this.readyState = "ended";
  }

  end() {
    this.stop();
    this.onended?.(new Event("ended"));
  }

  getSettings() {
    return { deviceId: this.deviceId };
  }
}

export class FakeMediaStream {
  readonly id = `stream-${++trackSequence}`;
  private tracks: FakeMediaStreamTrack[];

  constructor(tracks: FakeMediaStreamTrack[] = []) {
    this.tracks = [...tracks];
  }

  getTracks() {
    return [...this.tracks];
  }

  getAudioTracks() {
    return this.tracks.filter((track) => track.kind === "audio");
  }

  getVideoTracks() {
    return this.tracks.filter((track) => track.kind === "video");
  }

  addTrack(track: FakeMediaStreamTrack) {
    this.tracks.push(track);
  }

  removeTrack(track: FakeMediaStreamTrack) {
    this.tracks = this.tracks.filter((item) => item !== track);
  }
}

function exactDeviceId(constraint: boolean | MediaTrackConstraints | undefined) {
  if (!constraint || constraint === true) return undefined;
  const deviceId = constraint.deviceId;
  if (typeof deviceId === "string") return deviceId;
  if (deviceId && typeof deviceId === "object" && "exact" in deviceId) {
    const exact = deviceId.exact;
    return Array.isArray(exact) ? exact[0] : exact;
  }
  return undefined;
}

function streamFor(constraints: MediaStreamConstraints) {
  const tracks: FakeMediaStreamTrack[] = [];
  if (constraints.audio) {
    tracks.push(
      new FakeMediaStreamTrack(
        "audio",
        exactDeviceId(constraints.audio) ?? "microphone-default",
      ),
    );
  }
  if (constraints.video) {
    tracks.push(
      new FakeMediaStreamTrack(
        "video",
        exactDeviceId(constraints.video) ?? "camera-default",
      ),
    );
  }
  return new FakeMediaStream(tracks);
}

export const getUserMediaMock = vi.fn(
  async (constraints: MediaStreamConstraints) =>
    streamFor(constraints) as unknown as MediaStream,
);

export const getDisplayMediaMock = vi.fn(async () =>
  new FakeMediaStream([
    new FakeMediaStreamTrack("video", "display-default"),
  ]) as unknown as MediaStream,
);

export class FakeMediaRecorder {
  static instances: FakeMediaRecorder[] = [];
  static isTypeSupported = vi.fn((type: string) => type === "video/webm");
  readonly stream: MediaStream;
  readonly mimeType = "video/webm";
  state: RecordingState = "inactive";
  ondataavailable: ((event: BlobEvent) => unknown) | null = null;
  onerror: ((event: Event) => unknown) | null = null;
  onstop: (() => unknown) | null = null;
  start = vi.fn((timeslice?: number) => {
    void timeslice;
    this.state = "recording";
  });
  stop = vi.fn(() => {
    if (this.state !== "recording") {
      throw new DOMException("inactive", "InvalidStateError");
    }
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob(["local-recording"]) } as BlobEvent);
    this.onstop?.();
  });
  fail = vi.fn(() => {
    this.onerror?.(new Event("error"));
  });

  constructor(stream: MediaStream) {
    this.stream = stream;
    FakeMediaRecorder.instances.push(this);
  }
}

export const enumerateDevicesMock = vi.fn(async () =>
  [
    { deviceId: "camera-default", kind: "videoinput", label: "测试摄像头" },
    {
      deviceId: "microphone-default",
      kind: "audioinput",
      label: "测试麦克风",
    },
  ] as MediaDeviceInfo[],
);

const deviceChangeListeners = new Set<EventListener>();

export function dispatchDeviceChange() {
  const event = new Event("devicechange");
  deviceChangeListeners.forEach((listener) => listener(event));
}

export class FakeBroadcastChannel {
  static rooms = new Map<string, Set<FakeBroadcastChannel>>();

  readonly name: string;
  onmessage: ((event: MessageEvent) => unknown) | null = null;

  constructor(name: string) {
    this.name = name;
    const room = FakeBroadcastChannel.rooms.get(name) ?? new Set();
    room.add(this);
    FakeBroadcastChannel.rooms.set(name, room);
  }

  postMessage(data: unknown) {
    const recipients = FakeBroadcastChannel.rooms.get(this.name) ?? new Set();
    for (const recipient of recipients) {
      if (recipient === this) continue;
      queueMicrotask(() => recipient.onmessage?.({ data } as MessageEvent));
    }
  }

  close() {
    const room = FakeBroadcastChannel.rooms.get(this.name);
    room?.delete(this);
    if (room?.size === 0) FakeBroadcastChannel.rooms.delete(this.name);
  }
}

export function getBroadcastChannels(name: string) {
  return [...(FakeBroadcastChannel.rooms.get(name) ?? [])];
}

export function broadcastToRoom(name: string, data: unknown) {
  const recipients = FakeBroadcastChannel.rooms.get(name) ?? new Set();
  for (const recipient of recipients) {
    queueMicrotask(() => recipient.onmessage?.({ data } as MessageEvent));
  }
}

export class FakeRtpSender {
  track: FakeMediaStreamTrack | null;

  constructor(track: FakeMediaStreamTrack) {
    this.track = track;
  }

  replaceTrack = vi.fn(async (nextTrack: MediaStreamTrack | null) => {
    this.track = nextTrack as unknown as FakeMediaStreamTrack | null;
  });
}

export class FakePeerConnection {
  static instances: FakePeerConnection[] = [];

  readonly id = `peer-connection-${++peerSequence}`;
  connectionState: RTCPeerConnectionState = "new";
  localDescription: RTCSessionDescriptionInit | null = null;
  remoteDescription: RTCSessionDescriptionInit | null = null;
  ontrack: ((event: RTCTrackEvent) => unknown) | null = null;
  onicecandidate: ((event: RTCPeerConnectionIceEvent) => unknown) | null = null;
  onconnectionstatechange: (() => unknown) | null = null;
  readonly addedIceCandidates: RTCIceCandidateInit[] = [];
  private senders: FakeRtpSender[] = [];

  constructor() {
    FakePeerConnection.instances.push(this);
  }

  addTrack(track: MediaStreamTrack) {
    const sender = new FakeRtpSender(
      track as unknown as FakeMediaStreamTrack,
    );
    this.senders.push(sender);
    return sender as unknown as RTCRtpSender;
  }

  getSenders() {
    return this.senders as unknown as RTCRtpSender[];
  }

  async createOffer() {
    return { type: "offer", sdp: `offer:${this.id}` } as RTCSessionDescriptionInit;
  }

  async createAnswer() {
    return { type: "answer", sdp: `answer:${this.id}` } as RTCSessionDescriptionInit;
  }

  async setLocalDescription(description: RTCSessionDescriptionInit) {
    this.localDescription = description;
    if (description.type === "answer") this.scheduleConnected();
  }

  async setRemoteDescription(description: RTCSessionDescriptionInit) {
    this.remoteDescription = description;
    if (description.type === "answer") this.scheduleConnected();
  }

  async addIceCandidate(candidate: RTCIceCandidateInit) {
    if (!this.remoteDescription) {
      throw new Error("remote description is required before ICE candidate");
    }
    this.addedIceCandidates.push(candidate);
  }

  close() {
    this.connectionState = "closed";
    this.onconnectionstatechange?.();
  }

  private scheduleConnected() {
    setTimeout(() => {
      if (this.connectionState === "closed") return;
      this.connectionState = "connected";
      this.onconnectionstatechange?.();
    }, 0);
  }
}

function installBrowserFakes() {
  Object.defineProperty(globalThis.navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: getUserMediaMock,
      getDisplayMedia: getDisplayMediaMock,
      enumerateDevices: enumerateDevicesMock,
      addEventListener: (type: string, listener: EventListener) => {
        if (type === "devicechange") deviceChangeListeners.add(listener);
      },
      removeEventListener: (type: string, listener: EventListener) => {
        if (type === "devicechange") deviceChangeListeners.delete(listener);
      },
    },
  });
  Object.defineProperty(globalThis, "MediaStream", {
    configurable: true,
    value: FakeMediaStream,
  });
  Object.defineProperty(globalThis, "BroadcastChannel", {
    configurable: true,
    value: FakeBroadcastChannel,
  });
  Object.defineProperty(globalThis, "RTCPeerConnection", {
    configurable: true,
    value: FakePeerConnection,
  });
  Object.defineProperty(globalThis, "MediaRecorder", {
    configurable: true,
    value: FakeMediaRecorder,
  });
  Object.defineProperty(globalThis.crypto, "randomUUID", {
    configurable: true,
    value: vi.fn(() => {
      const suffix = String(++peerSequence).padStart(12, "0");
      return `00000000-0000-4000-8000-${suffix}`;
    }),
  });
}

beforeEach(() => {
  trackSequence = 0;
  peerSequence = 0;
  FakeBroadcastChannel.rooms.clear();
  FakePeerConnection.instances = [];
  FakeMediaRecorder.instances = [];
  deviceChangeListeners.clear();
  getUserMediaMock.mockReset();
  getUserMediaMock.mockImplementation(async (constraints) =>
    streamFor(constraints) as unknown as MediaStream,
  );
  getDisplayMediaMock.mockReset();
  getDisplayMediaMock.mockImplementation(async () =>
    new FakeMediaStream([
      new FakeMediaStreamTrack("video", "display-default"),
    ]) as unknown as MediaStream,
  );
  enumerateDevicesMock.mockClear();
  installBrowserFakes();
});

afterEach(() => {
  cleanup();
});
