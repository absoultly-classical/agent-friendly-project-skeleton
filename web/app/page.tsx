"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import {
  createRandomIdentifier,
  MAX_ROOM_ID_LENGTH,
  normalizeRoomId,
  useLocalWebRTC,
} from "./use-local-webrtc";
import type { JoinOptions } from "./use-local-webrtc";
import { useLocalRecording } from "./use-local-recording";
import {
  readStoredJson,
  readStoredText,
  removeStoredValue,
  writeStoredJson,
  writeStoredText,
} from "./local-storage";
import {
  pruneLocalMaterialContents,
  readLocalMaterialContents,
  removeLocalMaterialContent,
  saveLocalMaterialContent,
} from "./use-local-material-contents";
import {
  pruneLocalRecordings,
  readLocalRecording,
  removeLocalRecording,
  saveLocalRecording,
} from "./use-local-recording-storage";

type View = "home" | "meeting" | "report";
type Panel = "members" | "chat" | "activities" | null;
type Setter<T> = Dispatch<SetStateAction<T>>;
type MeetingMode = "class" | "normal";
const maxMeetingTitleLength = 120;
const maxParticipantNameLength = 80;
const maxMaterialFileNameLength = 160;
const maxReportDurationSeconds = 7 * 24 * 60 * 60;
const maxReportChatMessageCount = 100_000;
const maxReportSnapshotPayloadLength = 100_000;
type SessionReportSnapshot = {
  durationSeconds: number;
  chatMessageCount: number;
  publishedActivityCount: number;
  publishedActivityIds: ActivityId[];
  recordingAvailable: boolean;
  participantCount: number;
  participantName: string;
  meetingMode: MeetingMode;
};
type ReportTodo = {
  id: string;
  title: string;
  detail: string;
  done: boolean;
};
type CreateIntent = "start" | "schedule";
type CourseId = "digital" | "interaction";
type ClassId = "class1" | "class2";
type JoinPreferences = Required<Pick<JoinOptions, "audio" | "video">>;
type LocalWebRTCApi = ReturnType<typeof useLocalWebRTC>;
type MeetingGridCall = Pick<
  LocalWebRTCApi,
  | "status"
  | "error"
  | "roomId"
  | "setRoomId"
  | "micOn"
  | "cameraOn"
  | "sharing"
  | "localStream"
  | "remoteStream"
  | "devices"
  | "cameraId"
  | "microphoneId"
  | "switchCamera"
  | "switchMicrophone"
  | "join"
  | "leave"
>;

const navItems = [
  { icon: "⌂", label: "会议首页" },
  { icon: "▣", label: "我的会议" },
  { icon: "◎", label: "课堂回放" },
  { icon: "▤", label: "会议资料" },
];
type UtilityPanel = "search" | "notifications" | null;
type TopbarActions = {
  onSearch: (trigger: HTMLButtonElement) => void;
  onNotifications: (trigger: HTMLButtonElement) => void;
  unreadNotifications: number;
  activeUtilityPanel: UtilityPanel;
};
const notificationCatalog = [
  {
    id: "replay-ready",
    title: "课堂回放已生成",
    detail: "数字媒体技术 · 第 3 讲已完成字幕和章节",
    time: "2 分钟前",
    nav: "课堂回放",
    targetTitle: "第 3 讲 · 信息架构与导航设计",
  },
  {
    id: "defense-reminder",
    title: "下一场会议即将开始",
    detail: "毕业设计中期答辩将在 36 分钟后开始",
    time: "12 分钟前",
    nav: "我的会议",
  },
  {
    id: "attendance-alert",
    title: "课堂出勤需要关注",
    detail: "数字媒体技术 · 第 3 讲有 6 位学生未到",
    time: "今天 11:42",
    nav: "我的会议",
  },
] as const;
type AppNotification = (typeof notificationCatalog)[number] & {
  read: boolean;
  targetTitle?: string;
};
const notificationReadStorageKey = "learning-meeting-notification-read";
const maxNotificationReadStorageLength = 4096;
const localReportTodoStoragePrefix = "learning-meeting-report-todos:";
const maxReportTodoStorageLength = 16_000;
const maxStoredReportTodoIdLength = 80;
const maxStoredReportTodoTextLength = 240;

function readNotificationReadIds(): string[] {
  const parsed = readStoredJson(
    notificationReadStorageKey,
    maxNotificationReadStorageLength,
  );
  if (!Array.isArray(parsed)) return [];
  const knownIds = new Set<string>(
    notificationCatalog.map((notification) => notification.id),
  );
  return Array.from(
    new Set(
      parsed.filter(
        (value): value is string =>
          typeof value === "string" && knownIds.has(value),
      ),
    ),
  );
}

function writeNotificationReadIds(ids: readonly string[]) {
  const knownIds = new Set<string>(
    notificationCatalog.map((notification) => notification.id),
  );
  const normalized = Array.from(new Set(ids)).filter((id) => knownIds.has(id));
  return writeStoredJson(
    notificationReadStorageKey,
    normalized,
    maxNotificationReadStorageLength,
  );
}

function createNotifications(readIds: readonly string[]): AppNotification[] {
  const readIdSet = new Set(readIds);
  return notificationCatalog.map((notification) => ({
    ...notification,
    read: readIdSet.has(notification.id),
  }));
}

function reportTodoStorageKey(roomId: string) {
  return `${localReportTodoStoragePrefix}${roomId}`;
}

function readLocalReportTodos(roomId: string | null): ReportTodo[] {
  const todos: ReportTodo[] = [];
  if (!roomId) return todos;
  const parsed = readStoredJson(
    reportTodoStorageKey(roomId),
    maxReportTodoStorageLength,
  );
  if (!Array.isArray(parsed)) return todos;
  const seenIds = new Set<string>();
  parsed.forEach((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    const todo = value as {
      id?: unknown;
      title?: unknown;
      detail?: unknown;
      done?: unknown;
    };
    if (
      typeof todo.id === "string" &&
      todo.id.trim().length > 0 &&
      todo.id.length <= maxStoredReportTodoIdLength &&
      typeof todo.title === "string" &&
      todo.title.trim().length > 0 &&
      todo.title.length <= maxStoredReportTodoTextLength &&
      typeof todo.detail === "string" &&
      todo.detail.length <= maxStoredReportTodoTextLength &&
      typeof todo.done === "boolean" &&
      !seenIds.has(todo.id.trim())
    ) {
      seenIds.add(todo.id.trim());
      todos.push({
        id: todo.id.trim(),
        title: todo.title.trim(),
        detail: todo.detail.trim(),
        done: todo.done,
      });
    }
  });
  return todos.slice(0, 100);
}

function writeLocalReportTodoState(roomId: string | null, todos: readonly ReportTodo[]) {
  if (!roomId) return false;
  const normalized = todos
    .filter(
      (todo) =>
        typeof todo.id === "string" &&
        todo.id.trim().length > 0 &&
        todo.id.length <= maxStoredReportTodoIdLength &&
        todo.title.trim().length > 0 &&
        todo.title.length <= maxStoredReportTodoTextLength &&
        todo.detail.length <= maxStoredReportTodoTextLength,
    )
    .map((todo) => ({
      id: todo.id.trim(),
      title: todo.title.trim(),
      detail: todo.detail.trim(),
      done: todo.done === true,
    }))
    .slice(0, 100);
  return writeStoredJson(
    reportTodoStorageKey(roomId),
    normalized,
    maxReportTodoStorageLength,
  );
}

function mergeReportTodos(
  defaultTodos: readonly ReportTodo[],
  savedTodos: readonly ReportTodo[],
): ReportTodo[] {
  const savedById = new Map(savedTodos.map((todo) => [todo.id, todo]));
  const defaultIds = new Set(defaultTodos.map((todo) => todo.id));
  return [
    ...defaultTodos.map((todo) => ({
      ...todo,
      done: savedById.get(todo.id)?.done ?? todo.done,
    })),
    ...savedTodos.filter((todo) => !defaultIds.has(todo.id)),
  ];
}

function removeLocalReportTodos(roomId: string): boolean {
  if (!roomId || typeof window === "undefined") return false;
  try {
    const key = reportTodoStorageKey(roomId);
    window.localStorage.removeItem(key);
    return window.localStorage.getItem(key) === null;
  } catch {
    return false;
  }
}
const schedules = [
  {
    time: "10:00",
    title: "数字媒体技术 · 课堂",
    meta: "教学楼 A302 · 48 人",
    tag: "课程课堂",
    color: "green",
    roomId: "821406233",
    mode: "class",
  },
  {
    time: "14:30",
    title: "毕业设计中期答辩",
    meta: "线上会议 · 12 人",
    tag: "答辩",
    color: "amber",
    roomId: "563294108",
    mode: "normal",
  },
  {
    time: "19:00",
    title: "《交互设计》小组讨论",
    meta: "线上会议 · 8 人",
    tag: "小组会议",
    color: "blue",
    roomId: "704915286",
    mode: "normal",
  },
] as const;

function createLocalRoomId(additionalReservedRoomIds: readonly string[] = []) {
  const reservedRoomIds = new Set<string>(
    [...schedules.map((item) => item.roomId), ...additionalReservedRoomIds],
  );
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const uuidPrefix = createRandomIdentifier().replace(/-/g, "").slice(0, 8);
    const candidate = String(Number.parseInt(uuidPrefix, 16) % 1_000_000_000).padStart(
      9,
      "0",
    );
    if (!reservedRoomIds.has(candidate)) return candidate;
  }
  let fallback = 936217504;
  while (reservedRoomIds.has(String(fallback).padStart(9, "0"))) {
    fallback = (fallback + 1) % 1_000_000_000;
  }
  return String(fallback).padStart(9, "0");
}

function createScheduledRoomId(additionalReservedRoomIds: readonly string[] = []) {
  return createLocalRoomId(additionalReservedRoomIds);
}

type ReplayViewerItem = {
  course: string;
  title: string;
  date: string;
  duration: string;
  views: string;
  color: string;
  progress: number;
  localOnly?: boolean;
  roomId?: string;
  recordingAvailable?: boolean;
  recordingBlob?: Blob | null;
};
type ReplayItem = ReplayViewerItem;

const replayCatalog: readonly ReplayItem[] = [
  {
    course: "数字媒体技术",
    title: "第 3 讲 · 信息架构与导航设计",
    date: "今天 11:40",
    duration: "01:38:42",
    views: "36/48 已观看",
    color: "teal",
    progress: 82,
  },
  {
    course: "交互设计",
    title: "第 2 讲 · 用户研究方法",
    date: "8 月 27 日",
    duration: "01:26:18",
    views: "42/46 已观看",
    color: "blue",
    progress: 100,
  },
  {
    course: "毕业设计",
    title: "中期答辩 · 第一组",
    date: "8 月 25 日",
    duration: "02:12:05",
    views: "12/12 已观看",
    color: "violet",
    progress: 64,
  },
  {
    course: "产品设计教研室",
    title: "新学期课程建设研讨",
    date: "8 月 22 日",
    duration: "00:58:30",
    views: "18/24 已观看",
    color: "amber",
    progress: 35,
  },
];

export function matchesReplaySearch(
  item: { course: string; title: string },
  query: string,
) {
  const normalizedQuery = query.trim().toLowerCase();
  return `${item.course}${item.title}`.toLowerCase().includes(normalizedQuery);
}

const publishedReplayStorageKey = "learning-meeting-published-replay";
const maxPublishedReplayStorageLength = 512;

function readPublishedReplayTitle() {
  const stored = readStoredText(
    publishedReplayStorageKey,
    maxPublishedReplayStorageLength,
  )?.trim();
  return stored && replayCatalog.some((item) => item.title === stored)
    ? stored
    : null;
}

function writePublishedReplayTitle(title: string | null) {
  return title
    ? writeStoredText(publishedReplayStorageKey, title)
    : removeStoredValue(publishedReplayStorageKey);
}

function createLocalReplayPlaceholder(
  title: string,
  roomId?: string,
): ReplayViewerItem {
  return {
    course: "本地报告回放",
    title,
    date: roomId ? "来自本地回放引用" : "来自本地报告",
    duration: "—",
    views: "仅当前演示",
    color: "teal",
    progress: 0,
    localOnly: true,
    roomId,
    recordingAvailable: Boolean(roomId),
  };
}

function localReplayColor(accent: string) {
  if (accent === "blue" || accent === "violet" || accent === "amber") {
    return accent;
  }
  return "teal";
}

function createLocalReplayItem(
  meeting: ScheduledMeeting & {
    status: "past";
    reportSnapshot: SessionReportSnapshot;
  },
  recordingBlob: Blob | null,
): ReplayViewerItem {
  const snapshot = meeting.reportSnapshot;
  return {
    course: meeting.mode === "normal" ? "本地会议" : "本地课堂",
    title: meeting.title,
    date: `${meeting.month} ${meeting.day} · ${meeting.time}`,
    duration: snapshot ? formatMeetingDuration(snapshot.durationSeconds) : "—",
    views: recordingBlob ? "本机可播放" : "本地媒体待恢复",
    color: localReplayColor(meeting.accent),
    progress: 0,
    localOnly: true,
    roomId: meeting.roomId,
    recordingAvailable: true,
    recordingBlob,
  };
}

type MaterialFolder = "录制" | "课件" | "白板" | "活动";
type MaterialFile = {
  id: string;
  icon: string;
  name: string;
  source: string;
  size: string;
  time: string;
  color: string;
  folder: MaterialFolder;
};

type LocalFilePreviewKind = "image" | "video" | "audio" | null;

function getLocalFilePreviewKind(file: File): LocalFilePreviewKind {
  const type = file.type.toLowerCase();
  if (type.startsWith("image/")) return "image";
  if (type.startsWith("video/")) return "video";
  if (type.startsWith("audio/")) return "audio";
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(extension)) {
    return "image";
  }
  if (["mp4", "mov", "webm", "m4v"].includes(extension)) return "video";
  if (["mp3", "wav", "ogg", "m4a"].includes(extension)) return "audio";
  return null;
}

function LocalFileMediaPreview({ file }: { file: File }) {
  const objectUrlRef = useRef<string | null>(null);
  const releaseObjectUrl = useCallback(() => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  }, []);
  const attachObjectUrl = useCallback(
    (element: HTMLMediaElement | HTMLImageElement | null) => {
      releaseObjectUrl();
      if (!element || typeof URL.createObjectURL !== "function") return;
      const objectUrl = URL.createObjectURL(file);
      objectUrlRef.current = objectUrl;
      element.src = objectUrl;
    },
    [file, releaseObjectUrl],
  );
  useEffect(() => releaseObjectUrl, [releaseObjectUrl]);

  const kind = getLocalFilePreviewKind(file);
  if (!kind || typeof URL.createObjectURL !== "function") return null;
  if (kind === "image") {
    // Blob URLs are created at runtime and cannot use the static image optimizer.
    // eslint-disable-next-line @next/next/no-img-element
    return <img ref={attachObjectUrl} alt={`预览${file.name}`} />;
  }
  if (kind === "video") {
    return (
      <video
        ref={attachObjectUrl}
        controls
        playsInline
        preload="metadata"
        aria-label={`预览${file.name}`}
      />
    );
  }
  return (
    <audio
      ref={attachObjectUrl}
      controls
      preload="metadata"
      aria-label={`预览${file.name}`}
    />
  );
}

const materialCatalog: MaterialFile[] = [
  {
    id: "material-course-slides",
    icon: "P",
    name: "第 3 讲 · 信息架构课件.pptx",
    source: "数字媒体技术",
    size: "18.6 MB",
    time: "今天 09:42",
    color: "orange",
    folder: "课件",
  },
  {
    id: "material-defense-plan",
    icon: "W",
    name: "毕业设计中期答辩安排.docx",
    source: "毕业设计",
    size: "1.2 MB",
    time: "昨天 16:20",
    color: "blue",
    folder: "课件",
  },
  {
    id: "material-interaction-recording",
    icon: "V",
    name: "课堂录制 · 交互设计第 2 讲.mp4",
    source: "交互设计",
    size: "386 MB",
    time: "8 月 27 日",
    color: "violet",
    folder: "录制",
  },
  {
    id: "material-attendance-results",
    icon: "X",
    name: "课堂签到与测验结果.xlsx",
    source: "数字媒体技术",
    size: "246 KB",
    time: "8 月 27 日",
    color: "green",
    folder: "活动",
  },
];
type GlobalSearchResult = {
  id: string;
  kind: "会议" | "回放" | "资料";
  title: string;
  detail: string;
  nav: string;
  roomId?: string;
  materialId?: string;
};
const globalSearchCatalog: GlobalSearchResult[] = [
  ...schedules.map((item) => ({
    id: `meeting-${item.roomId}`,
    kind: "会议" as const,
    title: item.title,
    detail: `${item.tag} · ${item.meta}`,
    nav: "我的会议",
    roomId: item.roomId,
  })),
  ...replayCatalog.map((item) => ({
    id: `replay-${item.title}`,
    kind: "回放" as const,
    title: item.title,
    detail: `${item.course} · ${item.duration}`,
    nav: "课堂回放",
  })),
  ...materialCatalog.map((item) => ({
    id: `material-${item.name}`,
    kind: "资料" as const,
    title: item.name,
    detail: `${item.source} · ${item.size}`,
    nav: "会议资料",
    materialId: item.id,
  })),
];
const participants = [
  { name: "林老师", role: "主持人", color: "#c6f1e2", mic: true, camera: true },
  { name: "周雨桐", role: "学生", color: "#f3d49c", mic: false, camera: true },
  { name: "许明哲", role: "学生", color: "#d7d1fb", mic: false, camera: true },
  { name: "陈一凡", role: "学生", color: "#facbc1", mic: true, camera: true },
  { name: "苏晓", role: "学生", color: "#bfddf2", mic: false, camera: false },
  { name: "王子涵", role: "学生", color: "#e5d4f4", mic: false, camera: true },
];
type MemberListItem = {
  name: string;
  status: string;
  presence: string;
  mic: boolean;
};
const memberList: MemberListItem[] = [
  { name: "林老师", status: "主持人", presence: "已到", mic: true },
  { name: "周雨桐", status: "学生", presence: "已到", mic: false },
  { name: "许明哲", status: "学生", presence: "已到", mic: false },
  { name: "陈一凡", status: "学生", presence: "已到", mic: true },
  { name: "苏晓", status: "学生", presence: "迟到 3 分钟", mic: false },
  { name: "王子涵", status: "学生", presence: "已到", mic: false },
  { name: "赵欣然", status: "学生", presence: "未到", mic: false },
];
const baseMessages = [
  { name: "周雨桐", time: "10:18", text: "老师，案例里的字体需要统一吗？" },
  { name: "林老师", time: "10:19", text: "需要，先统一层级，再处理字重。" },
  { name: "许明哲", time: "10:20", text: "收到，我把小组版本同步到资料区。" },
];
const activityTypes = [
  { id: "checkin", icon: "✓", title: "课堂签到", detail: "按在线名单快速签到" },
  { id: "poll", icon: "▥", title: "快速投票", detail: "收集全班即时反馈" },
  { id: "quiz", icon: "?", title: "随堂测验", detail: "从课程题库选择题目" },
  { id: "random", icon: "✦", title: "随机选人", detail: "公平邀请学生发言" },
];
type ActivityId = (typeof activityTypes)[number]["id"];
type Message = (typeof baseMessages)[number] & { mine?: boolean };
type ChatSignal = {
  type: "chat";
  text: string;
  senderName?: string;
};
const maxChatMessageLength = 2000;
const maxChatSenderNameLength = 80;
const maxChatHistoryLength = 200;

function appendChatMessage(messages: Message[], message: Message) {
  return [...messages, message].slice(-maxChatHistoryLength);
}

function incrementSessionMessageCount(current: number) {
  return Math.min(current + 1, maxReportChatMessageCount);
}

function normalizeChatSignal(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const message = value as Partial<ChatSignal>;
  if (message.type !== "chat" || typeof message.text !== "string") return null;
  if (message.text.length > maxChatMessageLength) return null;
  const text = message.text.trim();
  if (!text || text.length > maxChatMessageLength) return null;
  const senderName =
    typeof message.senderName === "string" &&
    message.senderName.length <= maxChatSenderNameLength &&
    message.senderName.trim() &&
    message.senderName.trim().length <= maxChatSenderNameLength
      ? message.senderName.trim()
      : "远端参会者";
  return { text, senderName };
}
const activityLabels: Record<ActivityId, string> = Object.fromEntries(
  activityTypes.map((item) => [item.id, item.title]),
) as Record<ActivityId, string>;
type MeetingDraft = {
  title: string;
  courseId: CourseId;
  classId: ClassId;
  autoMute: boolean;
  generateReport: boolean;
};
type MeetingOptions = Pick<MeetingDraft, "autoMute" | "generateReport">;
type EnterMeeting = (
  message?: string,
  title?: string,
  roomId?: string,
  options?: MeetingOptions,
  displayName?: string,
  mode?: MeetingMode,
  preserveJoinPreferences?: boolean,
) => void;

const courseLabels: Record<CourseId, string> = {
  digital: "数字媒体技术",
  interaction: "交互设计",
};
const classLabels: Record<ClassId, string> = {
  class1: "2026 秋 · 1 班（48 人）",
  class2: "2026 秋 · 2 班（46 人）",
};

async function copyTextToClipboard(text: string) {
  try {
    if (!navigator.clipboard?.writeText) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

type ShareLinkKind = "report" | "replay" | "meeting";

function buildLocalShareLink(
  kind: ShareLinkKind,
  title: string,
  options: {
    mode?: MeetingMode;
    snapshot?: SessionReportSnapshot | null;
    roomId?: string;
  } = {},
) {
  const params = new URLSearchParams({
    share: kind,
    title,
  });
  if (kind === "report") {
    params.set("mode", options.snapshot?.meetingMode ?? options.mode ?? "class");
    if (options.snapshot) {
      params.set("snapshot", JSON.stringify(options.snapshot));
    }
  }
  if (kind === "meeting") {
    params.set("room", options.roomId ?? "");
    params.set("mode", options.mode ?? "normal");
  }
  if (kind === "replay" && options.roomId) {
    params.set("room", options.roomId);
  }
  return `${window.location.origin}${window.location.pathname}?${params.toString()}`;
}

function isSessionReportSnapshot(value: unknown): value is SessionReportSnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Partial<SessionReportSnapshot>;
  return (
    typeof snapshot.durationSeconds === "number" &&
    Number.isFinite(snapshot.durationSeconds) &&
    Number.isInteger(snapshot.durationSeconds) &&
    snapshot.durationSeconds >= 0 &&
    snapshot.durationSeconds <= maxReportDurationSeconds &&
    typeof snapshot.chatMessageCount === "number" &&
    Number.isFinite(snapshot.chatMessageCount) &&
    Number.isInteger(snapshot.chatMessageCount) &&
    snapshot.chatMessageCount >= 0 &&
    snapshot.chatMessageCount <= maxReportChatMessageCount &&
    typeof snapshot.publishedActivityCount === "number" &&
    Number.isFinite(snapshot.publishedActivityCount) &&
    snapshot.publishedActivityCount >= 0 &&
    Number.isInteger(snapshot.publishedActivityCount) &&
    Array.isArray(snapshot.publishedActivityIds) &&
    snapshot.publishedActivityIds.length === snapshot.publishedActivityCount &&
    new Set(snapshot.publishedActivityIds).size ===
      snapshot.publishedActivityIds.length &&
    snapshot.publishedActivityIds.every((id) =>
      activityTypes.some((activity) => activity.id === id),
    ) &&
    typeof snapshot.recordingAvailable === "boolean" &&
    typeof snapshot.participantCount === "number" &&
    Number.isFinite(snapshot.participantCount) &&
    Number.isInteger(snapshot.participantCount) &&
    snapshot.participantCount >= 0 &&
    snapshot.participantCount <= 2 &&
    typeof snapshot.participantName === "string" &&
    snapshot.participantName.length <= maxParticipantNameLength &&
    snapshot.participantName.trim().length > 0 &&
    snapshot.participantName.trim().length <= maxParticipantNameLength &&
    (snapshot.meetingMode === "class" || snapshot.meetingMode === "normal")
  );
}

function normalizeSessionReportSnapshot(
  value: unknown,
): SessionReportSnapshot | undefined {
  if (!isSessionReportSnapshot(value)) return undefined;
  return {
    durationSeconds: value.durationSeconds,
    chatMessageCount: value.chatMessageCount,
    publishedActivityCount: value.publishedActivityCount,
    publishedActivityIds: [...value.publishedActivityIds],
    recordingAvailable: value.recordingAvailable,
    participantCount: value.participantCount,
    participantName: value.participantName.trim(),
    meetingMode: value.meetingMode,
  };
}

function readLocalShareLink():
  | { kind: "report"; title: string; mode: MeetingMode; snapshot: SessionReportSnapshot | null }
  | { kind: "replay"; title: string; roomId?: string }
  | { kind: "meeting"; title: string; roomId: string; mode: MeetingMode }
  | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const kind = params.get("share");
  const rawTitle = params.get("title");
  const title = rawTitle?.trim();
  if (
    !rawTitle ||
    !title ||
    rawTitle.length > maxMeetingTitleLength ||
    title.length > maxMeetingTitleLength ||
    (kind !== "report" && kind !== "replay" && kind !== "meeting")
  )
    return null;
  if (kind === "replay") {
    const roomId = normalizeRoomId(params.get("room") ?? "");
    return roomId.length >= 6 && roomId.length <= MAX_ROOM_ID_LENGTH
      ? { kind, title, roomId }
      : { kind, title };
  }
  if (kind === "meeting") {
    const roomId = normalizeRoomId(params.get("room") ?? "");
    if (roomId.length < 6 || roomId.length > MAX_ROOM_ID_LENGTH) return null;
    return {
      kind,
      title,
      roomId,
      mode: params.get("mode") === "class" ? "class" : "normal",
    };
  }

  let snapshot: SessionReportSnapshot | null = null;
  const encodedSnapshot = params.get("snapshot");
  if (
    encodedSnapshot &&
    encodedSnapshot.length <= maxReportSnapshotPayloadLength
  ) {
    try {
      const parsed = JSON.parse(encodedSnapshot) as unknown;
      if (isSessionReportSnapshot(parsed)) snapshot = parsed;
    } catch {
      // Invalid local data should fall back to the report's demo state.
    }
  }
  return {
    kind,
    title,
    mode: params.get("mode") === "normal" ? "normal" : "class",
    snapshot,
  };
}

function consumeLocalShareLink() {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (!url.searchParams.has("share")) return;
  ["share", "title", "mode", "snapshot", "room"].forEach((key) =>
    url.searchParams.delete(key),
  );
  window.history.replaceState(
    window.history.state,
    "",
    `${url.pathname}${url.search}${url.hash}`,
  );
}

function formatMeetingDuration(totalSeconds: number) {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(safeSeconds / 3600)
    .toString()
    .padStart(2, "0");
  const m = Math.floor((safeSeconds % 3600) / 60)
    .toString()
    .padStart(2, "0");
  const s = (safeSeconds % 60).toString().padStart(2, "0");
  return `${h}:${m}:${s}`;
}

function downloadReportSummary(
  title: string,
  snapshot: SessionReportSnapshot | null = null,
  mode: MeetingMode = snapshot?.meetingMode ?? "class",
  recordingBlob: Blob | null = null,
) {
  if (typeof URL.createObjectURL !== "function") return false;
  const isClassReport = (snapshot?.meetingMode ?? mode) !== "normal";
  const content = [
    `学习通会议 · ${isClassReport ? "课堂" : "会议"}报告摘要`,
    `主题：${title}`,
    `状态：${isClassReport ? "课堂" : "会议"}已结束 · 报告已生成`,
    ...(snapshot
      ? [
          `会议时长：${formatMeetingDuration(snapshot.durationSeconds)}`,
          `本地参与：${snapshot.participantCount} / 2 个窗口`,
          `已发布活动：${snapshot.publishedActivityCount} 项`,
          `已发布活动明细：${snapshot.publishedActivityIds.length > 0 ? snapshot.publishedActivityIds.map((id) => activityLabels[id]).join("、") : "无"}`,
          `聊天消息：${snapshot.chatMessageCount} 条`,
          `录制：${snapshot.recordingAvailable ? recordingBlob ? "已生成本地 WebM（仅当前页面）" : "已标记（本地原型状态）" : "未开启"}`,
        ]
      : [
          ...(isClassReport
            ? [
                "到课人数：42 / 48（87.5%）",
                "互动参与：38 人",
                "发言与讨论：26 次",
              ]
            : [
                "参会人数：8 / 8（100%）",
                "课堂互动：不适用",
                "会议消息：26 条",
              ]),
        ]),
    "",
    "此文件为本地原型导出的报告摘要。",
  ].join("\n");
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${title.replace(/[\\/:*?"<>|]/g, "-")}-${isClassReport ? "课堂" : "会议"}报告.txt`;
  anchor.click();
  URL.revokeObjectURL(url);
  return true;
}

function LocalRecordingVideo({ blob }: { blob: Blob }) {
  const objectUrl = useMemo(() => {
    if (typeof URL.createObjectURL !== "function") return null;
    return URL.createObjectURL(blob);
  }, [blob]);
  useEffect(
    () => () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    },
    [objectUrl],
  );
  if (!objectUrl) return <i>▶</i>;
  return (
    <video
      className="local-recording-video"
      controls
      playsInline
      preload="metadata"
      src={objectUrl}
      aria-label="本地录制视频"
    />
  );
}

function downloadLocalRecording(title: string, blob: Blob | null) {
  if (!blob || typeof URL.createObjectURL !== "function") return false;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${title.replace(/[\\/:*?"<>|]/g, "-")}-本地录制.webm`;
  anchor.click();
  URL.revokeObjectURL(url);
  return true;
}

function createMeetingDraft(mode: MeetingMode): MeetingDraft {
  return {
    title:
      mode === "class" ? "数字媒体技术 · 第 3 讲" : "林老师的快速会议",
    courseId: "digital",
    classId: "class1",
    autoMute: true,
    generateReport: true,
  };
}

type ScheduledMeeting = {
  id: string;
  day: string;
  month: string;
  time: string;
  title: string;
  detail: string;
  type: string;
  accent: string;
  roomId: string;
  mode?: MeetingMode;
  autoMute?: boolean;
  generateReport?: boolean;
  status?: "upcoming" | "past";
  reportSnapshot?: SessionReportSnapshot;
  reportGenerated?: boolean;
};
type MeetingListItem = ScheduledMeeting & {
  reportSnapshot?: SessionReportSnapshot;
  reportGenerated?: boolean;
};
type LocalMeetingRecord = ScheduledMeeting & {
  status: "upcoming" | "past";
  reportSnapshot?: SessionReportSnapshot;
  reportGenerated?: boolean;
};

function isReplayReadyMeeting(
  meeting: ScheduledMeeting,
): meeting is ScheduledMeeting & {
  status: "past";
  reportSnapshot: SessionReportSnapshot;
} {
  return (
    meeting.status === "past" &&
    meeting.reportSnapshot?.recordingAvailable === true
  );
}

const scheduledMeetingStorageKey = "learning-meeting-scheduled";
const localMeetingsStorageKey = "learning-meetings-created";
const maxScheduledMeetingStorageLength = 100_000;
const maxLocalMeetingsStorageLength = 1_000_000;
const maxStoredMeetingIdLength = 128;
const maxStoredMeetingDayLength = 16;
const maxStoredMeetingMonthLength = 16;
const maxStoredMeetingTimeLength = 64;
const maxStoredMeetingDetailLength = 240;
const maxStoredMeetingTypeLength = 64;
const maxStoredMeetingAccentLength = 32;
const maxLocalMeetingRecordCount = 20;
const localMaterialFilesStorageKey = "learning-meeting-material-files";
const maxLocalMaterialStorageLength = 400_000;
const maxLocalMaterialFileCount = 40;
const maxStoredMaterialIdLength = 128;
const maxStoredMaterialIconLength = 4;
const maxStoredMaterialSourceLength = 120;
const maxStoredMaterialSizeLength = 32;
const maxStoredMaterialTimeLength = 64;
const materialColors = ["green", "blue", "violet", "orange"] as const;
const materialFolders = ["录制", "课件", "白板", "活动"] as const;

function canReadMeetingStorage() {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.getItem(localMeetingsStorageKey);
    window.localStorage.getItem(scheduledMeetingStorageKey);
    return true;
  } catch {
    return false;
  }
}

function isValidStoredText(value: unknown, maxLength: number): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= maxLength
  );
}

function isValidStoredRoomId(value: unknown): value is string {
  return typeof value === "string" && /^\d{6,18}$/.test(value);
}

function isValidStoredMeetingTitle(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= maxMeetingTitleLength &&
    value.trim().length > 0 &&
    value.trim().length <= maxMeetingTitleLength
  );
}

function isValidStoredMaterialFile(value: unknown): value is MaterialFile {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const file = value as Partial<MaterialFile>;
  return (
    isValidStoredText(file.id, maxStoredMaterialIdLength) &&
    typeof file.icon === "string" &&
    file.icon.length > 0 &&
    file.icon.length <= maxStoredMaterialIconLength &&
    typeof file.name === "string" &&
    file.name.length > 0 &&
    file.name.length <= maxMaterialFileNameLength &&
    file.name.trim().length > 0 &&
    file.name.trim().length <= maxMaterialFileNameLength &&
    isValidStoredText(file.source, maxStoredMaterialSourceLength) &&
    isValidStoredText(file.size, maxStoredMaterialSizeLength) &&
    isValidStoredText(file.time, maxStoredMaterialTimeLength) &&
    typeof file.color === "string" &&
    materialColors.includes(file.color as (typeof materialColors)[number]) &&
    materialFolders.includes(file.folder as (typeof materialFolders)[number]) &&
    file.source === "本地上传"
  );
}

function normalizeStoredMaterialFile(file: MaterialFile): MaterialFile {
  return {
    id: file.id.trim(),
    icon: file.icon.trim(),
    name: file.name.trim(),
    source: file.source.trim(),
    size: file.size.trim(),
    time: file.time.trim(),
    color: file.color,
    folder: file.folder,
  };
}

function readLocalMaterialFiles(): MaterialFile[] {
  const parsed = readStoredJson(
    localMaterialFilesStorageKey,
    maxLocalMaterialStorageLength,
  );
  if (!Array.isArray(parsed)) return [];
  const seenIds = new Set<string>();
  return parsed
    .flatMap((value) => {
      if (!isValidStoredMaterialFile(value)) return [];
      const file = normalizeStoredMaterialFile(value);
      if (
        file.name.length > maxMaterialFileNameLength ||
        file.name.length === 0 ||
        seenIds.has(file.id)
      )
        return [];
      seenIds.add(file.id);
      return [file];
    })
    .slice(0, maxLocalMaterialFileCount);
}

function writeLocalMaterialFiles(files: MaterialFile[]) {
  const normalized = files
    .filter(isValidStoredMaterialFile)
    .map(normalizeStoredMaterialFile)
    .slice(0, maxLocalMaterialFileCount);
  return writeStoredJson(
    localMaterialFilesStorageKey,
    normalized,
    maxLocalMaterialStorageLength,
  );
}

function hasValidStoredMeetingMetadata(
  record: Partial<ScheduledMeeting>,
): boolean {
  return (
    isValidStoredText(record.id, maxStoredMeetingIdLength) &&
    isValidStoredText(record.day, maxStoredMeetingDayLength) &&
    isValidStoredText(record.month, maxStoredMeetingMonthLength) &&
    isValidStoredText(record.time, maxStoredMeetingTimeLength) &&
    isValidStoredMeetingTitle(record.title) &&
    isValidStoredText(record.detail, maxStoredMeetingDetailLength) &&
    isValidStoredText(record.type, maxStoredMeetingTypeLength) &&
    isValidStoredText(record.accent, maxStoredMeetingAccentLength)
  );
}

function normalizeStoredMeetingMetadata(record: Partial<ScheduledMeeting>) {
  return {
    id: record.id!.trim(),
    day: record.day!.trim(),
    month: record.month!.trim(),
    time: record.time!.trim(),
    title: record.title!.trim(),
    detail: record.detail!.trim(),
    type: record.type!.trim(),
    accent: record.accent!.trim(),
  };
}

const defaultScheduledMeeting: ScheduledMeeting = {
  id: "local-scheduled-meeting",
  day: "29",
  month: "8月",
  time: "09:30–10:30",
  title: "数字媒体技术 · 第 3 讲",
  detail: "2026 秋 · 1 班 · 48 人",
  type: "课程课堂",
  accent: "green",
  roomId: "821406233",
  autoMute: true,
  generateReport: true,
  mode: "class",
  status: "upcoming",
  reportGenerated: true,
};

function readLocalMeetings(): LocalMeetingRecord[] {
  const parsed = readStoredJson(
    localMeetingsStorageKey,
    maxLocalMeetingsStorageLength,
  );
  if (!Array.isArray(parsed)) return [];
  const seenRoomIds = new Set<string>();
  return parsed
    .flatMap((value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return [];
      const record = value as Partial<LocalMeetingRecord>;
      if (
        !hasValidStoredMeetingMetadata(record) ||
        typeof record.roomId !== "string" ||
        !isValidStoredRoomId(record.roomId) ||
        (record.status !== "upcoming" && record.status !== "past")
      )
        return [];
      if (seenRoomIds.has(record.roomId)) return [];
      seenRoomIds.add(record.roomId);
      const normalizedMode =
        record.mode === "normal" || record.type === "普通会议"
          ? "normal"
          : "class";
      const normalizedGenerateReport =
        typeof record.generateReport === "boolean"
          ? record.generateReport
          : defaultScheduledMeeting.generateReport;
      const parsedSnapshot = normalizeSessionReportSnapshot(record.reportSnapshot);
      const reportSnapshot =
        parsedSnapshot?.meetingMode === normalizedMode ? parsedSnapshot : undefined;
      return [
        {
            ...defaultScheduledMeeting,
            ...normalizeStoredMeetingMetadata(record),
            roomId: record.roomId,
            mode: normalizedMode,
            autoMute:
              typeof record.autoMute === "boolean"
                ? record.autoMute
                : defaultScheduledMeeting.autoMute,
          generateReport:
            normalizedGenerateReport,
          reportSnapshot,
          reportGenerated:
            typeof record.reportGenerated === "boolean"
              ? record.reportGenerated
              : normalizedGenerateReport,
          status: record.status,
        } satisfies LocalMeetingRecord,
      ];
    })
    .slice(0, maxLocalMeetingRecordCount);
}

function writeLocalMeetings(meetings: LocalMeetingRecord[]) {
  const seenRoomIds = new Set<string>();
  const mergedMeetings = [...meetings, ...readLocalMeetings()]
    .filter((meeting) => {
      if (seenRoomIds.has(meeting.roomId)) return false;
      seenRoomIds.add(meeting.roomId);
      return true;
    })
    .slice(0, 20);
  return writeStoredJson(localMeetingsStorageKey, mergedMeetings);
}

function removeLocalMeetingRecord(roomId: string): boolean {
  if (typeof window === "undefined" || !isValidStoredRoomId(roomId)) return false;
  // 这里刻意直读：键不存在视为“已删除”（true），而 getItem 抛错是失败（false）。
  // 共享层的 readStoredText 两种情况都返回 null，无法区分。
  let stored: string | null;
  try {
    stored = window.localStorage.getItem(localMeetingsStorageKey);
  } catch {
    return false;
  }
  if (stored === null) return true;
  const current = readLocalMeetings();
  if (!current.some((meeting) => meeting.roomId === roomId)) return true;
  const next = current.filter((meeting) => meeting.roomId !== roomId);
  return writeStoredJson(
    localMeetingsStorageKey,
    next.slice(0, maxLocalMeetingRecordCount),
    maxLocalMeetingsStorageLength,
  );
}

function readScheduledMeeting(): ScheduledMeeting | null {
  const stored = readStoredText(
    scheduledMeetingStorageKey,
    maxScheduledMeetingStorageLength,
  );
  if (!stored) return null;
  // 旧格式兼容：早期版本只写字面量 "true"，必须在 JSON.parse 之前拦。
  if (stored === "true") return defaultScheduledMeeting;
  try {
    const parsed = JSON.parse(stored) as Partial<ScheduledMeeting>;
    if (
      hasValidStoredMeetingMetadata(parsed)
    ) {
      if (
        parsed.roomId !== undefined &&
        !isValidStoredRoomId(parsed.roomId)
      ) {
        return null;
      }
      const roomId =
        parsed.roomId === undefined
          ? defaultScheduledMeeting.roomId
          : parsed.roomId;
      const autoMute =
        typeof parsed.autoMute === "boolean"
          ? parsed.autoMute
          : defaultScheduledMeeting.autoMute;
      const generateReport =
        typeof parsed.generateReport === "boolean"
          ? parsed.generateReport
          : defaultScheduledMeeting.generateReport;
      const mode =
        parsed.mode === "normal" || parsed.type === "普通会议"
          ? "normal"
          : "class";
      const status = parsed.status === "past" ? "past" : "upcoming";
      const normalizedReportGenerated =
        typeof parsed.reportGenerated === "boolean"
          ? parsed.reportGenerated
          : generateReport;
      const parsedSnapshot = normalizeSessionReportSnapshot(parsed.reportSnapshot);
      const reportSnapshot =
        parsedSnapshot?.meetingMode === mode ? parsedSnapshot : undefined;
      return {
        ...defaultScheduledMeeting,
        ...normalizeStoredMeetingMetadata(parsed),
        roomId,
        autoMute,
        generateReport,
        mode,
        status,
        reportSnapshot,
        reportGenerated: normalizedReportGenerated,
      };
    }
  } catch {
    return null;
  }
  return null;
}

function writeScheduledMeeting(meeting: ScheduledMeeting): boolean {
  return writeStoredJson(scheduledMeetingStorageKey, meeting);
}

function removeScheduledMeeting(): boolean {
  return removeStoredValue(scheduledMeetingStorageKey);
}

function PersonAvatar({
  name,
  color,
  small = false,
}: {
  name: string;
  color: string;
  small?: boolean;
}) {
  return (
    <span
      className={small ? "person-avatar small" : "person-avatar"}
      style={{ background: color }}
    >
      {name.slice(-1)}
    </span>
  );
}

function handleMenuItemKeyDown(event: React.KeyboardEvent<HTMLElement>) {
  if (
    !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)
  )
    return;
  const menu = event.currentTarget.closest<HTMLElement>('[role="menu"]');
  const items = menu
    ? Array.from(
        menu.querySelectorAll<HTMLElement>(
          '[role="menuitem"]:not([aria-disabled="true"])',
        ),
      )
    : [];
  const currentIndex = items.indexOf(event.currentTarget);
  if (items.length === 0 || currentIndex < 0) return;
  const nextIndex =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? items.length - 1
        : (currentIndex + (event.key === "ArrowDown" ? 1 : -1) + items.length) %
          items.length;
  event.preventDefault();
  items[nextIndex]?.focus();
}

function GlobalUtilityPanel({
  panel,
  query,
  setQuery,
  searchCatalog,
  notifications,
  onClose,
  onNavigate,
  onMarkRead,
  onMarkAllRead,
}: {
  panel: Exclude<UtilityPanel, null>;
  query: string;
  setQuery: Setter<string>;
  searchCatalog: GlobalSearchResult[];
  notifications: AppNotification[];
  onClose: () => void;
  onNavigate: (
    nav: string,
    message: string,
    result?: GlobalSearchResult,
  ) => void;
  onMarkRead: (id: string) => void;
  onMarkAllRead: () => void;
}) {
  const searchRef = useRef<HTMLInputElement>(null);
  const searchResults = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return searchCatalog.filter((result) =>
      `${result.kind}${result.title}${result.detail}${result.roomId ?? ""}`
        .toLowerCase()
        .includes(normalizedQuery),
    );
  }, [query, searchCatalog]);

  useEffect(() => {
    if (panel === "search") searchRef.current?.focus();
  }, [panel]);

  return (
    <aside
      id={`global-utility-panel-${panel}`}
      className={`global-utility-panel ${panel}`}
      role="dialog"
      aria-describedby={`global-utility-title-${panel}`}
      aria-label={panel === "search" ? "全局搜索" : "通知中心"}
      aria-live="polite"
    >
      <div className="utility-panel-header">
        <div>
          <span>{panel === "search" ? "快速定位" : "最近动态"}</span>
          <strong id={`global-utility-title-${panel}`}>
            {panel === "search" ? "搜索工作台" : "通知"}
          </strong>
        </div>
        <button
          className="utility-panel-close"
          aria-label={panel === "search" ? "关闭搜索" : "关闭通知"}
          onClick={onClose}
        >
          ×
        </button>
      </div>
      {panel === "search" ? (
        <>
          <label className="utility-search-field">
            ⌕
            <input
              ref={searchRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索会议、回放或资料"
              aria-label="全局搜索"
            />
          </label>
      <div className="utility-results" aria-live="polite">
            <span className="utility-section-label">
              {query.trim() ? `${searchResults.length} 个匹配结果` : "最近访问"}
            </span>
            {searchResults.length > 0 ? (
              searchResults.slice(0, 6).map((result) => (
                <button
                  className="utility-result"
                  key={result.id}
                  onClick={() =>
                    onNavigate(
                      result.nav,
                      `已定位到${result.kind}：${result.title}`,
                      result,
                    )
                  }
                >
                  <span className={`utility-result-kind ${result.kind}`}>
                    {result.kind.slice(0, 1)}
                  </span>
                  <span>
                    <strong>{result.title}</strong>
                    <small>{result.detail}</small>
                  </span>
                  <i>→</i>
                </button>
              ))
            ) : (
              <div className="utility-empty">
                <strong>没有找到匹配结果</strong>
                <span>试试会议主题、课程或文件名。</span>
              </div>
            )}
          </div>
        </>
      ) : (
        <>
          <div className="notification-toolbar">
            <span>
              {notifications.filter((notification) => !notification.read).length} 条未读
            </span>
            <button
              onClick={onMarkAllRead}
              disabled={notifications.every((notification) => notification.read)}
            >
              全部已读
            </button>
          </div>
          <div className="notification-list" aria-live="polite">
            {notifications.map((notification) => (
              <button
                className={`notification-item ${notification.read ? "read" : "unread"}`}
                key={notification.id}
                onClick={() => {
                  onMarkRead(notification.id);
                  onNavigate(
                    notification.nav,
                    `已打开：${notification.title}`,
                    notification.targetTitle
                      ? {
                          id: `notification-replay-${notification.id}`,
                          kind: "回放",
                          title: notification.targetTitle,
                          detail: notification.detail,
                          nav: notification.nav,
                        }
                      : undefined,
                  );
                }}
              >
                <span className="notification-mark">{!notification.read && <i />}</span>
                <span>
                  <strong>{notification.title}</strong>
                  <small>{notification.detail}</small>
                  <em>{notification.time}</em>
                </span>
                <i className="notification-arrow">→</i>
              </button>
            ))}
          </div>
        </>
      )}
      <small className="utility-prototype-note">本地演示数据 · 不同步云端</small>
    </aside>
  );
}

export default function Home() {
  const [view, setView] = useState<View>("home");
  const [activeNav, setActiveNav] = useState("会议首页");
  const [createIntent, setCreateIntent] = useState<CreateIntent>("start");
  const [scheduledMeeting, setScheduledMeeting] =
    useState<ScheduledMeeting | null>(null);
  const [localMeetings, setLocalMeetings] = useState<LocalMeetingRecord[]>([]);
  const [localMeetingStorageHydrated, setLocalMeetingStorageHydrated] =
    useState(false);
  const [localMeetingStorageReadable, setLocalMeetingStorageReadable] =
    useState(false);
  const [localMaterialFiles, setLocalMaterialFiles] = useState<MaterialFile[]>(
    readLocalMaterialFiles,
  );
  const [localMaterialContents, setLocalMaterialContents] = useState<
    Record<string, File>
  >({});
  const [persistedLocalMaterialIds, setPersistedLocalMaterialIds] = useState<
    Set<string>
  >(() => new Set());
  const [panel, setPanel] = useState<Panel>(null);
  const [modal, setModal] = useState<"create" | "join" | null>(null);
  const [joinRoomId, setJoinRoomId] = useState("821406233");
  const [joinMeetingMode, setJoinMeetingMode] = useState<MeetingMode>("normal");
  const [joinPreferences, setJoinPreferences] = useState<JoinPreferences>(
    { audio: true, video: true },
  );
  const [startMuted, setStartMuted] = useState(false);
  const [meetingMode, setMeetingMode] = useState<MeetingMode>("class");
  const [meetingDraft, setMeetingDraft] = useState<MeetingDraft>(() =>
    createMeetingDraft("class"),
  );
  const [activeMeetingTitle, setActiveMeetingTitle] = useState(
    "数字媒体技术 · 第 3 讲",
  );
  const [recordingCaptured, setRecordingCaptured] = useState(false);
  const [localRecordingBlobs, setLocalRecordingBlobs] = useState<
    Record<string, Blob>
  >({});
  const [reportRecordingBlob, setReportRecordingBlob] = useState<Blob | null>(
    null,
  );
  const [meetingSettingsOpen, setMeetingSettingsOpen] = useState(false);
  const [layout, setLayout] = useState<"grid" | "focus">("grid");
  const [activity, setActivity] = useState<ActivityId>("checkin");
  const [publishedActivities, setPublishedActivities] = useState<ActivityId[]>(
    [],
  );
  const [reportSnapshot, setReportSnapshot] =
    useState<SessionReportSnapshot | null>(null);
  const [reportMode, setReportMode] = useState<MeetingMode>("class");
  const [reportRoomId, setReportRoomId] = useState<string | null>(null);
  const [reportGenerated, setReportGenerated] = useState(true);
  const [chatInput, setChatInput] = useState("");
  const [localMessages, setLocalMessages] = useState(baseMessages);
  const [sessionMessageCount, setSessionMessageCount] = useState(0);
  const [participantName, setParticipantName] = useState("林老师");
  const [joinName, setJoinName] = useState("林老师");
  const [toast, setToast] = useState("");
  const [utilityPanel, setUtilityPanel] = useState<UtilityPanel>(null);
  const [globalSearch, setGlobalSearch] = useState("");
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [notifications, setNotifications] = useState(() =>
    createNotifications(readNotificationReadIds()),
  );
  const notificationsRef = useRef(notifications);
  const [sharedReplayTitle, setSharedReplayTitle] = useState<string | null>(null);
  const [sharedReplayRoomId, setSharedReplayRoomId] = useState<string | null>(null);
  const [sharedMaterialName, setSharedMaterialName] = useState<string | null>(null);
  const [sharedMaterialId, setSharedMaterialId] = useState<string | null>(null);
  const [sharedMeetingTitle, setSharedMeetingTitle] = useState<string | null>(null);
  const [sharedMeetingRoomId, setSharedMeetingRoomId] = useState<string | null>(null);
  const [publishedReplayTitle, setPublishedReplayTitle] = useState<string | null>(
    readPublishedReplayTitle,
  );
  const [elapsed, setElapsed] = useState(28 * 60 + 16);
  const utilityTriggerRef = useRef<HTMLButtonElement | null>(null);
  const previousUtilityPanelRef = useRef<UtilityPanel>(null);
  const profileTriggerRef = useRef<HTMLButtonElement | null>(null);
  const profileMenuRef = useRef<HTMLDivElement | null>(null);
  const previousProfileMenuOpenRef = useRef(false);
  const meetingSettingsTriggerRef = useRef<HTMLButtonElement | null>(null);
  const meetingSettingsMenuRef = useRef<HTMLElement | null>(null);
  const previousMeetingSettingsOpenRef = useRef(false);
  const panelTriggerRefs = useRef<
    Record<Exclude<Panel, null>, HTMLButtonElement | null>
  >({ members: null, chat: null, activities: null });
  const previousPanelRef = useRef<Panel>(null);
  const chatChannelRef = useRef<BroadcastChannel | null>(null);
  const recordingSessionRoomIdRef = useRef<string | null>(null);
  const recordingHydrationRef = useRef(0);
  const call = useLocalWebRTC();
  const localRecording = useLocalRecording();
  const recording = localRecording.status === "recording";
  const recordingCapturedForReport =
    recordingCaptured && localRecording.status !== "error";
  const meetingGridCall: MeetingGridCall = {
    status: call.status,
    error: call.error,
    roomId: call.roomId,
    setRoomId: call.setRoomId,
    micOn: call.micOn,
    cameraOn: call.cameraOn,
    sharing: call.sharing,
    localStream: call.localStream,
    remoteStream: call.remoteStream,
    devices: call.devices,
    cameraId: call.cameraId,
    microphoneId: call.microphoneId,
    switchCamera: call.switchCamera,
    switchMicrophone: call.switchMicrophone,
    join: call.join,
    leave: call.leave,
  };
  useEffect(() => {
    const roomId = recordingSessionRoomIdRef.current;
    const blob = localRecording.blob;
    if (!roomId || !blob) return;
    setLocalRecordingBlobs((current) => {
      if (current[roomId] === blob) return current;
      const next = { ...current, [roomId]: blob };
      const roomIds = Object.keys(next);
      if (roomIds.length > 20) delete next[roomIds[0]!];
      return next;
    });
    if (view === "report" && reportRoomId === roomId) {
      setReportRecordingBlob(blob);
    }
    void saveLocalRecording(roomId, blob);
  }, [localRecording.blob, reportRoomId, view]);
  useEffect(() => {
    const activeRoomIds = [
      ...localMeetings.map((meeting) => meeting.roomId),
      ...(scheduledMeeting ? [scheduledMeeting.roomId] : []),
    ];
    if (!localMeetingStorageHydrated || !localMeetingStorageReadable) return;
    void pruneLocalRecordings(activeRoomIds);
  }, [
    localMeetingStorageHydrated,
    localMeetingStorageReadable,
    localMeetings,
    scheduledMeeting,
  ]);
  const searchCatalog = useMemo(() => {
    const localResults: GlobalSearchResult[] = localMeetings.map((meeting) => ({
      id: `meeting-${meeting.roomId}`,
      kind: "会议",
      title: meeting.title,
      detail: `本机会议 · ${meeting.status === "past" ? "已结束" : meeting.detail}`,
      nav: "我的会议",
      roomId: meeting.roomId,
    }));
    const scheduledResults: GlobalSearchResult[] = scheduledMeeting
      ? [
          {
            id: `meeting-${scheduledMeeting.roomId}`,
            kind: "会议",
            title: scheduledMeeting.title,
            detail:
              scheduledMeeting.status === "past"
                ? `本机预约 · 已结束 · ${scheduledMeeting.detail}`
                : `${scheduledMeeting.type} · ${scheduledMeeting.detail}`,
            nav: "我的会议",
            roomId: scheduledMeeting.roomId,
          },
        ]
      : [];
    const localReplayMeetings = [
      ...localMeetings,
      ...(scheduledMeeting ? [scheduledMeeting] : []),
    ]
      .filter(isReplayReadyMeeting)
      .filter(
        (meeting, index, meetings) =>
          meetings.findIndex((candidate) => candidate.roomId === meeting.roomId) ===
          index,
      );
    const localReplayResults: GlobalSearchResult[] = localReplayMeetings
      .map((meeting) => ({
        id: `local-replay-${meeting.roomId}`,
        kind: "回放" as const,
        title: meeting.title,
        detail: `本机录制 · ${formatMeetingDuration(meeting.reportSnapshot.durationSeconds)}`,
        nav: "课堂回放",
        roomId: meeting.roomId,
      }));
    const localMaterialResults: GlobalSearchResult[] = localMaterialFiles.map(
      (file) => ({
        id: `material-${file.id}`,
        kind: "资料",
        title: file.name,
        detail: `${file.source} · ${file.size} · 本地上传`,
        nav: "会议资料",
        materialId: file.id,
      }),
    );
    const results = [
      ...localResults,
      ...scheduledResults,
      ...localReplayResults,
      ...localMaterialResults,
      ...globalSearchCatalog,
    ];
    return results.filter(
      (result, index) =>
        results.findIndex((candidate) => candidate.id === result.id) === index,
    );
  }, [localMeetings, localMaterialFiles, scheduledMeeting]);

  useEffect(() => {
    if (
      view !== "meeting" ||
      call.status === "idle" ||
      call.status === "error"
    )
      return;
    const timer = window.setInterval(
      () => setElapsed((value) => value + 1),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [call.status, view]);
  useEffect(() => {
    const previousPanel = previousUtilityPanelRef.current;
    if (previousPanel && utilityPanel === null) {
      utilityTriggerRef.current?.focus();
    }
    previousUtilityPanelRef.current = utilityPanel;
  }, [utilityPanel]);
  useEffect(() => {
    if (previousProfileMenuOpenRef.current && !profileMenuOpen) {
      profileTriggerRef.current?.focus();
    }
    previousProfileMenuOpenRef.current = profileMenuOpen;
  }, [profileMenuOpen]);
  useEffect(() => {
    if (!profileMenuOpen) return;
    profileMenuRef.current
      ?.querySelector<HTMLElement>('[role="menuitem"]')
      ?.focus();
  }, [profileMenuOpen]);
  useEffect(() => {
    if (previousMeetingSettingsOpenRef.current && !meetingSettingsOpen) {
      meetingSettingsTriggerRef.current?.focus();
    }
    previousMeetingSettingsOpenRef.current = meetingSettingsOpen;
  }, [meetingSettingsOpen]);
  useEffect(() => {
    if (!meetingSettingsOpen) return;
    meetingSettingsMenuRef.current
      ?.querySelector<HTMLElement>('[role="menuitem"]')
      ?.focus();
  }, [meetingSettingsOpen]);
  useEffect(() => {
    const previousPanel = previousPanelRef.current;
    if (previousPanel && panel === null) {
      panelTriggerRefs.current[previousPanel]?.focus();
    }
    previousPanelRef.current = panel;
  }, [panel]);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2400);
    return () => window.clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setUtilityPanel(null);
      setProfileMenuOpen(false);
      setMeetingSettingsOpen(false);
      setPanel(null);
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setLocalMeetingStorageReadable(canReadMeetingStorage());
      setScheduledMeeting(readScheduledMeeting());
      setLocalMeetings(readLocalMeetings());
      setLocalMeetingStorageHydrated(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === scheduledMeetingStorageKey) {
        setScheduledMeeting(readScheduledMeeting());
      }
      if (event.key === null || event.key === localMeetingsStorageKey) {
        setLocalMeetings(readLocalMeetings());
      }
      if (event.key === null || event.key === publishedReplayStorageKey) {
        setPublishedReplayTitle(readPublishedReplayTitle());
      }
      if (event.key === null || event.key === localMaterialFilesStorageKey) {
        setLocalMaterialFiles(readLocalMaterialFiles());
      }
      if (event.key === null || event.key === notificationReadStorageKey) {
        const nextNotifications = createNotifications(readNotificationReadIds());
        notificationsRef.current = nextNotifications;
        setNotifications(nextNotifications);
      }
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);
  const materialContentHydrationRef = useRef(0);
  useEffect(() => {
    const activeIds = new Set(localMaterialFiles.map((file) => file.id));
    const hydration = ++materialContentHydrationRef.current;
    void readLocalMaterialContents([...activeIds]).then((restored) => {
      if (materialContentHydrationRef.current !== hydration) return;
      setLocalMaterialContents((current) => {
        const activeContents = Object.fromEntries(
          Object.entries(current).filter(([id]) => activeIds.has(id)),
        );
        const next = { ...restored, ...activeContents };
        return Object.keys(next).length === Object.keys(current).length
          ? current
          : next;
      });
      setPersistedLocalMaterialIds((current) => {
        const next = new Set([...current].filter((id) => activeIds.has(id)));
        Object.keys(restored).forEach((id) => next.add(id));
        return next.size === current.size ? current : next;
      });
      void pruneLocalMaterialContents([...activeIds]);
    });
  }, [localMaterialFiles]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const shared = readLocalShareLink();
      consumeLocalShareLink();
      if (!shared) return;
      if (shared.kind === "replay") {
        setActiveNav("课堂回放");
        setSharedReplayTitle(shared.title);
        setSharedReplayRoomId(shared.roomId ?? null);
        setToast("已打开本地回放分享引用");
        return;
      }
      if (shared.kind === "meeting") {
        setJoinRoomId(shared.roomId);
        setJoinMeetingMode(shared.mode);
        setMeetingMode(shared.mode);
        setCreateIntent("start");
        setModal("join");
        setToast(`已打开本地会议邀请：${shared.title}`);
        return;
      }
      setActiveMeetingTitle(shared.title);
      setReportMode(shared.mode);
      setReportSnapshot(shared.snapshot);
      setReportGenerated(true);
      setRecordingCaptured(shared.snapshot?.recordingAvailable ?? true);
      setView("report");
      setToast("已打开本地报告分享引用");
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  useEffect(() => {
    chatChannelRef.current?.close();
    chatChannelRef.current = null;
    if (view !== "meeting" || !window.BroadcastChannel) return;
    const normalizedRoom = normalizeRoomId(call.roomId);
    if (
      normalizedRoom.length < 6 ||
      normalizedRoom.length > MAX_ROOM_ID_LENGTH
    )
      return;
    const channel = new BroadcastChannel(
      `learning-meeting-chat:${normalizedRoom}`,
    );
    chatChannelRef.current = channel;
    channel.onmessage = (event: MessageEvent<unknown>) => {
      if (chatChannelRef.current !== channel) return;
      const message = normalizeChatSignal(event.data);
      if (!message) return;
      setLocalMessages((current) =>
        appendChatMessage(current, {
          name: message.senderName,
          time: "刚刚",
          text: message.text,
          mine: false,
        }),
      );
      setSessionMessageCount(incrementSessionMessageCount);
    };
    return () => {
      channel.close();
      if (chatChannelRef.current === channel) chatChannelRef.current = null;
    };
  }, [call.roomId, view]);
  const elapsedLabel = useMemo(() => {
    return formatMeetingDuration(elapsed);
  }, [elapsed]);
  const enterMeeting = (
    message?: string,
    title = meetingDraft.title.trim() || createMeetingDraft(meetingMode).title,
    roomId?: string,
    options?: MeetingOptions,
    displayName = "林老师",
    mode: MeetingMode = meetingMode,
    preserveJoinPreferences = false,
  ) => {
    setModal(null);
    if (roomId) call.setRoomId(roomId);
    recordingSessionRoomIdRef.current = roomId ?? call.roomId;
    setMeetingMode(mode);
    setReportMode(mode);
    setParticipantName(displayName);
    if (!preserveJoinPreferences) {
      setJoinPreferences({ audio: true, video: true });
    }
    if (options) {
      setStartMuted(options.autoMute);
      setReportGenerated(options.generateReport);
    } else {
      setStartMuted(false);
      setReportGenerated(true);
    }
    localRecording.reset();
    setRecordingCaptured(false);
    setReportRecordingBlob(null);
    setMeetingSettingsOpen(false);
    setLayout("grid");
    setActivity("checkin");
    setChatInput("");
    setLocalMessages(baseMessages);
    setSessionMessageCount(0);
    setElapsed(0);
    setReportSnapshot(null);
    setPublishedActivities([]);
    setView("meeting");
    setPanel(null);
    setActiveMeetingTitle(title);
    setToast(message ?? (mode === "class" ? "已进入课程课堂" : "会议已开始"));
  };
  const openReport = (
    title = activeMeetingTitle,
    preserveSessionActivities = false,
    hasRecording = true,
    mode: MeetingMode = meetingMode,
    savedSnapshot?: SessionReportSnapshot,
    generated = true,
    roomId = call.roomId,
  ) => {
    setReportMode(mode);
    setReportRoomId(roomId);
    const sessionRoomId = recordingSessionRoomIdRef.current;
    const inMemoryBlob =
      roomId && savedSnapshot
        ? localRecordingBlobs[roomId] ?? null
        : preserveSessionActivities && roomId === sessionRoomId
          ? localRecording.blob ?? localRecordingBlobs[roomId]
          : null;
    const hydration = ++recordingHydrationRef.current;
    setReportRecordingBlob(inMemoryBlob ?? null);
    if (!inMemoryBlob && roomId && savedSnapshot?.recordingAvailable) {
      void readLocalRecording(roomId).then((restored) => {
        if (recordingHydrationRef.current !== hydration) return;
        setReportRecordingBlob(restored);
      });
    }
    if (!preserveSessionActivities) {
      setPublishedActivities([]);
      setReportGenerated(generated);
      setReportSnapshot(savedSnapshot ?? null);
    } else {
      setReportSnapshot({
        durationSeconds: elapsed,
        chatMessageCount: sessionMessageCount,
        publishedActivityCount: publishedActivities.length,
        publishedActivityIds: [...publishedActivities],
        recordingAvailable: hasRecording,
        participantCount:
          (call.localStream ? 1 : 0) + (call.remoteStream ? 1 : 0),
        participantName,
        meetingMode: mode,
      });
    }
    setActiveMeetingTitle(title);
    setRecordingCaptured(hasRecording);
    setView("report");
  };
  const markMeetingReportGenerated = (roomId: string) => {
    let historySaved = true;
    if (localMeetings.some((meeting) => meeting.roomId === roomId)) {
      const nextLocalMeetings = localMeetings.map((meeting) =>
        meeting.roomId === roomId
          ? { ...meeting, reportGenerated: true }
          : meeting,
      );
      historySaved = writeLocalMeetings(nextLocalMeetings) && historySaved;
      setLocalMeetings(historySaved ? readLocalMeetings() : nextLocalMeetings);
    }
    if (scheduledMeeting?.roomId === roomId) {
      const nextScheduledMeeting = { ...scheduledMeeting, reportGenerated: true };
      historySaved = writeScheduledMeeting(nextScheduledMeeting) && historySaved;
      setScheduledMeeting(nextScheduledMeeting);
    }
    return historySaved;
  };
  const submitMeeting = () => {
    if (modal === "join") {
      const normalizedRoom = normalizeRoomId(joinRoomId);
      if (!normalizedRoom) {
        setToast("会议号只能包含数字，可使用空格或短横线分隔");
        return;
      }
      if (normalizedRoom.length < 6) {
        setToast("请输入至少 6 位会议号");
        return;
      }
      if (normalizedRoom.length > MAX_ROOM_ID_LENGTH) {
        setToast(`会议号不能超过 ${MAX_ROOM_ID_LENGTH} 位`);
        return;
      }
      if (joinName.trim().length > maxParticipantNameLength) {
        setToast(`入会名称不能超过 ${maxParticipantNameLength} 个字符`);
        return;
      }
      call.setRoomId(normalizedRoom);
      enterMeeting(
        "已进入会议",
        "本地会议",
        normalizedRoom,
        undefined,
        joinName.trim() || "访客",
        joinMeetingMode,
        true,
      );
      return;
    }
    if (createIntent === "start") {
      const storedMeetings = readLocalMeetings();
      const roomId = createLocalRoomId([
        call.roomId,
        ...(scheduledMeeting ? [scheduledMeeting.roomId] : []),
        ...localMeetings.map((meeting) => meeting.roomId),
        ...storedMeetings.map((meeting) => meeting.roomId),
      ]);
      const title =
        meetingDraft.title.trim() || createMeetingDraft(meetingMode).title;
      if (title.length > maxMeetingTitleLength) {
        setToast(`会议主题不能超过 ${maxMeetingTitleLength} 个字符`);
        return;
      }
      const createdMeeting: LocalMeetingRecord = {
        ...defaultScheduledMeeting,
        id: `local-created-${roomId}`,
        day: "28",
        month: "今天",
        time: "刚刚",
        title,
        detail:
          meetingMode === "class"
            ? `${courseLabels[meetingDraft.courseId]} · ${classLabels[meetingDraft.classId]}`
            : "本机创建 · 仅当前演示可见",
        type: meetingMode === "class" ? "课程课堂" : "普通会议",
        accent: meetingMode === "class" ? "green" : "blue",
        roomId,
        mode: meetingMode,
        autoMute: meetingDraft.autoMute,
        generateReport: meetingDraft.generateReport,
        reportGenerated: meetingDraft.generateReport,
        status: "upcoming",
      };
      const nextLocalMeetings = [
        createdMeeting,
        ...[...localMeetings, ...storedMeetings].filter(
          (meeting, index, meetings) =>
            meetings.findIndex((candidate) => candidate.roomId === meeting.roomId) ===
            index,
        ),
      ].slice(0, 20);
      const historySaved = writeLocalMeetings(nextLocalMeetings);
      setLocalMeetings(historySaved ? readLocalMeetings() : nextLocalMeetings);
      enterMeeting(
        undefined,
        title,
        roomId,
        {
          autoMute: meetingDraft.autoMute,
          generateReport: meetingDraft.generateReport,
        },
      );
      if (!historySaved) setToast("会议已开始，但本机历史未保存");
      return;
    }
    const storedMeetings = readLocalMeetings();
    const nextMeeting: ScheduledMeeting = {
      ...defaultScheduledMeeting,
      roomId: createScheduledRoomId([
        ...(scheduledMeeting ? [scheduledMeeting.roomId] : []),
        ...localMeetings.map((meeting) => meeting.roomId),
        ...storedMeetings.map((meeting) => meeting.roomId),
      ]),
      title:
        meetingDraft.title.trim() || createMeetingDraft(meetingMode).title,
      detail:
        meetingMode === "class"
          ? `${courseLabels[meetingDraft.courseId]} · ${classLabels[meetingDraft.classId]}`
          : "线上会议 · 仅邀请成员",
      type: meetingMode === "class" ? "课程课堂" : "普通会议",
      accent: meetingMode === "class" ? "green" : "blue",
      autoMute: meetingDraft.autoMute,
      generateReport: meetingDraft.generateReport,
      status: "upcoming",
      reportGenerated: meetingDraft.generateReport,
      mode: meetingMode,
    };
    if (nextMeeting.title.length > maxMeetingTitleLength) {
      setToast(`会议主题不能超过 ${maxMeetingTitleLength} 个字符`);
      return;
    }
    if (!writeScheduledMeeting(nextMeeting)) {
      setToast("本机存储不可用，预约未保存");
      return;
    }
    setScheduledMeeting(nextMeeting);
    setModal(null);
    setActiveNav("我的会议");
    setToast("会议已预约，并已保存到本机");
  };
  const markLocalMeetingPast = (
    roomId: string,
    savedSnapshot: SessionReportSnapshot,
    reportGenerated: boolean,
  ) => {
    if (!localMeetings.some((meeting) =>
      meeting.roomId === roomId && meeting.status === "upcoming",
    ))
      return;
    const nextLocalMeetings = localMeetings.map((meeting) =>
      meeting.roomId === roomId
        ? {
            ...meeting,
            status: "past" as const,
            reportSnapshot: savedSnapshot,
            reportGenerated,
          }
        : meeting,
    );
    const historySaved = writeLocalMeetings(nextLocalMeetings);
    setLocalMeetings(historySaved ? readLocalMeetings() : nextLocalMeetings);
    if (!historySaved) {
      setToast("会议已结束，但本机历史状态保存失败");
    }
  };
  const markScheduledMeetingPast = (
    roomId: string,
    savedSnapshot: SessionReportSnapshot,
    reportGenerated: boolean,
  ) => {
    if (
      !scheduledMeeting ||
      scheduledMeeting.roomId !== roomId ||
      scheduledMeeting.status === "past"
    )
      return;
    const nextScheduledMeeting: ScheduledMeeting = {
      ...scheduledMeeting,
      status: "past",
      reportSnapshot: savedSnapshot,
      reportGenerated,
    };
    setScheduledMeeting(nextScheduledMeeting);
    if (!writeScheduledMeeting(nextScheduledMeeting)) {
      setToast("会议已结束，但本机历史状态保存失败");
    }
  };
  const cancelScheduledMeeting = () => {
    if (!removeScheduledMeeting()) {
      setToast("本机存储不可用，暂时无法取消预约");
      return;
    }
    setScheduledMeeting(null);
    setToast("已取消本机预约");
  };
  const deleteLocalMeeting = async (item: MeetingListItem) => {
    const localRecordExists = localMeetings.some(
      (meeting) => meeting.roomId === item.roomId,
    );
    const scheduledRecordExists = scheduledMeeting?.roomId === item.roomId;
    if (!localRecordExists && !scheduledRecordExists) {
      setToast("该会议不是可删除的本机记录");
      return;
    }

    const localRemoved =
      !localRecordExists || removeLocalMeetingRecord(item.roomId);
    const scheduledRemoved =
      !scheduledRecordExists || removeScheduledMeeting();
    if (!localRemoved || !scheduledRemoved) {
      // 删除失败时不重读存储：此刻读取本身可能就是失败原因，
      // 重读会把列表清空，反而丢掉本应保留的记录。
      setToast("无法删除本机会议记录，请检查本机存储后重试");
      return;
    }

    setLocalMeetings(readLocalMeetings());
    setScheduledMeeting(readScheduledMeeting());
    setLocalRecordingBlobs((current) => {
      if (!(item.roomId in current)) return current;
      const next = { ...current };
      delete next[item.roomId];
      return next;
    });

    let recordingRemoved = typeof window.indexedDB === "undefined";
    if (!recordingRemoved) {
      try {
        recordingRemoved = await removeLocalRecording(item.roomId);
      } catch {
        recordingRemoved = false;
      }
    }
    const todosRemoved = removeLocalReportTodos(item.roomId);
    setToast(
      recordingRemoved && todosRemoved
        ? "已删除本机会议，并清理录制与课后待办"
        : "已删除本机会议，但部分本地附属数据清理失败，请稍后重试",
    );
  };
  const togglePanel = (next: Exclude<Panel, null>) =>
    setPanel((current) => (current === next ? null : next));
  const sendMessage = () => {
    if (chatInput.length > maxChatMessageLength) {
      setToast(`消息不能超过 ${maxChatMessageLength} 个字符`);
      return;
    }
    const text = chatInput.trim();
    if (!text) return;
    if (text.length > maxChatMessageLength) {
      setToast(`消息不能超过 ${maxChatMessageLength} 个字符`);
      return;
    }
    setLocalMessages((items) =>
      appendChatMessage(items, {
        name: participantName,
        time: "刚刚",
        text,
        mine: true,
      }),
    );
    setSessionMessageCount(incrementSessionMessageCount);
    chatChannelRef.current?.postMessage({
      type: "chat",
      text,
      senderName: participantName,
    } satisfies ChatSignal);
    setChatInput("");
  };
  const copyMeetingId = async () => {
    const meetingId = normalizeRoomId(call.roomId);
    if (!meetingId) {
      setToast("会议号只能包含数字，可使用空格或短横线分隔");
      return;
    }
    try {
      if (!navigator.clipboard?.writeText) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(meetingId);
      setToast("会议号已复制");
    } catch {
      setToast("复制失败，请手动复制会议号");
    }
  };
  const copyMeetingInvite = async (
    title: string,
    roomId: string,
    mode: MeetingMode,
  ) => {
    const normalizedRoom = normalizeRoomId(roomId);
    if (
      normalizedRoom.length < 6 ||
      normalizedRoom.length > MAX_ROOM_ID_LENGTH
    ) {
      setToast("会议号无效，无法生成本地邀请引用");
      return;
    }
    const link = buildLocalShareLink("meeting", title, {
      roomId: normalizedRoom,
      mode,
    });
    const copied = await copyTextToClipboard(link);
    setToast(
      copied
        ? "本地会议邀请引用已复制"
        : "复制失败，请手动复制本地会议邀请引用",
    );
  };
  const toggleUtilityPanel = (
    next: Exclude<UtilityPanel, null>,
    trigger: HTMLButtonElement,
  ) => {
    utilityTriggerRef.current = trigger;
    previousProfileMenuOpenRef.current = false;
    setProfileMenuOpen(false);
    setUtilityPanel((current) => (current === next ? null : next));
  };
  const topbarActions: TopbarActions = {
    onSearch: (trigger) => toggleUtilityPanel("search", trigger),
    onNotifications: (trigger) => toggleUtilityPanel("notifications", trigger),
    unreadNotifications: notifications.filter((notification) => !notification.read)
      .length,
    activeUtilityPanel: utilityPanel,
  };
  const navigateFromUtility = (
    nav: string,
    message: string,
    result?: GlobalSearchResult,
  ) => {
    setActiveNav(nav);
    if (result?.kind === "回放") {
      setSharedReplayTitle(result.title);
      setSharedReplayRoomId(result.roomId ?? null);
      setSharedMaterialName(null);
      setSharedMaterialId(null);
      setSharedMeetingTitle(null);
      setSharedMeetingRoomId(null);
    } else if (result?.kind === "资料") {
      setSharedReplayTitle(null);
      setSharedReplayRoomId(null);
      setSharedMaterialName(result.title);
      setSharedMaterialId(result.materialId ?? null);
      setSharedMeetingTitle(null);
      setSharedMeetingRoomId(null);
    } else if (result?.kind === "会议") {
      setSharedReplayTitle(null);
      setSharedReplayRoomId(null);
      setSharedMaterialName(null);
      setSharedMaterialId(null);
      setSharedMeetingTitle(result.title);
      setSharedMeetingRoomId(result.roomId ?? null);
    } else {
      setSharedReplayTitle(null);
      setSharedReplayRoomId(null);
      setSharedMaterialName(null);
      setSharedMaterialId(null);
      setSharedMeetingTitle(null);
      setSharedMeetingRoomId(null);
    }
    utilityTriggerRef.current = null;
    setUtilityPanel(null);
    setToast(message);
  };
  const persistNotifications = (nextNotifications: AppNotification[]) => {
    notificationsRef.current = nextNotifications;
    setNotifications(nextNotifications);
    const saved = writeNotificationReadIds(
      nextNotifications
        .filter((notification) => notification.read)
        .map((notification) => notification.id),
    );
    if (!saved) setToast("通知已更新，但本机状态保存失败");
    return saved;
  };
  const markNotificationRead = (id: string) => {
    persistNotifications(
      notificationsRef.current.map((notification) =>
        notification.id === id ? { ...notification, read: true } : notification,
      ),
    );
  };
  const markAllNotificationsRead = () => {
    const saved = persistNotifications(
      notificationsRef.current.map((notification) => ({
        ...notification,
        read: true,
      })),
    );
    if (saved) setToast("通知已全部标记为已读");
  };
  const returnHomeFromReport = () => {
    recordingHydrationRef.current += 1;
    setReportRecordingBlob(null);
    setView("home");
    setActiveNav("会议首页");
    setSharedReplayTitle(null);
    setSharedReplayRoomId(null);
    setSharedMaterialName(null);
    setSharedMaterialId(null);
    setSharedMeetingTitle(null);
    setSharedMeetingRoomId(null);
    utilityTriggerRef.current = null;
    setUtilityPanel(null);
    setProfileMenuOpen(false);
  };
  const leaveMeetingConnection = () => {
    localRecording.reset();
    setRecordingCaptured(false);
    call.leave();
  };
  const returnHomeFromMeeting = () => {
    leaveMeetingConnection();
    setView("home");
    setActiveNav("会议首页");
    setSharedReplayTitle(null);
    setSharedReplayRoomId(null);
    setSharedMaterialName(null);
    setSharedMaterialId(null);
    setSharedMeetingTitle(null);
    setSharedMeetingRoomId(null);
    setMeetingSettingsOpen(false);
    setPanel(null);
  };
  const isClassMeeting = meetingMode === "class";
  const meetingPhaseCopy = {
    idle: "大厅",
    starting: "正在入会",
    waiting: "等待参会者",
    connecting: "连接中",
    connected: "进行中",
    error: "连接异常",
  }[call.status];

  if (view === "meeting") {
    return (
      <main className="meeting-room">
        <header className="meeting-header">
          <div className="meeting-identity">
            <button
              className="meeting-logo"
              onClick={returnHomeFromMeeting}
              aria-label="返回会议首页"
            >
              学
            </button>
            <div>
              <strong>{activeMeetingTitle}</strong>
              <small>
                <i /> {isClassMeeting ? "课堂" : "会议"}{meetingPhaseCopy} · {elapsedLabel}
              </small>
            </div>
          </div>
          <div className="meeting-meta">
            <span>会议号 {call.roomId.replace(/(\d{3})(?=\d)/g, "$1 ")}</span>
            <button
              onClick={() => void copyMeetingId()}
              aria-label="复制会议号"
            >
              复制
            </button>
            <button
              onClick={() =>
                void copyMeetingInvite(activeMeetingTitle, call.roomId, meetingMode)
              }
              aria-label="复制本地会议邀请链接"
            >
              邀请
            </button>
          </div>
          <div className="meeting-head-actions">
            <button
              className={layout === "grid" ? "selected" : ""}
              onClick={() => setLayout("grid")}
              aria-pressed={layout === "grid"}
            >
              宫格
            </button>
            <button
              className={layout === "focus" ? "selected" : ""}
              onClick={() => setLayout("focus")}
              aria-pressed={layout === "focus"}
            >
              主讲
            </button>
            <button
              ref={meetingSettingsTriggerRef}
              aria-label="更多设置"
              aria-expanded={meetingSettingsOpen}
              aria-controls="meeting-settings-menu"
              aria-haspopup="menu"
              onClick={() => setMeetingSettingsOpen((current) => !current)}
            >
              •••
            </button>
            {meetingSettingsOpen && (
              <aside
                id="meeting-settings-menu"
                ref={meetingSettingsMenuRef}
                className="meeting-settings-menu"
                role="menu"
                aria-label="会议设置"
              >
                <strong>会话设置</strong>
                <span>本地 WebRTC 实验</span>
                <p>布局、设备和屏幕共享可在当前页面直接调整。</p>
                <button
                  type="button"
                  role="menuitem"
                  onKeyDown={handleMenuItemKeyDown}
                  onClick={() => {
                    setMeetingSettingsOpen(false);
                    setToast("当前会话仅在同源本地窗口间传输");
                  }}
                >
                  查看本地实验边界
                </button>
              </aside>
            )}
          </div>
        </header>
        <section className={`meeting-stage ${panel ? "with-panel" : ""}`}>
          <RealVideoGrid
            call={meetingGridCall}
            localVideoRef={call.localVideoRef}
            remoteVideoRef={call.remoteVideoRef}
            participantName={participantName}
            joinPreferences={joinPreferences}
            startMuted={startMuted}
            layout={layout}
            onLeave={leaveMeetingConnection}
          />
          {panel && (
            <MeetingPanel
              panel={panel}
              setPanel={setPanel}
              meetingMode={meetingMode}
              participantName={participantName}
              localStream={call.localStream}
              remoteStream={call.remoteStream}
              micOn={call.micOn}
              activity={activity}
              setActivity={setActivity}
              publishedActivities={publishedActivities}
              publishActivity={() => {
                setPublishedActivities((current) =>
                  current.includes(activity) ? current : [...current, activity],
                );
                setToast(
                  publishedActivities.includes(activity)
                    ? "该活动已发布"
                    : "课堂活动已发布",
                );
              }}
              localMessages={localMessages}
              chatInput={chatInput}
              setChatInput={setChatInput}
              sendMessage={sendMessage}
              setToast={setToast}
            />
          )}
        </section>
        {localRecording.error && (
          <div
            className="call-error meeting-recording-error"
            role="alert"
            aria-live="assertive"
          >
            {localRecording.error}
          </div>
        )}
        <footer className="meeting-controls">
          <div className="control-group">
            <button
              className={call.micOn ? "" : "off"}
              onClick={call.toggleMic}
              disabled={
                !call.localStream ||
                !call.localStream
                  .getAudioTracks()
                  .some((track) => track.readyState !== "ended")
              }
              aria-pressed={call.micOn}
            >
              <span>{call.micOn ? "◖))" : "╳"}</span>
              <small>{call.micOn ? "静音" : "解除静音"}</small>
            </button>
            <button
              className={call.cameraOn ? "" : "off"}
              onClick={call.toggleCamera}
              disabled={
                !call.localStream ||
                !call.localStream
                  .getVideoTracks()
                  .some((track) => track.readyState !== "ended")
              }
              aria-pressed={call.cameraOn}
            >
              <span>{call.cameraOn ? "▰" : "▱"}</span>
              <small>{call.cameraOn ? "关闭视频" : "开启视频"}</small>
            </button>
          </div>
          <div className="control-group central">
            <button
              className={call.sharing ? "active-control" : ""}
              onClick={() => void call.toggleSharing()}
              disabled={
                !call.localStream ||
                !call.localStream
                  .getVideoTracks()
                  .some((track) => track.readyState !== "ended")
              }
              aria-pressed={call.sharing}
            >
              <span>▣</span>
              <small>{call.sharing ? "停止共享" : "共享屏幕"}</small>
            </button>
            <button
              className={recording ? "recording" : ""}
              disabled={
                !recording &&
                !call.localStream?.getTracks().some(
                  (track) => track.readyState !== "ended",
                )
              }
              onClick={() => {
                if (recording) {
                  localRecording.stop();
                  setToast("正在完成本地录制");
                  return;
                }
                const started = localRecording.start(call.getRecordingStream());
                if (started) {
                  setRecordingCaptured(true);
                  setToast("本地录制已开始");
                } else {
                  setRecordingCaptured(false);
                  setToast(
                    call.localStream
                      ? "无法开始本地录制，请检查媒体设备"
                      : "请先开启摄像头或麦克风，再开始录制",
                  );
                }
              }}
              aria-pressed={recording}
            >
              <span>●</span>
              <small>{recording ? "停止录制" : "录制"}</small>
            </button>
            <button
              className={panel === "members" ? "active-control" : ""}
              ref={(element) => {
                panelTriggerRefs.current.members = element;
              }}
              onClick={() => togglePanel("members")}
              aria-expanded={panel === "members"}
              aria-controls="meeting-side-panel"
            >
              <span>♙</span>
              <small>
                成员 {isClassMeeting ? 48 : 1 + (call.remoteStream ? 1 : 0)}
              </small>
            </button>
            <button
              className={panel === "chat" ? "active-control" : ""}
              ref={(element) => {
                panelTriggerRefs.current.chat = element;
              }}
              onClick={() => togglePanel("chat")}
              aria-expanded={panel === "chat"}
              aria-controls="meeting-side-panel"
            >
              <span>▢</span>
              <small>聊天</small>
              <i className="control-dot" />
            </button>
            {isClassMeeting && (
              <button
                className={panel === "activities" ? "active-control" : ""}
                ref={(element) => {
                  panelTriggerRefs.current.activities = element;
                }}
                onClick={() => togglePanel("activities")}
                aria-expanded={panel === "activities"}
                aria-controls="meeting-side-panel"
              >
                <span>✦</span>
                <small>课堂互动</small>
              </button>
            )}
          </div>
          <button
            className="end-button"
            onClick={() => {
              if (recording) localRecording.stop();
              const sessionSnapshot: SessionReportSnapshot = {
                durationSeconds: elapsed,
                chatMessageCount: sessionMessageCount,
                publishedActivityCount: publishedActivities.length,
                publishedActivityIds: [...publishedActivities],
                recordingAvailable: recordingCapturedForReport,
                participantCount:
                  (call.localStream ? 1 : 0) + (call.remoteStream ? 1 : 0),
                participantName,
                meetingMode,
              };
              markLocalMeetingPast(call.roomId, sessionSnapshot, reportGenerated);
              markScheduledMeetingPast(call.roomId, sessionSnapshot, reportGenerated);
              call.leave();
              openReport(
                activeMeetingTitle,
                true,
                recordingCapturedForReport,
                meetingMode,
                sessionSnapshot,
              );
            }}
          >
            结束{isClassMeeting ? "课堂" : "会议"}
          </button>
        </footer>
        {toast && (
          <div className="toast" role="status">
            {toast}
          </div>
        )}
      </main>
    );
  }

  if (view === "report")
    return (
      <ReportPage
        key={`${activeMeetingTitle}:${reportMode}:${reportSnapshot ? "local" : "demo"}`}
        meetingTitle={activeMeetingTitle}
        onBackHome={returnHomeFromReport}
        toast={toast}
        setToast={setToast}
        publishedActivities={publishedActivities}
        reportGenerated={reportGenerated}
        setReportGenerated={setReportGenerated}
        onReportGenerated={() => markMeetingReportGenerated(reportRoomId ?? call.roomId)}
        reportSnapshot={reportSnapshot}
        reportMode={reportMode}
        reportRoomId={reportRoomId}
        recordingAvailable={
          reportSnapshot?.recordingAvailable ?? recordingCapturedForReport
        }
        recordingBlob={reportRecordingBlob}
      />
    );

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">学</span>
          <span className="brand-name">学习通会议</span>
        </div>
        <nav className="nav-list" aria-label="主要导航">
          {navItems.map((item) => (
            <button
              className={`nav-item ${activeNav === item.label ? "active" : ""}`}
              key={item.label}
              onClick={() => {
                setActiveNav(item.label);
                setSharedReplayTitle(null);
                setSharedReplayRoomId(null);
                setSharedMaterialName(null);
                setSharedMaterialId(null);
                setSharedMeetingTitle(null);
                setSharedMeetingRoomId(null);
                utilityTriggerRef.current = null;
                setProfileMenuOpen(false);
                setUtilityPanel(null);
              }}
              aria-current={activeNav === item.label ? "page" : undefined}
            >
              <span className="nav-icon" aria-hidden="true">
                {item.icon}
              </span>
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-course">
          <span className="course-kicker">正在进行的课程</span>
          <strong>数字媒体技术</strong>
          <span>2026 秋 · 1 班</span>
          <div className="course-progress">
            <i />
          </div>
          <small>第 3 / 16 周</small>
        </div>
        <button
          className="profile-card"
          id="profile-menu-trigger"
          ref={profileTriggerRef}
          aria-expanded={profileMenuOpen}
          aria-controls="profile-menu"
          aria-haspopup="menu"
          onClick={() => {
            utilityTriggerRef.current = null;
            setUtilityPanel(null);
            setProfileMenuOpen((current) => !current);
          }}
        >
          <span className="avatar">林</span>
          <span>
            <strong>林老师</strong>
            <small>信息工程学院</small>
          </span>
          <span className="more">•••</span>
        </button>
        {profileMenuOpen && (
          <div
            id="profile-menu"
            ref={profileMenuRef}
            className="profile-menu"
            role="menu"
            aria-label="个人菜单"
          >
            <div className="profile-menu-heading">
              <strong>林老师</strong>
              <small>信息工程学院 · 当前账号</small>
            </div>
            <button
              type="button"
              role="menuitem"
              onKeyDown={handleMenuItemKeyDown}
              onClick={() => {
                setProfileMenuOpen(false);
                setToast("个人资料暂未接入，本地演示保持不变");
              }}
            >
              <span>◉</span>
              <span>
                <strong>个人资料</strong>
                <small>查看当前演示身份</small>
              </span>
              <i>→</i>
            </button>
            <button
              type="button"
              role="menuitem"
              onKeyDown={handleMenuItemKeyDown}
              onClick={() => {
                setProfileMenuOpen(false);
                setToast("当前为本地演示，无需退出账号");
              }}
            >
              <span>↗</span>
              <span>
                <strong>账号状态</strong>
                <small>本地数据仅保存在此页面</small>
              </span>
              <i>→</i>
            </button>
          </div>
        )}
      </aside>
      <section className="workspace">
        {activeNav === "会议首页" && (
          <HomeDashboard
            enterMeeting={enterMeeting}
            setModal={setModal}
            setMeetingMode={setMeetingMode}
            setCreateIntent={setCreateIntent}
            setMeetingDraft={setMeetingDraft}
            setJoinMeetingMode={setJoinMeetingMode}
            setActiveNav={setActiveNav}
            scheduledMeeting={scheduledMeeting}
            topbarActions={topbarActions}
          />
        )}
        {activeNav === "我的会议" && (
          <MeetingsHub
            key={`${sharedMeetingRoomId ?? "none"}:${sharedMeetingTitle ?? "meetings-hub"}`}
            enterMeeting={enterMeeting}
            openReport={openReport}
            setToast={setToast}
            setModal={setModal}
            setMeetingMode={setMeetingMode}
            setCreateIntent={setCreateIntent}
            setMeetingDraft={setMeetingDraft}
            scheduledMeeting={scheduledMeeting}
            localMeetings={localMeetings}
            initialMeetingTitle={sharedMeetingTitle}
            initialMeetingRoomId={sharedMeetingRoomId}
            cancelScheduledMeeting={cancelScheduledMeeting}
            deleteLocalMeeting={deleteLocalMeeting}
            copyMeetingInvite={(item) =>
              copyMeetingInvite(
                item.title,
                item.roomId,
                item.mode ?? (item.type === "课程课堂" ? "class" : "normal"),
              )
            }
            topbarActions={topbarActions}
          />
        )}
        {activeNav === "课堂回放" && (
          <ReplayHub
            key={`${sharedReplayRoomId ?? "none"}:${sharedReplayTitle ?? "replay-hub"}`}
            setToast={setToast}
            topbarActions={topbarActions}
            initialReplayTitle={sharedReplayTitle}
            initialReplayRoomId={sharedReplayRoomId}
            publishedReplayTitle={publishedReplayTitle}
            setPublishedReplayTitle={setPublishedReplayTitle}
            localMeetings={localMeetings}
            scheduledMeeting={scheduledMeeting}
            localRecordingBlobs={localRecordingBlobs}
          />
        )}
        {activeNav === "会议资料" && (
          <MaterialsHub
            key={`${sharedMaterialId ?? "none"}:${sharedMaterialName ?? "materials-hub"}`}
            setToast={setToast}
            topbarActions={topbarActions}
            initialMaterialName={sharedMaterialName}
            initialMaterialId={sharedMaterialId}
            localFiles={localMaterialFiles}
            setLocalFiles={setLocalMaterialFiles}
            localFileContents={localMaterialContents}
            setLocalFileContents={setLocalMaterialContents}
            persistedFileIds={persistedLocalMaterialIds}
            setPersistedFileIds={setPersistedLocalMaterialIds}
          />
        )}
      </section>
      {utilityPanel && (
        <GlobalUtilityPanel
          panel={utilityPanel}
          query={globalSearch}
          setQuery={setGlobalSearch}
          searchCatalog={searchCatalog}
          notifications={notifications}
          onClose={() => setUtilityPanel(null)}
          onNavigate={navigateFromUtility}
          onMarkRead={markNotificationRead}
          onMarkAllRead={markAllNotificationsRead}
        />
      )}
      {modal && (
        <MeetingModal
          modal={modal}
          setModal={setModal}
          meetingMode={meetingMode}
          setMeetingMode={setMeetingMode}
          submitMeeting={submitMeeting}
          createIntent={createIntent}
          meetingDraft={meetingDraft}
          setMeetingDraft={setMeetingDraft}
          joinPreferences={joinPreferences}
          setJoinPreferences={setJoinPreferences}
          joinRoomId={joinRoomId}
          setJoinRoomId={setJoinRoomId}
          joinName={joinName}
          setJoinName={setJoinName}
        />
      )}
      {toast && (
        <div className="toast light-toast" role="status">
          {toast}
        </div>
      )}
    </main>
  );
}

function RealVideoGrid({
  call,
  localVideoRef,
  remoteVideoRef,
  participantName,
  joinPreferences,
  startMuted,
  layout,
  onLeave,
}: {
  call: MeetingGridCall;
  localVideoRef: LocalWebRTCApi["localVideoRef"];
  remoteVideoRef: LocalWebRTCApi["remoteVideoRef"];
  participantName: string;
  joinPreferences: JoinPreferences;
  startMuted: boolean;
  layout: "grid" | "focus";
  onLeave: () => void;
}) {
  const cameras = call.devices.filter((device) => device.kind === "videoinput");
  const microphones = call.devices.filter(
    (device) => device.kind === "audioinput",
  );
  const hasLiveCameraTrack = call.localStream?.getVideoTracks().some(
    (track) => track.readyState !== "ended",
  );
  const hasLiveMicrophoneTrack = call.localStream?.getAudioTracks().some(
    (track) => track.readyState !== "ended",
  );
  const statusCopy = {
    idle: "准备加入",
    starting: "正在请求设备权限",
    waiting: "等待另一位参会者",
    connecting: "正在建立加密连接",
    connected: "点对点连接已建立",
    error: "连接需要处理",
  }[call.status];

  return (
    <div className={`video-grid real-call-grid ${layout}`}>
      <article className="video-tile real-video-tile local-video-tile">
        <video
          ref={localVideoRef}
          autoPlay
          playsInline
          muted
          className={!call.cameraOn && !call.sharing ? "video-hidden" : ""}
        />
        {!call.localStream && (
          <div className="real-video-placeholder">
            <PersonAvatar name={participantName} color="#c6f1e2" />
            <span>摄像头尚未开启</span>
          </div>
        )}
        {call.localStream && !call.cameraOn && !call.sharing && (
          <div className="real-video-placeholder">
            <PersonAvatar name={participantName} color="#c6f1e2" />
            <span>摄像头已关闭</span>
          </div>
        )}
        <div className="tile-label">
          <span>{participantName} · 我</span>
          <span>{call.micOn ? "◖))" : "╳"}</span>
        </div>
        {call.sharing && <span className="speaking-badge">正在共享</span>}
      </article>

      <article className="video-tile real-video-tile remote-video-tile">
        <video ref={remoteVideoRef} autoPlay playsInline />
        {!call.remoteStream && (
          <div className="remote-waiting">
            <div className="waiting-rings">
              <i />
              <i />
              <span>＋</span>
            </div>
            <strong>
              {call.status === "waiting" ? "等待对方加入" : "第二位参会者"}
            </strong>
            <small>在另一个浏览器窗口打开本地地址，输入相同房间号</small>
          </div>
        )}
        {call.remoteStream && (
          <div className="tile-label">
            <span>远端参会者</span>
            <span>◖))</span>
          </div>
        )}
      </article>

      <div
        className={`connection-status ${call.status}`}
        aria-live="polite"
        aria-atomic="true"
      >
        <i />
        <span>{statusCopy}</span>
      </div>

      {call.error && call.status !== "idle" && call.status !== "error" && (
        <div className="meeting-call-error" role="alert" aria-live="assertive">
          <span className="meeting-call-error-icon" aria-hidden="true">
            !
          </span>
          <div>
            <strong>会议设备需要处理</strong>
            <span>{call.error}</span>
          </div>
          <button
            onClick={() => void call.join({ ...joinPreferences, startMuted })}
          >
            重新加入
          </button>
        </div>
      )}

      {call.localStream && (
        <div className="device-switcher">
          {hasLiveCameraTrack && (
            <label>
              <span>摄像头</span>
              <select
                value={call.cameraId}
                onChange={(event) => void call.switchCamera(event.target.value)}
              >
                <option value="">系统默认</option>
                {cameras.map((device, index) => (
                  <option value={device.deviceId} key={device.deviceId}>
                    {device.label || `摄像头 ${index + 1}`}
                  </option>
                ))}
              </select>
            </label>
          )}
          {hasLiveMicrophoneTrack && (
            <label>
              <span>麦克风</span>
              <select
                value={call.microphoneId}
                onChange={(event) =>
                  void call.switchMicrophone(event.target.value)
                }
              >
                <option value="">系统默认</option>
                {microphones.map((device, index) => (
                  <option value={device.deviceId} key={device.deviceId}>
                    {device.label || `麦克风 ${index + 1}`}
                  </option>
                ))}
              </select>
            </label>
          )}
          {!hasLiveCameraTrack && !hasLiveMicrophoneTrack && (
            <small>当前未开启音视频，请离开后重新加入并开启媒体。</small>
          )}
          <button onClick={onLeave}>离开连接</button>
        </div>
      )}

      {(call.status === "idle" || call.status === "error") && (
        <section className="call-lobby" aria-label="本地真实会议实验">
          <span className="call-lobby-kicker">本地 WebRTC 实验</span>
          <h2>打开真实摄像头，开始双人会议</h2>
          <p>
            在两个本地浏览器窗口输入相同房间号，即可建立真实的点对点音视频连接。
          </p>
          <label className="room-code-field">
            <span>房间号</span>
            <input
              maxLength={MAX_ROOM_ID_LENGTH}
              value={call.roomId}
              onChange={(event) => call.setRoomId(event.target.value)}
              inputMode="numeric"
              aria-label="本地会议房间号"
            />
          </label>
          {call.error && (
            <div className="call-error" role="alert" aria-live="assertive">
              {call.error}
            </div>
          )}
          <button
            className="join-real-call"
            onClick={() => void call.join({ ...joinPreferences, startMuted })}
          >
            开启设备并加入 <span>→</span>
          </button>
          <small>
            浏览器会请求摄像头与麦克风权限；媒体只在两个本地窗口之间传输。
          </small>
        </section>
      )}
    </div>
  );
}

function ProductTopbar({
  eyebrow,
  title,
  action,
  onSearch,
  onNotifications,
  unreadNotifications,
  activeUtilityPanel,
}: {
  eyebrow: string;
  title: string;
  action?: React.ReactNode;
  onSearch: (trigger: HTMLButtonElement) => void;
  onNotifications: (trigger: HTMLButtonElement) => void;
  unreadNotifications: number;
  activeUtilityPanel: UtilityPanel;
}) {
  return (
    <header className="topbar product-topbar">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
      </div>
      <div className="topbar-tools">
        {action && <div className="topbar-custom-action">{action}</div>}
        <div className="top-actions">
          <button
            className="icon-button"
            aria-label="搜索"
            aria-expanded={activeUtilityPanel === "search"}
            aria-controls="global-utility-panel-search"
            aria-haspopup="dialog"
            onClick={(event) => onSearch(event.currentTarget)}
          >
            ⌕
          </button>
          <button
            className="icon-button notification"
            aria-label="通知"
            aria-expanded={activeUtilityPanel === "notifications"}
            aria-controls="global-utility-panel-notifications"
            aria-haspopup="dialog"
            onClick={(event) => onNotifications(event.currentTarget)}
          >
            ♢{unreadNotifications > 0 && <i />}
          </button>
        </div>
      </div>
    </header>
  );
}

function HomeDashboard({
  enterMeeting,
  setModal,
  setMeetingMode,
  setCreateIntent,
  setMeetingDraft,
  setJoinMeetingMode,
  setActiveNav,
  scheduledMeeting,
  topbarActions,
}: {
  enterMeeting: EnterMeeting;
  setModal: Setter<"create" | "join" | null>;
  setMeetingMode: Setter<MeetingMode>;
  setCreateIntent: Setter<CreateIntent>;
  setMeetingDraft: Setter<MeetingDraft>;
  setJoinMeetingMode: Setter<MeetingMode>;
  setActiveNav: Setter<string>;
  scheduledMeeting: ScheduledMeeting | null;
  topbarActions: TopbarActions;
}) {
  return (
    <>
      <ProductTopbar
        eyebrow="8 月 28 日 · 星期五"
        title="下午好，林老师"
        {...topbarActions}
      />
      <section className="live-card">
        <div className="live-copy">
          <span className="live-label">
            <i /> 课堂进行中
          </span>
          <h2>数字媒体技术 · 第 3 讲</h2>
          <p>今天 10:00–11:40 · 已进行 28 分钟</p>
          <div className="live-stats">
            <span>
              <strong>42</strong> / 48 已到
            </span>
            <span>
              <strong>87%</strong> 到课率
            </span>
            <span>
              <strong>6</strong> 条互动
            </span>
          </div>
          <button
            className="primary-button"
            onClick={() =>
              enterMeeting(
                "已进入课程课堂",
                "数字媒体技术 · 第 3 讲",
                "821406233",
                undefined,
                "林老师",
                "class",
              )
            }
          >
            进入课堂 <span>→</span>
          </button>
        </div>
        <div className="live-visual" aria-hidden="true">
          <div className="pulse pulse-one" />
          <div className="pulse pulse-two" />
          <div className="class-orb">
            <span>42</span>
            <small>人在线</small>
          </div>
          <div className="mini-avatar avatar-one">周</div>
          <div className="mini-avatar avatar-two">许</div>
          <div className="mini-avatar avatar-three">陈</div>
        </div>
      </section>
      <section className="quick-section">
        <div className="section-heading">
          <div>
            <span className="section-index">01</span>
            <h2>开始会议</h2>
          </div>
          <p>从课程发起，或创建一次普通会议</p>
        </div>
        <div className="quick-grid">
          <button
            className="quick-card mint"
            onClick={() => {
              setMeetingMode("normal");
              setCreateIntent("start");
              setMeetingDraft(createMeetingDraft("normal"));
              setModal("create");
            }}
          >
            <span className="quick-icon">↗</span>
            <span>
              <strong>快速会议</strong>
              <small>立即开始</small>
            </span>
            <span className="arrow">↗</span>
          </button>
          <button
            className="quick-card blue"
            onClick={() => {
              setMeetingMode("class");
              setCreateIntent("schedule");
              setMeetingDraft(createMeetingDraft("class"));
              setModal("create");
            }}
          >
            <span className="quick-icon">＋</span>
            <span>
              <strong>预约会议</strong>
              <small>安排日程</small>
            </span>
            <span className="arrow">↗</span>
          </button>
          <button
            className="quick-card amber"
            onClick={() => {
              setCreateIntent("start");
              setJoinMeetingMode("normal");
              setModal("join");
            }}
          >
            <span className="quick-icon">⌁</span>
            <span>
              <strong>加入会议</strong>
              <small>输入会议号</small>
            </span>
            <span className="arrow">↗</span>
          </button>
        </div>
      </section>
      <section className="schedule-section">
        <div className="section-heading">
          <div>
            <span className="section-index">02</span>
            <h2>今天的日程</h2>
          </div>
          <button
            className="text-button"
            onClick={() => setActiveNav("我的会议")}
          >
            查看全部 <span>→</span>
          </button>
        </div>
        <div className="schedule-list">
          {scheduledMeeting && scheduledMeeting.status !== "past" && (
            <article className="schedule-row" key={scheduledMeeting.id}>
              <time>{scheduledMeeting.time.split("–")[0]}</time>
              <span className={`schedule-dot ${scheduledMeeting.accent}-bg`} />
              <div>
                <strong>{scheduledMeeting.title}</strong>
                <small>{scheduledMeeting.detail}</small>
              </div>
              <span className="tag">已预约</span>
              <button
                onClick={() =>
                  enterMeeting(
                    "已进入会议",
                    scheduledMeeting.title,
                    scheduledMeeting.roomId,
                    {
                      autoMute: scheduledMeeting.autoMute ?? true,
                      generateReport: scheduledMeeting.generateReport ?? true,
                    },
                    "林老师",
                    scheduledMeeting.mode ??
                      (scheduledMeeting.type === "课程课堂" ? "class" : "normal"),
                  )
                }
              >
                进入
              </button>
            </article>
          )}
          {schedules.map((item) => (
            <article className="schedule-row" key={item.time}>
              <time>{item.time}</time>
              <span className={`schedule-dot ${item.color}-bg`} />
              <div>
                <strong>{item.title}</strong>
                <small>{item.meta}</small>
              </div>
              <span className="tag">{item.tag}</span>
              <button
                aria-label={`打开${item.title}`}
            onClick={() =>
              enterMeeting(
                "已进入会议",
                item.title,
                item.roomId,
                undefined,
                "林老师",
                item.mode ?? "normal",
              )
            }
              >
                →
              </button>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}

function MeetingsHub({
  enterMeeting,
  openReport,
  setToast,
  setModal,
  setMeetingMode,
  setCreateIntent,
  setMeetingDraft,
  scheduledMeeting,
  localMeetings,
  initialMeetingTitle,
  initialMeetingRoomId,
  cancelScheduledMeeting,
  deleteLocalMeeting,
  copyMeetingInvite,
  topbarActions,
}: {
  enterMeeting: EnterMeeting;
  openReport: (
    title?: string,
    preserveSessionActivities?: boolean,
    hasRecording?: boolean,
    mode?: MeetingMode,
    savedSnapshot?: SessionReportSnapshot,
    generated?: boolean,
    roomId?: string,
  ) => void;
  setToast: Setter<string>;
  setModal: Setter<"create" | "join" | null>;
  setMeetingMode: Setter<MeetingMode>;
  setCreateIntent: Setter<CreateIntent>;
  setMeetingDraft: Setter<MeetingDraft>;
  scheduledMeeting: ScheduledMeeting | null;
  localMeetings: LocalMeetingRecord[];
  initialMeetingTitle: string | null;
  initialMeetingRoomId: string | null;
  cancelScheduledMeeting: () => void;
  deleteLocalMeeting: (item: MeetingListItem) => void | Promise<void>;
  copyMeetingInvite: (item: MeetingListItem) => void | Promise<void>;
  topbarActions: TopbarActions;
}) {
  const localSearchTarget = localMeetings.find(
    (item) =>
      initialMeetingRoomId
        ? item.roomId === initialMeetingRoomId
        : item.title === initialMeetingTitle,
  );
  const scheduledSearchTarget =
    scheduledMeeting &&
    (initialMeetingRoomId
      ? scheduledMeeting.roomId === initialMeetingRoomId
      : scheduledMeeting.title === initialMeetingTitle)
      ? scheduledMeeting
      : null;
  const [tab, setTab] = useState<"upcoming" | "past">(
    localSearchTarget?.status === "past" || scheduledSearchTarget?.status === "past"
      ? "past"
      : "upcoming",
  );
  const [query, setQuery] = useState("");
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [pendingConfirmation, setPendingConfirmation] = useState<{
    kind: "delete" | "cancel";
    item: MeetingListItem;
  } | null>(null);
  const [confirmationInProgress, setConfirmationInProgress] = useState(false);
  const [confirmationTrigger, setConfirmationTrigger] =
    useState<HTMLButtonElement | null>(null);
  const meetingMenuTriggerRef = useRef<HTMLButtonElement | null>(null);
  const meetingMenuRef = useRef<HTMLDivElement | null>(null);
  const previousOpenMenuIdRef = useRef<string | null>(null);
  const confirmationCancelRef = useRef<HTMLButtonElement | null>(null);
  const previousPendingConfirmationRef = useRef(false);
  const staticUpcoming: MeetingListItem[] = [
    {
      id: "current-class",
      day: "28",
      month: "今天",
      time: "10:00–11:40",
      title: "数字媒体技术 · 课堂",
      detail: "教学楼 A302 · 48 人",
      type: "课程课堂",
      accent: "green",
      roomId: "821406233",
      mode: "class",
    },
    {
      id: "defense-preview",
      day: "28",
      month: "今天",
      time: "14:30–16:30",
      title: "毕业设计中期答辩",
      detail: "信息工程学院 · 12 人",
      type: "答辩",
      accent: "amber",
      roomId: "563294108",
      mode: "normal",
    },
    {
      id: "interaction-group",
      day: "28",
      month: "今天",
      time: "19:00–20:00",
      title: "《交互设计》小组讨论",
      detail: "第 4 项目组 · 8 人",
      type: "小组会议",
      accent: "blue",
      roomId: "704915286",
      mode: "normal",
    },
    {
      id: "teaching-seminar",
      day: "31",
      month: "8月",
      time: "15:00–16:00",
      title: "新学期教学研讨会",
      detail: "产品设计教研室 · 24 人",
      type: "教研会",
      accent: "violet",
      roomId: "391825604",
      mode: "normal",
    },
  ];
  const searchTarget = schedules.find(
    (item) =>
      initialMeetingRoomId
        ? item.roomId === initialMeetingRoomId
        : item.title === initialMeetingTitle,
  );
  const searchableMeeting: MeetingListItem | null = searchTarget
    ? {
        id: `search-target-${searchTarget.roomId}`,
        day: "28",
        month: "今天",
        time: searchTarget.time,
        title: searchTarget.title,
        detail: searchTarget.meta,
        type: searchTarget.tag,
        accent: searchTarget.color,
        roomId: searchTarget.roomId,
        mode: searchTarget.mode,
      }
    : null;
  const upcoming: MeetingListItem[] = [
    ...(scheduledMeeting?.status !== "past" && scheduledMeeting
      ? [scheduledMeeting]
      : []),
    ...localMeetings.filter((meeting) => meeting.status === "upcoming"),
    ...(searchableMeeting ? [searchableMeeting] : []),
    ...staticUpcoming,
  ].filter(
    (item, index, items) =>
      items.findIndex((candidate) => candidate.roomId === item.roomId) === index,
  );
  const staticPastRoomIds = new Set(["248631907", "675314802"]);
  const completedMeetingDurationByRoom = new Map<string, number>();
  for (const meeting of [
    ...localMeetings,
    ...(scheduledMeeting ? [scheduledMeeting] : []),
  ]) {
    if (
      meeting.status === "past" &&
      meeting.reportSnapshot &&
      !staticPastRoomIds.has(meeting.roomId) &&
      !completedMeetingDurationByRoom.has(meeting.roomId)
    ) {
      completedMeetingDurationByRoom.set(
        meeting.roomId,
        meeting.reportSnapshot.durationSeconds,
      );
    }
  }
  const cumulativeMeetingDurationLabel = `${(
    (12.6 * 3600 +
      [...completedMeetingDurationByRoom.values()].reduce(
        (total, seconds) => total + seconds,
        0,
      )) /
    3600
  ).toFixed(1)} 小时`;
  const completedMeetingCount =
    8 +
    new Set([
      ...localMeetings
        .filter((meeting) => meeting.status === "past")
        .map((meeting) => meeting.roomId),
      ...(scheduledMeeting?.status === "past"
        ? [scheduledMeeting.roomId]
        : []),
    ].filter((roomId) => !staticPastRoomIds.has(roomId))).size;
  const past = ([
    ...(scheduledMeeting?.status === "past" ? [scheduledMeeting] : []),
    ...localMeetings.filter((meeting) => meeting.status === "past"),
    {
      id: "course-orientation",
      day: "27",
      month: "8月",
      time: "10:00–11:32",
      title: "交互设计 · 课程导学",
      detail: "46 人参会 · 已生成报告",
      type: "已结束",
      accent: "green",
      roomId: "248631907",
      mode: "class",
    },
    {
      id: "course-planning",
      day: "25",
      month: "8月",
      time: "14:00–15:16",
      title: "课程组备课会",
      detail: "8 人参会 · 录制 1:12:40",
      type: "已结束",
      accent: "blue",
      roomId: "675314802",
      mode: "normal",
    },
  ] satisfies MeetingListItem[]).filter(
    (item, index, items) =>
      items.findIndex((candidate) => candidate.roomId === item.roomId) === index,
  );
  const todayCount = [...upcoming, ...past].filter(
    (item, index, items) =>
      item.month === "今天" &&
      items.findIndex((candidate) => candidate.roomId === item.roomId) === index,
  ).length;
  const sourceRows = tab === "upcoming" ? upcoming : past;
  const normalizedQuery = query.trim().toLowerCase();
  const rows = sourceRows.filter((item) =>
    `${item.title}${item.detail}${item.type}${item.roomId}`
      .toLowerCase()
      .includes(normalizedQuery),
  );
  useEffect(() => {
    const previousMenuId = previousOpenMenuIdRef.current;
    if (previousMenuId && openMenuId === null) {
      meetingMenuTriggerRef.current?.focus();
    }
    previousOpenMenuIdRef.current = openMenuId;
  }, [openMenuId]);
  useEffect(() => {
    if (!openMenuId) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenMenuId(null);
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [openMenuId]);
  useEffect(() => {
    if (!pendingConfirmation) return;
    confirmationCancelRef.current?.focus();
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !confirmationInProgress) {
        setPendingConfirmation(null);
      }
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [confirmationInProgress, pendingConfirmation]);
  useEffect(() => {
    if (previousPendingConfirmationRef.current && !pendingConfirmation) {
      if (confirmationTrigger?.isConnected) {
        confirmationTrigger.focus();
      } else {
        document
          .querySelector<HTMLButtonElement>('[aria-current="page"]')
          ?.focus();
      }
    }
    previousPendingConfirmationRef.current = Boolean(pendingConfirmation);
  }, [confirmationTrigger, pendingConfirmation]);
  useEffect(() => {
    if (!openMenuId) return;
    meetingMenuRef.current
      ?.querySelector<HTMLElement>('[role="menuitem"]')
      ?.focus();
  }, [openMenuId]);
  const copyMeetingNumber = async (item: MeetingListItem) => {
    const copied = await copyTextToClipboard(item.roomId);
    setOpenMenuId(null);
    setToast(copied ? "会议号已复制" : "复制失败，请手动复制会议号");
  };
  const toggleMeetingMenu = (
    item: MeetingListItem,
    trigger: HTMLButtonElement,
  ) => {
    meetingMenuTriggerRef.current = trigger;
    setOpenMenuId((current) => (current === item.id ? null : item.id));
  };
  const openConfirmation = (
    item: MeetingListItem,
    kind: "delete" | "cancel",
    trigger: HTMLButtonElement | null,
  ) => {
    setConfirmationTrigger(trigger);
    setOpenMenuId(null);
    setPendingConfirmation({ item, kind });
  };
  const confirmAction = async () => {
    if (!pendingConfirmation || confirmationInProgress) return;
    setConfirmationInProgress(true);
    if (pendingConfirmation.kind === "delete") {
      await deleteLocalMeeting(pendingConfirmation.item);
    } else {
      cancelScheduledMeeting();
    }
    setConfirmationInProgress(false);
    setPendingConfirmation(null);
  };
  return (
    <>
      <ProductTopbar
        eyebrow="会议中心"
        title="我的会议"
        {...topbarActions}
        action={
          <button
            className="page-primary"
            onClick={() => {
              setMeetingMode("normal");
              setCreateIntent("schedule");
              setMeetingDraft(createMeetingDraft("normal"));
              setModal("create");
            }}
          >
            ＋ 预约会议
          </button>
        }
      />
      <section className="meeting-overview">
        <article>
          <span>今</span>
          <div>
              <small>今天的会议</small>
              <strong>{todayCount} 场</strong>
          </div>
        </article>
        <article>
          <span>周</span>
          <div>
            <small>本周已完成</small>
              <strong>{completedMeetingCount} 场</strong>
          </div>
        </article>
        <article>
          <span>时</span>
          <div>
            <small>累计会议时长</small>
            <strong>{cumulativeMeetingDurationLabel}</strong>
          </div>
        </article>
        <div className="next-meeting">
          <i />
          下一场：
          {scheduledMeeting && scheduledMeeting.status !== "past"
            ? scheduledMeeting.title
            : "毕业设计中期答辩"}
          <strong>
            {scheduledMeeting && scheduledMeeting.status !== "past"
              ? "已加入我的会议"
              : "还有 36 分钟"}
          </strong>
        </div>
      </section>
      <section className="asset-section">
        <div className="asset-toolbar">
          <div className="tab-switch">
            <button
              className={tab === "upcoming" ? "active" : ""}
              aria-pressed={tab === "upcoming"}
              onClick={() => setTab("upcoming")}
            >
              即将开始 <span>{upcoming.length}</span>
            </button>
            <button
              className={tab === "past" ? "active" : ""}
              aria-pressed={tab === "past"}
              onClick={() => setTab("past")}
            >
              已结束 <span>{past.length}</span>
            </button>
          </div>
          <label className="asset-search">
            ⌕{" "}
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索会议"
              aria-label="搜索会议"
            />
          </label>
        </div>
        <div className="meeting-list" aria-live="polite">
          {rows.length > 0 ? (
            rows.map((item, index) => (
            <article
              className="meeting-list-row"
              key={`${item.title}-${index}`}
            >
              <div className="date-block">
                <strong>{item.day}</strong>
                <small>{item.month}</small>
              </div>
              <i className={`${item.accent}-bg`} />
              <div className="meeting-list-copy">
                <span>{item.time}</span>
                <h3>{item.title}</h3>
                <p>{item.detail}</p>
              </div>
              <span className="meeting-type">{item.type}</span>
              <div className="meeting-row-actions">
                {tab === "upcoming" ? (
                  <>
                    <button
                      onClick={() =>
                        enterMeeting("已进入会议", item.title, item.roomId, {
                          autoMute: item.autoMute ?? true,
                          generateReport: item.generateReport ?? true,
                        }, "林老师", item.mode ?? "normal")
                      }
                    >
                      进入会议
                    </button>
                    {item.id === scheduledMeeting?.id ? (
                      <button
                        className="more-action"
                        onClick={(event) =>
                          openConfirmation(item, "cancel", event.currentTarget)
                        }
                      >
                        取消预约
                      </button>
                    ) : (
                      <button
                        className="more-action"
                        aria-label="更多操作"
                        aria-expanded={openMenuId === item.id}
                        aria-controls={`meeting-menu-${item.roomId}`}
                        aria-haspopup="menu"
                        onClick={(event) =>
                          toggleMeetingMenu(item, event.currentTarget)
                        }
                      >
                        •••
                      </button>
                    )}
                  </>
                ) : (
                  <>
                    <button
                      onClick={() =>
                        openReport(
                          item.title,
                          false,
                          item.reportSnapshot?.recordingAvailable ?? true,
                          item.mode,
                          item.reportSnapshot,
                          item.reportGenerated ?? true,
                          item.roomId,
                        )
                      }
                    >
                      查看报告
                    </button>
                    <button
                      className="more-action"
                      aria-label="更多操作"
                      aria-expanded={openMenuId === item.id}
                      aria-controls={`meeting-menu-${item.roomId}`}
                      aria-haspopup="menu"
                      onClick={(event) =>
                        toggleMeetingMenu(item, event.currentTarget)
                      }
                    >
                      •••
                    </button>
                  </>
                )}
                {openMenuId === item.id && (
                  <div
                    id={`meeting-menu-${item.roomId}`}
                    ref={meetingMenuRef}
                    className="meeting-row-menu"
                    role="menu"
                    aria-label={`${item.title}更多操作`}
                  >
                    <button
                      role="menuitem"
                      onKeyDown={handleMenuItemKeyDown}
                      onClick={() => void copyMeetingNumber(item)}
                    >
                      复制会议号
                    </button>
                    {tab === "upcoming" && (
                      <button
                        role="menuitem"
                        onKeyDown={handleMenuItemKeyDown}
                        onClick={() => void copyMeetingInvite(item)}
                      >
                        复制本地邀请链接
                      </button>
                    )}
                    {tab === "upcoming" ? (
                      <button
                        role="menuitem"
                        onKeyDown={handleMenuItemKeyDown}
                        onClick={() => {
                          setOpenMenuId(null);
                          enterMeeting("已进入会议", item.title, item.roomId, {
                            autoMute: item.autoMute ?? true,
                            generateReport: item.generateReport ?? true,
                          }, "林老师", item.mode ?? "normal");
                        }}
                      >
                        进入会议
                      </button>
                    ) : (
                      <button
                        role="menuitem"
                        onKeyDown={handleMenuItemKeyDown}
                        onClick={() => {
                          setOpenMenuId(null);
                          openReport(
                            item.title,
                            false,
                            item.reportSnapshot?.recordingAvailable ?? true,
                            item.mode,
                            item.reportSnapshot,
                            item.reportGenerated ?? true,
                            item.roomId,
                          );
                        }}
                      >
                        查看报告
                      </button>
                    )}
                    {(localMeetings.some(
                      (meeting) => meeting.roomId === item.roomId,
                    ) ||
                      scheduledMeeting?.roomId === item.roomId) && (
                      <button
                        role="menuitem"
                        className="danger-menu-item"
                        onKeyDown={handleMenuItemKeyDown}
                        onClick={(event) => {
                          const trigger = event.currentTarget
                            .closest<HTMLElement>(".meeting-row-actions")
                            ?.querySelector<HTMLButtonElement>(
                              'button[aria-label="更多操作"]',
                            );
                          openConfirmation(item, "delete", trigger ?? null);
                        }}
                      >
                        删除本机记录
                      </button>
                    )}
                  </div>
                )}
              </div>
            </article>
            ))
          ) : (
            <div className="empty-state">
              <strong>没有找到相关会议</strong>
              <span>试试搜索会议主题、课程或会议类型。</span>
            </div>
          )}
        </div>
      </section>
      {pendingConfirmation && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (
              event.currentTarget === event.target &&
              !confirmationInProgress
            ) {
              setPendingConfirmation(null);
            }
          }}
        >
          <section
            className="meeting-modal meeting-delete-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="meeting-confirmation-title"
            aria-describedby="meeting-confirmation-description"
            onKeyDown={(event) => {
              if (event.key === "Escape" && !confirmationInProgress) {
                event.preventDefault();
                setPendingConfirmation(null);
                return;
              }
              if (event.key !== "Tab") return;
              const focusable = Array.from(
                event.currentTarget.querySelectorAll<HTMLElement>(
                  'button:not([disabled]), [tabindex]:not([tabindex="-1"])',
                ),
              );
              if (focusable.length === 0) return;
              const first = focusable[0];
              const last = focusable[focusable.length - 1];
              if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
              } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
              }
            }}
          >
            <span className="modal-kicker">本机数据管理</span>
            <h2 id="meeting-confirmation-title">
              {pendingConfirmation.kind === "delete"
                ? "删除这场本机会议？"
                : "取消这场预约？"}
            </h2>
            <p id="meeting-confirmation-description" className="modal-lead">
              {pendingConfirmation.kind === "delete"
                ? `“${pendingConfirmation.item.title}”的会议记录、报告待办和本机录制引用会从当前设备移除。此操作不会影响其他设备或云端数据。`
                : `“${pendingConfirmation.item.title}”的预约记录会从当前设备移除，不会影响其他设备或云端数据。`}
            </p>
            <div className="delete-dialog-actions">
              <button
                ref={confirmationCancelRef}
                type="button"
                onClick={() => setPendingConfirmation(null)}
                disabled={confirmationInProgress}
              >
                {pendingConfirmation.kind === "delete" ? "保留记录" : "保留预约"}
              </button>
              <button
                className="delete-confirm-button"
                type="button"
                onClick={() => void confirmAction()}
                disabled={confirmationInProgress}
              >
                {confirmationInProgress
                  ? pendingConfirmation.kind === "delete"
                    ? "正在删除…"
                    : "正在取消…"
                  : pendingConfirmation.kind === "delete"
                    ? "确认删除"
                    : "确认取消预约"}
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}

function ReplayHub({
  setToast,
  topbarActions,
  initialReplayTitle,
  initialReplayRoomId,
  publishedReplayTitle,
  setPublishedReplayTitle,
  localMeetings,
  scheduledMeeting,
  localRecordingBlobs,
}: {
  setToast: Setter<string>;
  topbarActions: TopbarActions;
  initialReplayTitle: string | null;
  initialReplayRoomId: string | null;
  publishedReplayTitle: string | null;
  setPublishedReplayTitle: Setter<string | null>;
  localMeetings: LocalMeetingRecord[];
  scheduledMeeting: ScheduledMeeting | null;
  localRecordingBlobs: Record<string, Blob>;
}) {
  const localReplayItems = useMemo(
    () =>
      [
        ...localMeetings,
        ...(scheduledMeeting ? [scheduledMeeting] : []),
      ]
        .filter(isReplayReadyMeeting)
        .filter(
          (meeting, index, meetings) =>
            meetings.findIndex((candidate) => candidate.roomId === meeting.roomId) ===
            index,
        )
        .map((meeting) =>
          createLocalReplayItem(meeting, localRecordingBlobs[meeting.roomId] ?? null),
        ),
    [localMeetings, localRecordingBlobs, scheduledMeeting],
  );
  const [query, setQuery] = useState("");
  const findInitialReplay = useCallback(() => {
    if (!initialReplayTitle) return null;
    return (
      localReplayItems.find(
        (item) =>
          (initialReplayRoomId && item.roomId === initialReplayRoomId) ||
          (!initialReplayRoomId && item.title === initialReplayTitle),
      ) ??
      replayCatalog.find((item) => item.title === initialReplayTitle) ??
      createLocalReplayPlaceholder(initialReplayTitle, initialReplayRoomId ?? undefined)
    );
  }, [initialReplayRoomId, initialReplayTitle, localReplayItems]);
  const [selectedReplay, setSelectedReplay] = useState<ReplayViewerItem | null>(
    findInitialReplay,
  );
  const replayTriggerRef = useRef<HTMLButtonElement | null>(null);
  const previousSelectedReplayRef = useRef(false);
  const recordingHydrationRef = useRef(0);
  const [recordingRestore, setRecordingRestore] = useState<{
    roomId: string;
    status: "ready" | "missing";
  } | null>(null);
  const resolvedInitialReplay = findInitialReplay();
  const activeSelectedReplay =
    selectedReplay &&
    resolvedInitialReplay &&
    initialReplayTitle &&
    selectedReplay.title === initialReplayTitle &&
    (selectedReplay.roomId === resolvedInitialReplay.roomId ||
      !selectedReplay.roomId)
      ? {
          ...resolvedInitialReplay,
          recordingBlob:
            selectedReplay.recordingBlob ?? resolvedInitialReplay.recordingBlob,
        }
      : selectedReplay;
  const recordingRestoreState =
    activeSelectedReplay?.localOnly && activeSelectedReplay.roomId
      ? activeSelectedReplay.recordingBlob
        ? "ready"
        : recordingRestore?.roomId === activeSelectedReplay.roomId
          ? recordingRestore.status
          : "loading"
      : "idle";
  useEffect(() => {
    const roomId = activeSelectedReplay?.roomId;
    if (
      !activeSelectedReplay?.localOnly ||
      !roomId ||
      activeSelectedReplay.recordingBlob ||
      !activeSelectedReplay.recordingAvailable
    ) {
      return;
    }
    const hydration = ++recordingHydrationRef.current;
    void readLocalRecording(roomId).then((restored) => {
      if (recordingHydrationRef.current !== hydration) return;
      setSelectedReplay((current) =>
        current?.roomId === roomId
          ? { ...current, recordingBlob: restored }
          : current,
      );
      setRecordingRestore({
        roomId,
        status: restored ? "ready" : "missing",
      });
    });
    return () => {
      if (recordingHydrationRef.current === hydration) {
        recordingHydrationRef.current += 1;
      }
    };
  }, [
    activeSelectedReplay?.localOnly,
    activeSelectedReplay?.recordingAvailable,
    activeSelectedReplay?.recordingBlob,
    activeSelectedReplay?.roomId,
  ]);
  useEffect(() => {
    if (previousSelectedReplayRef.current && !selectedReplay) {
      replayTriggerRef.current?.focus();
    }
    previousSelectedReplayRef.current = Boolean(selectedReplay);
  }, [selectedReplay]);
  useEffect(() => {
    if (!selectedReplay) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectedReplay(null);
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [selectedReplay]);
  const replays = [...localReplayItems, ...replayCatalog].filter((item) =>
    matchesReplaySearch(item, query),
  );
  const featuredReplay = localReplayItems[0] ?? replayCatalog[0];
  const featuredReplayIsLocal = Boolean(featuredReplay.localOnly);
  const featuredReplayPublished =
    !featuredReplayIsLocal && publishedReplayTitle === featuredReplay.title;
  const openReplay = (
    item: ReplayViewerItem,
    message: string,
    trigger?: HTMLButtonElement,
  ) => {
    if (trigger) replayTriggerRef.current = trigger;
    setSelectedReplay(item);
    setToast(message);
  };
  const publishReplay = (item: ReplayItem, trigger?: HTMLButtonElement) => {
    const saved = writePublishedReplayTitle(item.title);
    if (saved) setPublishedReplayTitle(item.title);
    openReplay(
      item,
      saved
        ? "已在本地演示中标记回放为已发布"
        : "已标记回放，但本机发布状态保存失败",
      trigger,
    );
  };
  const copyReplayLink = async (item: ReplayViewerItem) => {
    const link = buildLocalShareLink("replay", item.title, {
      roomId: item.roomId,
    });
    const copied = await copyTextToClipboard(link);
    setToast(copied ? "本地回放引用已复制" : "复制失败，请手动复制本地回放引用");
  };
  const downloadReplay = async (item: ReplayViewerItem) => {
    const blob =
      item.recordingBlob ??
      (item.roomId ? await readLocalRecording(item.roomId) : null);
    const downloaded = downloadLocalRecording(item.title, blob);
    setToast(downloaded ? "本地录制已下载" : "本地录制尚未找到，请重新生成录制");
  };
  return (
    <>
      <ProductTopbar
        eyebrow="知识沉淀"
        title="课堂回放"
        {...topbarActions}
        action={
          <label className="page-search">
            ⌕{" "}
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索课程或回放"
              aria-label="搜索课程或回放"
            />
          </label>
        }
      />
      <section className="replay-feature">
        <div>
          <span className="replay-feature-kicker">
            {featuredReplayIsLocal
              ? "本机录制"
              : featuredReplayPublished
                ? "本地已发布"
                : "刚刚生成"}
          </span>
          <h2>{featuredReplay.title}</h2>
          <p>
            {featuredReplayIsLocal
              ? "本地报告保留了会议号；如果媒体仍在本机，可直接预览、下载或复制本地引用。"
              : "AI 已完成字幕、章节和课堂摘要，确认后可在本地演示中标记发布。"}
          </p>
          <div>
            {featuredReplayIsLocal ? (
              <button
                onClick={(event) =>
                  openReplay(
                    featuredReplay,
                    "正在预览本地会议录制",
                    event.currentTarget,
                  )
                }
              >
                预览本地录制
              </button>
            ) : (
              <button
                aria-pressed={featuredReplayPublished}
                onClick={(event) =>
                  publishReplay(replayCatalog[0], event.currentTarget)
                }
              >
                {featuredReplayPublished ? "已标记本地发布" : "标记为已发布"}
              </button>
            )}
            <button
              onClick={(event) => {
                if (featuredReplayIsLocal) {
                  void downloadReplay(featuredReplay);
                  return;
                }
                openReplay(featuredReplay, "正在预览课堂回放", event.currentTarget);
              }}
            >
              {featuredReplayIsLocal ? "下载本地录制" : "预览回放"}
            </button>
          </div>
        </div>
        <div className="chapter-stack" aria-hidden="true">
          <span>00:00 课程回顾</span>
          <span>18:24 信息架构</span>
          <span>46:10 导航案例</span>
          <span>72:36 课堂练习</span>
        </div>
      </section>
      {selectedReplay && (
        <section className="replay-viewer" aria-label="回放播放器">
          <div className={`replay-viewer-stage ${activeSelectedReplay?.color}`}>
            <span>
              {activeSelectedReplay?.localOnly
                ? "本地报告引用 · "
                : publishedReplayTitle === activeSelectedReplay?.title
                ? "本地已发布 · "
                : "正在查看 · "}
              {activeSelectedReplay?.course}
            </span>
            <strong>{activeSelectedReplay?.title}</strong>
            <button
              aria-label="关闭回放播放器"
              onClick={() => setSelectedReplay(null)}
            >
              ×
            </button>
            {activeSelectedReplay?.recordingBlob ? (
              <LocalRecordingVideo blob={activeSelectedReplay.recordingBlob} />
            ) : activeSelectedReplay?.localOnly ? (
              <span className="replay-media-status">
                {recordingRestoreState === "loading"
                  ? "正在恢复本地媒体…"
                  : "未找到本地媒体文件"}
              </span>
            ) : (
              <i>▶</i>
            )}
          </div>
          <div className="replay-viewer-copy">
            <span>
              {activeSelectedReplay?.date} · {activeSelectedReplay?.duration}
            </span>
            <p>
              {activeSelectedReplay?.localOnly
                ? !activeSelectedReplay.roomId
                  ? "这是报告中的本地回放占位，尚未生成真实媒体文件。"
                  : activeSelectedReplay.recordingBlob
                  ? "本地媒体已恢复，可在当前页面播放或下载。"
                  : recordingRestoreState === "loading"
                    ? "正在按会议号恢复本机录制，完成后会显示真实播放器。"
                    : "本机没有找到对应媒体文件，只保留会议元数据；请回到会议重新生成录制。"
                : "字幕、章节和课堂摘要已准备好，真实媒体接入后将在这里播放。"}
            </p>
            <button onClick={() => void copyReplayLink(activeSelectedReplay!)}>
              复制本地回放引用
            </button>
            {activeSelectedReplay?.localOnly && activeSelectedReplay.roomId && (
              <button onClick={() => void downloadReplay(activeSelectedReplay)}>
                下载本地录制
              </button>
            )}
          </div>
        </section>
      )}
      <section className="asset-section">
        <div className="section-heading">
          <div>
            <span className="section-index">01</span>
            <h2>全部回放</h2>
          </div>
          <p>{replays.length} 个结果</p>
        </div>
        <div className="replay-grid">
          {replays.map((item) => (
            <article
              className="replay-item"
              key={item.roomId ? `local-replay-${item.roomId}` : `demo-replay-${item.title}`}
            >
              <div className={`replay-cover ${item.color}`}>
                <span className="course-initial">
                  {item.course.slice(0, 1)}
                </span>
                <button
                  aria-label={
                    item.localOnly && !item.recordingBlob
                      ? `查看本地回放${item.title}`
                      : `播放${item.title}`
                  }
                  onClick={(event) =>
                    openReplay(
                      item,
                      item.localOnly && !item.recordingBlob
                        ? `正在打开本地回放：${item.title}`
                        : `正在播放：${item.title}`,
                      event.currentTarget,
                    )
                  }
                >
                  {item.localOnly && !item.recordingBlob ? "→" : "▶"}
                </button>
                <small>{item.duration}</small>
              </div>
              <div className="replay-info">
                <span>
                  {item.course}
                  {publishedReplayTitle === item.title ? " · 本地已发布" : ""}
                </span>
                <h3>{item.title}</h3>
                <p>
                  {item.date} · {item.views}
                </p>
                <div className="watch-progress">
                  <i style={{ width: `${item.progress}%` }} />
                </div>
                <div className="replay-actions">
                  <button onClick={() => void copyReplayLink(item)}>
                    分享
                  </button>
                  {item.localOnly && (
                    <button onClick={() => void downloadReplay(item)}>
                      下载
                    </button>
                  )}
                  <button
                    onClick={(event) =>
                      openReplay(item, "正在打开回放详情", event.currentTarget)
                    }
                  >
                    详情 →
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}

function MaterialsHub({
  setToast,
  topbarActions,
  initialMaterialName,
  initialMaterialId,
  localFiles,
  setLocalFiles,
  localFileContents,
  setLocalFileContents,
  persistedFileIds,
  setPersistedFileIds,
}: {
  setToast: Setter<string>;
  topbarActions: TopbarActions;
  initialMaterialName: string | null;
  initialMaterialId: string | null;
  localFiles: MaterialFile[];
  setLocalFiles: Setter<MaterialFile[]>;
  localFileContents: Record<string, File>;
  setLocalFileContents: Setter<Record<string, File>>;
  persistedFileIds: Set<string>;
  setPersistedFileIds: Setter<Set<string>>;
}) {
  const files = useMemo(
    () => [...localFiles, ...materialCatalog],
    [localFiles],
  );
  const [query, setQuery] = useState("");
  const [folder, setFolder] = useState<MaterialFolder | null>(null);
  const [selectedFileId, setSelectedFileId] = useState<string | null>(() => {
    if (!initialMaterialName) return null;
    return (
      files.find((file) => file.id === initialMaterialId)?.id ??
      files.find((file) => file.name === initialMaterialName)?.id ??
      null
    );
  });
  const [openedFileId, setOpenedFileId] = useState<string | null>(null);
  const selectedFile =
    files.find((file) => file.id === selectedFileId) ?? null;
  const openedFile = files.find((file) => file.id === openedFileId) ?? null;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const selectedFileTriggerRef = useRef<HTMLButtonElement | null>(null);
  const openedFileTriggerRef = useRef<HTMLButtonElement | null>(null);
  const previousSelectedFileRef = useRef(false);
  const previousOpenedFileRef = useRef(false);
  const mountedRef = useRef(true);
  const localFileIdsRef = useRef(localFiles.map((file) => file.id));
  useEffect(() => {
    localFileIdsRef.current = localFiles.map((file) => file.id);
  }, [localFiles]);
  useEffect(() => () => {
    mountedRef.current = false;
  }, []);
  useEffect(() => {
    if (previousSelectedFileRef.current && !selectedFile) {
      selectedFileTriggerRef.current?.focus();
    }
    previousSelectedFileRef.current = Boolean(selectedFile);
  }, [selectedFile]);
  useEffect(() => {
    if (previousOpenedFileRef.current && !openedFile) {
      openedFileTriggerRef.current?.focus();
    }
    previousOpenedFileRef.current = Boolean(openedFile);
  }, [openedFile]);
  useEffect(() => {
    if (!selectedFile && !openedFile) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (openedFile) {
        setOpenedFileId(null);
      } else {
        setSelectedFileId(null);
      }
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [openedFile, selectedFile]);
  const folderFileCount = (targetFolder: MaterialFolder) =>
    files.filter((file) => file.folder === targetFolder).length;
  const filteredFiles = files.filter((file) =>
    (folder === null || file.folder === folder) &&
    `${file.name}${file.source}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );
  const handleUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const uploaded = event.target.files?.[0];
    event.target.value = "";
    if (!uploaded) return;
    const rawName = uploaded.name;
    const fileName = rawName.trim();
    if (
      !fileName ||
      rawName.length > maxMaterialFileNameLength ||
      fileName.length > maxMaterialFileNameLength
    ) {
      setToast(
        `资料文件名不能为空且不能超过 ${maxMaterialFileNameLength} 个字符`,
      );
      return;
    }
    const extension = fileName.split(".").pop()?.toLowerCase() ?? "";
    const isVideo = ["mp4", "mov", "webm"].includes(extension);
    const isDocument = ["ppt", "pptx", "doc", "docx", "pdf"].includes(
      extension,
    );
    const isSheet = ["xls", "xlsx", "csv"].includes(extension);
    const nextFile: MaterialFile = {
      id: createRandomIdentifier(),
      icon: isVideo ? "V" : isSheet ? "X" : isDocument ? "P" : "F",
      name: fileName,
      source: "本地上传",
      size:
        uploaded.size >= 1024 * 1024
          ? `${(uploaded.size / 1024 / 1024).toFixed(1)} MB`
          : `${Math.max(1, Math.round(uploaded.size / 1024))} KB`,
      time: "刚刚",
      color: isVideo ? "violet" : isSheet ? "green" : isDocument ? "orange" : "blue",
      folder: isVideo ? "录制" : isSheet ? "活动" : isDocument ? "课件" : "白板",
    };
    setLocalFileContents((current) => ({ ...current, [nextFile.id]: uploaded }));
    void saveLocalMaterialContent(nextFile.id, uploaded).then((result) => {
      if (
        result === "saved" &&
        mountedRef.current &&
        localFileIdsRef.current.includes(nextFile.id)
      ) {
        setPersistedFileIds((current) => new Set(current).add(nextFile.id));
      }
    });
    const nextLocalFiles = [nextFile, ...localFiles].slice(
      0,
      maxLocalMaterialFileCount,
    );
    localFileIdsRef.current = nextLocalFiles.map((file) => file.id);
    const saved = writeLocalMaterialFiles(nextLocalFiles);
    setLocalFiles(nextLocalFiles);
    setFolder(null);
    setQuery("");
    setToast(
      saved
        ? `已添加资料：${fileName}`
        : `已添加资料：${fileName}，但本机状态保存失败`,
    );
  };
  const removeUploadedFile = () => {
    if (!selectedFile || selectedFile.source !== "本地上传") return;
    const removedName = selectedFile.name;
    setLocalFileContents((current) => {
      const next = { ...current };
      delete next[selectedFile.id];
      return next;
    });
    setPersistedFileIds((current) => {
      const next = new Set(current);
      next.delete(selectedFile.id);
      return next;
    });
    void removeLocalMaterialContent(selectedFile.id);
    const nextLocalFiles = localFiles.filter(
      (file) => file.id !== selectedFile.id,
    );
    localFileIdsRef.current = nextLocalFiles.map((file) => file.id);
    const saved = writeLocalMaterialFiles(nextLocalFiles);
    setLocalFiles(nextLocalFiles);
    setOpenedFileId(null);
    setSelectedFileId(null);
    setToast(
      saved
        ? `已移除资料：${removedName}`
        : `已移除资料：${removedName}，但本机状态保存失败`,
    );
  };
  const downloadSelectedFile = () => {
    if (!selectedFile || selectedFile.source !== "本地上传") return;
    const file = localFileContents[selectedFile.id];
    if (!file) {
      setToast("当前只恢复了资料元数据，请重新上传文件内容");
      return;
    }
    if (typeof URL.createObjectURL !== "function") {
      setToast("当前环境不支持下载本地资料");
      return;
    }
    const url = URL.createObjectURL(file);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = selectedFile.name;
    anchor.click();
    URL.revokeObjectURL(url);
    setToast(`已下载资料：${selectedFile.name}`);
  };
  const localPreviewAvailable = openedFile
    ? openedFile.source !== "本地上传" || Boolean(localFileContents[openedFile.id])
    : false;
  const openedLocalFile =
    openedFile?.source === "本地上传"
      ? localFileContents[openedFile.id]
      : undefined;
  const previewCopy = openedFile
    ? openedFile.source === "本地上传"
      ? persistedFileIds.has(openedFile.id)
        ? "文件内容已保存到本机，刷新后仍可预览或下载；不会同步到云端。"
        : localPreviewAvailable
          ? "文件内容仅保留在当前页面，可下载原文件；刷新后需重新上传内容。"
          : "当前只恢复了资料元数据，原文件内容不在本页面，请重新上传后再下载。"
      : openedFile.folder === "录制"
        ? "视频预览已就绪，接入真实媒体后可在此播放。"
        : openedFile.folder === "活动"
          ? "表格预览已就绪，接入真实文件后可查看活动结果。"
          : openedFile.folder === "白板"
            ? "白板预览已就绪，接入真实文件后可查看课堂批注。"
            : "文档预览已就绪，接入真实文件后可查看课件内容。"
    : "";
  return (
    <>
      <ProductTopbar
        eyebrow="会议资产"
        title="会议资料"
        {...topbarActions}
        action={
          <div className="top-actions">
            <label className="page-search">
              ⌕{" "}
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索文件或来源"
                aria-label="搜索文件或来源"
              />
            </label>
            <button
              className="page-primary"
              onClick={() => fileInputRef.current?.click()}
            >
              ↑ 上传资料
            </button>
            <input
              ref={fileInputRef}
              type="file"
              aria-label="选择要上传的资料"
              className="visually-hidden"
              onChange={handleUpload}
            />
          </div>
        }
      />
      <section className="storage-banner">
        <div>
          <span className="storage-icon">本</span>
          <div>
            <small>本地资料区 · 当前浏览器</small>
            <strong>资料元数据仅保存在本机</strong>
            <p>文件内容只保留在当前页面，刷新后恢复资料元数据。</p>
          </div>
        </div>
        <div className="storage-meter">
          <span>
            <strong>{files.length} 个文件</strong>
          </span>
          <i>
            <b />
          </i>
          <small>文件内容仅保留在当前页面</small>
        </div>
      </section>
      <section className="folder-grid">
        <button
          aria-pressed={folder === "录制"}
          onClick={() => setFolder((current) => (current === "录制" ? null : "录制"))}
        >
          <span className="folder-icon green">◎</span>
          <div>
            <strong>课堂录制</strong>
            <small>{folderFileCount("录制")} 个文件 · 本地页面</small>
          </div>
          <i>→</i>
        </button>
        <button
          aria-pressed={folder === "课件"}
          onClick={() => setFolder((current) => (current === "课件" ? null : "课件"))}
        >
          <span className="folder-icon blue">▤</span>
          <div>
            <strong>会议课件</strong>
            <small>{folderFileCount("课件")} 个文件 · 本地页面</small>
          </div>
          <i>→</i>
        </button>
        <button
          aria-pressed={folder === "白板"}
          onClick={() => setFolder((current) => (current === "白板" ? null : "白板"))}
        >
          <span className="folder-icon violet">✎</span>
          <div>
            <strong>白板与批注</strong>
            <small>{folderFileCount("白板")} 个文件 · 本地页面</small>
          </div>
          <i>→</i>
        </button>
        <button
          aria-pressed={folder === "活动"}
          onClick={() => setFolder((current) => (current === "活动" ? null : "活动"))}
        >
          <span className="folder-icon amber">✓</span>
          <div>
            <strong>活动结果</strong>
            <small>{folderFileCount("活动")} 个文件 · 本地页面</small>
          </div>
          <i>→</i>
        </button>
      </section>
      <section className="asset-section">
        <div className="section-heading">
          <div>
            <span className="section-index">01</span>
            <h2>最近使用</h2>
          </div>
          <button
            className="text-button"
            onClick={() => {
              setQuery("");
              setFolder(null);
              setToast("已显示全部文件");
            }}
          >
            查看全部 →
          </button>
        </div>
        <div className="file-table">
          <div className="file-head">
            <span>名称</span>
            <span>来源</span>
            <span>大小</span>
            <span>更新时间</span>
            <span />
          </div>
          {filteredFiles.length > 0 ? (
            filteredFiles.map((file) => (
              <article className="file-row" key={file.id}>
                <div>
                  <span className={`file-type ${file.color}`}>{file.icon}</span>
                  <strong>{file.name}</strong>
                </div>
                <span>{file.source}</span>
                <span>{file.size}</span>
                <span>{file.time}</span>
                <button
                  aria-label={`查看${file.name}`}
                  onClick={(event) => {
                    selectedFileTriggerRef.current = event.currentTarget;
                    openedFileTriggerRef.current = null;
                    setSelectedFileId(file.id);
                    setOpenedFileId(null);
                  }}
                >
                  •••
                </button>
              </article>
            ))
          ) : (
            <div className="empty-state">
              <strong>没有找到相关资料</strong>
              <span>试试搜索文件名或课程来源。</span>
            </div>
          )}
        </div>
      </section>
      {selectedFile && (
        <section className="file-viewer" aria-label="资料详情">
          <div className={`file-viewer-icon ${selectedFile.color}`}>
            {selectedFile.icon}
          </div>
          <div className="file-viewer-copy">
            <span>{selectedFile.source}</span>
            <strong>{selectedFile.name}</strong>
            <small>{selectedFile.size} · 更新于 {selectedFile.time}</small>
          </div>
          <div className="file-viewer-actions">
            <button
              onClick={(event) => {
                openedFileTriggerRef.current = event.currentTarget;
                setOpenedFileId(selectedFile.id);
                setToast(`正在查看：${selectedFile.name}`);
              }}
            >
              打开资料
            </button>
            {selectedFile.source === "本地上传" && (
              <>
                <button onClick={downloadSelectedFile}>下载原文件</button>
                <button onClick={removeUploadedFile}>移除资料</button>
              </>
            )}
            <button
              className="file-viewer-close"
              aria-label="关闭资料详情"
              onClick={() => {
                openedFileTriggerRef.current = null;
                setSelectedFileId(null);
                setOpenedFileId(null);
              }}
            >
              ×
            </button>
          </div>
        </section>
      )}
      {openedFile && (
        <section className="material-preview" aria-label="资料预览">
          <div className={`material-preview-stage ${openedFile.color}`}>
            <span>{openedFile.folder} · 本地预览</span>
            <strong>{openedFile.name}</strong>
            {openedLocalFile && getLocalFilePreviewKind(openedLocalFile) ? (
              <LocalFileMediaPreview file={openedLocalFile} />
            ) : (
              <i>{openedFile.icon}</i>
            )}
          </div>
          <div className="material-preview-copy">
            <span>{openedFile.source} · {openedFile.size}</span>
            <p>{previewCopy}</p>
            <button onClick={() => setOpenedFileId(null)}>关闭预览</button>
          </div>
        </section>
      )}
    </>
  );
}

function MeetingPanel({
  panel,
  setPanel,
  meetingMode,
  participantName,
  localStream,
  remoteStream,
  micOn,
  activity,
  setActivity,
  publishedActivities,
  publishActivity,
  localMessages,
  chatInput,
  setChatInput,
  sendMessage,
  setToast,
}: {
  panel: Exclude<Panel, null>;
  setPanel: Setter<Panel>;
  meetingMode: MeetingMode;
  participantName: string;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  micOn: boolean;
  activity: ActivityId;
  setActivity: Setter<ActivityId>;
  publishedActivities: ActivityId[];
  publishActivity: () => void;
  localMessages: Message[];
  chatInput: string;
  setChatInput: Setter<string>;
  sendMessage: () => void;
  setToast: Setter<string>;
}) {
  const activityPublished = publishedActivities.includes(activity);
  const localMembers: MemberListItem[] = [
    {
      name: participantName,
      status: "本地窗口",
      presence: localStream ? "已加入" : "未开启设备",
      mic: micOn,
    },
    {
      name: "远端参会者",
      status: "同源窗口",
      presence: remoteStream ? "已加入" : "未加入",
      mic: true,
    },
  ];
  const memberCatalog = meetingMode === "class" ? memberList : localMembers;
  const initialMemberMicState = Object.fromEntries(
    memberCatalog.map((member) => [member.name, member.mic]),
  );
  const memberMicStateRef = useRef<Record<string, boolean>>(
    initialMemberMicState,
  );
  const [memberMicState, setMemberMicState] = useState<Record<string, boolean>>(
    initialMemberMicState,
  );
  const [memberQuery, setMemberQuery] = useState("");
  const [randomMember, setRandomMember] = useState("");
  const onlineStudents = memberCatalog.filter(
    (member) => member.presence !== "未到" && member.status === "学生",
  );
  const visibleMembers = memberCatalog.filter((member) =>
    [member.name, member.status, member.presence]
      .join("")
      .toLowerCase()
      .includes(memberQuery.trim().toLowerCase()),
  );
  const panelTabOrder: Exclude<Panel, null>[] =
    meetingMode === "class" ? ["members", "chat", "activities"] : ["members", "chat"];
  const panelTabRefs = useRef<
    Record<Exclude<Panel, null>, HTMLButtonElement | null>
  >({ members: null, chat: null, activities: null });
  const handlePanelTabKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    currentPanel: Exclude<Panel, null>,
  ) => {
    const currentIndex = panelTabOrder.indexOf(currentPanel);
    let nextIndex = -1;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIndex = (currentIndex + 1) % panelTabOrder.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextIndex =
        (currentIndex - 1 + panelTabOrder.length) % panelTabOrder.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = panelTabOrder.length - 1;
    }
    if (nextIndex < 0) return;
    event.preventDefault();
    const nextPanel = panelTabOrder[nextIndex];
    setPanel(nextPanel);
    panelTabRefs.current[nextPanel]?.focus();
  };
  const toggleMemberMic = (name: string) => {
    const next = !memberMicStateRef.current[name];
    const nextState = { ...memberMicStateRef.current, [name]: next };
    memberMicStateRef.current = nextState;
    setMemberMicState(nextState);
    setToast(`${name}${next ? "已解除静音" : "已静音"}`);
  };

  return (
    <aside id="meeting-side-panel" className="meeting-panel" aria-label="会议侧栏">
      <div className="panel-tabs">
        <div
          className="panel-tab-list"
          role="tablist"
          aria-label="会议侧栏视图"
          aria-orientation="horizontal"
        >
          <button
            id="meeting-panel-tab-members"
            type="button"
            role="tab"
            className={panel === "members" ? "active" : ""}
            aria-selected={panel === "members"}
            aria-controls="meeting-panel-content-members"
            tabIndex={panel === "members" ? 0 : -1}
            onClick={() => setPanel("members")}
            onKeyDown={(event) => handlePanelTabKeyDown(event, "members")}
            ref={(element) => {
              panelTabRefs.current.members = element;
            }}
          >
            成员
          </button>
          <button
            id="meeting-panel-tab-chat"
            type="button"
            role="tab"
            className={panel === "chat" ? "active" : ""}
            aria-selected={panel === "chat"}
            aria-controls="meeting-panel-content-chat"
            tabIndex={panel === "chat" ? 0 : -1}
            onClick={() => setPanel("chat")}
            onKeyDown={(event) => handlePanelTabKeyDown(event, "chat")}
            ref={(element) => {
              panelTabRefs.current.chat = element;
            }}
          >
            聊天
          </button>
          {meetingMode === "class" && (
            <button
              id="meeting-panel-tab-activities"
              type="button"
              role="tab"
              className={panel === "activities" ? "active" : ""}
              aria-selected={panel === "activities"}
              aria-controls="meeting-panel-content-activities"
              tabIndex={panel === "activities" ? 0 : -1}
              onClick={() => setPanel("activities")}
              onKeyDown={(event) => handlePanelTabKeyDown(event, "activities")}
              ref={(element) => {
                panelTabRefs.current.activities = element;
              }}
            >
              课堂互动
            </button>
          )}
        </div>
        <button
          type="button"
          className="panel-close"
          onClick={() => setPanel(null)}
          aria-label="关闭侧栏"
        >
          ×
        </button>
      </div>
      {panel === "members" && (
        <div
          id="meeting-panel-content-members"
          className="panel-content members-panel"
          role="tabpanel"
          aria-labelledby="meeting-panel-tab-members"
          tabIndex={0}
        >
          <div className="panel-summary">
            {meetingMode === "class" ? (
              <>
                <span>
                  <strong>42</strong> 已到
                </span>
                <span>
                  <strong>1</strong> 迟到
                </span>
                <span>
                  <strong>6</strong> 未到
                </span>
              </>
            ) : (
              <>
                <span>
                  <strong>1</strong> 本地窗口
                </span>
                <span>
                  <strong>{remoteStream ? 1 : 0}</strong> 远端窗口
                </span>
              </>
            )}
          </div>
          {meetingMode !== "class" && (
            <small className="panel-scope-note">
              本地实验只显示当前页面和同源远端窗口。
            </small>
          )}
          <label className="member-search">
            ⌕{" "}
            <input
              aria-label="搜索成员"
              placeholder="搜索成员"
              value={memberQuery}
              onChange={(event) => setMemberQuery(event.target.value)}
            />
          </label>
          <div className="member-list">
            {visibleMembers.map((member, index) => (
              <div
                className={`member-row ${member.presence === "未到" ? "absent" : ""}`}
                key={member.name}
              >
                <PersonAvatar
                  name={member.name}
                  color={participants[index % participants.length].color}
                  small
                />
                <span>
                  <strong>{member.name}</strong>
                  <small>
                    {member.status} · {member.presence}
                  </small>
                </span>
                {meetingMode === "class" ? (
                  <button
                    aria-label={`${member.name}麦克风`}
                    aria-pressed={memberMicState[member.name]}
                    onClick={() => toggleMemberMic(member.name)}
                  >
                    {memberMicState[member.name] ? "◖))" : "╳"}
                  </button>
                ) : (
                  <em className="member-readonly">
                    {member.name === participantName && localStream
                      ? micOn
                        ? "麦克风开"
                        : "已静音"
                      : member.presence === "已加入"
                        ? "状态未知"
                        : "—"}
                  </em>
                )}
              </div>
            ))}
            {visibleMembers.length === 0 && (
              <div className="panel-empty-state" role="status">
                没有找到匹配成员
              </div>
            )}
          </div>
          {meetingMode === "class" && (
            <button
              className="panel-secondary"
              onClick={() => {
                const nextState = Object.fromEntries(
                  memberList.map((member) => [member.name, false]),
                );
                memberMicStateRef.current = nextState;
                setMemberMicState(nextState);
                setToast("全体已静音");
              }}
            >
              全体静音
            </button>
          )}
        </div>
      )}
      {panel === "chat" && (
        <div
          id="meeting-panel-content-chat"
          className="panel-content chat-panel"
          role="tabpanel"
          aria-labelledby="meeting-panel-tab-chat"
          tabIndex={0}
        >
          <div className="chat-list">
            {localMessages.map((message, index) => (
              <div
                className={`chat-message ${message.mine ?? message.name === "林老师" ? "mine" : ""}`}
                key={`${message.time}-${index}`}
              >
                <span>
                  <strong>{message.name}</strong>
                  <small>{message.time}</small>
                </span>
                <p>{message.text}</p>
              </div>
            ))}
          </div>
          <div className="chat-compose">
            <textarea
              aria-label="聊天消息"
              maxLength={maxChatMessageLength}
              value={chatInput}
              onChange={(event) => setChatInput(event.target.value)}
              placeholder="发送给所有人…"
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  sendMessage();
                }
              }}
            />
            <button onClick={sendMessage}>发送</button>
          </div>
        </div>
      )}
      {panel === "activities" && (
        <div
          id="meeting-panel-content-activities"
          className="panel-content activity-panel"
          role="tabpanel"
          aria-labelledby="meeting-panel-tab-activities"
          tabIndex={0}
        >
          <div className="activity-intro">
            <span>教学工具</span>
            <strong>让每个人都参与进来</strong>
            <small>活动结果会记录到当前本地课堂报告</small>
          </div>
          <div className="activity-options">
            {activityTypes.map((item) => (
              <button
                className={activity === item.id ? "active" : ""}
                key={item.id}
                aria-pressed={activity === item.id}
                onClick={() => {
                  setActivity(item.id);
                  setRandomMember("");
                }}
              >
                <span>{item.icon}</span>
                <div>
                  <strong>{item.title}</strong>
                  <small>{item.detail}</small>
                </div>
                <i />
              </button>
            ))}
          </div>
          <div className="activity-preview">
            {activity === "checkin" && (
              <>
                <strong>课堂签到</strong>
                <p>已根据当前在线名单准备 48 人签到。</p>
                <div className="tiny-stats">
                  <span>在线 42</span>
                  <span>未到 6</span>
                </div>
              </>
            )}
            {activity === "poll" && (
              <>
                <strong>快速投票</strong>
                <p>“你认为哪种交互更符合自然映射？”</p>
                <div className="poll-bar">
                  <i />
                </div>
              </>
            )}
            {activity === "quiz" && (
              <>
                <strong>随堂测验</strong>
                <p>已从《数字媒体技术》题库选取 3 道题。</p>
                <div className="tiny-stats">
                  <span>预计 5 分钟</span>
                  <span>满分 10</span>
                </div>
              </>
            )}
            {activity === "random" && (
              <>
                <strong>随机选人</strong>
                <p>从 42 位在线学生中随机邀请一位发言。</p>
                <button
                  className="random-picker"
                  onClick={() => {
                    const index = Math.floor(
                      Math.random() * onlineStudents.length,
                    );
                    const selected = onlineStudents[index];
                    if (!selected) return;
                    setRandomMember(selected.name);
                    setToast(`${selected.name}已被随机选中`);
                  }}
                >
                  随机抽取
                </button>
                <div className="random-name">
                  {randomMember ? randomMember.slice(-1) : "?"}
                </div>
                {randomMember && (
                  <small className="random-result">{randomMember}</small>
                )}
              </>
            )}
          </div>
          <button
            className="panel-primary"
            onClick={publishActivity}
            aria-pressed={activityPublished}
          >
            {activityPublished ? "已发布到课堂" : "发布活动"}
          </button>
        </div>
      )}
    </aside>
  );
}

function MeetingModal({
  modal,
  setModal,
  meetingMode,
  setMeetingMode,
  submitMeeting,
  createIntent,
  meetingDraft,
  setMeetingDraft,
  joinPreferences,
  setJoinPreferences,
  joinRoomId,
  setJoinRoomId,
  joinName,
  setJoinName,
}: {
  modal: "create" | "join";
  setModal: Setter<"create" | "join" | null>;
  meetingMode: MeetingMode;
  setMeetingMode: Setter<MeetingMode>;
  submitMeeting: () => void;
  createIntent: CreateIntent;
  meetingDraft: MeetingDraft;
  setMeetingDraft: Setter<MeetingDraft>;
  joinPreferences: JoinPreferences;
  setJoinPreferences: Setter<JoinPreferences>;
  joinRoomId: string;
  setJoinRoomId: Setter<string>;
  joinName: string;
  setJoinName: Setter<string>;
}) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const activeElement = document.activeElement;
    previousFocusRef.current =
      activeElement instanceof HTMLElement ? activeElement : null;
    closeButtonRef.current?.focus();
    return () => {
      if (previousFocusRef.current?.isConnected)
        previousFocusRef.current.focus();
    };
  }, []);
  const switchMeetingMode = (nextMode: MeetingMode) => {
    setMeetingMode(nextMode);
    setMeetingDraft((current) => {
      const currentTitle = current.title.trim();
      const previousDefaultTitle = createMeetingDraft(meetingMode).title;
      if (!currentTitle || currentTitle === previousDefaultTitle) {
        return {
          ...current,
          title: createMeetingDraft(nextMode).title,
        };
      }
      return current;
    });
  };

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) setModal(null);
      }}
    >
      <form
        className="meeting-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        onSubmit={(event) => {
          event.preventDefault();
          submitMeeting();
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") setModal(null);
          if (event.key !== "Tab") return;
          const focusable = Array.from(
            event.currentTarget.querySelectorAll<HTMLElement>(
              'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
            ),
          );
          if (focusable.length === 0) return;
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }}
      >
        <button
          className="modal-close"
          type="button"
          ref={closeButtonRef}
          onClick={() => setModal(null)}
          aria-label="关闭"
        >
          ×
        </button>
        {modal === "create" ? (
          <>
            <span className="modal-kicker">创建会议</span>
            <h2 id="modal-title">把相聚变成一次有效协作</h2>
            <p className="modal-lead">
              可以创建普通会议，也可以关联课程和班级。
            </p>
            <div className="mode-switch">
              <button
                type="button"
                className={meetingMode === "class" ? "active" : ""}
                aria-pressed={meetingMode === "class"}
                onClick={() => switchMeetingMode("class")}
              >
                <span>课</span>
                <div>
                  <strong>课程课堂</strong>
                  <small>带入班级与教学活动</small>
                </div>
              </button>
              <button
                type="button"
                className={meetingMode === "normal" ? "active" : ""}
                aria-pressed={meetingMode === "normal"}
                onClick={() => switchMeetingMode("normal")}
              >
                <span>会</span>
                <div>
                  <strong>普通会议</strong>
                  <small>适合教研、答辩与培训</small>
                </div>
              </button>
            </div>
            <label className="form-field">
              <span>主题</span>
              <input
                maxLength={maxMeetingTitleLength}
                value={meetingDraft.title}
                onChange={(event) =>
                  setMeetingDraft((current) => ({
                    ...current,
                    title: event.target.value,
                  }))
                }
                aria-label="会议主题"
              />
            </label>
            {meetingMode === "class" && (
              <div className="form-row">
                <label className="form-field">
                  <span>课程</span>
                  <select
                    value={meetingDraft.courseId}
                    onChange={(event) =>
                      setMeetingDraft((current) => ({
                        ...current,
                        courseId: event.target.value as CourseId,
                      }))
                    }
                    aria-label="课程"
                  >
                    <option value="digital">数字媒体技术</option>
                    <option value="interaction">交互设计</option>
                  </select>
                </label>
                <label className="form-field">
                  <span>班级</span>
                  <select
                    value={meetingDraft.classId}
                    onChange={(event) =>
                      setMeetingDraft((current) => ({
                        ...current,
                        classId: event.target.value as ClassId,
                      }))
                    }
                    aria-label="班级"
                  >
                    <option value="class1">2026 秋 · 1 班（48 人）</option>
                    <option value="class2">2026 秋 · 2 班（46 人）</option>
                  </select>
                </label>
              </div>
            )}
            <div className="modal-options">
              <label>
                <input
                  type="checkbox"
                  checked={meetingDraft.autoMute}
                  onChange={(event) =>
                    setMeetingDraft((current) => ({
                      ...current,
                      autoMute: event.target.checked,
                    }))
                  }
                />{" "}
                入会自动静音
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={meetingDraft.generateReport}
                  onChange={(event) =>
                    setMeetingDraft((current) => ({
                      ...current,
                      generateReport: event.target.checked,
                    }))
                  }
                />{" "}
                自动生成{meetingMode === "class" ? "课堂" : "会议"}报告
              </label>
            </div>
            <button className="modal-primary" type="submit">
              {createIntent === "schedule"
                ? "确认预约"
                : meetingMode === "class"
                  ? "开始课堂"
                  : "开始会议"}{" "}
              <span>→</span>
            </button>
            <small className="prototype-note">
              开启会议后会请求浏览器设备权限；媒体仅在同源本地窗口间传输。
            </small>
          </>
        ) : (
          <>
            <span className="modal-kicker">加入会议</span>
            <h2 id="modal-title">输入会议号</h2>
            <p className="modal-lead">也可以从课程任务或邀请链接直接进入。</p>
            <label className="join-code">
              <span>会议号</span>
              <input
                inputMode="numeric"
                maxLength={MAX_ROOM_ID_LENGTH}
                value={joinRoomId}
                onChange={(event) => setJoinRoomId(event.target.value)}
                aria-label="会议号"
              />
            </label>
            <label className="form-field">
              <span>入会名称</span>
              <input
                maxLength={maxParticipantNameLength}
                value={joinName}
                onChange={(event) => setJoinName(event.target.value)}
                aria-label="入会名称"
              />
            </label>
            <div className="device-preview">
              <div>
                <span className="avatar large">
                  {(joinName.trim() || "访客").slice(-1)}
                </span>
                <small>摄像头预览</small>
              </div>
              <label>
                <input
                  type="checkbox"
                  checked={joinPreferences.audio}
                  onChange={(event) =>
                    setJoinPreferences((current) => ({
                      ...current,
                      audio: event.target.checked,
                    }))
                  }
                />{" "}
                开启麦克风
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={joinPreferences.video}
                  onChange={(event) =>
                    setJoinPreferences((current) => ({
                      ...current,
                      video: event.target.checked,
                    }))
                  }
                />{" "}
                开启摄像头
              </label>
            </div>
            <button className="modal-primary" type="submit">
              加入会议 <span>→</span>
            </button>
            <small className="prototype-note">
              进入会议后会请求浏览器设备权限；媒体仅在同源本地窗口间传输。
            </small>
          </>
        )}
      </form>
    </div>
  );
}

function ReportPage({
  meetingTitle,
  onBackHome,
  toast,
  setToast,
  publishedActivities,
  reportGenerated,
  setReportGenerated,
  onReportGenerated,
  reportSnapshot,
  reportMode,
  reportRoomId,
  recordingAvailable,
  recordingBlob,
}: {
  meetingTitle: string;
  onBackHome: () => void;
  toast: string;
  setToast: Setter<string>;
  publishedActivities: ActivityId[];
  reportGenerated: boolean;
  setReportGenerated: Setter<boolean>;
  onReportGenerated: () => boolean;
  reportSnapshot: SessionReportSnapshot | null;
  reportMode: MeetingMode;
  reportRoomId: string | null;
  recordingAvailable: boolean;
  recordingBlob: Blob | null;
}) {
  const [attendanceExpanded, setAttendanceExpanded] = useState(false);
  const [replayOpen, setReplayOpen] = useState(false);
  const replayTriggerRef = useRef<HTMLButtonElement | null>(null);
  const previousReplayOpenRef = useRef(false);
  useEffect(() => {
    if (previousReplayOpenRef.current && !replayOpen) {
      replayTriggerRef.current?.focus();
    }
    previousReplayOpenRef.current = replayOpen;
  }, [replayOpen]);
  useEffect(() => {
    if (!replayOpen) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setReplayOpen(false);
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [replayOpen]);
  const localParticipantCount = reportSnapshot?.participantCount ?? 0;
  const localAttendanceRate = Math.round((localParticipantCount / 2) * 100);
  const isClassReport = reportSnapshot
    ? reportSnapshot.meetingMode !== "normal"
    : reportMode !== "normal";
  const reportPublishedActivities = reportSnapshot
    ? reportSnapshot.publishedActivityIds
    : publishedActivities;
  const defaultTodos = useMemo<ReportTodo[]>(() => [
    ...(reportSnapshot
      ? [
          {
            id: "export-summary",
            title: "导出本地会话摘要",
            detail: "保存当前页面快照到本机",
            done: false,
          },
          {
            id: "share-local-report",
            title: "复制本地报告引用",
            detail: "链接仅用于当前本地演示",
            done: false,
          },
        ]
      : [
          ...(isClassReport
            ? [
                {
                  id: "publish-replay",
                  title: "发布第 3 讲课堂回放（演示）",
                  detail: "发布动作未接入，仅保留历史演示待办",
                  done: recordingAvailable,
                },
                {
                  id: "absent-reminder",
                  title: "提醒 6 位缺勤学生补学（演示）",
                  detail: "通知服务未接入，仅保留历史演示待办",
                  done: false,
                },
                {
                  id: "quiz-review",
                  title: "查看测验错题分布（演示）",
                  detail: "测验分析未接入，仅保留历史演示待办",
                  done: false,
                },
              ]
            : [
                {
                  id: "share-minutes",
                  title: "发送会议摘要（演示）",
                  detail: "消息服务未接入，仅保留历史演示待办",
                  done: false,
                },
                {
                  id: "confirm-actions",
                  title: "确认会议行动项（演示）",
                  detail: "资料归档服务未接入，仅保留历史演示待办",
                  done: false,
                },
                {
                  id: "review-recording",
                  title: "确认录制分享范围（演示）",
                  detail: "权限服务未接入，仅保留历史演示待办",
                  done: recordingAvailable,
                },
              ]),
        ]),
  ], [isClassReport, recordingAvailable, reportSnapshot]);
  const [todos, setTodos] = useState<ReportTodo[]>(() => {
    if (!reportSnapshot || !reportRoomId) return defaultTodos;
    return mergeReportTodos(defaultTodos, readLocalReportTodos(reportRoomId));
  });
  // 挂载时的首次写入只是把初始待办落盘，不是用户动作，失败也不提示，
  // 否则每次打开报告页都可能弹一次与当前操作无关的提示。
  // 记录已落盘过的会议号而非布尔值：切换报告页时首次写入同样属于水合，
  // 用布尔值会让换会议后的第一次落盘被误判成用户动作。
  // 该分支当前无测试覆盖也无法覆盖：带 reportSnapshot 的会议只来自本机创建，
  // 单次会话内 reportRoomId 不会变化。若种子历史会议以后带上快照即可达。
  const hydratedTodoRoomRef = useRef<string | null>(null);
  useEffect(() => {
    if (!reportSnapshot || !reportRoomId) return;
    const saved = writeLocalReportTodoState(reportRoomId, todos);
    if (!saved && hydratedTodoRoomRef.current === reportRoomId) {
      setToast("课后任务已更新，但本机保存失败");
    }
    hydratedTodoRoomRef.current = reportRoomId;
  }, [reportRoomId, reportSnapshot, setToast, todos]);
  useEffect(() => {
    if (!reportSnapshot || !reportRoomId) return;
    const key = reportTodoStorageKey(reportRoomId);
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== null && event.key !== key) return;
      setTodos(mergeReportTodos(defaultTodos, readLocalReportTodos(reportRoomId)));
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, [defaultTodos, reportRoomId, reportSnapshot]);
  const completeTodo = (id: string) => {
    setTodos((current) =>
      current.map((todo) => (todo.id === id ? { ...todo, done: true } : todo)),
    );
  };
  const addTodo = () => {
    if (todos.some((todo) => todo.id === "interaction-summary")) {
      setToast("该课后任务已存在");
      return;
    }
    setTodos((current) => [
      ...current,
      {
        id: "interaction-summary",
        title: isClassReport ? "整理课堂互动摘要" : "整理会议行动项",
        detail: isClassReport ? "归档活动结果到会议资料" : "归档到会议资料",
        done: false,
      },
    ]);
    setToast("已添加课后任务");
  };
  const copyReportLink = async () => {
    const link = buildLocalShareLink("report", meetingTitle, {
      mode: reportMode,
      snapshot: reportSnapshot,
    });
    const copied = await copyTextToClipboard(link);
    if (copied && reportSnapshot) completeTodo("share-local-report");
    setToast(
      copied
        ? `本地${isClassReport ? "课堂" : "会议"}报告引用已复制`
        : "复制失败，请手动复制本地报告引用",
    );
  };
  const copyReplayLink = async () => {
    const link = buildLocalShareLink("replay", meetingTitle);
    const copied = await copyTextToClipboard(link);
    setToast(copied ? "本地回放引用已复制" : "复制失败，请手动复制本地回放引用");
  };
  const exportReport = () => {
    const exported = downloadReportSummary(
      meetingTitle,
      reportSnapshot,
      reportMode,
      recordingBlob,
    );
    if (exported && reportSnapshot) completeTodo("export-summary");
    setToast(exported ? "报告摘要已下载" : "当前环境不支持下载报告摘要");
  };
  const downloadRecording = () => {
    const downloaded = downloadLocalRecording(meetingTitle, recordingBlob);
    setToast(downloaded ? "本地录制已下载" : "本地录制尚未准备好");
  };

  if (!reportGenerated) {
    return (
      <main className="report-page">
        <header className="report-header">
          <button className="back-button" onClick={onBackHome}>
            ← 返回会议首页
          </button>
        </header>
        <section className="report-empty-state" aria-live="polite">
          <span className="report-kicker">
            {isClassReport ? "课堂已结束" : "会议已结束"} · 等待生成
          </span>
          <h1>{meetingTitle}</h1>
          <p>
            本次{isClassReport ? "课堂" : "会议"}关闭了自动生成报告。你可以现在手动生成一份本地报告摘要。
          </p>
          <button
            className="report-primary"
            onClick={() => {
              setReportGenerated(true);
              const saved = onReportGenerated();
              setToast(saved ? "报告已生成" : "报告已生成，但本机历史状态保存失败");
            }}
          >
            立即生成报告
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="report-page">
      <header className="report-header">
        <button className="back-button" onClick={onBackHome}>
          ← 返回会议首页
        </button>
        <div className="report-actions">
          <button onClick={() => void copyReportLink()}>
            分享报告
          </button>
          <button
            className="report-primary"
            onClick={exportReport}
          >
            导出报告
          </button>
        </div>
      </header>
      <section className="report-hero">
        <div>
          <span className="report-kicker">
            {isClassReport ? "课堂已结束" : "会议已结束"} · 报告已生成
          </span>
          <h1>{meetingTitle}</h1>
          <p>
            {reportSnapshot
              ? `本地会话 · 时长 ${formatMeetingDuration(reportSnapshot.durationSeconds)} · ${reportSnapshot.participantName}`
              : isClassReport
                ? "2026 年 8 月 28 日 10:00–11:40 · 林老师 · 2026 秋 1 班"
                : "2026 年 8 月 25 日 14:00–15:16 · 林老师 · 普通会议"}
          </p>
        </div>
        <div className="report-score">
          <span>{isClassReport ? "课堂活跃度" : "会议活跃度"}</span>
          {reportSnapshot ? (
            <>
              <strong>—</strong>
              <small>未接入课程分析</small>
            </>
          ) : (
            <>
              <strong>92</strong>
              <small>较上次 +6</small>
            </>
          )}
        </div>
      </section>
      {replayOpen && (
        <section className="replay-viewer report-replay-viewer" aria-label="报告回放播放器">
          <div className="replay-viewer-stage teal">
            <span>
              {reportSnapshot
                ? "本地录制状态预览"
                : `正在查看 · ${isClassReport ? "课堂" : "会议"}回放`}
            </span>
            <strong>{meetingTitle}</strong>
            <button
              aria-label="关闭报告回放"
              onClick={() => setReplayOpen(false)}
            >
              ×
            </button>
            {recordingBlob ? <LocalRecordingVideo blob={recordingBlob} /> : <i>▶</i>}
          </div>
          <div className="replay-viewer-copy">
            <span>
              {reportSnapshot
                ? `会话时长 ${formatMeetingDuration(reportSnapshot.durationSeconds)}`
                : "01:38:42 · 字幕与章节已准备"}
            </span>
            <p>
              {reportSnapshot
                ? recordingBlob
                  ? "本地媒体已生成，可在当前报告中预览或下载；支持本机存储时会按会议保存。"
                  : "正在等待本地媒体完成；如果没有生成文件，请重新开始录制。"
                : `真实媒体接入后将在这里播放当前${isClassReport ? "课堂" : "会议"}回放。`}
            </p>
            {reportSnapshot && recordingBlob && (
              <button onClick={downloadRecording}>下载本地录制</button>
            )}
            {!reportSnapshot && (
              <button onClick={() => void copyReplayLink()}>复制本地回放引用</button>
            )}
          </div>
        </section>
      )}
      <section className="metric-grid">
        <article>
          <span className="metric-icon green">✓</span>
          <div>
            <small>
              {reportSnapshot ? "本地会话参与" : isClassReport ? "到课人数" : "参会人数"}
            </small>
            <strong>
              {reportSnapshot ? (
                <>
                  {localParticipantCount} <i>/ 2</i>
                </>
              ) : (
                isClassReport ? <>42 <i>/ 48</i></> : <>8 <i>/ 8</i></>
              )}
            </strong>
            <span>
              {reportSnapshot
                ? `${localAttendanceRate}% 本地参与率`
                : isClassReport
                  ? "到课率 87.5%"
                  : "参会率 100%"}
            </span>
          </div>
        </article>
        <article>
          <span className="metric-icon blue">◷</span>
          <div>
            <small>{reportSnapshot ? "会议时长" : "平均在线"}</small>
            <strong>
              {reportSnapshot ? (
                formatMeetingDuration(reportSnapshot.durationSeconds)
              ) : (
                isClassReport ? <>91 <i>分钟</i></> : <>76 <i>分钟</i></>
              )}
            </strong>
            <span>
              {reportSnapshot
                ? "当前本地会话已结束"
                : isClassReport
                  ? "全程在线 36 人"
                  : "全程在线 8 人"}
            </span>
          </div>
        </article>
        <article>
          <span className="metric-icon violet">✦</span>
          <div>
            <small>{reportSnapshot ? "已发布活动" : "互动参与"}</small>
            <strong>
              {reportSnapshot
                ? reportSnapshot.publishedActivityCount
                : isClassReport
                  ? 38
                  : 0} <i>
                {reportSnapshot ? "项" : isClassReport ? "人" : "项"}
              </i>
            </strong>
            <span>
              {reportSnapshot
                ? "当前会话发布的课堂活动"
                : isClassReport
                  ? "共完成 4 项活动"
                  : "普通会议不提供课堂活动"}
            </span>
          </div>
        </article>
        <article>
          <span className="metric-icon amber">◎</span>
          <div>
            <small>{reportSnapshot ? "聊天消息" : "发言与讨论"}</small>
            <strong>
              {reportSnapshot ? reportSnapshot.chatMessageCount : 26} <i>
                {reportSnapshot ? "条" : "条"}
              </i>
            </strong>
            <span>
              {reportSnapshot
                ? "本次会话新增消息"
                : isClassReport
                  ? "聊天消息 48 条"
                  : "会议消息 26 条"}
            </span>
          </div>
        </article>
      </section>
      <section className="report-grid">
        <article className="report-card attendance-card">
            <div className="card-title">
              <div>
                <span>01</span>
                <h2>{isClassReport ? "出勤概览" : "参会概览"}</h2>
              </div>
            <button
              aria-expanded={attendanceExpanded}
              onClick={() => setAttendanceExpanded((current) => !current)}
            >
              {attendanceExpanded
                ? "收起名单 ↑"
                : reportSnapshot
                  ? "查看窗口状态 →"
                  : isClassReport
                    ? "查看完整名单 →"
                    : "查看参会摘要 →"}
            </button>
          </div>
          <div className="attendance-chart">
            <div
              className="donut"
              style={
                reportSnapshot
                  ? {
                      background: `conic-gradient(#16ae81 0 ${localAttendanceRate}%,#e3e9e6 ${localAttendanceRate}% 100%)`,
                    }
                  : isClassReport
                    ? undefined
                    : {
                        background: "conic-gradient(#16ae81 0 100%,#e3e9e6 100% 100%)",
                      }
              }
            >
              <div>
                <strong>
                  {reportSnapshot
                    ? `${localAttendanceRate}%`
                    : isClassReport
                      ? "87.5%"
                      : "100%"}
                </strong>
                <small>{reportSnapshot || !isClassReport ? "参与率" : "到课率"}</small>
              </div>
            </div>
            {reportSnapshot ? (
              <div className="legend">
                <span>
                  <i className="green-bg" />
                  已加入<strong>{localParticipantCount} 个窗口</strong>
                </span>
                <span>
                  <i className="gray-bg" />
                  未加入<strong>{2 - localParticipantCount} 个窗口</strong>
                </span>
              </div>
            ) : isClassReport ? (
              <div className="legend">
                <span>
                  <i className="green-bg" />
                  按时到课<strong>41 人</strong>
                </span>
                <span>
                  <i className="amber-bg" />
                  迟到<strong>1 人</strong>
                </span>
                <span>
                  <i className="gray-bg" />
                  未到<strong>6 人</strong>
                </span>
              </div>
            ) : (
              <div className="legend">
                <span>
                  <i className="green-bg" />
                  已参会<strong>8 人</strong>
                </span>
              </div>
            )}
          </div>
          {attendanceExpanded && (
            reportSnapshot ? (
              <div className="attendance-details" aria-label="本地窗口状态">
                <div className="attendance-detail-row">
                  <PersonAvatar
                    name={reportSnapshot.participantName}
                    color="#c6f1e2"
                    small
                  />
                  <span>
                    <strong>{reportSnapshot.participantName}</strong>
                    <small>本地窗口</small>
                  </span>
                  <em className={localParticipantCount < 1 ? "absent" : ""}>
                    {localParticipantCount > 0 ? "已加入" : "未开启设备"}
                  </em>
                </div>
                <div className="attendance-detail-row">
                  <PersonAvatar name="远端" color="#d7d1fb" small />
                  <span>
                    <strong>远端参会者</strong>
                    <small>同源另一窗口</small>
                  </span>
                  <em className={localParticipantCount < 2 ? "absent" : ""}>
                    {localParticipantCount > 1 ? "已加入" : "未加入"}
                  </em>
                </div>
              </div>
            ) : isClassReport ? (
              <div className="attendance-details" aria-label="完整出勤名单">
                {memberList.map((member, index) => (
                  <div className="attendance-detail-row" key={member.name}>
                    <PersonAvatar
                      name={member.name}
                      color={participants[index % participants.length].color}
                      small
                    />
                    <span>
                      <strong>{member.name}</strong>
                      <small>{member.status}</small>
                    </span>
                    <em className={member.presence === "未到" ? "absent" : ""}>
                      {member.presence}
                    </em>
                  </div>
                ))}
              </div>
            ) : (
              <div className="attendance-details" aria-label="会议参会摘要">
                <div className="attendance-detail-row">
                  <PersonAvatar name="会" color="#d7d1fb" small />
                  <span>
                    <strong>参会成员</strong>
                    <small>普通会议演示统计</small>
                  </span>
                  <em>8 人</em>
                </div>
              </div>
            )
          )}
        </article>
        <article className="report-card interaction-card">
          <div className="card-title">
            <div>
              <span>02</span>
              <h2>{isClassReport ? "课堂互动" : "会议互动"}</h2>
            </div>
            <small>
              {reportSnapshot
                ? `${reportPublishedActivities.length} 项已发布`
                : isClassReport
                  ? "4 项活动"
                  : "无课堂活动"}
            </small>
          </div>
          {reportSnapshot ? (
            reportSnapshot.publishedActivityCount > 0 ? (
              <div className="interaction-list">
                {reportPublishedActivities.map((id) => (
                  <div className="report-published-activity" key={id}>
                    <span>{activityLabels[id]}</span>
                    <i>
                      <b style={{ width: "100%" }} />
                    </i>
                    <strong>已发布</strong>
                  </div>
                ))}
              </div>
            ) : (
              <div className="report-activity-empty">
                <strong>
                  本次{isClassReport ? "会话未发布课堂活动" : "会议未发布互动活动"}
                </strong>
                <span>
                  {isClassReport
                    ? "结束前发布签到、投票或测验后，会在这里留下记录。"
                    : "普通会议不提供课堂活动记录。"}
                </span>
              </div>
            )
          ) : isClassReport ? (
            <div className="interaction-list">
              <div>
                <span>签到</span>
                <i>
                  <b style={{ width: "88%" }} />
                </i>
                <strong>42/48</strong>
              </div>
              <div>
                <span>快速投票</span>
                <i>
                  <b style={{ width: "79%" }} />
                </i>
                <strong>38/48</strong>
              </div>
              <div>
                <span>随堂测验</span>
                <i>
                  <b style={{ width: "83%" }} />
                </i>
                <strong>40/48</strong>
              </div>
              <div>
                <span>随机选人</span>
                <i>
                  <b style={{ width: "54%" }} />
                </i>
                <strong>6 人</strong>
              </div>
            </div>
          ) : (
            <div className="report-activity-empty">
              <strong>本次会议未记录课堂互动</strong>
              <span>普通会议不提供签到、投票、测验或随机选人记录。</span>
            </div>
          )}
          {reportPublishedActivities.length > 0 && (
            <p className="report-activity-note">
              本次会中发布：
              {reportPublishedActivities.map((id) => activityLabels[id]).join("、")}
            </p>
          )}
        </article>
        {recordingAvailable ? (
          <article className="report-card replay-card">
            <div className="replay-thumb">
              <button
                aria-label={
                  reportSnapshot
                    ? "查看本地录制状态"
                    : `打开${isClassReport ? "课堂" : "会议"}回放`
                }
                onClick={(event) => {
                  replayTriggerRef.current = event.currentTarget;
                  setReplayOpen(true);
                  setToast(
                    reportSnapshot
                      ? "正在查看本地录制状态"
                      : `正在打开${isClassReport ? "课堂" : "会议"}回放`,
                  );
                }}
              >
                ▶
              </button>
              <span>
                {reportSnapshot
                  ? formatMeetingDuration(reportSnapshot.durationSeconds)
                  : "01:38:42"}
              </span>
            </div>
            <div>
              <span className="report-kicker">
                {reportSnapshot
                  ? "本地录制状态"
                  : `${isClassReport ? "课堂" : "会议"}回放`}
              </span>
              <h2>
                {reportSnapshot
                    ? recordingBlob
                      ? "本地录制已生成"
                      : "录制状态已记录"
                  : isClassReport
                    ? "历史课堂回放（演示数据）"
                    : "历史会议回放（演示数据）"}
              </h2>
              <p>
                  {reportSnapshot
                    ? recordingBlob
                      ? "媒体已生成，可下载为 WebM 文件；支持本机存储时，重新打开该会议报告仍可恢复。"
                      : "正在等待本地媒体完成；如果没有生成文件，请重新开始录制。"
                    : isClassReport
                    ? "字幕与章节为演示数据，真实媒体接入后才可播放。"
                    : "回放内容为演示数据，真实媒体接入后才可供受邀成员回看。"}
              </p>
              {reportSnapshot ? (
                <div className="report-replay-actions">
                  <button
                    onClick={(event) => {
                      replayTriggerRef.current = event.currentTarget;
                      setReplayOpen(true);
                      setToast("正在查看本地录制状态");
                    }}
                  >
                    查看录制状态
                  </button>
                  {recordingBlob && (
                    <button onClick={downloadRecording}>下载本地录制</button>
                  )}
                </div>
              ) : (
                <button onClick={() => void copyReplayLink()}>
                  复制本地回放引用
                </button>
              )}
            </div>
          </article>
        ) : (
          <article className="report-card report-no-replay">
            <span className="metric-icon amber">●</span>
            <div>
              <span className="report-kicker">
                {isClassReport ? "课堂回放" : "会议回放"}
              </span>
              <h2>本次{isClassReport ? "课堂" : "会议"}未开启录制</h2>
              <p>
                {isClassReport
                  ? "课堂结束前未开启录制，因此没有可查看或分享的课堂回放。"
                  : "会议结束前未开启录制，因此没有可查看或分享的会议回放。"}
              </p>
            </div>
          </article>
        )}
        <article className="report-card todo-card">
          <div className="card-title">
            <div>
              <span>03</span>
              <h2>{isClassReport ? "课后待办" : "会后待办"}</h2>
            </div>
            <button onClick={addTodo}>＋ 添加</button>
          </div>
          {todos.map((todo) => (
            <label key={todo.id}>
              <input
                type="checkbox"
                checked={todo.done}
                onChange={(event) =>
                  setTodos((current) =>
                    current.map((item) =>
                      item.id === todo.id
                        ? { ...item, done: event.target.checked }
                        : item,
                    ),
                  )
                }
              />
              <span>
                <strong>{todo.title}</strong>
                <small>{todo.detail}</small>
              </span>
            </label>
          ))}
        </article>
      </section>
      {toast && (
        <div className="toast light-toast" role="status">
          {toast}
        </div>
      )}
    </main>
  );
}
