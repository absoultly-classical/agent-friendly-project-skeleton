"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type CallStatus =
  | "idle"
  | "starting"
  | "waiting"
  | "connecting"
  | "connected"
  | "error";

export type JoinOptions = {
  audio?: boolean;
  video?: boolean;
  startMuted?: boolean;
};

export const MAX_ROOM_ID_LENGTH = 18;
export const MAX_PENDING_ICE_CANDIDATES = 128;

export function normalizeRoomId(value: string) {
  const normalized = value.replace(/[\s-]/g, "");
  return /^\d+$/.test(normalized) ? normalized : "";
}

type SignalMessage = {
  type: "hello" | "presence" | "offer" | "answer" | "ice" | "leave";
  from: string;
  target?: string;
  description?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
};

type PendingIceCandidate = {
  from: string;
  candidate: RTCIceCandidateInit;
};

const maxSignalPeerIdLength = 128;
const maxSignalSdpLength = 200_000;
const maxSignalCandidateLength = 4_096;
const maxSignalSdpMidLength = 128;

export function createRandomIdentifier() {
  const runtimeCrypto =
    typeof globalThis.crypto === "undefined" ? undefined : globalThis.crypto;
  if (typeof runtimeCrypto?.randomUUID === "function") {
    try {
      return runtimeCrypto.randomUUID();
    } catch {
      // Fall through to another local identifier source.
    }
  }
  if (typeof runtimeCrypto?.getRandomValues === "function") {
    try {
      const values = new Uint32Array(4);
      runtimeCrypto.getRandomValues(values);
      return Array.from(values, (value) => value.toString(16).padStart(8, "0")).join("");
    } catch {
      // Fall through to a non-cryptographic local identifier.
    }
  }
  return `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
}

function isSignalMessage(value: unknown): value is SignalMessage {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const message = value as Partial<SignalMessage>;
  if (
    typeof message.from !== "string" ||
    !message.from ||
    message.from.length > maxSignalPeerIdLength ||
    !["hello", "presence", "offer", "answer", "ice", "leave"].includes(
      message.type ?? "",
    )
  )
    return false;
  if (
    message.target !== undefined &&
    (typeof message.target !== "string" ||
      message.target.length > maxSignalPeerIdLength)
  )
    return false;
  if (message.type === "offer" || message.type === "answer") {
    const description = message.description;
    return (
      !!description &&
      typeof description === "object" &&
      description.type === message.type &&
      (description.sdp === undefined ||
        (typeof description.sdp === "string" &&
          description.sdp.length <= maxSignalSdpLength))
    );
  }
  if (message.type === "ice") {
    const candidate = message.candidate;
    return (
      !!candidate &&
      typeof candidate === "object" &&
      !Array.isArray(candidate) &&
      (candidate.candidate === undefined ||
        (typeof candidate.candidate === "string" &&
          candidate.candidate.length <= maxSignalCandidateLength)) &&
      (candidate.sdpMid === undefined ||
        (typeof candidate.sdpMid === "string" &&
          candidate.sdpMid.length <= maxSignalSdpMidLength)) &&
      (candidate.sdpMLineIndex === undefined ||
        candidate.sdpMLineIndex === null ||
        (Number.isInteger(candidate.sdpMLineIndex) &&
          candidate.sdpMLineIndex >= 0)) &&
      (candidate.usernameFragment === undefined ||
        (typeof candidate.usernameFragment === "string" &&
          candidate.usernameFragment.length <= maxSignalSdpMidLength))
    );
  }
  return true;
}

const makePeerId = () => createRandomIdentifier();

export function useLocalWebRTC() {
  const [status, setStatus] = useState<CallStatus>("idle");
  const [error, setError] = useState("");
  const [roomId, setRoomId] = useState("821406233");
  const [micOn, setMicOn] = useState(true);
  const [cameraOn, setCameraOn] = useState(true);
  const [sharing, setSharing] = useState(false);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [cameraId, setCameraId] = useState("");
  const [microphoneId, setMicrophoneId] = useState("");
  const micOnRef = useRef(true);
  const cameraOnRef = useRef(true);

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const peerIdRef = useRef(makePeerId());
  const remotePeerRef = useRef("");
  const channelRef = useRef<BroadcastChannel | null>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const offeredToRef = useRef("");
  const handledOfferRef = useRef("");
  const handledAnswerRef = useRef("");
  const operationRef = useRef(0);
  const pendingIceCandidatesRef = useRef<PendingIceCandidate[]>([]);
  const cameraSwitchRequestRef = useRef(0);
  const microphoneSwitchRequestRef = useRef(0);
  const sharingRequestRef = useRef(0);
  const deviceEnumerationRequestRef = useRef(0);

  useEffect(() => {
    if (localVideoRef.current)
      localVideoRef.current.srcObject = screenStreamRef.current ?? localStream;
  }, [localStream, sharing, status]);
  useEffect(() => {
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = remoteStream;
  }, [remoteStream, status]);

  const refreshDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    const request = ++deviceEnumerationRequestRef.current;
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      if (deviceEnumerationRequestRef.current !== request) return [];
      setDevices(list);
      setCameraId((current) =>
        current && !list.some((device) => device.deviceId === current)
          ? ""
          : current,
      );
      setMicrophoneId((current) =>
        current && !list.some((device) => device.deviceId === current)
          ? ""
          : current,
      );
      return list;
    } catch (deviceError) {
      if (deviceEnumerationRequestRef.current !== request) return [];
      console.error(deviceError);
      return [];
    }
  }, []);

  useEffect(() => {
    const mediaDevices = navigator.mediaDevices;
    if (!mediaDevices?.addEventListener) return;
    const handleDeviceChange = () => {
      void refreshDevices();
    };
    mediaDevices.addEventListener("devicechange", handleDeviceChange);
    return () =>
      mediaDevices.removeEventListener("devicechange", handleDeviceChange);
  }, [refreshDevices]);

  const bindTrackLifecycle = useCallback(
    (stream: MediaStream, operation: number) => {
      const audioTrack = stream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.onended = () => {
          if (
            operationRef.current !== operation ||
            localStreamRef.current !== stream
          )
            return;
          micOnRef.current = false;
          setMicOn(false);
          setError("麦克风已断开，请检查设备后重新加入。");
        };
      }
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.onended = () => {
          if (
            operationRef.current !== operation ||
            localStreamRef.current !== stream
          )
            return;
          cameraOnRef.current = false;
          setCameraOn(false);
          setError("摄像头已断开，请检查设备后重新加入。");
        };
      }
    },
    [],
  );

  const cleanup = useCallback((notify = true) => {
    operationRef.current += 1;
    if (notify && channelRef.current) {
      channelRef.current.postMessage({
        type: "leave",
        from: peerIdRef.current,
        target: remotePeerRef.current,
      } satisfies SignalMessage);
    }
    channelRef.current?.close();
    channelRef.current = null;
    peerRef.current?.close();
    peerRef.current = null;
    screenStreamRef.current?.getTracks().forEach((track) => track.stop());
    screenStreamRef.current = null;
    localStreamRef.current?.getTracks().forEach((track) => {
      track.onended = null;
      track.stop();
    });
    localStreamRef.current = null;
    remotePeerRef.current = "";
    offeredToRef.current = "";
    handledOfferRef.current = "";
    handledAnswerRef.current = "";
    pendingIceCandidatesRef.current = [];
    cameraSwitchRequestRef.current += 1;
    microphoneSwitchRequestRef.current += 1;
    sharingRequestRef.current += 1;
    deviceEnumerationRequestRef.current += 1;
    setLocalStream(null);
    setRemoteStream(null);
    setSharing(false);
  }, []);

  const leave = useCallback(() => {
    cleanup(true);
    setStatus("idle");
    setError("");
  }, [cleanup]);

  useEffect(() => {
    const handlePageHide = (event: PageTransitionEvent) => {
      if (event.persisted) return;
      leave();
    };
    window.addEventListener("pagehide", handlePageHide);
    return () => window.removeEventListener("pagehide", handlePageHide);
  }, [leave]);

  useEffect(() => () => cleanup(false), [cleanup]);

  const join = useCallback(async ({
    audio = true,
    video = true,
    startMuted = false,
  }: JoinOptions = {}) => {
    if (
      ((audio || video) && !navigator.mediaDevices?.getUserMedia) ||
      !window.RTCPeerConnection ||
      !window.BroadcastChannel
    ) {
      setError("当前浏览器不支持本地 WebRTC 会议实验。");
      setStatus("error");
      return;
    }
    const normalizedRoom = normalizeRoomId(roomId);
    if (!normalizedRoom) {
      setError("房间号只能包含数字，可使用空格或短横线分隔。");
      setStatus("error");
      return;
    }
    if (normalizedRoom.length < 6) {
      setError("请输入至少 6 位房间号。");
      setStatus("error");
      return;
    }
    if (normalizedRoom.length > MAX_ROOM_ID_LENGTH) {
      setError(`房间号不能超过 ${MAX_ROOM_ID_LENGTH} 位。`);
      setStatus("error");
      return;
    }

    setRoomId(normalizedRoom);
    cleanup(false);
    peerIdRef.current = makePeerId();
    const operation = operationRef.current;
    setStatus("starting");
    setError("");
    const nextMicOn = audio && !startMuted;
    const nextCameraOn = video;
    micOnRef.current = nextMicOn;
    cameraOnRef.current = nextCameraOn;
    setMicOn(nextMicOn);
    setCameraOn(nextCameraOn);

    try {
      const stream = audio || video
        ? await navigator.mediaDevices.getUserMedia({
            audio: audio
              ? microphoneId
                ? { deviceId: { exact: microphoneId } }
                : true
              : false,
            video: video && cameraId
              ? {
                  deviceId: { exact: cameraId },
                  width: { ideal: 1280 },
                  height: { ideal: 720 },
                }
              : video
                ? { width: { ideal: 1280 }, height: { ideal: 720 } }
                : false,
          })
        : new MediaStream();
      if (operationRef.current !== operation) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      stream.getAudioTracks().forEach((track) => {
        track.enabled = audio && !startMuted;
      });
      localStreamRef.current = stream;
      setLocalStream(stream);
      bindTrackLifecycle(stream, operation);
      await refreshDevices();
      if (operationRef.current !== operation) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      const channel = new BroadcastChannel(
        `learning-meeting:${normalizedRoom}`,
      );
      channelRef.current = channel;

      const post = (message: Omit<SignalMessage, "from">) =>
        channel.postMessage({
          ...message,
          from: peerIdRef.current,
        } satisfies SignalMessage);

      const flushPendingIceCandidates = async (
        peer: RTCPeerConnection,
        target: string,
      ) => {
        const pending = pendingIceCandidatesRef.current;
        pendingIceCandidatesRef.current = [];
        for (const pendingCandidate of pending) {
          if (pendingCandidate.from !== target) continue;
          await peer.addIceCandidate(pendingCandidate.candidate);
        }
      };

      const acceptIceCandidate = async (
        peer: RTCPeerConnection,
        from: string,
        candidate: RTCIceCandidateInit,
      ) => {
        if (!peer.remoteDescription) {
          if (
            remotePeerRef.current &&
            remotePeerRef.current !== from
          )
            return;
          if (
            pendingIceCandidatesRef.current.length >=
            MAX_PENDING_ICE_CANDIDATES
          ) {
            pendingIceCandidatesRef.current.shift();
          }
          pendingIceCandidatesRef.current.push({ from, candidate });
          return;
        }
        await peer.addIceCandidate(candidate);
      };

      const recoverFromPeerFailure = (peer: RTCPeerConnection) => {
        if (
          operationRef.current !== operation ||
          peerRef.current !== peer
        )
          return;
        const target = remotePeerRef.current;
        if (target) {
          post({ type: "leave", target });
        }
        cleanup(false);
        setError("连接已断开，请重新加入。");
        setStatus("error");
      };

      const ensurePeer = () => {
        if (peerRef.current) return peerRef.current;
        const peer = new RTCPeerConnection();
        const sharedVideoTrack = screenStreamRef.current
          ?.getVideoTracks()
          .find((track) => track.readyState !== "ended");
        const videoTrack = sharedVideoTrack ?? stream.getVideoTracks()[0];
        [...stream.getAudioTracks(), ...(videoTrack ? [videoTrack] : [])].forEach(
          (track) => peer.addTrack(track, stream),
        );
        peer.ontrack = (event) => {
          const incoming = event.streams[0] ?? new MediaStream([event.track]);
          setRemoteStream(incoming);
          event.track.onended = () => {
            if (
              operationRef.current !== operation ||
              peerRef.current !== peer
            )
              return;
            incoming.removeTrack(event.track);
            const remaining = incoming.getTracks();
            setRemoteStream(
              remaining.length > 0
                ? new MediaStream(remaining)
                : null,
            );
          };
        };
        peer.onicecandidate = (event) => {
          if (
            operationRef.current !== operation ||
            peerRef.current !== peer ||
            !event.candidate ||
            !remotePeerRef.current
          )
            return;
          post({
            type: "ice",
            target: remotePeerRef.current,
            candidate: event.candidate.toJSON(),
          });
        };
        peer.onconnectionstatechange = () => {
          if (
            operationRef.current !== operation ||
            peerRef.current !== peer
          )
            return;
          if (peer.connectionState === "connected") setStatus("connected");
          if (peer.connectionState === "connecting") setStatus("connecting");
          if (
            ["disconnected", "failed", "closed"].includes(peer.connectionState)
          ) {
            if (peer.connectionState !== "closed") {
              recoverFromPeerFailure(peer);
            }
          }
        };
        peerRef.current = peer;
        return peer;
      };

      const createOffer = async (target: string) => {
        if (operationRef.current !== operation) return;
        if (offeredToRef.current === target) return;
        offeredToRef.current = target;
        remotePeerRef.current = target;
        const peer = ensurePeer();
        const offer = await peer.createOffer();
        if (operationRef.current !== operation) return;
        await peer.setLocalDescription(offer);
        if (operationRef.current !== operation) return;
        post({
          type: "offer",
          target,
          description: peer.localDescription ?? offer,
        });
        setStatus("connecting");
      };

      let signalQueue = Promise.resolve();
      const handleSignal = async (message: SignalMessage) => {
        if (
          operationRef.current !== operation ||
          (remotePeerRef.current && message.from !== remotePeerRef.current)
        )
          return;
        try {
          if (message.type === "hello") {
            remotePeerRef.current = message.from;
            post({ type: "presence", target: message.from });
            if (peerIdRef.current < message.from)
              await createOffer(message.from);
          }
          if (message.type === "presence") {
            remotePeerRef.current = message.from;
            if (peerIdRef.current < message.from)
              await createOffer(message.from);
          }
          if (message.type === "offer" && message.description) {
            const descriptionKey = `${message.description.type}:${message.description.sdp ?? ""}`;
            if (handledOfferRef.current === descriptionKey) return;
            handledOfferRef.current = descriptionKey;
            remotePeerRef.current = message.from;
            const peer = ensurePeer();
            await peer.setRemoteDescription(message.description);
            if (operationRef.current !== operation) return;
            await flushPendingIceCandidates(peer, message.from);
            const answer = await peer.createAnswer();
            if (operationRef.current !== operation) return;
            await peer.setLocalDescription(answer);
            if (operationRef.current !== operation) return;
            post({
              type: "answer",
              target: message.from,
              description: peer.localDescription ?? answer,
            });
            setStatus("connecting");
          }
          if (message.type === "answer" && message.description) {
            const descriptionKey = `${message.description.type}:${message.description.sdp ?? ""}`;
            if (handledAnswerRef.current === descriptionKey) return;
            handledAnswerRef.current = descriptionKey;
            const peer = ensurePeer();
            await peer.setRemoteDescription(message.description);
            if (operationRef.current !== operation) return;
            await flushPendingIceCandidates(peer, message.from);
          }
          if (message.type === "ice" && message.candidate) {
            const peer = ensurePeer();
            await acceptIceCandidate(peer, message.from, message.candidate);
            if (operationRef.current !== operation) return;
          }
          if (message.type === "leave") {
            peerRef.current?.close();
            peerRef.current = null;
            remotePeerRef.current = "";
            offeredToRef.current = "";
            handledOfferRef.current = "";
            handledAnswerRef.current = "";
            pendingIceCandidatesRef.current = [];
            setRemoteStream(null);
            setStatus("waiting");
          }
        } catch (signalError) {
          if (operationRef.current !== operation) return;
          console.error(signalError);
          cleanup(true);
          setError("连接协商失败，请双方离开后重新加入。");
          setStatus("error");
        }
      };
      channel.onmessage = (event: MessageEvent<SignalMessage>) => {
        const message = event.data;
        if (
          operationRef.current !== operation ||
          !isSignalMessage(message) ||
          message.from === peerIdRef.current
        )
          return;
        if (message.target && message.target !== peerIdRef.current) return;
        if (remotePeerRef.current && message.from !== remotePeerRef.current)
          return;
        signalQueue = signalQueue
          .then(() => handleSignal(message))
          .catch((signalError) => {
            if (operationRef.current !== operation) return;
            console.error(signalError);
            cleanup(true);
            setError("连接协商失败，请双方离开后重新加入。");
            setStatus("error");
          });
      };

      setStatus("waiting");
      post({ type: "hello" });
    } catch (mediaError) {
      if (operationRef.current !== operation) return;
      console.error(mediaError);
      cleanup(false);
      setError("无法使用摄像头或麦克风，请检查浏览器权限和设备占用情况。");
      setStatus("error");
    }
  }, [bindTrackLifecycle, cameraId, cleanup, microphoneId, refreshDevices, roomId]);

  const toggleMic = useCallback(() => {
    const tracks = (localStreamRef.current?.getAudioTracks() ?? []).filter(
      (track) => track.readyState !== "ended",
    );
    if (tracks.length === 0) return;
    const next = !micOnRef.current;
    tracks.forEach((track) => {
      track.enabled = next;
    });
    micOnRef.current = next;
    setMicOn(next);
  }, []);

  const toggleCamera = useCallback(() => {
    const tracks = (localStreamRef.current?.getVideoTracks() ?? []).filter(
      (track) => track.readyState !== "ended",
    );
    if (tracks.length === 0) return;
    const next = !cameraOnRef.current;
    tracks.forEach((track) => {
      track.enabled = next;
    });
    cameraOnRef.current = next;
    setCameraOn(next);
  }, []);

  const switchCamera = useCallback(
    async (nextId: string) => {
      const previousId = cameraId;
      const request = ++cameraSwitchRequestRef.current;
      const stream = localStreamRef.current;
      if (!stream) {
        setCameraId(nextId);
        return;
      }
      if (!stream.getVideoTracks().some((track) => track.readyState !== "ended")) {
        setError("当前未开启摄像头，请离开后重新加入并开启摄像头。");
        return;
      }
      setCameraId(nextId);
      const operation = operationRef.current;
      const oldTrack = stream.getVideoTracks()[0];
      const sender = peerRef.current
        ?.getSenders()
        .find((item) => item.track?.kind === "video");
      let replacement: MediaStream | null = null;
      try {
        replacement = await navigator.mediaDevices.getUserMedia({
          video: nextId
            ? {
                deviceId: { exact: nextId },
                width: { ideal: 1280 },
                height: { ideal: 720 },
              }
            : { width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        if (
          operationRef.current !== operation ||
          cameraSwitchRequestRef.current !== request
        ) {
          replacement.getTracks().forEach((track) => track.stop());
          return;
        }
        const nextTrack = replacement.getVideoTracks()[0];
        if (!nextTrack) {
          replacement.getTracks().forEach((track) => track.stop());
          setCameraId(previousId);
          return;
        }
        nextTrack.enabled = cameraOnRef.current;
        if (sender && !screenStreamRef.current) await sender.replaceTrack(nextTrack);
        if (
          operationRef.current !== operation ||
          cameraSwitchRequestRef.current !== request
        ) {
          const restoreTrack =
            screenStreamRef.current?.getVideoTracks().find(
              (track) => track.readyState !== "ended",
            ) ?? oldTrack;
          if (sender?.track === nextTrack) {
            try {
              await sender.replaceTrack(restoreTrack ?? null);
            } catch {
              // A newer operation or a closed peer owns the sender now.
            }
          }
          nextTrack.stop();
          return;
        }
        if (oldTrack) {
          oldTrack.onended = null;
          stream.removeTrack(oldTrack);
          oldTrack.stop();
        }
        stream.addTrack(nextTrack);
        bindTrackLifecycle(stream, operation);
        setLocalStream(new MediaStream(stream.getTracks()));
        setError("");
      } catch (deviceError) {
        const replacementTrack = replacement?.getVideoTracks()[0];
        const isCurrentRequest =
          operationRef.current === operation &&
          cameraSwitchRequestRef.current === request;
        if (isCurrentRequest && sender && sender.track === replacementTrack) {
          try {
            await sender.replaceTrack(oldTrack ?? null);
          } catch {
            // The sender may have become unavailable while rolling back.
          }
        }
        replacement?.getTracks().forEach((track) => track.stop());
        if (!isCurrentRequest) return;
        setCameraId(previousId);
        console.error(deviceError);
        setError("无法切换摄像头，请确认设备仍然可用。");
      }
    },
    [bindTrackLifecycle, cameraId],
  );

  const switchMicrophone = useCallback(
    async (nextId: string) => {
      const previousId = microphoneId;
      const request = ++microphoneSwitchRequestRef.current;
      const stream = localStreamRef.current;
      if (!stream) {
        setMicrophoneId(nextId);
        return;
      }
      if (!stream.getAudioTracks().some((track) => track.readyState !== "ended")) {
        setError("当前未开启麦克风，请离开后重新加入并开启麦克风。");
        return;
      }
      setMicrophoneId(nextId);
      const operation = operationRef.current;
      const oldTrack = stream.getAudioTracks()[0];
      const sender = peerRef.current
        ?.getSenders()
        .find((item) => item.track?.kind === "audio");
      let replacement: MediaStream | null = null;
      try {
        replacement = await navigator.mediaDevices.getUserMedia({
          audio: nextId ? { deviceId: { exact: nextId } } : true,
          video: false,
        });
        if (
          operationRef.current !== operation ||
          microphoneSwitchRequestRef.current !== request
        ) {
          replacement.getTracks().forEach((track) => track.stop());
          return;
        }
        const nextTrack = replacement.getAudioTracks()[0];
        if (!nextTrack) {
          replacement.getTracks().forEach((track) => track.stop());
          setMicrophoneId(previousId);
          return;
        }
        nextTrack.enabled = micOnRef.current;
        if (sender) await sender.replaceTrack(nextTrack);
        if (
          operationRef.current !== operation ||
          microphoneSwitchRequestRef.current !== request
        ) {
          if (sender?.track === nextTrack) {
            try {
              await sender.replaceTrack(oldTrack ?? null);
            } catch {
              // A newer operation or a closed peer owns the sender now.
            }
          }
          nextTrack.stop();
          return;
        }
        if (oldTrack) {
          oldTrack.onended = null;
          stream.removeTrack(oldTrack);
          oldTrack.stop();
        }
        stream.addTrack(nextTrack);
        bindTrackLifecycle(stream, operation);
        setLocalStream(new MediaStream(stream.getTracks()));
        setError("");
      } catch (deviceError) {
        const replacementTrack = replacement?.getAudioTracks()[0];
        const isCurrentRequest =
          operationRef.current === operation &&
          microphoneSwitchRequestRef.current === request;
        if (isCurrentRequest && sender && sender.track === replacementTrack) {
          try {
            await sender.replaceTrack(oldTrack ?? null);
          } catch {
            // The sender may have become unavailable while rolling back.
          }
        }
        replacement?.getTracks().forEach((track) => track.stop());
        if (!isCurrentRequest) return;
        setMicrophoneId(previousId);
        console.error(deviceError);
        setError("无法切换麦克风，请确认设备仍然可用。");
      }
    },
    [bindTrackLifecycle, microphoneId],
  );

  const stopSharing = useCallback(
    async (
      expectedOperation = operationRef.current,
      expectedScreen?: MediaStream,
    ) => {
      if (
        operationRef.current !== expectedOperation ||
        (expectedScreen && screenStreamRef.current !== expectedScreen)
      )
        return;
      const videoTracks = localStreamRef.current?.getVideoTracks() ?? [];
      const cameraTrack = videoTracks.find((track) => track.readyState !== "ended");
      if (videoTracks.length > 0 && !cameraTrack) {
        setError("无法恢复摄像头画面，请继续共享或重新加入。");
        return;
      }
      const sender = peerRef.current
        ?.getSenders()
        .find((item) => item.track?.kind === "video");
      const screenTrack = screenStreamRef.current
        ?.getVideoTracks()
        .find((track) => track.readyState !== "ended");
      try {
        if (sender && cameraTrack) await sender.replaceTrack(cameraTrack);
      } catch (shareError) {
        console.error(shareError);
        if (sender && sender.track === cameraTrack && screenTrack) {
          try {
            await sender.replaceTrack(screenTrack);
          } catch {
            // The sender may have become unavailable while rolling back.
          }
        }
        if (
          operationRef.current === expectedOperation &&
          (!expectedScreen || screenStreamRef.current === expectedScreen)
        )
          setError("无法恢复摄像头画面，请继续共享或重新加入。");
        return;
      }
      if (
        operationRef.current !== expectedOperation ||
        (expectedScreen && screenStreamRef.current !== expectedScreen)
      )
        return;
      screenStreamRef.current?.getTracks().forEach((track) => track.stop());
      screenStreamRef.current = null;
      setSharing(false);
    },
    [],
  );

  const toggleSharing = useCallback(async () => {
    const request = ++sharingRequestRef.current;
    if (sharing) {
      await stopSharing();
      return;
    }
    const hasLiveVideoTrack = localStreamRef.current
      ?.getVideoTracks()
      .some((track) => track.readyState !== "ended");
    if (!hasLiveVideoTrack) {
      setError("开启摄像头后才能共享屏幕。");
      return;
    }
    const operation = operationRef.current;
    const cameraTrack = localStreamRef.current
      ?.getVideoTracks()
      .find((track) => track.readyState !== "ended");
    let sender: RTCRtpSender | undefined;
    let screenTrack: MediaStreamTrack | undefined;
    let screen: MediaStream | null = null;
    try {
      screen = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false,
      });
      if (
        operationRef.current !== operation ||
        sharingRequestRef.current !== request
      ) {
        screen.getTracks().forEach((track) => track.stop());
        return;
      }
      const nextScreenTrack = screen.getVideoTracks()[0];
      if (!nextScreenTrack) {
        screen.getTracks().forEach((track) => track.stop());
        return;
      }
      screenTrack = nextScreenTrack;
      sender = peerRef.current
        ?.getSenders()
        .find((item) => item.track?.kind === "video");
      if (sender) await sender.replaceTrack(nextScreenTrack);
      if (
        operationRef.current !== operation ||
        sharingRequestRef.current !== request
      ) {
        screen.getTracks().forEach((track) => track.stop());
        return;
      }
      const currentScreen = screen;
      screenStreamRef.current = currentScreen;
      setSharing(true);
      nextScreenTrack.onended = () => {
        void stopSharing(operation, currentScreen);
      };
    } catch (shareError) {
      screen?.getTracks().forEach((track) => track.stop());
      if (sender && sender.track === screenTrack && cameraTrack) {
        try {
          await sender.replaceTrack(cameraTrack);
        } catch {
          // The sender may have become unavailable while rolling back.
        }
      }
      if (
        operationRef.current !== operation ||
        sharingRequestRef.current !== request
      )
        return;
      if ((shareError as DOMException).name !== "NotAllowedError")
        setError("无法开始屏幕共享。");
    }
  }, [sharing, stopSharing]);

  const getRecordingStream = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return null;
    const audioTracks = stream
      .getAudioTracks()
      .filter((track) => track.readyState !== "ended");
    const videoTrack =
      screenStreamRef.current
        ?.getVideoTracks()
        .find((track) => track.readyState !== "ended") ??
      stream.getVideoTracks().find((track) => track.readyState !== "ended");
    return new MediaStream([...audioTracks, ...(videoTrack ? [videoTrack] : [])]);
  }, []);

  return {
    status,
    error,
    roomId,
    setRoomId,
    micOn,
    cameraOn,
    sharing,
    localStream,
    remoteStream,
    localVideoRef,
    remoteVideoRef,
    devices,
    cameraId,
    setCameraId,
    microphoneId,
    setMicrophoneId,
    switchCamera,
    switchMicrophone,
    join,
    leave,
    toggleMic,
    toggleCamera,
    toggleSharing,
    getRecordingStream,
    refreshDevices,
  };
}
