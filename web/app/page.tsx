"use client";

import { useEffect, useMemo, useState } from "react";

type View = "home" | "meeting" | "report";
type Panel = "members" | "chat" | "activities" | null;

const navItems = [
  { icon: "⌂", label: "会议首页" },
  { icon: "▣", label: "我的会议" },
  { icon: "◎", label: "课堂回放" },
  { icon: "▤", label: "会议资料" },
];
const schedules = [
  {
    time: "10:00",
    title: "数字媒体技术 · 课堂",
    meta: "教学楼 A302 · 48 人",
    tag: "课程课堂",
    color: "green",
  },
  {
    time: "14:30",
    title: "毕业设计中期答辩",
    meta: "线上会议 · 12 人",
    tag: "答辩",
    color: "amber",
  },
  {
    time: "19:00",
    title: "《交互设计》小组讨论",
    meta: "线上会议 · 8 人",
    tag: "小组会议",
    color: "blue",
  },
];
const participants = [
  { name: "林老师", role: "主持人", color: "#c6f1e2", mic: true, camera: true },
  { name: "周雨桐", role: "学生", color: "#f3d49c", mic: false, camera: true },
  { name: "许明哲", role: "学生", color: "#d7d1fb", mic: false, camera: true },
  { name: "陈一凡", role: "学生", color: "#facbc1", mic: true, camera: true },
  { name: "苏晓", role: "学生", color: "#bfddf2", mic: false, camera: false },
  { name: "王子涵", role: "学生", color: "#e5d4f4", mic: false, camera: true },
];
const memberList = [
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

export default function Home() {
  const [view, setView] = useState<View>("home");
  const [activeNav, setActiveNav] = useState("会议首页");
  const [createIntent, setCreateIntent] = useState<"start" | "schedule">(
    "start",
  );
  const [hasLocalSchedule, setHasLocalSchedule] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);
  const [modal, setModal] = useState<"create" | "join" | null>(null);
  const [meetingMode, setMeetingMode] = useState<"class" | "normal">("class");
  const [micOn, setMicOn] = useState(true);
  const [cameraOn, setCameraOn] = useState(true);
  const [sharing, setSharing] = useState(false);
  const [recording, setRecording] = useState(false);
  const [layout, setLayout] = useState<"grid" | "focus">("grid");
  const [activity, setActivity] = useState("checkin");
  const [activityPublished, setActivityPublished] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [localMessages, setLocalMessages] = useState(baseMessages);
  const [toast, setToast] = useState("");
  const [elapsed, setElapsed] = useState(28 * 60 + 16);

  useEffect(() => {
    if (view !== "meeting") return;
    const timer = window.setInterval(
      () => setElapsed((value) => value + 1),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [view]);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2400);
    return () => window.clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    setHasLocalSchedule(
      window.localStorage.getItem("learning-meeting-scheduled") === "true",
    );
  }, []);
  const elapsedLabel = useMemo(() => {
    const h = Math.floor(elapsed / 3600)
      .toString()
      .padStart(2, "0");
    const m = Math.floor((elapsed % 3600) / 60)
      .toString()
      .padStart(2, "0");
    const s = (elapsed % 60).toString().padStart(2, "0");
    return `${h}:${m}:${s}`;
  }, [elapsed]);
  const enterMeeting = () => {
    setModal(null);
    setView("meeting");
    setPanel(null);
    setToast(meetingMode === "class" ? "已进入课程课堂" : "会议已开始");
  };
  const submitMeeting = () => {
    if (createIntent === "start") {
      enterMeeting();
      return;
    }
    window.localStorage.setItem("learning-meeting-scheduled", "true");
    setHasLocalSchedule(true);
    setModal(null);
    setActiveNav("我的会议");
    setToast("会议已预约，并已保存到本机");
  };
  const togglePanel = (next: Exclude<Panel, null>) =>
    setPanel((current) => (current === next ? null : next));
  const sendMessage = () => {
    if (!chatInput.trim()) return;
    setLocalMessages((items) => [
      ...items,
      { name: "林老师", time: "刚刚", text: chatInput.trim() },
    ]);
    setChatInput("");
  };

  if (view === "meeting") {
    return (
      <main className="meeting-room">
        <header className="meeting-header">
          <div className="meeting-identity">
            <button
              className="meeting-logo"
              onClick={() => setView("home")}
              aria-label="返回会议首页"
            >
              学
            </button>
            <div>
              <strong>数字媒体技术 · 第 3 讲</strong>
              <small>
                <i /> 课堂进行中 · {elapsedLabel}
              </small>
            </div>
          </div>
          <div className="meeting-meta">
            <span>会议号 821 406 233</span>
            <button onClick={() => setToast("会议号已复制")}>复制</button>
          </div>
          <div className="meeting-head-actions">
            <button
              className={layout === "grid" ? "selected" : ""}
              onClick={() => setLayout("grid")}
            >
              宫格
            </button>
            <button
              className={layout === "focus" ? "selected" : ""}
              onClick={() => setLayout("focus")}
            >
              主讲
            </button>
            <button aria-label="更多设置">•••</button>
          </div>
        </header>
        <section className={`meeting-stage ${panel ? "with-panel" : ""}`}>
          <div className={`video-grid ${layout}`}>
            {participants.map((person, index) => (
              <article
                className={`video-tile tile-${index + 1} ${!person.camera ? "camera-off" : ""}`}
                key={person.name}
              >
                <div
                  className="video-gradient"
                  style={
                    { "--tile-color": person.color } as React.CSSProperties
                  }
                >
                  {person.camera ? (
                    <>
                      <span className="person-silhouette" />
                      <PersonAvatar name={person.name} color={person.color} />
                    </>
                  ) : (
                    <div className="camera-off-state">
                      <PersonAvatar name={person.name} color={person.color} />
                      <span>摄像头已关闭</span>
                    </div>
                  )}
                </div>
                <div className="tile-label">
                  <span>
                    {person.name}
                    {person.role === "主持人" ? " · 主持人" : ""}
                  </span>
                  <span>{person.mic ? "◖))" : "╳"}</span>
                </div>
                {index === 3 && (
                  <span className="speaking-badge">正在发言</span>
                )}
              </article>
            ))}
          </div>
          {panel && (
            <MeetingPanel
              panel={panel}
              setPanel={setPanel}
              activity={activity}
              setActivity={setActivity}
              activityPublished={activityPublished}
              setActivityPublished={setActivityPublished}
              localMessages={localMessages}
              chatInput={chatInput}
              setChatInput={setChatInput}
              sendMessage={sendMessage}
              setToast={setToast}
            />
          )}
        </section>
        <footer className="meeting-controls">
          <div className="control-group">
            <button
              className={micOn ? "" : "off"}
              onClick={() => setMicOn(!micOn)}
            >
              <span>{micOn ? "◖))" : "╳"}</span>
              <small>{micOn ? "静音" : "解除静音"}</small>
            </button>
            <button
              className={cameraOn ? "" : "off"}
              onClick={() => setCameraOn(!cameraOn)}
            >
              <span>{cameraOn ? "▰" : "▱"}</span>
              <small>{cameraOn ? "关闭视频" : "开启视频"}</small>
            </button>
          </div>
          <div className="control-group central">
            <button
              className={sharing ? "active-control" : ""}
              onClick={() => {
                setSharing(!sharing);
                setToast(sharing ? "已停止共享" : "正在共享屏幕");
              }}
            >
              <span>▣</span>
              <small>{sharing ? "停止共享" : "共享屏幕"}</small>
            </button>
            <button
              className={recording ? "recording" : ""}
              onClick={() => {
                setRecording(!recording);
                setToast(recording ? "录制已暂停" : "录制已开始");
              }}
            >
              <span>●</span>
              <small>{recording ? "停止录制" : "录制"}</small>
            </button>
            <button
              className={panel === "members" ? "active-control" : ""}
              onClick={() => togglePanel("members")}
            >
              <span>♙</span>
              <small>成员 48</small>
            </button>
            <button
              className={panel === "chat" ? "active-control" : ""}
              onClick={() => togglePanel("chat")}
            >
              <span>▢</span>
              <small>聊天</small>
              <i className="control-dot" />
            </button>
            <button
              className={panel === "activities" ? "active-control" : ""}
              onClick={() => togglePanel("activities")}
            >
              <span>✦</span>
              <small>课堂互动</small>
            </button>
          </div>
          <button className="end-button" onClick={() => setView("report")}>
            结束课堂
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
    return <ReportPage setView={setView} toast={toast} setToast={setToast} />;

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
              onClick={() => setActiveNav(item.label)}
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
          onClick={() => setToast("已打开个人菜单")}
        >
          <span className="avatar">林</span>
          <span>
            <strong>林老师</strong>
            <small>信息工程学院</small>
          </span>
          <span className="more">•••</span>
        </button>
      </aside>
      <section className="workspace">
        {activeNav === "会议首页" && (
          <HomeDashboard
            setView={setView}
            setToast={setToast}
            setModal={setModal}
            setMeetingMode={setMeetingMode}
            setCreateIntent={setCreateIntent}
            setActiveNav={setActiveNav}
          />
        )}
        {activeNav === "我的会议" && (
          <MeetingsHub
            setView={setView}
            setModal={setModal}
            setMeetingMode={setMeetingMode}
            setCreateIntent={setCreateIntent}
            hasLocalSchedule={hasLocalSchedule}
          />
        )}
        {activeNav === "课堂回放" && <ReplayHub setToast={setToast} />}
        {activeNav === "会议资料" && <MaterialsHub setToast={setToast} />}
      </section>
      {modal && (
        <MeetingModal
          modal={modal}
          setModal={setModal}
          meetingMode={meetingMode}
          setMeetingMode={setMeetingMode}
          submitMeeting={submitMeeting}
          createIntent={createIntent}
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

function ProductTopbar({
  eyebrow,
  title,
  action,
}: {
  eyebrow: string;
  title: string;
  action?: React.ReactNode;
}) {
  return (
    <header className="topbar product-topbar">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
      </div>
      {action ?? (
        <div className="top-actions">
          <button className="icon-button" aria-label="搜索">
            ⌕
          </button>
          <button className="icon-button notification" aria-label="通知">
            ♢<i />
          </button>
        </div>
      )}
    </header>
  );
}

function HomeDashboard({
  setView,
  setToast,
  setModal,
  setMeetingMode,
  setCreateIntent,
  setActiveNav,
}: any) {
  return (
    <>
      <ProductTopbar
        eyebrow="8 月 28 日 · 星期五"
        title="下午好，林老师"
        action={
          <div className="top-actions">
            <button
              className="icon-button"
              aria-label="搜索"
              onClick={() => setToast("搜索会议、课程或成员")}
            >
              ⌕
            </button>
            <button
              className="icon-button notification"
              aria-label="通知"
              onClick={() => setToast("你有 3 条会议通知")}
            >
              ♢<i />
            </button>
          </div>
        }
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
          <button className="primary-button" onClick={() => setView("meeting")}>
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
                onClick={() => setView("meeting")}
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
  setView,
  setModal,
  setMeetingMode,
  setCreateIntent,
  hasLocalSchedule,
}: any) {
  const [tab, setTab] = useState<"upcoming" | "past">("upcoming");
  const upcoming = [
    ...(hasLocalSchedule
      ? [
          {
            day: "29",
            month: "8月",
            time: "09:30–10:30",
            title: "数字媒体技术 · 第 3 讲",
            detail: "2026 秋 · 1 班 · 48 人",
            type: "课程课堂",
            accent: "green",
          },
        ]
      : []),
    {
      day: "28",
      month: "今天",
      time: "14:30–16:30",
      title: "毕业设计中期答辩",
      detail: "信息工程学院 · 12 人",
      type: "答辩",
      accent: "amber",
    },
    {
      day: "28",
      month: "今天",
      time: "19:00–20:00",
      title: "《交互设计》小组讨论",
      detail: "第 4 项目组 · 8 人",
      type: "小组会议",
      accent: "blue",
    },
    {
      day: "31",
      month: "8月",
      time: "15:00–16:00",
      title: "新学期教学研讨会",
      detail: "产品设计教研室 · 24 人",
      type: "教研会",
      accent: "violet",
    },
  ];
  const past = [
    {
      day: "27",
      month: "8月",
      time: "10:00–11:32",
      title: "交互设计 · 课程导学",
      detail: "46 人参会 · 已生成报告",
      type: "已结束",
      accent: "green",
    },
    {
      day: "25",
      month: "8月",
      time: "14:00–15:16",
      title: "课程组备课会",
      detail: "8 人参会 · 录制 1:12:40",
      type: "已结束",
      accent: "blue",
    },
  ];
  const rows = tab === "upcoming" ? upcoming : past;
  return (
    <>
      <ProductTopbar
        eyebrow="会议中心"
        title="我的会议"
        action={
          <button
            className="page-primary"
            onClick={() => {
              setMeetingMode("normal");
              setCreateIntent("schedule");
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
            <strong>3 场</strong>
          </div>
        </article>
        <article>
          <span>周</span>
          <div>
            <small>本周已完成</small>
            <strong>8 场</strong>
          </div>
        </article>
        <article>
          <span>时</span>
          <div>
            <small>累计会议时长</small>
            <strong>12.6 小时</strong>
          </div>
        </article>
        <div className="next-meeting">
          <i />
          下一场：毕业设计中期答辩<strong>还有 36 分钟</strong>
        </div>
      </section>
      <section className="asset-section">
        <div className="asset-toolbar">
          <div className="tab-switch">
            <button
              className={tab === "upcoming" ? "active" : ""}
              onClick={() => setTab("upcoming")}
            >
              即将开始 <span>{upcoming.length}</span>
            </button>
            <button
              className={tab === "past" ? "active" : ""}
              onClick={() => setTab("past")}
            >
              已结束 <span>{past.length}</span>
            </button>
          </div>
          <label className="asset-search">
            ⌕ <input placeholder="搜索会议" aria-label="搜索会议" />
          </label>
        </div>
        <div className="meeting-list">
          {rows.map((item, index) => (
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
                    <button onClick={() => setView("meeting")}>进入会议</button>
                    <button className="more-action">•••</button>
                  </>
                ) : (
                  <>
                    <button onClick={() => setView("report")}>查看报告</button>
                    <button className="more-action">•••</button>
                  </>
                )}
              </div>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}

function ReplayHub({ setToast }: any) {
  const [query, setQuery] = useState("");
  const replays = [
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
  ].filter((item) => `${item.course}${item.title}`.includes(query.trim()));
  return (
    <>
      <ProductTopbar
        eyebrow="知识沉淀"
        title="课堂回放"
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
          <span className="replay-feature-kicker">刚刚生成</span>
          <h2>数字媒体技术 · 第 3 讲</h2>
          <p>AI 已完成字幕、章节和课堂摘要，你可以继续编辑后发布给学生。</p>
          <div>
            <button onClick={() => setToast("正在打开回放编辑器")}>
              编辑并发布
            </button>
            <button onClick={() => setToast("正在预览课堂回放")}>
              预览回放
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
            <article className="replay-item" key={item.title}>
              <div className={`replay-cover ${item.color}`}>
                <span className="course-initial">
                  {item.course.slice(0, 1)}
                </span>
                <button
                  aria-label={`播放${item.title}`}
                  onClick={() => setToast(`正在播放：${item.title}`)}
                >
                  ▶
                </button>
                <small>{item.duration}</small>
              </div>
              <div className="replay-info">
                <span>{item.course}</span>
                <h3>{item.title}</h3>
                <p>
                  {item.date} · {item.views}
                </p>
                <div className="watch-progress">
                  <i style={{ width: `${item.progress}%` }} />
                </div>
                <div className="replay-actions">
                  <button onClick={() => setToast("回放链接已复制")}>
                    分享
                  </button>
                  <button onClick={() => setToast("正在打开回放详情")}>
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

function MaterialsHub({ setToast }: any) {
  const files = [
    {
      icon: "P",
      name: "第 3 讲 · 信息架构课件.pptx",
      source: "数字媒体技术",
      size: "18.6 MB",
      time: "今天 09:42",
      color: "orange",
    },
    {
      icon: "W",
      name: "毕业设计中期答辩安排.docx",
      source: "毕业设计",
      size: "1.2 MB",
      time: "昨天 16:20",
      color: "blue",
    },
    {
      icon: "V",
      name: "课堂录制 · 交互设计第 2 讲.mp4",
      source: "交互设计",
      size: "386 MB",
      time: "8 月 27 日",
      color: "violet",
    },
    {
      icon: "X",
      name: "课堂签到与测验结果.xlsx",
      source: "数字媒体技术",
      size: "246 KB",
      time: "8 月 27 日",
      color: "green",
    },
  ];
  return (
    <>
      <ProductTopbar
        eyebrow="会议资产"
        title="会议资料"
        action={
          <button
            className="page-primary"
            onClick={() => setToast("原型暂不上传真实文件")}
          >
            ↑ 上传资料
          </button>
        }
      />
      <section className="storage-banner">
        <div>
          <span className="storage-icon">云</span>
          <div>
            <small>超星云盘 · 会议空间</small>
            <strong>资料会自动关联课程与会议</strong>
            <p>录制、课件、白板和活动结果都在这里统一沉淀。</p>
          </div>
        </div>
        <div className="storage-meter">
          <span>
            <strong>12.8 GB</strong> / 50 GB
          </span>
          <i>
            <b />
          </i>
          <small>还有 37.2 GB 可用</small>
        </div>
      </section>
      <section className="folder-grid">
        <button onClick={() => setToast("已打开课堂录制")}>
          <span className="folder-icon green">◎</span>
          <div>
            <strong>课堂录制</strong>
            <small>18 个文件 · 8.6 GB</small>
          </div>
          <i>→</i>
        </button>
        <button onClick={() => setToast("已打开会议课件")}>
          <span className="folder-icon blue">▤</span>
          <div>
            <strong>会议课件</strong>
            <small>42 个文件 · 2.1 GB</small>
          </div>
          <i>→</i>
        </button>
        <button onClick={() => setToast("已打开白板批注")}>
          <span className="folder-icon violet">✎</span>
          <div>
            <strong>白板与批注</strong>
            <small>16 个文件 · 328 MB</small>
          </div>
          <i>→</i>
        </button>
        <button onClick={() => setToast("已打开活动结果")}>
          <span className="folder-icon amber">✓</span>
          <div>
            <strong>活动结果</strong>
            <small>31 个文件 · 96 MB</small>
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
            onClick={() => setToast("已切换到全部文件")}
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
          {files.map((file) => (
            <article className="file-row" key={file.name}>
              <div>
                <span className={`file-type ${file.color}`}>{file.icon}</span>
                <strong>{file.name}</strong>
              </div>
              <span>{file.source}</span>
              <span>{file.size}</span>
              <span>{file.time}</span>
              <button onClick={() => setToast(`已打开：${file.name}`)}>
                •••
              </button>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}

function MeetingPanel({
  panel,
  setPanel,
  activity,
  setActivity,
  activityPublished,
  setActivityPublished,
  localMessages,
  chatInput,
  setChatInput,
  sendMessage,
  setToast,
}: any) {
  return (
    <aside className="meeting-panel">
      <div className="panel-tabs">
        <button
          className={panel === "members" ? "active" : ""}
          onClick={() => setPanel("members")}
        >
          成员
        </button>
        <button
          className={panel === "chat" ? "active" : ""}
          onClick={() => setPanel("chat")}
        >
          聊天
        </button>
        <button
          className={panel === "activities" ? "active" : ""}
          onClick={() => setPanel("activities")}
        >
          课堂互动
        </button>
        <button
          className="panel-close"
          onClick={() => setPanel(null)}
          aria-label="关闭侧栏"
        >
          ×
        </button>
      </div>
      {panel === "members" && (
        <div className="panel-content members-panel">
          <div className="panel-summary">
            <span>
              <strong>42</strong> 已到
            </span>
            <span>
              <strong>1</strong> 迟到
            </span>
            <span>
              <strong>6</strong> 未到
            </span>
          </div>
          <label className="member-search">
            ⌕ <input aria-label="搜索成员" placeholder="搜索成员" />
          </label>
          <div className="member-list">
            {memberList.map((member, index) => (
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
                <button aria-label={`${member.name}麦克风`}>
                  {member.mic ? "◖))" : "╳"}
                </button>
              </div>
            ))}
          </div>
          <button
            className="panel-secondary"
            onClick={() => setToast("全体已静音")}
          >
            全体静音
          </button>
        </div>
      )}
      {panel === "chat" && (
        <div className="panel-content chat-panel">
          <div className="chat-list">
            {localMessages.map((message: any, index: number) => (
              <div
                className={`chat-message ${message.name === "林老师" ? "mine" : ""}`}
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
        <div className="panel-content activity-panel">
          <div className="activity-intro">
            <span>教学工具</span>
            <strong>让每个人都参与进来</strong>
            <small>活动结果可同步到课程课堂报告</small>
          </div>
          <div className="activity-options">
            {activityTypes.map((item) => (
              <button
                className={activity === item.id ? "active" : ""}
                key={item.id}
                onClick={() => {
                  setActivity(item.id);
                  setActivityPublished(false);
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
                <div className="random-name">?</div>
              </>
            )}
          </div>
          <button
            className="panel-primary"
            onClick={() => {
              setActivityPublished(true);
              setToast("课堂活动已发布");
            }}
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
}: any) {
  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) setModal(null);
      }}
    >
      <section
        className="meeting-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
      >
        <button
          className="modal-close"
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
                className={meetingMode === "class" ? "active" : ""}
                onClick={() => setMeetingMode("class")}
              >
                <span>课</span>
                <div>
                  <strong>课程课堂</strong>
                  <small>带入班级与教学活动</small>
                </div>
              </button>
              <button
                className={meetingMode === "normal" ? "active" : ""}
                onClick={() => setMeetingMode("normal")}
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
                defaultValue={
                  meetingMode === "class"
                    ? "数字媒体技术 · 第 3 讲"
                    : "林老师的快速会议"
                }
              />
            </label>
            {meetingMode === "class" && (
              <div className="form-row">
                <label className="form-field">
                  <span>课程</span>
                  <select defaultValue="digital">
                    <option value="digital">数字媒体技术</option>
                    <option value="interaction">交互设计</option>
                  </select>
                </label>
                <label className="form-field">
                  <span>班级</span>
                  <select defaultValue="class1">
                    <option value="class1">2026 秋 · 1 班（48 人）</option>
                    <option value="class2">2026 秋 · 2 班（46 人）</option>
                  </select>
                </label>
              </div>
            )}
            <div className="modal-options">
              <label>
                <input type="checkbox" defaultChecked /> 入会自动静音
              </label>
              <label>
                <input type="checkbox" defaultChecked /> 自动生成课堂报告
              </label>
            </div>
            <button className="modal-primary" onClick={submitMeeting}>
              {createIntent === "schedule"
                ? "确认预约"
                : meetingMode === "class"
                  ? "开始课堂"
                  : "开始会议"}{" "}
              <span>→</span>
            </button>
            <small className="prototype-note">
              当前为交互原型，不会真实调用摄像头或麦克风。
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
                defaultValue="821 406 233"
                aria-label="会议号"
              />
            </label>
            <label className="form-field">
              <span>入会名称</span>
              <input defaultValue="林老师" />
            </label>
            <div className="device-preview">
              <div>
                <span className="avatar large">林</span>
                <small>摄像头预览</small>
              </div>
              <label>
                <input type="checkbox" defaultChecked /> 开启麦克风
              </label>
              <label>
                <input type="checkbox" defaultChecked /> 开启摄像头
              </label>
            </div>
            <button className="modal-primary" onClick={submitMeeting}>
              加入会议 <span>→</span>
            </button>
            <small className="prototype-note">
              当前为交互原型，不会真实调用摄像头或麦克风。
            </small>
          </>
        )}
      </section>
    </div>
  );
}

function ReportPage({ setView, toast, setToast }: any) {
  return (
    <main className="report-page">
      <header className="report-header">
        <button className="back-button" onClick={() => setView("home")}>
          ← 返回会议首页
        </button>
        <div className="report-actions">
          <button onClick={() => setToast("课堂报告链接已复制")}>
            分享报告
          </button>
          <button
            className="report-primary"
            onClick={() => setToast("报告已导出")}
          >
            导出报告
          </button>
        </div>
      </header>
      <section className="report-hero">
        <div>
          <span className="report-kicker">课堂已结束 · 报告已生成</span>
          <h1>数字媒体技术 · 第 3 讲</h1>
          <p>2026 年 8 月 28 日 10:00–11:40 · 林老师 · 2026 秋 1 班</p>
        </div>
        <div className="report-score">
          <span>课堂活跃度</span>
          <strong>92</strong>
          <small>较上次 +6</small>
        </div>
      </section>
      <section className="metric-grid">
        <article>
          <span className="metric-icon green">✓</span>
          <div>
            <small>到课人数</small>
            <strong>
              42 <i>/ 48</i>
            </strong>
            <span>到课率 87.5%</span>
          </div>
        </article>
        <article>
          <span className="metric-icon blue">◷</span>
          <div>
            <small>平均在线</small>
            <strong>
              91 <i>分钟</i>
            </strong>
            <span>全程在线 36 人</span>
          </div>
        </article>
        <article>
          <span className="metric-icon violet">✦</span>
          <div>
            <small>互动参与</small>
            <strong>
              38 <i>人</i>
            </strong>
            <span>共完成 4 项活动</span>
          </div>
        </article>
        <article>
          <span className="metric-icon amber">◎</span>
          <div>
            <small>发言与讨论</small>
            <strong>
              26 <i>次</i>
            </strong>
            <span>聊天消息 48 条</span>
          </div>
        </article>
      </section>
      <section className="report-grid">
        <article className="report-card attendance-card">
          <div className="card-title">
            <div>
              <span>01</span>
              <h2>出勤概览</h2>
            </div>
            <button>查看完整名单 →</button>
          </div>
          <div className="attendance-chart">
            <div className="donut">
              <div>
                <strong>87.5%</strong>
                <small>到课率</small>
              </div>
            </div>
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
          </div>
        </article>
        <article className="report-card interaction-card">
          <div className="card-title">
            <div>
              <span>02</span>
              <h2>课堂互动</h2>
            </div>
            <small>4 项活动</small>
          </div>
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
        </article>
        <article className="report-card replay-card">
          <div className="replay-thumb">
            <button onClick={() => setToast("正在打开课堂回放")}>▶</button>
            <span>01:38:42</span>
          </div>
          <div>
            <span className="report-kicker">课堂回放</span>
            <h2>录制已保存到课程云盘</h2>
            <p>自动生成字幕与章节，学生可在课程任务中回看。</p>
            <button onClick={() => setToast("回放链接已复制")}>
              复制回放链接
            </button>
          </div>
        </article>
        <article className="report-card todo-card">
          <div className="card-title">
            <div>
              <span>03</span>
              <h2>课后待办</h2>
            </div>
            <button onClick={() => setToast("已添加课后任务")}>＋ 添加</button>
          </div>
          <label>
            <input type="checkbox" defaultChecked />
            <span>
              <strong>发布第 3 讲课堂回放</strong>
              <small>自动同步到课程章节</small>
            </span>
          </label>
          <label>
            <input type="checkbox" />
            <span>
              <strong>提醒 6 位缺勤学生补学</strong>
              <small>附带回放和随堂测验</small>
            </span>
          </label>
          <label>
            <input type="checkbox" />
            <span>
              <strong>查看测验错题分布</strong>
              <small>3 道题中第 2 题错误率最高</small>
            </span>
          </label>
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
