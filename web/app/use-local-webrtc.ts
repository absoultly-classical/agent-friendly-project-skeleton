"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type CallStatus =
  | "idle"
  | "starting"
  | "waiting"
  | "connecting"
  | "connected"
  | "error";

type SignalMessage = {
  type: "hello" | "presence" | "offer" | "answer" | "ice" | "leave";
  from: string;
  target?: string;
  description?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
};

const makePeerId = () => crypto.randomUUID();

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

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const peerIdRef = useRef(makePeerId());
  const remotePeerRef = useRef("");
  const channelRef = useRef<BroadcastChannel | null>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const offeredToRef = useRef("");

  useEffect(() => {
    if (localVideoRef.current)
      localVideoRef.current.srcObject = screenStreamRef.current ?? localStream;
  }, [localStream, sharing, status]);
  useEffect(() => {
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = remoteStream;
  }, [remoteStream, status]);

  const refreshDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    const list = await navigator.mediaDevices.enumerateDevices();
    setDevices(list);
  }, []);

  const cleanup = useCallback((notify = true) => {
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
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
    remotePeerRef.current = "";
    offeredToRef.current = "";
    setLocalStream(null);
    setRemoteStream(null);
    setSharing(false);
  }, []);

  const leave = useCallback(() => {
    cleanup(true);
    setStatus("idle");
    setError("");
  }, [cleanup]);

  useEffect(() => () => cleanup(false), [cleanup]);

  const join = useCallback(async () => {
    if (
      !navigator.mediaDevices?.getUserMedia ||
      !window.RTCPeerConnection ||
      !window.BroadcastChannel
    ) {
      setError("当前浏览器不支持本地 WebRTC 会议实验。");
      setStatus("error");
      return;
    }
    const normalizedRoom = roomId.replace(/\D/g, "");
    if (normalizedRoom.length < 6) {
      setError("请输入至少 6 位房间号。");
      setStatus("error");
      return;
    }

    cleanup(false);
    setStatus("starting");
    setError("");
    setMicOn(true);
    setCameraOn(true);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: microphoneId ? { deviceId: { exact: microphoneId } } : true,
        video: cameraId
          ? {
              deviceId: { exact: cameraId },
              width: { ideal: 1280 },
              height: { ideal: 720 },
            }
          : { width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      localStreamRef.current = stream;
      setLocalStream(stream);
      await refreshDevices();

      const channel = new BroadcastChannel(
        `learning-meeting:${normalizedRoom}`,
      );
      channelRef.current = channel;

      const post = (message: Omit<SignalMessage, "from">) =>
        channel.postMessage({
          ...message,
          from: peerIdRef.current,
        } satisfies SignalMessage);

      const ensurePeer = () => {
        if (peerRef.current) return peerRef.current;
        const peer = new RTCPeerConnection();
        stream.getTracks().forEach((track) => peer.addTrack(track, stream));
        peer.ontrack = (event) => {
          const incoming = event.streams[0] ?? new MediaStream([event.track]);
          setRemoteStream(incoming);
        };
        peer.onicecandidate = (event) => {
          if (event.candidate && remotePeerRef.current)
            post({
              type: "ice",
              target: remotePeerRef.current,
              candidate: event.candidate.toJSON(),
            });
        };
        peer.onconnectionstatechange = () => {
          if (peer.connectionState === "connected") setStatus("connected");
          if (peer.connectionState === "connecting") setStatus("connecting");
          if (
            ["disconnected", "failed", "closed"].includes(peer.connectionState)
          ) {
            setRemoteStream(null);
            if (peer.connectionState !== "closed") setStatus("waiting");
          }
        };
        peerRef.current = peer;
        return peer;
      };

      const createOffer = async (target: string) => {
        if (offeredToRef.current === target) return;
        offeredToRef.current = target;
        remotePeerRef.current = target;
        const peer = ensurePeer();
        const offer = await peer.createOffer();
        await peer.setLocalDescription(offer);
        post({
          type: "offer",
          target,
          description: peer.localDescription ?? offer,
        });
        setStatus("connecting");
      };

      channel.onmessage = async (event: MessageEvent<SignalMessage>) => {
        const message = event.data;
        if (!message || message.from === peerIdRef.current) return;
        if (message.target && message.target !== peerIdRef.current) return;
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
            remotePeerRef.current = message.from;
            const peer = ensurePeer();
            await peer.setRemoteDescription(message.description);
            const answer = await peer.createAnswer();
            await peer.setLocalDescription(answer);
            post({
              type: "answer",
              target: message.from,
              description: peer.localDescription ?? answer,
            });
            setStatus("connecting");
          }
          if (message.type === "answer" && message.description) {
            await ensurePeer().setRemoteDescription(message.description);
          }
          if (message.type === "ice" && message.candidate) {
            await ensurePeer().addIceCandidate(message.candidate);
          }
          if (message.type === "leave") {
            peerRef.current?.close();
            peerRef.current = null;
            remotePeerRef.current = "";
            offeredToRef.current = "";
            setRemoteStream(null);
            setStatus("waiting");
          }
        } catch (signalError) {
          console.error(signalError);
          setError("连接协商失败，请双方离开后重新加入。");
          setStatus("error");
        }
      };

      setStatus("waiting");
      post({ type: "hello" });
    } catch (mediaError) {
      console.error(mediaError);
      cleanup(false);
      setError("无法使用摄像头或麦克风，请检查浏览器权限和设备占用情况。");
      setStatus("error");
    }
  }, [cameraId, cleanup, microphoneId, refreshDevices, roomId]);

  const toggleMic = useCallback(() => {
    const next = !micOn;
    localStreamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = next;
    });
    setMicOn(next);
  }, [micOn]);

  const toggleCamera = useCallback(() => {
    const next = !cameraOn;
    localStreamRef.current?.getVideoTracks().forEach((track) => {
      track.enabled = next;
    });
    setCameraOn(next);
  }, [cameraOn]);

  const switchCamera = useCallback(
    async (nextId: string) => {
      setCameraId(nextId);
      if (!localStreamRef.current || !nextId) return;
      try {
        const replacement = await navigator.mediaDevices.getUserMedia({
          video: {
            deviceId: { exact: nextId },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });
        const nextTrack = replacement.getVideoTracks()[0];
        nextTrack.enabled = cameraOn;
        const oldTrack = localStreamRef.current.getVideoTracks()[0];
        const sender = peerRef.current
          ?.getSenders()
          .find((item) => item.track?.kind === "video");
        if (sender) await sender.replaceTrack(nextTrack);
        if (oldTrack) {
          localStreamRef.current.removeTrack(oldTrack);
          oldTrack.stop();
        }
        localStreamRef.current.addTrack(nextTrack);
        setLocalStream(new MediaStream(localStreamRef.current.getTracks()));
      } catch (deviceError) {
        console.error(deviceError);
        setError("无法切换摄像头，请确认设备仍然可用。");
      }
    },
    [cameraOn],
  );

  const switchMicrophone = useCallback(
    async (nextId: string) => {
      setMicrophoneId(nextId);
      if (!localStreamRef.current || !nextId) return;
      try {
        const replacement = await navigator.mediaDevices.getUserMedia({
          audio: { deviceId: { exact: nextId } },
          video: false,
        });
        const nextTrack = replacement.getAudioTracks()[0];
        nextTrack.enabled = micOn;
        const oldTrack = localStreamRef.current.getAudioTracks()[0];
        const sender = peerRef.current
          ?.getSenders()
          .find((item) => item.track?.kind === "audio");
        if (sender) await sender.replaceTrack(nextTrack);
        if (oldTrack) {
          localStreamRef.current.removeTrack(oldTrack);
          oldTrack.stop();
        }
        localStreamRef.current.addTrack(nextTrack);
        setLocalStream(new MediaStream(localStreamRef.current.getTracks()));
      } catch (deviceError) {
        console.error(deviceError);
        setError("无法切换麦克风，请确认设备仍然可用。");
      }
    },
    [micOn],
  );

  const stopSharing = useCallback(async () => {
    const cameraTrack = localStreamRef.current?.getVideoTracks()[0];
    const sender = peerRef.current
      ?.getSenders()
      .find((item) => item.track?.kind === "video");
    if (sender && cameraTrack) await sender.replaceTrack(cameraTrack);
    screenStreamRef.current?.getTracks().forEach((track) => track.stop());
    screenStreamRef.current = null;
    setSharing(false);
  }, []);

  const toggleSharing = useCallback(async () => {
    if (sharing) {
      await stopSharing();
      return;
    }
    try {
      const screen = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false,
      });
      const screenTrack = screen.getVideoTracks()[0];
      const sender = peerRef.current
        ?.getSenders()
        .find((item) => item.track?.kind === "video");
      if (sender) await sender.replaceTrack(screenTrack);
      screenStreamRef.current = screen;
      setSharing(true);
      screenTrack.onended = () => {
        void stopSharing();
      };
    } catch (shareError) {
      if ((shareError as DOMException).name !== "NotAllowedError")
        setError("无法开始屏幕共享。");
    }
  }, [sharing, stopSharing]);

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
    refreshDevices,
  };
}
