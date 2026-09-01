import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Home, { matchesReplaySearch } from "./page";
import * as localRecordingStorage from "./use-local-recording-storage";
import {
  FakeMediaStream,
  FakeMediaRecorder,
  FakeMediaStreamTrack,
  FakePeerConnection,
  broadcastToRoom,
  getBroadcastChannels,
  getDisplayMediaMock,
  getUserMediaMock,
} from "../test/setup";

function enterLiveMeeting() {
  fireEvent.click(screen.getByRole("button", { name: /进入课堂/ }));
  expect(screen.getByText("本地 WebRTC 实验")).toBeTruthy();
}

async function joinLiveMeeting() {
  enterLiveMeeting();
  fireEvent.click(screen.getByRole("button", { name: /开启设备并加入/ }));
  await waitFor(() => {
    expect(screen.getByText("等待另一位参会者")).toBeTruthy();
  });
}

describe("会议页面", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState({}, "", "/");
  });

  it("可以从首页进入本地会议并显示等待状态", async () => {
    render(<Home />);
    enterLiveMeeting();

    fireEvent.click(screen.getByRole("button", { name: /开启设备并加入/ }));

    await waitFor(() => {
      expect(screen.getByText("等待另一位参会者")).toBeTruthy();
    });
    expect(screen.getByRole("button", { name: /离开连接/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /静音/ })).not.toHaveProperty(
      "disabled",
      true,
    );
  });

  it("本地连接建立后标题显示进行中，主动离会后回到会议大厅", async () => {
    const first = render(<Home />);
    const second = render(<Home />);
    fireEvent.click(within(first.container).getByRole("button", { name: /进入课堂/ }));
    fireEvent.click(within(second.container).getByRole("button", { name: /进入课堂/ }));
    fireEvent.click(
      within(first.container).getByRole("button", { name: /开启设备并加入/ }),
    );
    fireEvent.click(
      within(second.container).getByRole("button", { name: /开启设备并加入/ }),
    );

    await waitFor(() => {
      expect(within(first.container).getByText(/课堂进行中/)).toBeTruthy();
    });
    fireEvent.click(
      within(first.container).getByRole("button", { name: /离开连接/ }),
    );

    expect(within(first.container).getByText(/课堂大厅/)).toBeTruthy();
    expect(
      within(first.container).getByRole("button", { name: /开启设备并加入/ }),
    ).toBeTruthy();
  });

  it("打开会议大厅但尚未入会时不会累计会议时长", () => {
    vi.useFakeTimers();
    try {
      render(<Home />);
      enterLiveMeeting();

      act(() => {
        vi.advanceTimersByTime(5000);
      });

      expect(screen.getByText(/课堂大厅 · 00:00:00/)).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("未入会且没有媒体轨道时禁用录制入口", () => {
    render(<Home />);
    enterLiveMeeting();
    expect(screen.getByRole("button", { name: /录制/ })).toHaveProperty(
      "disabled",
      true,
    );
  });

  it("主导航会标记当前页面并清除旧页面状态", () => {
    render(<Home />);
    const homeNav = screen.getByRole("button", { name: "会议首页" });
    const replayNav = screen.getByRole("button", { name: "课堂回放" });

    expect(homeNav.getAttribute("aria-current")).toBe("page");
    expect(replayNav.getAttribute("aria-current")).toBeNull();

    fireEvent.click(replayNav);

    expect(replayNav.getAttribute("aria-current")).toBe("page");
    expect(homeNav.getAttribute("aria-current")).toBeNull();
  });

  it("主导航切换时会关闭全局搜索浮层", () => {
    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: "搜索" }));
    expect(screen.getByRole("dialog", { name: "全局搜索" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "课堂回放" }));

    expect(screen.queryByRole("dialog", { name: "全局搜索" })).toBeNull();
    expect(screen.getByRole("heading", { name: "课堂回放" })).toBeTruthy();
  });

  it("个人资料入口会打开可操作菜单并支持 Escape 关闭", () => {
    render(<Home />);
    const profileButton = screen.getByRole("button", { name: /林老师/ });

    expect(profileButton.getAttribute("aria-expanded")).toBe("false");
    expect(profileButton.getAttribute("aria-controls")).toBe("profile-menu");
    fireEvent.click(profileButton);

    const menu = screen.getByRole("menu", { name: "个人菜单" });
    expect(profileButton.getAttribute("aria-expanded")).toBe("true");
    expect(menu.id).toBe("profile-menu");
    const menuItems = within(menu).getAllByRole("menuitem");
    expect(menuItems).toHaveLength(2);
    expect(menuItems[0].textContent).toContain("个人资料");
    expect(menuItems[1].textContent).toContain("账号状态");
    expect(document.activeElement).toBe(menuItems[0]);
    fireEvent.keyDown(menuItems[0], { key: "ArrowDown" });
    expect(document.activeElement).toBe(menuItems[1]);
    fireEvent.keyDown(menuItems[1], { key: "Home" });
    expect(document.activeElement).toBe(menuItems[0]);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("menu", { name: "个人菜单" })).toBeNull();
    expect(profileButton.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(profileButton);
  });

  it("全局工具浮层与个人菜单保持互斥", () => {
    render(<Home />);
    const profileButton = screen.getByRole("button", { name: /林老师/ });
    const searchButton = screen.getByRole("button", { name: "搜索" });

    profileButton.focus();
    fireEvent.click(profileButton);
    expect(screen.getByRole("menu", { name: "个人菜单" })).toBeTruthy();
    searchButton.focus();
    fireEvent.click(searchButton);
    expect(screen.queryByRole("menu", { name: "个人菜单" })).toBeNull();
    expect(screen.getByRole("dialog", { name: "全局搜索" })).toBeTruthy();

    profileButton.focus();
    fireEvent.click(profileButton);
    expect(screen.queryByRole("dialog", { name: "全局搜索" })).toBeNull();
    expect(screen.getByRole("menu", { name: "个人菜单" })).toBeTruthy();
    expect(document.activeElement).toBe(
      within(screen.getByRole("menu", { name: "个人菜单" })).getAllByRole(
        "menuitem",
      )[0],
    );
  });

  it("打开全局搜索时不会把焦点恢复到已关闭的个人菜单", () => {
    render(<Home />);
    const profileButton = screen.getByRole("button", { name: /林老师/ });
    const searchButton = screen.getByRole("button", { name: "搜索" });

    fireEvent.click(profileButton);
    fireEvent.click(searchButton);

    expect(document.activeElement).toBe(
      within(screen.getByRole("dialog", { name: "全局搜索" })).getByRole(
        "textbox",
        { name: "全局搜索" },
      ),
    );
  });

  it("个人菜单动作会关闭菜单并反馈当前本地演示边界", () => {
    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: /林老师/ }));
    fireEvent.click(
      screen.getByRole("menuitem", { name: /个人资料/ }),
    );

    expect(screen.queryByRole("menu", { name: "个人菜单" })).toBeNull();
    expect(screen.getByRole("status").textContent).toContain(
      "个人资料暂未接入",
    );
  });

  it("从首页日程进入会议时会保留日程标题", () => {
    render(<Home />);
    fireEvent.click(
      screen.getByRole("button", { name: "打开毕业设计中期答辩" }),
    );

    expect(screen.getByText("毕业设计中期答辩")).toBeTruthy();
    expect(screen.getByLabelText("本地会议房间号")).toHaveProperty(
      "value",
      "563294108",
    );
    expect(screen.getByText(/会议大厅/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "结束会议" })).toBeTruthy();
  });

  it("首页课堂入口会恢复固定课堂房间号", () => {
    render(<Home />);
    fireEvent.click(
      screen.getByRole("button", { name: "打开毕业设计中期答辩" }),
    );
    fireEvent.click(screen.getByRole("button", { name: /返回会议首页/ }));
    fireEvent.click(screen.getByRole("button", { name: /进入课堂/ }));

    expect(screen.getByLabelText("本地会议房间号")).toHaveProperty(
      "value",
      "821406233",
    );
  });

  it("会议中心默认显示首页当前课堂日程", () => {
    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: "我的会议" }));

    expect(screen.getByText("数字媒体技术 · 课堂")).toBeTruthy();
    expect(screen.getByText("教学楼 A302 · 48 人")).toBeTruthy();
    expect(screen.getByText("3 场")).toBeTruthy();
  });

  it("从会议中心进入会中后返回按钮会回到真正的会议首页", () => {
    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: "我的会议" }));
    const meetingRow = screen
      .getByText("数字媒体技术 · 课堂")
      .closest("article");
    expect(meetingRow).toBeTruthy();

    fireEvent.click(
      within(meetingRow as HTMLElement).getByRole("button", {
        name: "进入会议",
      }),
    );
    expect(screen.getByText("本地 WebRTC 实验")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "返回会议首页" }));

    expect(screen.getByText("下午好，林老师")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "会议首页" }).getAttribute("aria-current"),
    ).toBe("page");
  });

  it("快速会议会分配独立的本机房间号", () => {
    render(<Home />);
    fireEvent.click(
      screen.getByRole("button", { name: "打开毕业设计中期答辩" }),
    );
    fireEvent.click(screen.getByRole("button", { name: /返回会议首页/ }));
    fireEvent.click(screen.getByRole("button", { name: /快速会议/ }));
    fireEvent.click(screen.getByRole("button", { name: /开始会议/ }));

    const roomInput = screen.getByLabelText("本地会议房间号");
    expect(roomInput).toHaveProperty("value", expect.stringMatching(/^\d{9}$/));
    expect(roomInput).not.toHaveProperty("value", "563294108");
  });

  it("缺少 randomUUID 时仍能渲染并创建合法本机房间号", () => {
    const cryptoObject = globalThis.crypto as Crypto;
    const originalRandomUUID = cryptoObject.randomUUID;
    Object.defineProperty(cryptoObject, "randomUUID", {
      configurable: true,
      value: undefined,
    });

    try {
      render(<Home />);
      fireEvent.click(screen.getByRole("button", { name: /快速会议/ }));
      fireEvent.click(screen.getByRole("button", { name: /开始会议/ }));

      expect(screen.getByLabelText("本地会议房间号")).toHaveProperty(
        "value",
        expect.stringMatching(/^\d{9}$/),
      );
    } finally {
      Object.defineProperty(cryptoObject, "randomUUID", {
        configurable: true,
        value: originalRandomUUID,
      });
    }
  });

  it("缺少 randomUUID 时上传资料仍能生成本地资料标识", () => {
    const cryptoObject = globalThis.crypto as Crypto;
    const originalRandomUUID = cryptoObject.randomUUID;
    Object.defineProperty(cryptoObject, "randomUUID", {
      configurable: true,
      value: undefined,
    });

    try {
      render(<Home />);
      fireEvent.click(screen.getByRole("button", { name: "会议资料" }));
      const input = screen.getByLabelText("选择要上传的资料") as HTMLInputElement;
      const file = new File(["demo"], "本地课件.pdf", {
        type: "application/pdf",
      });
      fireEvent.change(input, { target: { files: [file] } });
      expect(screen.getByText("本地课件.pdf")).toBeTruthy();
    } finally {
      Object.defineProperty(cryptoObject, "randomUUID", {
        configurable: true,
        value: originalRandomUUID,
      });
    }
  });

  it("快速会议结束后会进入已结束会议并在刷新后保留", async () => {
    const first = render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: /快速会议/ }));
    fireEvent.click(screen.getByRole("button", { name: /开始会议/ }));
    fireEvent.click(screen.getByRole("button", { name: "结束会议" }));
    fireEvent.click(screen.getByRole("button", { name: /返回会议首页/ }));
    fireEvent.click(screen.getByRole("button", { name: "我的会议" }));
    fireEvent.click(screen.getByRole("button", { name: /已结束/ }));

    await waitFor(() => {
      expect(screen.getByText("林老师的快速会议")).toBeTruthy();
    });
    const todayOverview = screen.getByText("今天的会议").closest("article");
    expect(todayOverview?.textContent).toContain("4 场");
    expect(screen.getByText("9 场")).toBeTruthy();
    const localMeetingRow = screen
      .getByText("林老师的快速会议")
      .closest("article");
    expect(localMeetingRow).toBeTruthy();
    fireEvent.click(
      within(localMeetingRow as HTMLElement).getByRole("button", {
        name: "查看报告",
      }),
    );
    expect(screen.getByText("本地会话参与")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /返回会议首页/ }));
    fireEvent.click(screen.getByRole("button", { name: "我的会议" }));
    fireEvent.click(screen.getByRole("button", { name: /已结束/ }));
    expect(
      JSON.parse(window.localStorage.getItem("learning-meetings-created") ?? "[]")[0]
        .status,
    ).toBe("past");

    first.unmount();
    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: "我的会议" }));
    fireEvent.click(screen.getByRole("button", { name: /已结束/ }));
    await waitFor(() => {
      expect(screen.getByText("林老师的快速会议")).toBeTruthy();
    });
    const restoredLocalMeetingRow = screen
      .getByText("林老师的快速会议")
      .closest("article");
    expect(restoredLocalMeetingRow).toBeTruthy();
    fireEvent.click(
      within(restoredLocalMeetingRow as HTMLElement).getByRole("button", {
        name: "查看报告",
      }),
    );
    expect(screen.getByText("本地会话参与")).toBeTruthy();
  });

  it("保存本机会议状态时会合并其他同源窗口新增的历史", () => {
    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: /快速会议/ }));
    fireEvent.click(screen.getByRole("button", { name: /开始会议/ }));

    window.localStorage.setItem(
      "learning-meetings-created",
      JSON.stringify([
        {
          id: "local-created-from-another-window",
          day: "27",
          month: "今天",
          time: "刚刚",
          title: "另一窗口创建的会议",
          detail: "本机创建 · 仅当前演示可见",
          type: "普通会议",
          accent: "blue",
          roomId: "918273645",
          mode: "normal",
          autoMute: true,
          generateReport: true,
          reportGenerated: true,
          status: "past",
        },
      ]),
    );
    fireEvent.click(screen.getByRole("button", { name: "结束会议" }));
    fireEvent.click(screen.getByRole("button", { name: /返回会议首页/ }));
    fireEvent.click(screen.getByRole("button", { name: "我的会议" }));
    fireEvent.click(screen.getByRole("button", { name: /已结束/ }));

    expect(screen.getByText("另一窗口创建的会议")).toBeTruthy();
    expect(screen.getByText("林老师的快速会议")).toBeTruthy();
  });

  it("从会中返回首页时会释放本地媒体资源", async () => {
    render(<Home />);
    enterLiveMeeting();
    fireEvent.click(screen.getByRole("button", { name: /开启设备并加入/ }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /离开连接/ })).toBeTruthy();
    });
    const stream = await getUserMediaMock.mock.results[0].value;
    const tracks = stream.getTracks() as unknown as Array<{ stopped: boolean }>;

    fireEvent.click(screen.getByRole("button", { name: "返回会议首页" }));

    expect(screen.getByText("下午好，林老师")).toBeTruthy();
    expect(tracks.every((track) => track.stopped)).toBe(true);
  });

  it("普通会议会使用会议语义并隐藏课堂互动入口", () => {
    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: /快速会议/ }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /开始会议/ }));

    expect(screen.getByText(/会议大厅/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "结束会议" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /课堂互动/ })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "结束会议" }));
    expect(screen.getByText("会议已结束 · 报告已生成")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "会议互动" })).toBeTruthy();
    expect(screen.getByText("本次会议未发布互动活动")).toBeTruthy();
    expect(JSON.parse(window.localStorage.getItem("learning-meetings-created") ?? "[]")[0])
      .toMatchObject({
        detail: "本机创建 · 仅当前演示可见",
        type: "普通会议",
        accent: "blue",
        mode: "normal",
      });
  });

  it("快速会议切换为课堂后历史记录会保留课程模式元数据", async () => {
    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: /快速会议/ }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /课程课堂/ }));
    fireEvent.change(within(dialog).getByRole("combobox", { name: "课程" }), {
      target: { value: "interaction" },
    });
    fireEvent.change(within(dialog).getByRole("combobox", { name: "班级" }), {
      target: { value: "class2" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: /开始课堂/ }));
    fireEvent.click(screen.getByRole("button", { name: "结束课堂" }));

    const savedMeeting = JSON.parse(
      window.localStorage.getItem("learning-meetings-created") ?? "[]",
    )[0];
    expect(savedMeeting).toMatchObject({
      detail: "交互设计 · 2026 秋 · 2 班（46 人）",
      type: "课程课堂",
      accent: "green",
      mode: "class",
    });

    fireEvent.click(screen.getByRole("button", { name: /返回会议首页/ }));
    fireEvent.click(screen.getByRole("button", { name: "我的会议" }));
    fireEvent.click(screen.getByRole("button", { name: /已结束/ }));
    await waitFor(() => expect(screen.getByText("交互设计 · 2026 秋 · 2 班（46 人）")).toBeTruthy());
    const row = screen.getByText("数字媒体技术 · 第 3 讲").closest("article");
    expect(row).toBeTruthy();
    expect(within(row as HTMLElement).getByText("课程课堂")).toBeTruthy();
  });

  it("创建弹窗的报告选项会随会议模式切换文案", () => {
    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: /快速会议/ }));
    const dialog = screen.getByRole("dialog");

    expect(
      within(dialog).getByText("自动生成会议报告"),
    ).toBeTruthy();
    expect(within(dialog).queryByText("自动生成课堂报告")).toBeNull();

    fireEvent.click(within(dialog).getByRole("button", { name: /课程课堂/ }));
    expect(within(dialog).getByText("自动生成课堂报告")).toBeTruthy();
    expect(within(dialog).queryByText("自动生成会议报告")).toBeNull();
  });

  it("创建弹窗切换会议模式时会保留已填写的主题", () => {
    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: /快速会议/ }));
    const dialog = screen.getByRole("dialog");
    const title = within(dialog).getByRole("textbox", { name: "会议主题" });
    fireEvent.change(title, { target: { value: "毕业答辩专场" } });

    fireEvent.click(within(dialog).getByRole("button", { name: /课程课堂/ }));
    expect(title).toHaveProperty("value", "毕业答辩专场");
    fireEvent.click(within(dialog).getByRole("button", { name: /普通会议/ }));
    expect(title).toHaveProperty("value", "毕业答辩专场");
  });

  it("普通会议成员面板只显示本地窗口且不提供课堂控制", () => {
    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: /快速会议/ }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /开始会议/ }));

    const membersButton = screen.getByRole("button", { name: /成员 1/ });
    fireEvent.click(membersButton);

    expect(screen.getByText("本地实验只显示当前页面和同源远端窗口。")).toBeTruthy();
    expect(screen.getByText("林老师")).toBeTruthy();
    expect(screen.getByText("本地窗口 · 未开启设备")).toBeTruthy();
    expect(screen.queryByText("周雨桐")).toBeNull();
    expect(screen.queryByText("已到")).toBeNull();
    expect(screen.queryByRole("button", { name: "全体静音" })).toBeNull();
    expect(screen.queryByRole("button", { name: "林老师麦克风" })).toBeNull();
  });

  it("普通会议收到同源远端流后成员按钮和面板显示两个窗口", async () => {
    render(
      <>
        <Home />
        <Home />
      </>,
    );
    fireEvent.click(screen.getAllByRole("button", { name: /快速会议/ })[0]);
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: /开始会议/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: /快速会议/ }));
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: /开始会议/ }),
    );

    const roomInputs = screen.getAllByLabelText(
      "本地会议房间号",
    ) as HTMLInputElement[];
    fireEvent.change(roomInputs[1], { target: { value: roomInputs[0].value } });
    const joinButtons = screen.getAllByRole("button", { name: /开启设备并加入/ });
    fireEvent.click(joinButtons[0]);
    fireEvent.click(joinButtons[1]);
    await waitFor(() =>
      expect(screen.getAllByText("点对点连接已建立")).toHaveLength(2),
    );

    const remoteTrack = new FakeMediaStreamTrack("video", "remote-camera");
    const remoteStream = new FakeMediaStream([remoteTrack]);
    act(() => {
      FakePeerConnection.instances[0]?.ontrack?.({
        track: remoteTrack,
        streams: [remoteStream],
      } as unknown as RTCTrackEvent);
    });

    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: /成员 2/ })).toHaveLength(1),
    );
    const membersButtons = screen.getAllByRole("button", { name: /成员 2/ });
    fireEvent.click(membersButtons[0]);
    expect(screen.getAllByText("远端参会者")).toHaveLength(2);
    expect(screen.getByText("同源窗口 · 已加入")).toBeTruthy();
    expect(screen.queryByText("周雨桐")).toBeNull();
    expect(screen.queryByRole("button", { name: "全体静音" })).toBeNull();
  });

  it("复制会议号会写入剪贴板并提示成功", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    render(<Home />);
    enterLiveMeeting();

    fireEvent.click(screen.getByRole("button", { name: "复制会议号" }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("821406233");
      expect(screen.getByRole("status").textContent).toContain("会议号已复制");
    });
  });

  it("剪贴板不可用时提示手动复制会议号", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    render(<Home />);
    enterLiveMeeting();

    fireEvent.click(screen.getByRole("button", { name: "复制会议号" }));

    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toContain(
        "复制失败，请手动复制会议号",
      );
    });
  });

  it("将媒体权限失败展示为可恢复的页面错误", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    getUserMediaMock.mockRejectedValueOnce(
      new DOMException("permission denied", "NotAllowedError"),
    );
    render(<Home />);
    enterLiveMeeting();

    fireEvent.click(screen.getByRole("button", { name: /开启设备并加入/ }));

    await waitFor(() => {
      expect(
        screen.getByText("无法使用摄像头或麦克风，请检查浏览器权限和设备占用情况。"),
      ).toBeTruthy();
    });
    expect(screen.getByRole("button", { name: /开启设备并加入/ })).toBeTruthy();
  });

  it("会中设备异常会显示可操作的 alert 并允许重新加入", async () => {
    render(<Home />);
    enterLiveMeeting();
    fireEvent.click(screen.getByRole("button", { name: /开启设备并加入/ }));

    await waitFor(() => {
      expect(screen.getByText("等待另一位参会者")).toBeTruthy();
    });
    getDisplayMediaMock.mockRejectedValueOnce(
      new DOMException("display unavailable", "NotReadableError"),
    );

    fireEvent.click(screen.getByRole("button", { name: /共享屏幕/ }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("无法开始屏幕共享");
    fireEvent.click(within(alert).getByRole("button", { name: "重新加入" }));
    await waitFor(() => expect(screen.getByText("等待另一位参会者")).toBeTruthy());
    expect(getUserMediaMock).toHaveBeenCalledTimes(2);
  });

  it("控制本地音视频并可离开连接", async () => {
    render(<Home />);
    enterLiveMeeting();
    fireEvent.click(screen.getByRole("button", { name: /开启设备并加入/ }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /静音/ })).not.toHaveProperty(
        "disabled",
        true,
      );
    });
    const micButton = screen.getByRole("button", { name: /静音/ });
    const cameraButton = screen.getByRole("button", { name: /关闭视频/ });
    expect(micButton.getAttribute("aria-pressed")).toBe("true");
    expect(cameraButton.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(micButton);
    fireEvent.click(cameraButton);
    expect(screen.getByRole("button", { name: /解除静音/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /开启视频/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /解除静音/ }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("button", { name: /开启视频/ }).getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(screen.getByRole("button", { name: /离开连接/ }));
    expect(screen.getByText("摄像头尚未开启")).toBeTruthy();
    expect(screen.getByRole("button", { name: /开启设备并加入/ })).toBeTruthy();
    expect(screen.getByText(/课堂大厅/)).toBeTruthy();
  });

  it("普通离会会停止本地录制并丢弃当前会话媒体", async () => {
    render(<Home />);
    await joinLiveMeeting();
    fireEvent.click(screen.getByRole("button", { name: /录制/ }));
    expect(screen.getByRole("button", { name: /停止录制/ })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /离开连接/ }));

    expect(screen.getByText("本地 WebRTC 实验")).toBeTruthy();
    expect(screen.queryByText("本地录制已生成")).toBeNull();
  });

  it("会议标题按钮离会时也会清理本地录制", async () => {
    render(<Home />);
    await joinLiveMeeting();
    fireEvent.click(screen.getByRole("button", { name: /录制/ }));

    fireEvent.click(screen.getByRole("button", { name: "返回会议首页" }));

    expect(screen.getByText("下午好，林老师")).toBeTruthy();
    expect(screen.queryByText("本地录制已生成")).toBeNull();
  });

  it("录制器异常后结束会议不会保留虚假的回放入口", async () => {
    render(<Home />);
    await joinLiveMeeting();
    fireEvent.click(screen.getByRole("button", { name: /录制/ }));

    act(() => {
      FakeMediaRecorder.instances[0]?.fail();
    });
    expect(
      await screen.findByText("本地录制发生异常，请重新开始录制。"),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "结束课堂" }));

    expect(screen.getByText("本次课堂未开启录制")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "查看本地录制状态" })).toBeNull();
  });

  it("屏幕共享期间关闭摄像头仍保留共享预览", async () => {
    render(<Home />);
    enterLiveMeeting();
    fireEvent.click(screen.getByRole("button", { name: /开启设备并加入/ }));
    await waitFor(() => expect(screen.getByText("等待另一位参会者")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: /共享屏幕/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: /停止共享/ })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /关闭视频/ }));

    const localVideo = document.querySelector(".local-video-tile video");
    expect(localVideo).toBeTruthy();
    expect(localVideo?.classList.contains("video-hidden")).toBe(false);
    expect(screen.queryByText("摄像头已关闭")).toBeNull();
    expect(screen.getByText("正在共享")).toBeTruthy();
  });

  it("关闭入会麦克风时仍会采集轨道，但初始保持静音", async () => {
    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: /快速会议/ }));
    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByRole("checkbox", { name: /入会自动静音/ }),
    ).toHaveProperty("checked", true);
    fireEvent.click(within(dialog).getByRole("button", { name: /开始会议/ }));
    fireEvent.click(screen.getByRole("button", { name: /开启设备并加入/ }));

    await waitFor(() => {
      expect(getUserMediaMock).toHaveBeenCalledWith({
        audio: true,
        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      expect(screen.getByRole("button", { name: /解除静音/ })).toBeTruthy();
    });
    const stream = await getUserMediaMock.mock.results[0].value;
    expect(stream.getAudioTracks()[0].enabled).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: /解除静音/ }));
    expect(stream.getAudioTracks()[0].enabled).toBe(true);
  });

  it("新会议不会继承上一场会议关闭报告的设置", () => {
    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: /快速会议/ }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(
      within(dialog).getByRole("checkbox", { name: /自动生成会议报告/ }),
    );
    fireEvent.click(within(dialog).getByRole("button", { name: /开始会议/ }));
    fireEvent.click(screen.getByRole("button", { name: "结束会议" }));
    expect(screen.getByRole("button", { name: "立即生成报告" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /返回会议首页/ }));
    enterLiveMeeting();
    fireEvent.click(screen.getByRole("button", { name: "结束课堂" }));

    expect(screen.queryByRole("button", { name: "立即生成报告" })).toBeNull();
    expect(screen.getByText("课堂活跃度")).toBeTruthy();
  });

  it("未开启的媒体轨道不会显示为可切换状态", async () => {
    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: /加入会议/ }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(
      within(dialog).getByRole("checkbox", { name: "开启麦克风" }),
    );
    fireEvent.click(
      within(dialog).getByRole("checkbox", { name: "开启摄像头" }),
    );
    fireEvent.click(within(dialog).getByRole("button", { name: /加入会议/ }));
    fireEvent.click(screen.getByRole("button", { name: /开启设备并加入/ }));

    await waitFor(() => expect(screen.getByText("等待另一位参会者")).toBeTruthy());
    expect(getUserMediaMock).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /解除静音/ })).toHaveProperty(
      "disabled",
      true,
    );
    expect(screen.getByRole("button", { name: /开启视频/ })).toHaveProperty(
      "disabled",
      true,
    );
    expect(screen.getByRole("button", { name: /共享屏幕/ })).toHaveProperty(
      "disabled",
      true,
    );
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.getByRole("button", { name: /离开连接/ })).toBeTruthy();
    expect(screen.getByText("当前未开启音视频，请离开后重新加入并开启媒体。")).toBeTruthy();
  });

  it("媒体轨道结束后会禁用对应的会中控制", async () => {
    render(<Home />);
    enterLiveMeeting();
    fireEvent.click(screen.getByRole("button", { name: /开启设备并加入/ }));
    await waitFor(() => expect(screen.getByText("等待另一位参会者")).toBeTruthy());

    const stream = await getUserMediaMock.mock.results[0].value;
    stream.getAudioTracks()[0].end();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /解除静音/ })).toHaveProperty(
        "disabled",
        true,
      ),
    );
  });

  it("创建和加入弹窗支持表单提交且模式切换不会误提交", () => {
    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: /加入会议/ }));
    const joinDialog = screen.getByRole("dialog");
    fireEvent.submit(joinDialog);
    expect(screen.getByText("本地 WebRTC 实验")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "返回会议首页" }));
    fireEvent.click(screen.getByRole("button", { name: /快速会议/ }));
    const createDialog = screen.getByRole("dialog");
    fireEvent.click(within(createDialog).getByRole("button", { name: /课程课堂/ }));
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("创建会议模式和课堂互动选择会暴露当前按下状态", () => {
    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: /快速会议/ }));
    const dialog = screen.getByRole("dialog");
    const classMode = within(dialog).getByRole("button", { name: /课程课堂/ });
    const normalMode = within(dialog).getByRole("button", { name: /普通会议/ });
    expect(classMode.getAttribute("aria-pressed")).toBe("false");
    expect(normalMode.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(classMode);
    expect(classMode.getAttribute("aria-pressed")).toBe("true");
    expect(normalMode.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(within(dialog).getByRole("button", { name: /开始课堂/ }));
    fireEvent.click(screen.getByRole("button", { name: /课堂互动/ }));
    const checkin = screen.getByRole("button", { name: /课堂签到/ });
    const poll = screen.getByRole("button", { name: /快速投票/ });
    expect(checkin.getAttribute("aria-pressed")).toBe("true");
    expect(poll.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(poll);
    expect(checkin.getAttribute("aria-pressed")).toBe("false");
    expect(poll.getAttribute("aria-pressed")).toBe("true");
  });

  it("会中布局和侧栏按钮会同步选择与展开状态", () => {
    render(<Home />);
    enterLiveMeeting();

    const gridButton = screen.getByRole("button", { name: "宫格" });
    const focusButton = screen.getByRole("button", { name: "主讲" });
    expect(gridButton.getAttribute("aria-pressed")).toBe("true");
    expect(focusButton.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(focusButton);
    expect(gridButton.getAttribute("aria-pressed")).toBe("false");
    expect(focusButton.getAttribute("aria-pressed")).toBe("true");

    const membersButton = screen.getByRole("button", { name: /成员 48/ });
    expect(membersButton.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(membersButton);
    expect(membersButton.getAttribute("aria-expanded")).toBe("true");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(membersButton.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("button", { name: "关闭侧栏" })).toBeNull();
  });

  it("会中更多设置会展示当前实验能力和边界", () => {
    render(<Home />);
    enterLiveMeeting();
    const settings = screen.getByRole("button", { name: "更多设置" });
    expect(settings.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(settings);

    expect(screen.getByLabelText("会议设置")).toBeTruthy();
    expect(document.activeElement).toBe(
      screen.getByRole("menuitem", { name: "查看本地实验边界" }),
    );
    expect(screen.getByText("布局、设备和屏幕共享可在当前页面直接调整。")).toBeTruthy();
    fireEvent.click(screen.getByRole("menuitem", { name: "查看本地实验边界" }));
    expect(screen.queryByLabelText("会议设置")).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("同源本地窗口");
  });

  it("会中按 Escape 会关闭更多设置菜单", () => {
    render(<Home />);
    enterLiveMeeting();
    fireEvent.click(screen.getByRole("button", { name: "更多设置" }));
    expect(screen.getByLabelText("会议设置")).toBeTruthy();

    fireEvent.keyDown(window, { key: "Escape" });

    expect(screen.queryByLabelText("会议设置")).toBeNull();
    expect(
      screen.getByRole("button", { name: "更多设置" }).getAttribute("aria-expanded"),
    ).toBe("false");
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "更多设置" }),
    );
  });

  it("会中设置菜单通过菜单项关闭后恢复更多设置按钮焦点", () => {
    render(<Home />);
    enterLiveMeeting();
    const settings = screen.getByRole("button", { name: "更多设置" });
    fireEvent.click(settings);
    fireEvent.click(screen.getByRole("menuitem", { name: "查看本地实验边界" }));

    expect(screen.queryByLabelText("会议设置")).toBeNull();
    expect(document.activeElement).toBe(settings);
  });

  it("会中侧栏通过关闭按钮、Escape 和标签切换恢复对应触发按钮焦点", () => {
    render(<Home />);
    enterLiveMeeting();
    const membersButton = screen.getByRole("button", { name: /成员 48/ });
    const chatButton = screen.getByRole("button", { name: /聊天/ });

    fireEvent.click(membersButton);
    fireEvent.click(screen.getByRole("button", { name: "关闭侧栏" }));
    expect(document.activeElement).toBe(membersButton);

    fireEvent.click(chatButton);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(document.activeElement).toBe(chatButton);

    fireEvent.click(membersButton);
    fireEvent.click(screen.getByRole("tab", { name: "聊天" }));
    fireEvent.click(screen.getByRole("button", { name: "关闭侧栏" }));
    expect(document.activeElement).toBe(chatButton);
  });

  it("会中侧栏标签会暴露当前选中状态和对应内容面板", () => {
    render(<Home />);
    enterLiveMeeting();
    fireEvent.click(screen.getByRole("button", { name: /成员 48/ }));

    const membersTab = screen.getByRole("tab", { name: "成员" });
    const chatTab = screen.getByRole("tab", { name: "聊天" });
    expect(membersTab.getAttribute("aria-selected")).toBe("true");
    expect(membersTab.getAttribute("aria-controls")).toBe(
      "meeting-panel-content-members",
    );
    expect(membersTab.getAttribute("tabindex")).toBe("0");
    expect(chatTab.getAttribute("tabindex")).toBe("-1");
    expect(screen.getByRole("tabpanel").id).toBe("meeting-panel-content-members");

    fireEvent.click(chatTab);
    expect(chatTab.getAttribute("aria-selected")).toBe("true");
    expect(membersTab.getAttribute("aria-selected")).toBe("false");
    expect(chatTab.getAttribute("tabindex")).toBe("0");
    expect(membersTab.getAttribute("tabindex")).toBe("-1");
    expect(screen.getByRole("tabpanel").id).toBe("meeting-panel-content-chat");
    expect(screen.getByRole("tabpanel").getAttribute("aria-labelledby")).toBe(
      "meeting-panel-tab-chat",
    );
  });

  it("会中侧栏标签支持方向键和 Home/End 键切换", () => {
    render(<Home />);
    enterLiveMeeting();
    fireEvent.click(screen.getByRole("button", { name: /成员 48/ }));

    const membersTab = screen.getByRole("tab", { name: "成员" });
    const chatTab = screen.getByRole("tab", { name: "聊天" });
    const activitiesTab = screen.getByRole("tab", { name: "课堂互动" });

    membersTab.focus();
    fireEvent.keyDown(membersTab, { key: "ArrowRight" });
    expect(document.activeElement).toBe(chatTab);
    expect(chatTab.getAttribute("aria-selected")).toBe("true");

    fireEvent.keyDown(chatTab, { key: "End" });
    expect(document.activeElement).toBe(activitiesTab);
    expect(activitiesTab.getAttribute("aria-selected")).toBe("true");

    fireEvent.keyDown(activitiesTab, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(chatTab);
    expect(chatTab.getAttribute("aria-selected")).toBe("true");

    fireEvent.keyDown(chatTab, { key: "Home" });
    expect(document.activeElement).toBe(membersTab);
    expect(membersTab.getAttribute("aria-selected")).toBe("true");
  });

  it("我的会议可以按主题、课程或类型筛选", () => {
    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: "我的会议" }));

    const search = screen.getByRole("textbox", { name: "搜索会议" });
    expect(screen.getByText("毕业设计中期答辩")).toBeTruthy();
    fireEvent.change(search, { target: { value: "教研" } });

    expect(screen.getByText("新学期教学研讨会")).toBeTruthy();
    expect(screen.queryByText("毕业设计中期答辩")).toBeNull();
  });

  it("即将开始的会议更多操作可以复制会议号并进入会议", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: "我的会议" }));

    const row = screen.getByText("毕业设计中期答辩").closest("article");
    expect(row).toBeTruthy();
    const rowQueries = within(row as HTMLElement);
    fireEvent.click(rowQueries.getByRole("button", { name: "更多操作" }));
    const menu = screen.getByRole("menu", { name: "毕业设计中期答辩更多操作" });
    expect(within(menu).getByRole("menuitem", { name: "进入会议" })).toBeTruthy();

    fireEvent.click(within(menu).getByRole("menuitem", { name: "复制会议号" }));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("563294108");
      expect(screen.getByRole("status").textContent).toContain("会议号已复制");
    });
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("会议可以复制本地邀请引用并在打开后预填会议号", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const first = render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: "我的会议" }));

    const row = screen.getByText("毕业设计中期答辩").closest("article");
    expect(row).toBeTruthy();
    fireEvent.click(
      within(row as HTMLElement).getByRole("button", { name: "更多操作" }),
    );
    fireEvent.click(
      within(screen.getByRole("menu", { name: "毕业设计中期答辩更多操作" })).getByRole(
        "menuitem",
        { name: "复制本地邀请链接" },
      ),
    );

    let inviteLink = "";
    await waitFor(() => {
      inviteLink = writeText.mock.calls[0]?.[0] as string;
      expect(inviteLink).toContain("share=meeting");
      expect(inviteLink).toContain("room=563294108");
      expect(screen.getByRole("status").textContent).toContain(
        "本地会议邀请引用已复制",
      );
    });

    const inviteUrl = new URL(inviteLink);
    first.unmount();
    window.history.replaceState({}, "", `${inviteUrl.pathname}${inviteUrl.search}`);
    render(<Home />);

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("textbox", { name: "会议号" })).toHaveProperty(
      "value",
      "563294108",
    );
    expect(screen.getByRole("status").textContent).toContain("已打开本地会议邀请");
  });

  it("课堂邀请引用会保留课堂模式但不会自动请求媒体权限", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const first = render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: "我的会议" }));

    const row = screen.getByText("数字媒体技术 · 课堂").closest("article");
    expect(row).toBeTruthy();
    fireEvent.click(
      within(row as HTMLElement).getByRole("button", { name: "更多操作" }),
    );
    fireEvent.click(
      within(screen.getByRole("menu", { name: "数字媒体技术 · 课堂更多操作" })).getByRole(
        "menuitem",
        { name: "复制本地邀请链接" },
      ),
    );

    let inviteLink = "";
    await waitFor(() => {
      inviteLink = writeText.mock.calls[0]?.[0] as string;
      expect(inviteLink).toContain("mode=class");
    });
    const inviteUrl = new URL(inviteLink);
    first.unmount();
    window.history.replaceState({}, "", `${inviteUrl.pathname}${inviteUrl.search}`);
    render(<Home />);

    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /加入会议/ }));
    expect(screen.getByText(/课堂大厅/)).toBeTruthy();
    expect(getUserMediaMock).not.toHaveBeenCalled();
  });

  it("非法本地会议邀请引用不会打开加入弹窗", async () => {
    window.history.replaceState(
      {},
      "",
      `/?share=meeting&title=${encodeURIComponent("无效邀请")}&room=12345`,
    );
    render(<Home />);

    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByText("下午好，林老师")).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("已结束的会议更多操作可以查看报告，菜单支持单开和 Escape 关闭", () => {
    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: "我的会议" }));
    fireEvent.click(screen.getByRole("button", { name: /已结束/ }));

    const firstRow = screen.getByText("交互设计 · 课程导学").closest("article");
    const secondRow = screen.getByText("课程组备课会").closest("article");
    expect(firstRow).toBeTruthy();
    expect(secondRow).toBeTruthy();
    fireEvent.click(within(firstRow as HTMLElement).getByRole("button", { name: "更多操作" }));
    expect(screen.getByRole("menu", { name: "交互设计 · 课程导学更多操作" })).toBeTruthy();

    fireEvent.click(within(secondRow as HTMLElement).getByRole("button", { name: "更多操作" }));
    expect(screen.queryByRole("menu", { name: "交互设计 · 课程导学更多操作" })).toBeNull();
    const secondMenu = screen.getByRole("menu", { name: "课程组备课会更多操作" });
    expect(within(secondMenu).getByRole("menuitem", { name: "查看报告" })).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("会议更多菜单关联触发按钮并在关闭后恢复焦点", () => {
    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: "我的会议" }));
    fireEvent.click(screen.getByRole("button", { name: /已结束/ }));

    const row = screen
      .getByText("课程组备课会")
      .closest("article") as HTMLElement;
    const trigger = within(row).getByRole("button", { name: "更多操作" });
    const menuId = trigger.getAttribute("aria-controls");
    expect(menuId).toBeTruthy();

    fireEvent.click(trigger);
    expect(screen.getByRole("menu", { name: "课程组备课会更多操作" }).id).toBe(
      menuId,
    );
    expect(trigger.getAttribute("aria-expanded")).toBe("true");

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("menu", { name: "课程组备课会更多操作" })).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("会议更多菜单打开后支持方向键和 Home/End 导航", () => {
    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: "我的会议" }));
    const row = screen
      .getByText("数字媒体技术 · 课堂")
      .closest("article") as HTMLElement;
    const trigger = within(row).getByRole("button", { name: "更多操作" });

    fireEvent.click(trigger);
    const menu = screen.getByRole("menu", {
      name: "数字媒体技术 · 课堂更多操作",
    });
    const items = within(menu).getAllByRole("menuitem");
    expect(items).toHaveLength(3);
    expect(document.activeElement).toBe(items[0]);

    fireEvent.keyDown(items[0], { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[1]);
    fireEvent.keyDown(items[1], { key: "End" });
    expect(document.activeElement).toBe(items[2]);
    fireEvent.keyDown(items[2], { key: "ArrowUp" });
    expect(document.activeElement).toBe(items[1]);
    fireEvent.keyDown(items[1], { key: "Home" });
    expect(document.activeElement).toBe(items[0]);
  });

  it("本机会议删除前需要确认，并会清理历史与报告待办", async () => {
    const roomId = "936217521";
    const title = "待删除的本机课堂";
    window.localStorage.setItem(
      "learning-meetings-created",
      JSON.stringify([
        {
          id: "local-created-delete-test",
          day: "28",
          month: "今天",
          time: "刚刚",
          title,
          detail: "本机创建 · 仅当前演示可见",
          type: "课程课堂",
          accent: "green",
          roomId,
          mode: "class",
          autoMute: true,
          generateReport: true,
          reportGenerated: true,
          status: "past",
          reportSnapshot: {
            durationSeconds: 42,
            chatMessageCount: 1,
            publishedActivityCount: 0,
            publishedActivityIds: [],
            recordingAvailable: true,
            participantCount: 1,
            participantName: "林老师",
            meetingMode: "class",
          },
        },
      ]),
    );
    window.localStorage.setItem(
      `learning-meeting-report-todos:${roomId}`,
      JSON.stringify([
        {
          id: "interaction-summary",
          title: "整理课堂互动摘要",
          detail: "归档活动结果到会议资料",
          done: false,
        },
      ]),
    );

    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: "我的会议" }));
    fireEvent.click(screen.getByRole("button", { name: /已结束/ }));
    const row = await waitFor(() => {
      const meetingRow = screen.getByText(title).closest("article");
      expect(meetingRow).toBeTruthy();
      return meetingRow as HTMLElement;
    });
    fireEvent.click(within(row).getByRole("button", { name: "更多操作" }));
    fireEvent.click(
      within(screen.getByRole("menu", { name: `${title}更多操作` })).getByRole(
        "menuitem",
        { name: "删除本机记录" },
      ),
    );

    const dialog = screen.getByRole("dialog", { name: "删除这场本机会议？" });
    expect(document.activeElement).toBe(
      within(dialog).getByRole("button", { name: "保留记录" }),
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "删除这场本机会议？" })).toBeNull();
    expect(document.activeElement).toBe(
      within(screen.getByText(title).closest("article") as HTMLElement).getByRole(
        "button",
        { name: "更多操作" },
      ),
    );

    fireEvent.click(
      within(screen.getByText(title).closest("article") as HTMLElement).getByRole(
        "button",
        { name: "更多操作" },
      ),
    );
    fireEvent.click(
      within(screen.getByRole("menu", { name: `${title}更多操作` })).getByRole(
        "menuitem",
        { name: "删除本机记录" },
      ),
    );
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "删除这场本机会议？" })).getByRole(
        "button",
        { name: "确认删除" },
      ),
    );

    await waitFor(() => {
      expect(screen.queryByText(title)).toBeNull();
      expect(screen.getByRole("status").textContent).toContain(
        "已删除本机会议，并清理录制与课后待办",
      );
    });
    expect(JSON.parse(window.localStorage.getItem("learning-meetings-created") ?? "null")).toEqual([]);
    expect(window.localStorage.getItem(`learning-meeting-report-todos:${roomId}`)).toBeNull();
  });

  it("本机会议删除写入失败时保留记录并提示", async () => {
    const roomId = "936217522";
    const title = "删除失败的本机会议";
    window.localStorage.setItem(
      "learning-meetings-created",
      JSON.stringify([
        {
          id: "local-created-delete-failure",
          day: "28",
          month: "今天",
          time: "刚刚",
          title,
          detail: "本机创建 · 仅当前演示可见",
          type: "普通会议",
          accent: "blue",
          roomId,
          mode: "normal",
          status: "upcoming",
        },
      ]),
    );
    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: "我的会议" }));
    const row = await waitFor(() => {
      const meetingRow = screen.getByText(title).closest("article");
      expect(meetingRow).toBeTruthy();
      return meetingRow as HTMLElement;
    });
    fireEvent.click(within(row).getByRole("button", { name: "更多操作" }));
    fireEvent.click(
      within(screen.getByRole("menu", { name: `${title}更多操作` })).getByRole(
        "menuitem",
        { name: "删除本机记录" },
      ),
    );
    const setItemSpy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("storage unavailable");
      });
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "删除这场本机会议？" })).getByRole(
        "button",
        { name: "确认删除" },
      ),
    );

    await waitFor(() => {
      expect(screen.getByText(title)).toBeTruthy();
      expect(screen.getByRole("status").textContent).toContain(
        "无法删除本机会议记录",
      );
    });
    setItemSpy.mockRestore();
  });

  // getItem 抛错必须与“键不存在”区分：抛错是失败（保留记录并提示），
  // 键不存在才视为已删除。共享存储层两者都返回 null，所以删除路径刻意直读。
  it("本机会议删除读取抛错时保留记录并提示", async () => {
    const roomId = "936217530";
    const title = "读取抛错的本机会议";
    window.localStorage.setItem(
      "learning-meetings-created",
      JSON.stringify([
        {
          id: "local-created-read-throw",
          day: "28",
          month: "今天",
          time: "刚刚",
          title,
          detail: "本机创建 · 仅当前演示可见",
          type: "普通会议",
          accent: "blue",
          roomId,
          mode: "normal",
          status: "upcoming",
        },
      ]),
    );
    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: "我的会议" }));
    const row = await waitFor(() => {
      const meetingRow = screen.getByText(title).closest("article");
      expect(meetingRow).toBeTruthy();
      return meetingRow as HTMLElement;
    });
    fireEvent.click(within(row).getByRole("button", { name: "更多操作" }));
    fireEvent.click(
      within(screen.getByRole("menu", { name: `${title}更多操作` })).getByRole(
        "menuitem",
        { name: "删除本机记录" },
      ),
    );
    const getItemSpy = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("storage unavailable");
      });
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "删除这场本机会议？" })).getByRole(
        "button",
        { name: "确认删除" },
      ),
    );

    await waitFor(() => {
      expect(screen.getByText(title)).toBeTruthy();
      expect(screen.getByRole("status").textContent).toContain(
        "无法删除本机会议记录",
      );
    });
    getItemSpy.mockRestore();
  });

  it("录制清理异常时删除流程仍会结束并提示部分失败", async () => {
    const roomId = "936217523";
    const title = "录制清理异常的本机会议";
    window.localStorage.setItem(
      "learning-meetings-created",
      JSON.stringify([
        {
          id: "local-created-recording-delete-failure",
          day: "28",
          month: "今天",
          time: "刚刚",
          title,
          detail: "本机创建 · 仅当前演示可见",
          type: "普通会议",
          accent: "blue",
          roomId,
          mode: "normal",
          status: "past",
        },
      ]),
    );
    const originalIndexedDb = window.indexedDB;
    Object.defineProperty(window, "indexedDB", {
      configurable: true,
      value: {},
    });
    const removeRecordingSpy = vi
      .spyOn(localRecordingStorage, "removeLocalRecording")
      .mockRejectedValue(new Error("recording cleanup failed"));
    try {
      render(<Home />);
      fireEvent.click(screen.getByRole("button", { name: "我的会议" }));
      fireEvent.click(screen.getByRole("button", { name: /已结束/ }));
      const row = await waitFor(() => {
        const meetingRow = screen.getByText(title).closest("article");
        expect(meetingRow).toBeTruthy();
        return meetingRow as HTMLElement;
      });
      fireEvent.click(within(row).getByRole("button", { name: "更多操作" }));
      fireEvent.click(
        within(screen.getByRole("menu", { name: `${title}更多操作` })).getByRole(
          "menuitem",
          { name: "删除本机记录" },
        ),
      );
      fireEvent.click(
        within(screen.getByRole("dialog", { name: "删除这场本机会议？" })).getByRole(
          "button",
          { name: "确认删除" },
        ),
      );

      await waitFor(() => {
        expect(removeRecordingSpy).toHaveBeenCalledWith(roomId);
        expect(screen.queryByRole("dialog", { name: "删除这场本机会议？" })).toBeNull();
        expect(screen.getByRole("status").textContent).toContain(
          "部分本地附属数据清理失败",
        );
      });
      expect(screen.queryByText(title)).toBeNull();
    } finally {
      removeRecordingSpy.mockRestore();
      Object.defineProperty(window, "indexedDB", {
        configurable: true,
        value: originalIndexedDb,
      });
    }
  });

  it("预约会议进入会中时会保留自定义标题", async () => {
    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: /预约会议/ }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByRole("textbox", { name: "会议主题" }), {
      target: { value: "交互设计期末评审" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: /确认预约/ }));

    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: "进入会议" }).length).toBeGreaterThan(0);
    });
    fireEvent.click(screen.getAllByRole("button", { name: "进入会议" })[0]);

    expect(screen.getByText("交互设计期末评审")).toBeTruthy();
  });

  it("预约后首页日程和会议中心摘要会同步更新", async () => {
    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: /预约会议/ }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByRole("textbox", { name: "会议主题" }), {
      target: { value: "预约后的专题讨论" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: /确认预约/ }));

    await waitFor(() => {
      expect(screen.getByText("预约后的专题讨论")).toBeTruthy();
      expect(screen.getByText("3 场")).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "会议首页" }));
    expect(screen.getByText("预约后的专题讨论")).toBeTruthy();
    expect(screen.getByText("已预约")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "我的会议" }));
    fireEvent.click(screen.getByRole("button", { name: "取消预约" }));
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "取消这场预约？" })).getByRole(
        "button",
        { name: "确认取消预约" },
      ),
    );
    expect(screen.queryByText("预约后的专题讨论")).toBeNull();
  });

  it("新建预约会分配独立房间号并在重新加载后保持", async () => {
    const first = render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: /预约会议/ }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByRole("textbox", { name: "会议主题" }), {
      target: { value: "独立房间预约" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: /确认预约/ }));

    await waitFor(() => expect(screen.getByText("独立房间预约")).toBeTruthy());
    const stored = JSON.parse(
      window.localStorage.getItem("learning-meeting-scheduled") ?? "{}",
    ) as { roomId?: string };
    expect(stored.roomId).toMatch(/^\d{6,}$/);
    expect(stored.roomId).not.toBe("821406233");
    expect(stored.roomId).not.toBe("563294108");
    expect(stored.roomId).not.toBe("704915286");

    first.unmount();
    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: "我的会议" }));
    await waitFor(() => expect(screen.getByText("独立房间预约")).toBeTruthy());
    fireEvent.click(screen.getAllByRole("button", { name: "进入会议" })[0]);

    expect(screen.getByLabelText("本地会议房间号")).toHaveProperty(
      "value",
      stored.roomId,
    );
  });

  it("创建会议会避开已保存的本机历史房间号", () => {
    window.localStorage.setItem(
      "learning-meetings-created",
      JSON.stringify([
        {
          id: "local-created-collision",
          day: "28",
          month: "今天",
          time: "刚刚",
          title: "历史占用房间",
          detail: "本机创建 · 仅当前演示可见",
          type: "普通会议",
          accent: "blue",
          roomId: "000000000",
          mode: "normal",
          status: "past",
        },
        {
          id: "local-created-fallback-collision",
          day: "28",
          month: "今天",
          time: "刚刚",
          title: "回退占用房间",
          detail: "本机创建 · 仅当前演示可见",
          type: "普通会议",
          accent: "blue",
          roomId: "936217504",
          mode: "normal",
          status: "past",
        },
      ]),
    );
    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: /快速会议/ }));
    fireEvent.click(screen.getByRole("button", { name: /开始会议/ }));

    expect(screen.getByLabelText("本地会议房间号")).not.toHaveProperty(
      "value",
      "000000000",
    );
    expect(screen.getByLabelText("本地会议房间号")).not.toHaveProperty(
      "value",
      "936217504",
    );
  });

  it("已结束会议按房间号去重，避免旧本机数据重复展示", async () => {
    window.localStorage.setItem(
      "learning-meetings-created",
      JSON.stringify([
        {
          id: "local-created-duplicate",
          day: "28",
          month: "今天",
          time: "刚刚",
          title: "重复房间的本机历史",
          detail: "本机创建 · 仅当前演示可见",
          type: "普通会议",
          accent: "blue",
          roomId: "248631907",
          mode: "normal",
          status: "past",
        },
      ]),
    );
    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: "我的会议" }));
    fireEvent.click(screen.getByRole("button", { name: /已结束/ }));

    await waitFor(() => expect(screen.getByText("重复房间的本机历史")).toBeTruthy());
    expect(screen.queryByText("交互设计 · 课程导学")).toBeNull();
    expect(screen.getByText("8 场")).toBeTruthy();
    expect(screen.getByRole("button", { name: /已结束/ }).textContent).toContain(
      "2",
    );
  });

  it("累计会议时长会计入本机快照并按房间号去重", async () => {
    const sharedRoomId = "900000001";
    const snapshot = {
      durationSeconds: 3600,
      chatMessageCount: 0,
      publishedActivityCount: 0,
      publishedActivityIds: [],
      recordingAvailable: false,
      participantCount: 1,
      participantName: "林老师",
      meetingMode: "normal",
    };
    window.localStorage.setItem(
      "learning-meetings-created",
      JSON.stringify([
        {
          id: "local-created-duration",
          day: "28",
          month: "今天",
          time: "刚刚",
          title: "本机时长历史",
          detail: "本机创建 · 仅当前演示可见",
          type: "普通会议",
          accent: "blue",
          roomId: sharedRoomId,
          mode: "normal",
          status: "past",
          reportSnapshot: snapshot,
        },
      ]),
    );
    window.localStorage.setItem(
      "learning-meeting-scheduled",
      JSON.stringify({
        id: "local-scheduled-duration",
        day: "29",
        month: "8月",
        time: "09:30–10:30",
        title: "同房间预约历史",
        detail: "线上会议 · 仅邀请成员",
        type: "普通会议",
        accent: "blue",
        roomId: sharedRoomId,
        mode: "normal",
        status: "past",
        reportSnapshot: { ...snapshot, durationSeconds: 7200 },
      }),
    );

    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: "我的会议" }));

    await waitFor(() => expect(screen.getByText("13.6 小时")).toBeTruthy());
  });

  it("历史会议查看报告时会显示该会议标题", () => {
    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: "我的会议" }));
    fireEvent.click(screen.getByRole("button", { name: /已结束/ }));
    fireEvent.click(screen.getAllByRole("button", { name: "查看报告" })[0]);

    expect(screen.getByRole("heading", { name: "交互设计 · 课程导学" })).toBeTruthy();
    expect(screen.getByText("较上次 +6")).toBeTruthy();
    expect(screen.getByText("4 项活动")).toBeTruthy();
    expect(screen.getByText("历史课堂回放（演示数据）")).toBeTruthy();
    expect(screen.getByText("字幕与章节为演示数据，真实媒体接入后才可播放。")).toBeTruthy();
    expect(screen.getByText("发布第 3 讲课堂回放（演示）")).toBeTruthy();
    expect(
      screen.getByText("发布动作未接入，仅保留历史演示待办"),
    ).toBeTruthy();
    expect(screen.getByText("01:38:42")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /查看完整名单/ }));
    expect(screen.getByLabelText("完整出勤名单")).toBeTruthy();
    expect(screen.getByText("赵欣然")).toBeTruthy();
  });

  it("历史普通会议报告会保留会议语义并隐藏课程名单", () => {
    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: "我的会议" }));
    fireEvent.click(screen.getByRole("button", { name: /已结束/ }));
    fireEvent.click(screen.getAllByRole("button", { name: "查看报告" })[1]);

    expect(screen.getByRole("heading", { name: "课程组备课会" })).toBeTruthy();
    expect(screen.getByText("会议互动")).toBeTruthy();
    expect(screen.getByText("参会率 100%")).toBeTruthy();
    expect(screen.getByText("历史会议回放（演示数据）")).toBeTruthy();
    expect(screen.queryByText("历史课堂回放（演示数据）")).toBeNull();
    expect(screen.queryByRole("heading", { name: "课堂互动" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /查看参会摘要/ }));
    expect(screen.getByLabelText("会议参会摘要")).toBeTruthy();
    expect(screen.getByText("参会成员")).toBeTruthy();
    expect(screen.queryByText("周雨桐")).toBeNull();
  });

  it("无匹配会议时提供明确反馈", () => {
    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: "我的会议" }));
    fireEvent.change(screen.getByRole("textbox", { name: "搜索会议" }), {
      target: { value: "不存在的会议" },
    });

    expect(screen.getByText("没有找到相关会议")).toBeTruthy();
    expect(
      screen.getByText("试试搜索会议主题、课程或会议类型。"),
    ).toBeTruthy();
  });

  it("加入会议使用输入的会议号进入本地房间", () => {
    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: /加入会议/ }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByRole("textbox", { name: "会议号" }), {
      target: { value: "999 888 777" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: /加入会议/ }));

    expect(screen.getByLabelText("本地会议房间号")).toHaveProperty(
      "value",
      "999888777",
    );
  });

  it("加入名称会贯通到本地视频标签和聊天消息", async () => {
    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: /加入会议/ }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByRole("textbox", { name: "入会名称" }), {
      target: { value: "陈同学" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: /加入会议/ }));
    expect(screen.getByText("陈同学 · 我")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /开启设备并加入/ }));
    await waitFor(() => expect(screen.getByText("等待另一位参会者")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /聊天/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "聊天消息" }), {
      target: { value: "大家好" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    expect(screen.getByText("陈同学")).toBeTruthy();
    expect(screen.getByText("大家好")).toBeTruthy();
  });

  it("空白入会名称会回退为访客", () => {
    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: /加入会议/ }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByRole("textbox", { name: "入会名称" }), {
      target: { value: "   " },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: /加入会议/ }));

    expect(screen.getByText("访客 · 我")).toBeTruthy();
  });

  it("创建和加入弹窗会准确说明真实权限与本地传输边界", () => {
    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: /快速会议/ }));
    expect(
      screen.getByText(
        "开启会议后会请求浏览器设备权限；媒体仅在同源本地窗口间传输。",
      ),
    ).toBeTruthy();
    expect(
      screen.queryByText("当前为交互原型，不会真实调用摄像头或麦克风。"),
    ).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));

    fireEvent.click(screen.getByRole("button", { name: /加入会议/ }));
    expect(
      screen.getByText(
        "进入会议后会请求浏览器设备权限；媒体仅在同源本地窗口间传输。",
      ),
    ).toBeTruthy();
  });

  it("加入会议的设备开关会驱动实际媒体采集约束", async () => {
    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: /加入会议/ }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(
      within(dialog).getByRole("checkbox", { name: "开启麦克风" }),
    );
    fireEvent.click(
      within(dialog).getByRole("checkbox", { name: "开启摄像头" }),
    );
    fireEvent.click(within(dialog).getByRole("button", { name: /加入会议/ }));
    fireEvent.click(screen.getByRole("button", { name: /开启设备并加入/ }));

    await waitFor(() => {
      expect(screen.getByText("等待另一位参会者")).toBeTruthy();
    });
    expect(getUserMediaMock).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /解除静音/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /开启视频/ })).toBeTruthy();
  });

  it("主动加入的媒体偏好不会泄漏到首页日程入口", async () => {
    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: /加入会议/ }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(
      within(dialog).getByRole("checkbox", { name: "开启摄像头" }),
    );
    fireEvent.click(within(dialog).getByRole("button", { name: /加入会议/ }));
    fireEvent.click(screen.getByRole("button", { name: "返回会议首页" }));

    getUserMediaMock.mockClear();
    fireEvent.click(
      screen.getByRole("button", { name: "打开毕业设计中期答辩" }),
    );
    fireEvent.click(screen.getByRole("button", { name: /开启设备并加入/ }));

    await waitFor(() => {
      expect(screen.getByText("等待另一位参会者")).toBeTruthy();
    });
    expect(getUserMediaMock).toHaveBeenCalledWith({
      audio: true,
      video: { width: { ideal: 1280 }, height: { ideal: 720 } },
    });
  });

  it("拒绝不足 6 位的加入会议号并保留弹窗", () => {
    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: /加入会议/ }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByRole("textbox", { name: "会议号" }), {
      target: { value: "123" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: /加入会议/ }));

    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("至少 6 位");
  });

  it("拒绝超过 18 位的加入会议号并保留弹窗", () => {
    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: /加入会议/ }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByRole("textbox", { name: "会议号" }), {
      target: { value: "1".repeat(19) },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: /加入会议/ }));

    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("不能超过 18 位");
  });

  it("拒绝包含非法字符的加入会议号并保留弹窗", () => {
    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: /加入会议/ }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByRole("textbox", { name: "会议号" }), {
      target: { value: "123abc456" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: /加入会议/ }));

    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("只能包含数字");
  });

  it("大厅聊天不会为超长房间号创建信令频道", async () => {
    render(<Home />);
    enterLiveMeeting();
    fireEvent.change(screen.getByLabelText("本地会议房间号"), {
      target: { value: "1".repeat(19) },
    });
    fireEvent.click(screen.getByRole("button", { name: /聊天/ }));
    broadcastToRoom(`learning-meeting-chat:${"1".repeat(19)}`, {
      type: "chat",
      text: "不应进入大厅消息",
      senderName: "异常窗口",
    });

    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByText("不应进入大厅消息")).toBeNull();
  });

  it("大厅聊天不会把非法房间号压缩成另一个合法频道", async () => {
    render(<Home />);
    enterLiveMeeting();
    fireEvent.change(screen.getByLabelText("本地会议房间号"), {
      target: { value: "123abc456" },
    });
    fireEvent.click(screen.getByRole("button", { name: "复制会议号" }));
    expect(screen.getByRole("status").textContent).toContain("只能包含数字");
    fireEvent.click(screen.getByRole("button", { name: /聊天/ }));
    broadcastToRoom("learning-meeting-chat:123456", {
      type: "chat",
      text: "不应进入压缩后的消息",
      senderName: "异常窗口",
    });

    await act(async () => {
      await Promise.resolve();
    });
    expect(getBroadcastChannels("learning-meeting-chat:123456")).toHaveLength(0);
    expect(screen.queryByText("不应进入压缩后的消息")).toBeNull();
  });

  it("会议弹窗打开时聚焦关闭按钮并支持 Esc 关闭", () => {
    render(<Home />);
    const trigger = screen.getByRole("button", { name: /加入会议/ });
    trigger.focus();
    fireEvent.click(trigger);

    const dialog = screen.getByRole("dialog");
    const closeButton = within(dialog).getByRole("button", { name: "关闭" });
    expect(document.activeElement).toBe(closeButton);
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(
      within(dialog).getByRole("button", { name: /加入会议/ }),
    );
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("保存预约记录并在重新渲染后恢复", async () => {
    const first = render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: /预约会议/ }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /确认预约/ }));

    await waitFor(() => {
      expect(screen.getByText("数字媒体技术 · 第 3 讲")).toBeTruthy();
    });
    expect(JSON.parse(window.localStorage.getItem("learning-meeting-scheduled") ?? "{}")).toMatchObject({
      title: "数字媒体技术 · 第 3 讲",
      type: "课程课堂",
    });

    first.unmount();
    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: "我的会议" }));
    await waitFor(() => {
      expect(screen.getByText("数字媒体技术 · 第 3 讲")).toBeTruthy();
    });
  });

  it("预约记录使用表单中的主题、课程和班级", async () => {
    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: /预约会议/ }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByRole("textbox", { name: "会议主题" }), {
      target: { value: "交互设计期末评审" },
    });
    fireEvent.change(within(dialog).getByRole("combobox", { name: "课程" }), {
      target: { value: "interaction" },
    });
    fireEvent.change(within(dialog).getByRole("combobox", { name: "班级" }), {
      target: { value: "class2" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: /确认预约/ }));

    await waitFor(() => {
      expect(screen.getByText("交互设计期末评审")).toBeTruthy();
      expect(screen.getByText("交互设计 · 2026 秋 · 2 班（46 人）")).toBeTruthy();
    });
    expect(JSON.parse(window.localStorage.getItem("learning-meeting-scheduled") ?? "{}"))
      .toMatchObject({
        title: "交互设计期末评审",
        detail: "交互设计 · 2026 秋 · 2 班（46 人）",
        type: "课程课堂",
      });
  });

  it("预约会议结束后会转入已结束列表并在刷新后保留", async () => {
    const first = render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: /预约会议/ }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByRole("textbox", { name: "会议主题" }), {
      target: { value: "可结束的预约课堂" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: /确认预约/ }));

    await waitFor(() => expect(screen.getByText("可结束的预约课堂")).toBeTruthy());
    const scheduledRow = screen
      .getByText("可结束的预约课堂")
      .closest("article");
    expect(scheduledRow).toBeTruthy();
    fireEvent.click(
      within(scheduledRow as HTMLElement).getByRole("button", {
        name: "进入会议",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "结束课堂" }));
    expect(screen.getByText("课堂已结束 · 报告已生成")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /返回会议首页/ }));
    fireEvent.click(screen.getByRole("button", { name: "我的会议" }));
    expect(screen.getByText("9 场")).toBeTruthy();
    expect(screen.queryByText("可结束的预约课堂")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /已结束/ }));
    expect(screen.getByText("可结束的预约课堂")).toBeTruthy();
    expect(
      JSON.parse(window.localStorage.getItem("learning-meeting-scheduled") ?? "{}").status,
    ).toBe("past");

    first.unmount();
    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: "我的会议" }));
    fireEvent.click(screen.getByRole("button", { name: /已结束/ }));
    await waitFor(() => expect(screen.getByText("可结束的预约课堂")).toBeTruthy());
  });

  it("预约历史手动生成报告后会保存生成状态", async () => {
    const first = render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: /预约会议/ }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(
      within(dialog).getByRole("checkbox", { name: /自动生成课堂报告/ }),
    );
    fireEvent.click(within(dialog).getByRole("button", { name: /确认预约/ }));
    await waitFor(() => expect(screen.getByText("数字媒体技术 · 第 3 讲")).toBeTruthy());
    const scheduledRow = screen
      .getByText("数字媒体技术 · 第 3 讲")
      .closest("article");
    expect(scheduledRow).toBeTruthy();
    fireEvent.click(
      within(scheduledRow as HTMLElement).getByRole("button", {
        name: "进入会议",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "结束课堂" }));
    fireEvent.click(screen.getByRole("button", { name: /返回会议首页/ }));
    fireEvent.click(screen.getByRole("button", { name: "我的会议" }));
    fireEvent.click(screen.getByRole("button", { name: /已结束/ }));
    const pastRow = screen
      .getByText("数字媒体技术 · 第 3 讲")
      .closest("article");
    expect(pastRow).toBeTruthy();
    fireEvent.click(
      within(pastRow as HTMLElement).getByRole("button", { name: "查看报告" }),
    );
    expect(screen.getByRole("button", { name: "立即生成报告" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "立即生成报告" }));

    expect(
      JSON.parse(window.localStorage.getItem("learning-meeting-scheduled") ?? "{}").reportGenerated,
    ).toBe(true);
    first.unmount();
    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: "我的会议" }));
    fireEvent.click(screen.getByRole("button", { name: /已结束/ }));
    await waitFor(() => expect(screen.getByText("数字媒体技术 · 第 3 讲")).toBeTruthy());
    const restoredPastRow = screen
      .getByText("数字媒体技术 · 第 3 讲")
      .closest("article");
    expect(restoredPastRow).toBeTruthy();
    fireEvent.click(
      within(restoredPastRow as HTMLElement).getByRole("button", {
        name: "查看报告",
      }),
    );
    expect(screen.queryByRole("button", { name: "立即生成报告" })).toBeNull();
  });

  it("兼容旧版本保存的预约布尔标记", async () => {
    window.localStorage.setItem("learning-meeting-scheduled", "true");
    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: "我的会议" }));

    await waitFor(() => {
      expect(screen.getByText("数字媒体技术 · 第 3 讲")).toBeTruthy();
    });
  });

  it("兼容缺少房间号的旧版预约记录", async () => {
    window.localStorage.setItem(
      "learning-meeting-scheduled",
      JSON.stringify({
        id: "local-scheduled-meeting",
        day: "29",
        month: "8月",
        time: "09:30–10:30",
        title: "旧版预约会议",
        detail: "2026 秋 · 1 班 · 48 人",
        type: "课程课堂",
        accent: "green",
      }),
    );
    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: "我的会议" }));

    await waitFor(() => {
      expect(screen.getByText("旧版预约会议")).toBeTruthy();
    });
    fireEvent.click(screen.getAllByRole("button", { name: "进入会议" })[0]);

    expect(screen.getByLabelText("本地会议房间号")).toHaveProperty(
      "value",
      "821406233",
    );
  });

  it("恢复预约时会归一化错误选项并保留合法 false", async () => {
    window.localStorage.setItem(
      "learning-meeting-scheduled",
      JSON.stringify({
        id: "local-scheduled-meeting",
        day: "29",
        month: "8月",
        time: "09:30–10:30",
        title: "异常字段预约",
        detail: "线上会议 · 仅邀请成员",
        type: "普通会议",
        accent: "blue",
        roomId: "123456789",
        autoMute: "false",
        generateReport: 0,
      }),
    );
    const first = render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: "我的会议" }));

    await waitFor(() => expect(screen.getByText("异常字段预约")).toBeTruthy());
    fireEvent.click(screen.getAllByRole("button", { name: "进入会议" })[0]);
    fireEvent.click(screen.getByRole("button", { name: /开启设备并加入/ }));

    await waitFor(() => {
      expect(getUserMediaMock).toHaveBeenCalledWith({
        audio: true,
        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
      });
    });
    const mutedStream = await getUserMediaMock.mock.results[0].value;
    expect(mutedStream.getAudioTracks()[0].enabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "结束会议" }));
    expect(screen.queryByRole("button", { name: "立即生成报告" })).toBeNull();

    first.unmount();
    getUserMediaMock.mockClear();
    window.localStorage.setItem(
      "learning-meeting-scheduled",
      JSON.stringify({
        id: "local-scheduled-meeting",
        day: "29",
        month: "8月",
        time: "09:30–10:30",
        title: "合法关闭选项",
        detail: "线上会议 · 仅邀请成员",
        type: "普通会议",
        accent: "blue",
        roomId: "123456789",
        autoMute: false,
        generateReport: false,
      }),
    );
    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: "我的会议" }));
    await waitFor(() => expect(screen.getByText("合法关闭选项")).toBeTruthy());
    fireEvent.click(screen.getAllByRole("button", { name: "进入会议" })[0]);
    fireEvent.click(screen.getByRole("button", { name: /开启设备并加入/ }));
    await waitFor(() => {
      expect(getUserMediaMock).toHaveBeenCalledWith({
        audio: true,
        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
      });
    });
    fireEvent.click(screen.getByRole("button", { name: "结束会议" }));
    expect(screen.getByRole("button", { name: "立即生成报告" })).toBeTruthy();
  });

  it("可以取消本机预约并清理保存记录", async () => {
    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: /预约会议/ }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /确认预约/ }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "取消预约" })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "取消预约" }));
    expect(screen.getByRole("dialog", { name: "取消这场预约？" })).toBeTruthy();
    expect(screen.getByText("数字媒体技术 · 第 3 讲")).toBeTruthy();
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "取消这场预约？" })).getByRole(
        "button",
        { name: "确认取消预约" },
      ),
    );

    expect(screen.queryByText("数字媒体技术 · 第 3 讲")).toBeNull();
    expect(window.localStorage.getItem("learning-meeting-scheduled")).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("已取消本机预约");
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "我的会议" }),
    );
  });

  it("本机存储读取失败时首页仍能渲染", async () => {
    const getItemSpy = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("storage unavailable");
      });
    render(<Home />);

    expect(screen.getByText("下午好，林老师")).toBeTruthy();
    await waitFor(() => expect(getItemSpy).toHaveBeenCalled());
    getItemSpy.mockRestore();
  });

  it("超大的本机历史和预约数据会安全回退为无对应本地数据", async () => {
    window.localStorage.setItem(
      "learning-meetings-created",
      `[{"title":"${"x".repeat(1_000_001)}"}]`,
    );
    window.localStorage.setItem(
      "learning-meeting-scheduled",
      `{"title":"${"x".repeat(100_001)}"}`,
    );
    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: "我的会议" }));

    await waitFor(() => {
      expect(screen.queryByText("取消预约")).toBeNull();
      expect(screen.getByText("数字媒体技术 · 课堂")).toBeTruthy();
    });
  });

  it("本机历史和预约会忽略超过 18 位的房间号", async () => {
    const oversizedRoomId = "1".repeat(19);
    window.localStorage.setItem(
      "learning-meetings-created",
      JSON.stringify([
        {
          id: "oversized-local-room",
          day: "28",
          month: "今天",
          time: "刚刚",
          title: "超长房间号历史",
          detail: "本机创建 · 仅当前演示可见",
          type: "普通会议",
          accent: "blue",
          roomId: oversizedRoomId,
          mode: "normal",
          status: "upcoming",
        },
      ]),
    );
    window.localStorage.setItem(
      "learning-meeting-scheduled",
      JSON.stringify({
        id: "oversized-scheduled-room",
        day: "30",
        month: "8月",
        time: "16:00–17:00",
        title: "超长房间号预约",
        detail: "线上会议 · 仅邀请成员",
        type: "普通会议",
        accent: "blue",
        roomId: oversizedRoomId,
        mode: "normal",
        status: "upcoming",
      }),
    );
    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: "我的会议" }));

    await waitFor(() => {
      expect(screen.getByText("数字媒体技术 · 课堂")).toBeTruthy();
      expect(screen.queryByText("超长房间号历史")).toBeNull();
      expect(screen.queryByText("超长房间号预约")).toBeNull();
      expect(screen.queryByText("取消预约")).toBeNull();
    });
  });

  it("本机历史和预约会忽略空白或超过 120 字符的主题", async () => {
    window.localStorage.setItem(
      "learning-meetings-created",
      JSON.stringify([
        {
          id: "empty-title-local-meeting",
          day: "28",
          month: "今天",
          time: "刚刚",
          title: "   ",
          detail: "本机创建 · 仅当前演示可见",
          type: "普通会议",
          accent: "blue",
          roomId: "936217507",
          mode: "normal",
          status: "upcoming",
        },
        {
          id: "oversized-title-local-meeting",
          day: "28",
          month: "今天",
          time: "刚刚",
          title: "x".repeat(121),
          detail: "本机创建 · 仅当前演示可见",
          type: "普通会议",
          accent: "blue",
          roomId: "936217508",
          mode: "normal",
          status: "upcoming",
        },
      ]),
    );
    window.localStorage.setItem(
      "learning-meeting-scheduled",
      JSON.stringify({
        id: "empty-title-scheduled-meeting",
        day: "30",
        month: "8月",
        time: "16:00–17:00",
        title: " ",
        detail: "线上会议 · 仅邀请成员",
        type: "普通会议",
        accent: "blue",
        roomId: "936217509",
        mode: "normal",
        status: "upcoming",
      }),
    );
    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: "我的会议" }));

    await waitFor(() => {
      expect(screen.getByText("数字媒体技术 · 课堂")).toBeTruthy();
      expect(screen.queryByText("x".repeat(121))).toBeNull();
      expect(screen.queryByText("取消预约")).toBeNull();
    });
  });

  it("本机主题的原始长度不能被首尾空白绕过", async () => {
    const paddedTitle = ` ${"x".repeat(120)} `;
    window.localStorage.setItem(
      "learning-meetings-created",
      JSON.stringify([
        {
          id: "padded-title-local-meeting",
          day: "28",
          month: "今天",
          time: "刚刚",
          title: paddedTitle,
          detail: "本机创建 · 仅当前演示可见",
          type: "普通会议",
          accent: "blue",
          roomId: "936217513",
          mode: "normal",
          status: "upcoming",
        },
      ]),
    );
    window.localStorage.setItem(
      "learning-meeting-scheduled",
      JSON.stringify({
        id: "padded-title-scheduled-meeting",
        day: "30",
        month: "8月",
        time: "16:00–17:00",
        title: paddedTitle,
        detail: "线上会议 · 仅邀请成员",
        type: "普通会议",
        accent: "blue",
        roomId: "936217514",
        mode: "normal",
        status: "upcoming",
      }),
    );
    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: "我的会议" }));

    await waitFor(() => {
      expect(screen.getByText("数字媒体技术 · 课堂")).toBeTruthy();
      expect(screen.queryByText("x".repeat(120))).toBeNull();
      expect(screen.queryByText("取消预约")).toBeNull();
    });
  });

  it("本机历史和预约会忽略异常展示元数据", async () => {
    window.localStorage.setItem(
      "learning-meetings-created",
      JSON.stringify([
        {
          id: "x".repeat(129),
          day: "28",
          month: "今天",
          time: "刚刚",
          title: "异常 ID 历史",
          detail: "本机创建 · 仅当前演示可见",
          type: "普通会议",
          accent: "blue",
          roomId: "936217510",
          mode: "normal",
          status: "upcoming",
        },
        {
          id: "oversized-detail-local-meeting",
          day: "28",
          month: "今天",
          time: "刚刚",
          title: "异常详情历史",
          detail: "x".repeat(241),
          type: "普通会议",
          accent: "blue",
          roomId: "936217511",
          mode: "normal",
          status: "upcoming",
        },
      ]),
    );
    window.localStorage.setItem(
      "learning-meeting-scheduled",
      JSON.stringify({
        id: "oversized-time-scheduled-meeting",
        day: "30",
        month: "8月",
        time: "x".repeat(65),
        title: "异常时间预约",
        detail: "线上会议 · 仅邀请成员",
        type: "普通会议",
        accent: "blue",
        roomId: "936217512",
        mode: "normal",
        status: "upcoming",
      }),
    );
    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: "我的会议" }));

    await waitFor(() => {
      expect(screen.getByText("数字媒体技术 · 课堂")).toBeTruthy();
      expect(screen.queryByText("异常 ID 历史")).toBeNull();
      expect(screen.queryByText("异常详情历史")).toBeNull();
      expect(screen.queryByText("异常时间预约")).toBeNull();
      expect(screen.queryByText("取消预约")).toBeNull();
    });
  });

  it("本机历史恢复最多保留 20 条记录", async () => {
    window.localStorage.setItem(
      "learning-meetings-created",
      JSON.stringify(
        Array.from({ length: 21 }, (_, index) => ({
          id: `local-meeting-${index}`,
          day: "28",
          month: "今天",
          time: "刚刚",
          title: `本机历史 ${index}`,
          detail: "本机创建 · 仅当前演示可见",
          type: "普通会议",
          accent: "blue",
          roomId: String(936217520 + index),
          mode: "normal",
          status: "upcoming",
        })),
      ),
    );
    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: "我的会议" }));

    await waitFor(() => {
      expect(screen.getByText("本机历史 0")).toBeTruthy();
      expect(screen.getByText("本机历史 19")).toBeTruthy();
      expect(screen.queryByText("本机历史 20")).toBeNull();
    });
  });

  it("本机历史不会因无效前缀而丢弃后面的合法记录", async () => {
    const validMeeting = {
      id: "valid-after-invalid-prefix",
      day: "28",
      month: "今天",
      time: "刚刚",
      title: "无效前缀后的合法会议",
      detail: "本机创建 · 仅当前演示可见",
      type: "普通会议",
      accent: "blue",
      roomId: "936217521",
      mode: "normal",
      status: "upcoming",
    };
    window.localStorage.setItem(
      "learning-meetings-created",
      JSON.stringify([...Array.from({ length: 20 }, () => null), validMeeting]),
    );
    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: "我的会议" }));

    await waitFor(() =>
      expect(screen.getByText("无效前缀后的合法会议")).toBeTruthy(),
    );
  });

  it("本机历史写回时不会保留未知字段", async () => {
    window.localStorage.setItem(
      "learning-meetings-created",
      JSON.stringify([
        {
          id: "local-with-unknown-field",
          day: "28",
          month: "今天",
          time: "刚刚",
          title: "含未知字段的历史",
          detail: "本机创建 · 仅当前演示可见",
          type: "普通会议",
          accent: "blue",
          roomId: "936217513",
          mode: "normal",
          status: "upcoming",
          unknownField: "不应被写回",
          reportSnapshot: {
            durationSeconds: 12,
            chatMessageCount: 1,
            publishedActivityCount: 0,
            publishedActivityIds: [],
            recordingAvailable: false,
            participantCount: 1,
            participantName: "林老师",
            meetingMode: "normal",
            snapshotUnknownField: "不应被写回",
          },
        },
      ]),
    );
    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: "我的会议" }));
    await waitFor(() => expect(screen.getByText("含未知字段的历史")).toBeTruthy());

    const row = screen.getByText("含未知字段的历史").closest("article");
    fireEvent.click(
      within(row as HTMLElement).getByRole("button", { name: "进入会议" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "结束会议" }));

    const saved = JSON.parse(
      window.localStorage.getItem("learning-meetings-created") ?? "[]",
    )[0];
    expect(saved.unknownField).toBeUndefined();
    expect(saved.reportSnapshot.snapshotUnknownField).toBeUndefined();
  });

  it("本机预约写回时不会保留未知字段", async () => {
    window.localStorage.setItem(
      "learning-meeting-scheduled",
      JSON.stringify({
        id: "scheduled-with-unknown-field",
        day: "30",
        month: "8月",
        time: "16:00–17:00",
        title: "含未知字段的预约",
        detail: "线上会议 · 仅邀请成员",
        type: "普通会议",
        accent: "blue",
        roomId: "936217514",
        mode: "normal",
        status: "upcoming",
        unknownField: "不应被写回",
      }),
    );
    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: "我的会议" }));
    await waitFor(() => expect(screen.getByText("含未知字段的预约")).toBeTruthy());

    const row = screen.getByText("含未知字段的预约").closest("article");
    fireEvent.click(
      within(row as HTMLElement).getByRole("button", { name: "进入会议" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "结束会议" }));

    const saved = JSON.parse(
      window.localStorage.getItem("learning-meeting-scheduled") ?? "{}",
    );
    expect(saved.unknownField).toBeUndefined();
  });

  it("创建会议会拒绝过长主题并保留创建面板", () => {
    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: /快速会议/ }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByRole("textbox", { name: "会议主题" }), {
      target: { value: "x".repeat(121) },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: /开始会议/ }));

    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("主题不能超过 120");
  });

  it("本机存储写入失败时保留预约弹窗并提示", () => {
    const setItemSpy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("quota exceeded");
      });
    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: /预约会议/ }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /确认预约/ }));

    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("预约未保存");
    setItemSpy.mockRestore();
  });

  it("本机存储静默丢弃预约写入时不会伪造保存成功", () => {
    const setItemSpy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => undefined);
    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: /预约会议/ }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /确认预约/ }));

    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("预约未保存");
    setItemSpy.mockRestore();
  });

  it("快速会议历史写入失败时仍可入会并明确提示", () => {
    const setItemSpy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("quota exceeded");
      });
    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: /快速会议/ }));
    fireEvent.click(screen.getByRole("button", { name: /开始会议/ }));

    expect(screen.getByText("本地 WebRTC 实验")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain(
      "会议已开始，但本机历史未保存",
    );
    setItemSpy.mockRestore();
  });

  it("本机存储静默丢弃会议历史时仍可入会并明确提示", () => {
    const setItemSpy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => undefined);
    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: /快速会议/ }));
    fireEvent.click(screen.getByRole("button", { name: /开始会议/ }));

    expect(screen.getByText("本地 WebRTC 实验")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain(
      "会议已开始，但本机历史未保存",
    );
    setItemSpy.mockRestore();
  });

  it("会同步其他窗口写入的预约和本机会议历史", async () => {
    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: "我的会议" }));

    const localMeeting = {
      id: "external-local-meeting",
      day: "28",
      month: "今天",
      time: "刚刚",
      title: "其他窗口创建的会议",
      detail: "本机创建 · 仅当前演示可见",
      type: "普通会议",
      accent: "blue",
      roomId: "918273645",
      mode: "normal",
      status: "upcoming",
    };
    window.localStorage.setItem(
      "learning-meetings-created",
      JSON.stringify([localMeeting]),
    );
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "learning-meetings-created",
        newValue: JSON.stringify([localMeeting]),
      }),
    );
    await waitFor(() => expect(screen.getByText("其他窗口创建的会议")).toBeTruthy());

    window.localStorage.setItem("learning-meetings-created", "[]");
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "learning-meetings-created",
        newValue: "[]",
      }),
    );
    await waitFor(() => expect(screen.queryByText("其他窗口创建的会议")).toBeNull());

    const scheduledMeeting = {
      id: "external-scheduled-meeting",
      day: "30",
      month: "8月",
      time: "16:00–17:00",
      title: "其他窗口预约的会议",
      detail: "线上会议 · 仅邀请成员",
      type: "普通会议",
      accent: "blue",
      roomId: "918273646",
      mode: "normal",
      status: "upcoming",
    };
    window.localStorage.setItem(
      "learning-meeting-scheduled",
      JSON.stringify(scheduledMeeting),
    );
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "learning-meeting-scheduled",
        newValue: JSON.stringify(scheduledMeeting),
      }),
    );
    await waitFor(() => expect(screen.getByText("其他窗口预约的会议")).toBeTruthy());

    window.localStorage.removeItem("learning-meeting-scheduled");
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "learning-meeting-scheduled",
        newValue: null,
      }),
    );
    await waitFor(() => expect(screen.queryByText("其他窗口预约的会议")).toBeNull());
  });

  it("会同步其他窗口的回放发布状态", async () => {
    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: "课堂回放" }));

    const replayTitle = "第 3 讲 · 信息架构与导航设计";
    window.localStorage.setItem("learning-meeting-published-replay", replayTitle);
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "learning-meeting-published-replay",
        newValue: replayTitle,
      }),
    );
    await waitFor(() =>
      expect(screen.getByText("本地已发布")).toBeTruthy(),
    );

    window.localStorage.removeItem("learning-meeting-published-replay");
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "learning-meeting-published-replay",
        newValue: null,
      }),
    );
    await waitFor(() => expect(screen.getByText("刚刚生成")).toBeTruthy());
  });

  it("回放发布写入失败时会提示本机状态未保存", () => {
    const setItemSpy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("quota exceeded");
      });
    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: "课堂回放" }));
    fireEvent.click(screen.getByRole("button", { name: "标记为已发布" }));

    expect(screen.getByRole("status").textContent).toContain(
      "本机发布状态保存失败",
    );
    expect(screen.getByText("刚刚生成")).toBeTruthy();
    setItemSpy.mockRestore();
  });

  it("回放发布被本机存储静默丢弃时不会伪造持久化成功", () => {
    const setItemSpy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => undefined);
    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: "课堂回放" }));
    fireEvent.click(screen.getByRole("button", { name: "标记为已发布" }));

    expect(screen.getByRole("button", { name: "标记为已发布" })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain(
      "本机发布状态保存失败",
    );
    setItemSpy.mockRestore();
  });

  it("结束本机会议时历史写入失败会提示当前状态无法持久化", () => {
    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: /快速会议/ }));
    fireEvent.click(screen.getByRole("button", { name: /开始会议/ }));
    const setItemSpy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("quota exceeded");
      });

    fireEvent.click(screen.getByRole("button", { name: "结束会议" }));

    expect(screen.getByRole("status").textContent).toContain(
      "会议已结束，但本机历史状态保存失败",
    );
    setItemSpy.mockRestore();
  });

  it("手动生成本机历史报告时写入失败会提示状态未保存", () => {
    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: /快速会议/ }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(
      within(dialog).getByRole("checkbox", { name: /自动生成会议报告/ }),
    );
    fireEvent.click(within(dialog).getByRole("button", { name: /开始会议/ }));
    fireEvent.click(screen.getByRole("button", { name: "结束会议" }));
    expect(screen.getByRole("button", { name: "立即生成报告" })).toBeTruthy();

    const setItemSpy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("quota exceeded");
      });
    fireEvent.click(screen.getByRole("button", { name: "立即生成报告" }));

    expect(screen.getByText("本地会话参与")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain(
      "报告已生成，但本机历史状态保存失败",
    );
    setItemSpy.mockRestore();
  });

  it("本机存储删除失败时保留预约记录并提示", async () => {
    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: /预约会议/ }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /确认预约/ }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "取消预约" })).toBeTruthy();
    });

    const removeItemSpy = vi
      .spyOn(Storage.prototype, "removeItem")
      .mockImplementation(() => {
        throw new Error("storage unavailable");
      });
    fireEvent.click(screen.getByRole("button", { name: "取消预约" }));
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "取消这场预约？" })).getByRole(
        "button",
        { name: "确认取消预约" },
      ),
    );

    expect(screen.getByText("数字媒体技术 · 第 3 讲")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("无法取消预约");
    removeItemSpy.mockRestore();
  });

  it("本机存储静默忽略删除时保留预约记录并提示", async () => {
    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: /预约会议/ }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /确认预约/ }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "取消预约" })).toBeTruthy();
    });

    const removeItemSpy = vi
      .spyOn(Storage.prototype, "removeItem")
      .mockImplementation(() => undefined);
    fireEvent.click(screen.getByRole("button", { name: "取消预约" }));
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "取消这场预约？" })).getByRole(
        "button",
        { name: "确认取消预约" },
      ),
    );

    expect(screen.getByText("数字媒体技术 · 第 3 讲")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("无法取消预约");
    removeItemSpy.mockRestore();
  });

  it("成员面板可以切换单个成员并一键静音全体", () => {
    render(<Home />);
    enterLiveMeeting();
    fireEvent.click(screen.getByRole("button", { name: /成员 48/ }));

    const studentMic = screen.getByRole("button", { name: "周雨桐麦克风" });
    expect(studentMic.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(studentMic);
    expect(studentMic.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("status").textContent).toContain("周雨桐已解除静音");

    act(() => {
      fireEvent.click(studentMic);
      fireEvent.click(studentMic);
    });
    expect(studentMic.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("status").textContent).toContain("周雨桐已解除静音");

    fireEvent.click(screen.getByRole("button", { name: "全体静音" }));
    for (const name of [
      "林老师",
      "周雨桐",
      "许明哲",
      "陈一凡",
      "苏晓",
      "王子涵",
      "赵欣然",
    ]) {
      expect(
        screen
          .getByRole("button", { name: `${name}麦克风` })
          .getAttribute("aria-pressed"),
      ).toBe("false");
    }
    expect(screen.getByRole("status").textContent).toContain("全体已静音");
  });

  it("成员面板搜索会过滤姓名、身份和出勤状态", () => {
    render(<Home />);
    enterLiveMeeting();
    fireEvent.click(screen.getByRole("button", { name: /成员 48/ }));

    const search = screen.getByRole("textbox", { name: "搜索成员" });
    fireEvent.change(search, { target: { value: "迟到" } });
    expect(screen.getByText("苏晓")).toBeTruthy();
    expect(screen.queryByText("周雨桐")).toBeNull();

    fireEvent.change(search, { target: { value: "不存在" } });
    expect(screen.getByText("没有找到匹配成员")).toBeTruthy();
  });

  it("随机选人会从在线学生中产生具体结果", () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);
    render(<Home />);
    enterLiveMeeting();
    fireEvent.click(screen.getByRole("button", { name: /课堂互动/ }));
    fireEvent.click(screen.getByRole("button", { name: /随机选人/ }));
    fireEvent.click(screen.getByRole("button", { name: "随机抽取" }));

    expect(screen.getByText("周雨桐")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("周雨桐已被随机选中");
    randomSpy.mockRestore();
  });

  it("已发布课堂活动会保持状态并显示在会后报告", () => {
    render(<Home />);
    enterLiveMeeting();
    fireEvent.click(screen.getByRole("button", { name: /课堂互动/ }));
    fireEvent.click(screen.getByRole("button", { name: /快速投票/ }));
    const publishButton = screen.getByRole("button", { name: "发布活动" });
    fireEvent.click(publishButton);
    expect(
      screen
        .getByRole("button", { name: "已发布到课堂" })
        .getAttribute("aria-pressed"),
    ).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: /课堂签到/ }));
    fireEvent.click(screen.getByRole("button", { name: /快速投票/ }));
    expect(screen.getByRole("button", { name: "已发布到课堂" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "结束课堂" }));

    expect(screen.getByText("本次会中发布：快速投票")).toBeTruthy();
    expect(screen.getByText("1 项已发布")).toBeTruthy();
  });

  it("进入新会议时不会沿用上一场会议的活动发布记录", () => {
    render(<Home />);
    enterLiveMeeting();
    fireEvent.click(screen.getByRole("button", { name: /课堂互动/ }));
    fireEvent.click(screen.getByRole("button", { name: /快速投票/ }));
    fireEvent.click(screen.getByRole("button", { name: "发布活动" }));
    fireEvent.click(screen.getByRole("button", { name: "结束课堂" }));
    expect(screen.getByText("本次会中发布：快速投票")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /返回会议首页/ }));
    enterLiveMeeting();
    fireEvent.click(screen.getByRole("button", { name: "结束课堂" }));

    expect(screen.queryByText("本次会中发布：快速投票")).toBeNull();
  });

  it("重新进入会议时会重置临时 UI 状态", async () => {
    render(<Home />);
    await joinLiveMeeting();
    fireEvent.click(screen.getByRole("button", { name: "主讲" }));
    fireEvent.click(screen.getByRole("button", { name: /录制/ }));
    fireEvent.click(screen.getByRole("button", { name: /聊天/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "聊天消息" }), {
      target: { value: "只属于上一场会议的消息" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    expect(screen.getByText("只属于上一场会议的消息")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "结束课堂" }));
    fireEvent.click(screen.getByRole("button", { name: /返回会议首页/ }));
    enterLiveMeeting();

    expect(screen.getByRole("button", { name: "宫格" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(screen.getByRole("button", { name: /录制/ })).toBeTruthy();
    expect(screen.getByText(/课堂大厅 · 00:00:00/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /聊天/ }));
    expect(screen.queryByText("只属于上一场会议的消息")).toBeNull();
    expect(screen.getByText("老师，案例里的字体需要统一吗？")).toBeTruthy();
  });

  it("同房间的会议页面会同步聊天消息", async () => {
    const first = render(<Home />);
    const second = render(<Home />);
    fireEvent.click(
      within(first.container).getByRole("button", { name: /加入会议/ }),
    );
    const firstDialog = within(first.container).getByRole("dialog");
    fireEvent.change(
      within(firstDialog).getByRole("textbox", { name: "入会名称" }),
      { target: { value: "陈同学" } },
    );
    fireEvent.click(
      within(firstDialog).getByRole("button", { name: /加入会议/ }),
    );
    fireEvent.click(
      within(second.container).getByRole("button", { name: /进入课堂/ }),
    );
    fireEvent.click(within(second.container).getByRole("button", { name: /聊天/ }));
    fireEvent.click(within(first.container).getByRole("button", { name: /聊天/ }));
    fireEvent.change(
      within(first.container).getByRole("textbox", { name: "聊天消息" }),
      { target: { value: "请查看共享的课堂资料" } },
    );
    fireEvent.click(within(first.container).getByRole("button", { name: "发送" }));

    expect(within(first.container).getByText("请查看共享的课堂资料")).toBeTruthy();
    await waitFor(() =>
      expect(within(second.container).getByText("请查看共享的课堂资料")).toBeTruthy(),
    );
    expect(within(second.container).getByText("陈同学")).toBeTruthy();
  });

  it("不同房间和离会页面不会收到聊天消息", async () => {
    const first = render(<Home />);
    const second = render(<Home />);
    fireEvent.click(
      within(first.container).getByRole("button", { name: /进入课堂/ }),
    );
    fireEvent.click(
      within(second.container).getByRole("button", { name: /进入课堂/ }),
    );
    fireEvent.change(
      within(second.container).getByLabelText("本地会议房间号"),
      { target: { value: "999888777" } },
    );
    fireEvent.click(within(first.container).getByRole("button", { name: /聊天/ }));
    fireEvent.change(
      within(first.container).getByRole("textbox", { name: "聊天消息" }),
      { target: { value: "只发送到默认房间" } },
    );
    fireEvent.click(within(first.container).getByRole("button", { name: "发送" }));

    await act(async () => {
      await Promise.resolve();
    });
    expect(within(second.container).queryByText("只发送到默认房间")).toBeNull();

    fireEvent.click(
      within(first.container).getByRole("button", { name: "返回会议首页" }),
    );
    expect(within(first.container).queryByText("只发送到默认房间")).toBeNull();
  });

  it("快速离开并重入同一房间时不会接收旧聊天频道的排队消息", async () => {
    render(<Home />);
    enterLiveMeeting();
    const oldChannel = getBroadcastChannels("learning-meeting-chat:821406233")[0];
    expect(oldChannel).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "返回会议首页" }));
    await waitFor(() => expect(screen.getByText("下午好，林老师")).toBeTruthy());
    enterLiveMeeting();
    const currentChannel = getBroadcastChannels("learning-meeting-chat:821406233")[0];
    expect(currentChannel).toBeTruthy();
    expect(currentChannel).not.toBe(oldChannel);

    oldChannel?.onmessage?.({
      data: {
        type: "chat",
        text: "旧会话排队消息",
        senderName: "旧窗口",
      },
    } as MessageEvent);

    fireEvent.click(screen.getByRole("button", { name: /聊天/ }));
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.queryByText("旧会话排队消息")).toBeNull();
    expect(screen.getByText("老师，案例里的字体需要统一吗？")).toBeTruthy();
  });

  it("畸形聊天信令不会破坏接收页面", async () => {
    render(<Home />);
    enterLiveMeeting();
    fireEvent.click(screen.getByRole("button", { name: /聊天/ }));

    broadcastToRoom("learning-meeting-chat:821406233", {
      type: "chat",
      text: "数字类型名称",
      senderName: 123,
    });
    broadcastToRoom("learning-meeting-chat:821406233", {
      type: "chat",
      text: "空白名称",
      senderName: "   ",
    });

    await waitFor(() => {
      expect(screen.getByText("数字类型名称")).toBeTruthy();
      expect(screen.getByText("空白名称")).toBeTruthy();
      expect(screen.getAllByText("远端参会者")).toHaveLength(2);
    });

    fireEvent.change(screen.getByRole("textbox", { name: "聊天消息" }), {
      target: { value: "畸形消息后仍可继续聊天" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    expect(screen.getByText("畸形消息后仍可继续聊天")).toBeTruthy();
  });

  it("超长聊天信令会被丢弃并保留聊天面板可用", async () => {
    render(<Home />);
    enterLiveMeeting();
    fireEvent.click(screen.getByRole("button", { name: /聊天/ }));
    const oversizedText = "x".repeat(2001);

    broadcastToRoom("learning-meeting-chat:821406233", {
      type: "chat",
      text: oversizedText,
      senderName: "异常窗口",
    });

    await act(async () => {
      await Promise.resolve();
    });
    expect(
      [...document.querySelectorAll(".chat-message p")].some(
        (node) => node.textContent === oversizedText,
      ),
    ).toBe(false);
    expect(
      [...document.querySelectorAll(".chat-message strong")].some(
        (node) => node.textContent === "异常窗口",
      ),
    ).toBe(false);

    fireEvent.change(screen.getByRole("textbox", { name: "聊天消息" }), {
      target: { value: "长度校验后仍可发送" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    expect(screen.getByText("长度校验后仍可发送")).toBeTruthy();
  });

  it("本地发送超长聊天消息时不进入列表也不广播", () => {
    render(<Home />);
    enterLiveMeeting();
    fireEvent.click(screen.getByRole("button", { name: /聊天/ }));
    const oversizedText = "x".repeat(2001);
    fireEvent.change(screen.getByRole("textbox", { name: "聊天消息" }), {
      target: { value: oversizedText },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    expect(
      [...document.querySelectorAll(".chat-message p")].some(
        (node) => node.textContent === oversizedText,
      ),
    ).toBe(false);
    expect(screen.getByRole("status").textContent).toContain("不能超过 2000");
  });

  it("聊天消息和发送者名称的原始长度不能被首尾空白绕过", async () => {
    render(<Home />);
    enterLiveMeeting();
    fireEvent.click(screen.getByRole("button", { name: /聊天/ }));
    const paddedText = ` ${"x".repeat(2000)} `;
    const paddedSenderName = ` ${"y".repeat(80)} `;

    broadcastToRoom("learning-meeting-chat:821406233", {
      type: "chat",
      text: paddedText,
      senderName: "异常窗口",
    });
    broadcastToRoom("learning-meeting-chat:821406233", {
      type: "chat",
      text: "发送者名称超限",
      senderName: paddedSenderName,
    });

    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByText("x".repeat(2000))).toBeNull();
    expect(screen.queryByText("发送者名称超限")).toBeTruthy();
    expect(screen.getAllByText("远端参会者")).toHaveLength(1);

    fireEvent.change(screen.getByRole("textbox", { name: "聊天消息" }), {
      target: { value: paddedText },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    expect(
      [...document.querySelectorAll(".chat-message p")].some(
        (node) => node.textContent === "x".repeat(2000),
      ),
    ).toBe(false);
    expect(screen.getByRole("status").textContent).toContain("不能超过 2000");
  });

  it("同源聊天历史超过 200 条时只保留最近消息", async () => {
    render(<Home />);
    enterLiveMeeting();
    fireEvent.click(screen.getByRole("button", { name: /聊天/ }));

    for (let index = 0; index < 205; index += 1) {
      broadcastToRoom("learning-meeting-chat:821406233", {
        type: "chat",
        text: `批量消息 ${index}`,
        senderName: "批量窗口",
      });
    }

    await waitFor(() =>
      expect(document.querySelectorAll(".chat-message p")).toHaveLength(200),
    );
    const bubbles = [...document.querySelectorAll(".chat-message p")].map(
      (node) => node.textContent,
    );
    expect(bubbles[0]).toBe("批量消息 5");
    expect(bubbles.at(-1)).toBe("批量消息 204");
    expect(bubbles).not.toContain("批量消息 0");
  });

  it("本次会话聊天计数最多保留 100000 条", async () => {
    render(<Home />);
    enterLiveMeeting();
    fireEvent.click(screen.getByRole("button", { name: /聊天/ }));

    await act(async () => {
      for (let index = 0; index < 100_005; index += 1) {
        broadcastToRoom("learning-meeting-chat:821406233", {
          type: "chat",
          text: `计数消息 ${index}`,
          senderName: "计数窗口",
        });
      }
      await Promise.resolve();
    });

    fireEvent.click(screen.getByRole("button", { name: "结束课堂" }));
    const chatMetric = screen.getByText("本次会话新增消息").parentElement;
    expect(chatMetric?.textContent).toContain("100000");
    expect(chatMetric?.textContent).not.toContain("100005");
  });

  it("创建会议选项会控制入会静音和报告生成", async () => {
    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: /快速会议/ }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(
      within(dialog).getByRole("checkbox", { name: /入会自动静音/ }),
    );
    fireEvent.click(
      within(dialog).getByRole("checkbox", { name: /自动生成会议报告/ }),
    );
    fireEvent.click(within(dialog).getByRole("button", { name: /开始会议/ }));

    fireEvent.click(screen.getByRole("button", { name: /开启设备并加入/ }));
    await waitFor(() => {
      expect(getUserMediaMock).toHaveBeenCalledWith({
        audio: true,
        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
      });
    });
    fireEvent.click(screen.getByRole("button", { name: "结束会议" }));
    expect(screen.getByRole("button", { name: "立即生成报告" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "立即生成报告" }));
    expect(screen.getByText("本地会话参与")).toBeTruthy();
  });

  it("课后报告可以展开名单并管理待办", () => {
    render(<Home />);
    enterLiveMeeting();
    fireEvent.click(screen.getByRole("button", { name: "结束课堂" }));

    const attendanceButton = screen.getByRole("button", {
      name: /查看窗口状态/,
    });
    expect(screen.queryByLabelText("本地窗口状态")).toBeNull();
    fireEvent.click(attendanceButton);
    expect(screen.getByLabelText("本地窗口状态")).toBeTruthy();
    expect(screen.getByText("本地窗口")).toBeTruthy();
    expect(screen.getByText("未开启设备")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /收起名单/ }));
    expect(screen.queryByLabelText("本地窗口状态")).toBeNull();

    const exportTodo = screen.getByRole("checkbox", {
      name: /导出本地会话摘要/,
    });
    expect(exportTodo).toHaveProperty("checked", false);
    fireEvent.click(exportTodo);
    expect(exportTodo).toHaveProperty("checked", true);

    fireEvent.click(screen.getByRole("button", { name: /添加/ }));
    expect(screen.getByText("整理课堂互动摘要")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("已添加课后任务");
  });

  it("当前会话报告使用结束时的时长、活动和聊天快照", () => {
    render(<Home />);
    enterLiveMeeting();
    fireEvent.click(screen.getByRole("button", { name: /课堂互动/ }));
    fireEvent.click(screen.getByRole("button", { name: /快速投票/ }));
    fireEvent.click(screen.getByRole("button", { name: "发布活动" }));
    fireEvent.click(screen.getByRole("button", { name: /聊天/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "聊天消息" }), {
      target: { value: "这条消息应该进入本次报告" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    fireEvent.click(screen.getByRole("button", { name: "结束课堂" }));

    expect(screen.getByText("会议时长")).toBeTruthy();
    expect(screen.getByText("00:00:00")).toBeTruthy();
    const activityMetric = screen.getByText("当前会话发布的课堂活动").parentElement;
    expect(activityMetric?.textContent).toContain("1");
    expect(activityMetric?.textContent).toContain("项");
    expect(screen.getByText("快速投票")).toBeTruthy();
    expect(screen.getByText("已发布")).toBeTruthy();
    expect(screen.queryByText("随堂测验")).toBeNull();
    const chatMetric = screen.getByText("本次会话新增消息").parentElement;
    expect(chatMetric?.textContent).toContain("1");
    expect(chatMetric?.textContent).toContain("条");
    expect(screen.getByText("本次会话新增消息")).toBeTruthy();
  });

  it("当前会话报告使用入会名称并标明未接入课程活跃度分析", () => {
    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: /加入会议/ }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByRole("textbox", { name: "入会名称" }), {
      target: { value: "周老师" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: /加入会议/ }));
    fireEvent.click(screen.getByRole("button", { name: "结束会议" }));

    expect(
      screen.getByText("本地会话 · 时长 00:00:00 · 周老师"),
    ).toBeTruthy();
    expect(screen.getByText("未接入课程分析")).toBeTruthy();
    expect(screen.queryByText("较上次 +6")).toBeNull();
  });

  it("当前会话报告只显示本地范围的课后待办并在导出后完成待办", () => {
    const createObjectURL = vi.fn(() => "blob:local-summary");
    vi.spyOn(URL, "createObjectURL").mockImplementation(createObjectURL);
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
      () => undefined,
    );
    render(<Home />);
    enterLiveMeeting();
    fireEvent.click(screen.getByRole("button", { name: "结束课堂" }));

    expect(screen.getByText("导出本地会话摘要")).toBeTruthy();
    expect(screen.getByText("复制本地报告引用")).toBeTruthy();
    expect(screen.queryByText("提醒 6 位缺勤学生补学")).toBeNull();
    expect(screen.queryByText("查看测验错题分布")).toBeNull();

    const exportTodo = screen.getByRole("checkbox", {
      name: /导出本地会话摘要/,
    });
    expect(exportTodo).toHaveProperty("checked", false);
    fireEvent.click(screen.getByRole("button", { name: "导出报告" }));
    expect(exportTodo).toHaveProperty("checked", true);
  });

  it("当前会话导出摘要包含已发布活动明细", async () => {
    let exportedBlob: Blob | undefined;
    vi.spyOn(URL, "createObjectURL").mockImplementation((value) => {
      exportedBlob = value as Blob;
      return "blob:activity-report";
    });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
      () => undefined,
    );

    render(<Home />);
    enterLiveMeeting();
    fireEvent.click(screen.getByRole("button", { name: /课堂互动/ }));
    fireEvent.click(screen.getByRole("button", { name: /快速投票/ }));
    fireEvent.click(screen.getByRole("button", { name: "发布活动" }));
    fireEvent.click(screen.getByRole("button", { name: "结束课堂" }));
    fireEvent.click(screen.getByRole("button", { name: "导出报告" }));

    const content = await exportedBlob?.text();
    expect(content).toContain("已发布活动：1 项");
    expect(content).toContain("已发布活动明细：快速投票");
  });

  it("当前会话没有发布活动时导出摘要明确写出无活动", async () => {
    let exportedBlob: Blob | undefined;
    vi.spyOn(URL, "createObjectURL").mockImplementation((value) => {
      exportedBlob = value as Blob;
      return "blob:empty-activity-report";
    });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
      () => undefined,
    );

    render(<Home />);
    enterLiveMeeting();
    fireEvent.click(screen.getByRole("button", { name: "结束课堂" }));
    fireEvent.click(screen.getByRole("button", { name: "导出报告" }));

    const content = await exportedBlob?.text();
    expect(content).toContain("已发布活动：0 项");
    expect(content).toContain("已发布活动明细：无");
  });

  it("新会议不会继承上一场会话的报告快照", () => {
    render(<Home />);
    enterLiveMeeting();
    fireEvent.click(screen.getByRole("button", { name: /聊天/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "聊天消息" }), {
      target: { value: "上一场会话消息" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    fireEvent.click(screen.getByRole("button", { name: "结束课堂" }));
    fireEvent.click(screen.getByRole("button", { name: /返回会议首页/ }));

    enterLiveMeeting();
    fireEvent.click(screen.getByRole("button", { name: "结束课堂" }));
    const chatMetric = screen.getByText("本次会话新增消息").parentElement;
    expect(chatMetric?.textContent).toContain("0");
    expect(chatMetric?.textContent).not.toContain("1");
  });

  it("当前报告的聊天数量包含本次新增的本地和远端消息", async () => {
    render(<Home />);
    enterLiveMeeting();
    fireEvent.click(screen.getByRole("button", { name: /聊天/ }));
    broadcastToRoom("learning-meeting-chat:821406233", {
      type: "chat",
      text: "同源远端新增消息",
      senderName: "远端参会者",
    });

    await waitFor(() => expect(screen.getByText("同源远端新增消息")).toBeTruthy());
    fireEvent.change(screen.getByRole("textbox", { name: "聊天消息" }), {
      target: { value: "本地新增消息" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    fireEvent.click(screen.getByRole("button", { name: "结束课堂" }));

    const chatMetric = screen.getByText("本次会话新增消息").parentElement;
    expect(chatMetric?.textContent).toContain("2");
  });

  it("课堂回放的播放和预览会打开可关闭的查看区域", () => {
    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: "课堂回放" }));

    const playButton = screen.getByRole("button", {
      name: "播放第 3 讲 · 信息架构与导航设计",
    });
    fireEvent.click(playButton);
    const viewer = screen.getByLabelText("回放播放器");
    expect(viewer).toBeTruthy();
    expect(
      within(viewer).getByText("第 3 讲 · 信息架构与导航设计"),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "关闭回放播放器" }),
    );
    expect(screen.queryByLabelText("回放播放器")).toBeNull();
    expect(document.activeElement).toBe(playButton);

    const previewButton = screen.getByRole("button", { name: "预览回放" });
    fireEvent.click(previewButton);
    expect(screen.getByLabelText("回放播放器")).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByLabelText("回放播放器")).toBeNull();
    expect(document.activeElement).toBe(previewButton);
  });

  it("回放精选入口可以标记为本地已发布并保留状态", () => {
    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: "课堂回放" }));

    const publishButton = screen.getByRole("button", { name: "标记为已发布" });
    fireEvent.click(publishButton);

    expect(publishButton.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "已标记本地发布" })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain(
      "本地演示中标记回放为已发布",
    );
  });

  it("回放本地发布状态在切换页面后仍保持", () => {
    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: "课堂回放" }));
    fireEvent.click(screen.getByRole("button", { name: "标记为已发布" }));

    fireEvent.click(screen.getByRole("button", { name: "会议首页" }));
    fireEvent.click(screen.getByRole("button", { name: "课堂回放" }));

    expect(
      screen.getByRole("button", { name: "已标记本地发布" }),
    ).toBeTruthy();
    expect(screen.getByText(/数字媒体技术 · 本地已发布/)).toBeTruthy();
  });

  it("回放本地发布状态在重新挂载后从本机存储恢复", async () => {
    const first = render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: "课堂回放" }));
    fireEvent.click(screen.getByRole("button", { name: "标记为已发布" }));

    await waitFor(() => {
      expect(
        window.localStorage.getItem("learning-meeting-published-replay"),
      ).toBe("第 3 讲 · 信息架构与导航设计");
    });
    first.unmount();

    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: "课堂回放" }));
    expect(
      screen.getByRole("button", { name: "已标记本地发布" }),
    ).toBeTruthy();
  });

  it("回放本机存储不可用时不会伪造持久化成功", () => {
    const setItemSpy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("storage unavailable");
      });
    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: "课堂回放" }));
    fireEvent.click(screen.getByRole("button", { name: "标记为已发布" }));

    expect(screen.getByRole("button", { name: "标记为已发布" })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain(
      "本机发布状态保存失败",
    );
    expect(setItemSpy).toHaveBeenCalled();
    setItemSpy.mockRestore();
  });

  it("回放本机存储中的未知标题不会显示为已发布", () => {
    window.localStorage.setItem("learning-meeting-published-replay", "未知回放");
    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: "课堂回放" }));

    expect(screen.getByRole("button", { name: "标记为已发布" })).toBeTruthy();
    expect(screen.queryByText(/数字媒体技术 · 本地已发布/)).toBeNull();
  });

  it("回放本机存储的原始长度不能被首尾空白绕过", () => {
    const replayTitle = "第 3 讲 · 信息架构与导航设计";
    window.localStorage.setItem(
      "learning-meeting-published-replay",
      `${replayTitle}${" ".repeat(512)}`,
    );
    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: "课堂回放" }));

    expect(screen.getByRole("button", { name: "标记为已发布" })).toBeTruthy();
    expect(screen.queryByText(/数字媒体技术 · 本地已发布/)).toBeNull();
  });

  it("回放分享会写入剪贴板，失败时提示手动复制", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: "课堂回放" }));
    fireEvent.click(screen.getAllByRole("button", { name: "分享" })[0]);

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(
        expect.stringContaining("share=replay"),
      );
      expect(screen.getByRole("status").textContent).toContain("本地回放引用已复制");
    });

    writeText.mockRejectedValueOnce(new Error("denied"));
    fireEvent.click(screen.getAllByRole("button", { name: "分享" })[0]);
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toContain(
        "复制失败，请手动复制本地回放引用",
      ),
    );
  });

  it("报告分享会写入当前本地报告引用", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: "我的会议" }));
    fireEvent.click(screen.getByRole("button", { name: /已结束/ }));
    fireEvent.click(screen.getAllByRole("button", { name: "查看报告" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "分享报告" }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(expect.stringContaining("share=report"));
      expect(screen.getByRole("status").textContent).toContain("本地课堂报告引用已复制");
    });
  });

  it("打开本地报告引用会恢复报告标题和会议模式", async () => {
    window.history.replaceState(
      {},
      "",
      `/?share=report&mode=normal&title=${encodeURIComponent("课程组备课会")}`,
    );
    render(<Home />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "课程组备课会" })).toBeTruthy();
    });
    expect(window.location.search).toBe("");
    expect(screen.getByText("会议已结束 · 报告已生成")).toBeTruthy();
    expect(screen.queryByText("到课人数")).toBeNull();
    expect(screen.getByText("会议互动")).toBeTruthy();
  });

  it("消费分享引用时会保留非分享查询参数和 hash", async () => {
    window.history.replaceState(
      {},
      "",
      "/?share=replay&title=%E7%AC%AC%203%20%E8%AE%B2&from=notification#viewer",
    );
    render(<Home />);

    await waitFor(() => expect(screen.getByLabelText("回放播放器")).toBeTruthy());
    expect(window.location.search).toBe("?from=notification");
    expect(window.location.hash).toBe("#viewer");
  });

  it("打开带活动快照的本地报告引用会恢复具体活动列表", async () => {
    const params = new URLSearchParams({
      share: "report",
      mode: "class",
      title: "数字媒体技术 · 第 3 讲",
      snapshot: JSON.stringify({
        durationSeconds: 42,
        chatMessageCount: 2,
        publishedActivityCount: 1,
        publishedActivityIds: ["poll"],
        recordingAvailable: false,
        participantCount: 1,
        participantName: "林老师",
        meetingMode: "class",
      }),
    });
    window.history.replaceState({}, "", `/?${params.toString()}`);
    render(<Home />);

    await waitFor(() => {
      expect(screen.getByText("快速投票")).toBeTruthy();
    });
    expect(screen.getByText("1 项已发布")).toBeTruthy();
    expect(screen.getByText("本次会中发布：快速投票")).toBeTruthy();
  });

  it("超长本地分享标题不会进入报告页面", async () => {
    window.history.replaceState(
      {},
      "",
      `/?share=report&mode=normal&title=${"x".repeat(121)}`,
    );
    render(<Home />);

    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByText("下午好，林老师")).toBeTruthy();
    expect(screen.queryByText("会议已结束 · 报告已生成")).toBeNull();
  });

  it("分享标题的原始长度不能被首尾空白绕过", async () => {
    const paddedTitle = ` ${"x".repeat(119)} `;
    window.history.replaceState(
      {},
      "",
      `/?share=replay&title=${encodeURIComponent(paddedTitle)}`,
    );
    render(<Home />);

    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByText("下午好，林老师")).toBeTruthy();
    expect(screen.queryByLabelText("回放播放器")).toBeNull();
  });

  it("报告快照身份的原始长度不能被首尾空白绕过", async () => {
    const params = new URLSearchParams({
      share: "report",
      mode: "normal",
      title: "边界报告",
      snapshot: JSON.stringify({
        durationSeconds: 42,
        chatMessageCount: 2,
        publishedActivityCount: 0,
        publishedActivityIds: [],
        recordingAvailable: false,
        participantCount: 1,
         participantName: ` ${"x".repeat(79)} `,
        meetingMode: "normal",
      }),
    });
    window.history.replaceState({}, "", `/?${params.toString()}`);
    render(<Home />);

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "边界报告" })).toBeTruthy(),
    );
    expect(screen.getByText("参会人数")).toBeTruthy();
    expect(screen.queryByText("本地会话参与")).toBeNull();
  });

  it("超大报告快照载荷不会在读取时解析", async () => {
    const params = new URLSearchParams({
      share: "report",
      mode: "normal",
      title: "超大载荷报告",
      snapshot: JSON.stringify({
        durationSeconds: 42,
        chatMessageCount: 2,
        publishedActivityCount: 0,
        publishedActivityIds: [],
        recordingAvailable: false,
        participantCount: 1,
        participantName: "林老师",
        meetingMode: "normal",
        ignored: "x".repeat(100_001),
      }),
    });
    window.history.replaceState({}, "", `/?${params.toString()}`);
    render(<Home />);

    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "超大载荷报告" }),
      ).toBeTruthy(),
    );
    expect(screen.getByText("参会人数")).toBeTruthy();
    expect(screen.queryByText("本地会话参与")).toBeNull();
  });

  it.each([
    {
      label: "窗口数量超过本地上限",
      snapshot: {
        durationSeconds: 42,
        chatMessageCount: 2,
        publishedActivityCount: 0,
        publishedActivityIds: [],
        recordingAvailable: false,
        participantCount: 3,
        participantName: "林老师",
        meetingMode: "normal",
      },
    },
    {
      label: "活动 ID 重复",
      snapshot: {
        durationSeconds: 42,
        chatMessageCount: 2,
        publishedActivityCount: 2,
        publishedActivityIds: ["poll", "poll"],
        recordingAvailable: false,
        participantCount: 1,
        participantName: "林老师",
        meetingMode: "normal",
      },
    },
    {
      label: "聊天数量不是整数",
      snapshot: {
        durationSeconds: 42,
        chatMessageCount: 1.5,
        publishedActivityCount: 0,
        publishedActivityIds: [],
        recordingAvailable: false,
        participantCount: 1,
        participantName: "林老师",
        meetingMode: "normal",
      },
    },
    {
      label: "会议时长超过本地上限",
      snapshot: {
        durationSeconds: 7 * 24 * 60 * 60 + 1,
        chatMessageCount: 2,
        publishedActivityCount: 0,
        publishedActivityIds: [],
        recordingAvailable: false,
        participantCount: 1,
        participantName: "林老师",
        meetingMode: "normal",
      },
    },
  ])("非法报告快照会回退到演示报告：$label", async ({ snapshot }) => {
    const params = new URLSearchParams({
      share: "report",
      mode: "normal",
      title: "被篡改的本地报告",
      snapshot: JSON.stringify(snapshot),
    });
    window.history.replaceState({}, "", `/?${params.toString()}`);
    render(<Home />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "被篡改的本地报告" })).toBeTruthy();
    });
    expect(screen.getByText("参会人数")).toBeTruthy();
    expect(screen.queryByText("本地会话参与")).toBeNull();
  });

  it("打开本地回放引用会定位到对应回放查看器", async () => {
    window.history.replaceState(
      {},
      "",
      "/?share=replay&title=%E7%AC%AC%203%20%E8%AE%B2%20%C2%B7%20%E4%BF%A1%E6%81%AF%E6%9E%B6%E6%9E%84%E4%B8%8E%E5%AF%BC%E8%88%AA%E8%AE%BE%E8%AE%A1",
    );
    render(<Home />);

    await waitFor(() => {
      expect(screen.getByLabelText("回放播放器")).toBeTruthy();
    });
    expect(
      within(screen.getByLabelText("回放播放器")).getByText(
        "第 3 讲 · 信息架构与导航设计",
      ),
    ).toBeTruthy();
  });

  it("回放搜索对英文关键字不区分大小写", () => {
    expect(
      matchesReplaySearch(
        { course: "Digital Media", title: "Interaction Lab" },
        "  DIGITAL  ",
      ),
    ).toBe(true);
    expect(
      matchesReplaySearch(
        { course: "Digital Media", title: "Interaction Lab" },
        "research",
      ),
    ).toBe(false);
  });

  it("历史报告生成的未知回放引用会打开本地占位查看器", async () => {
    window.history.replaceState(
      {},
      "",
      `/?share=replay&title=${encodeURIComponent("课程组备课会")}`,
    );
    render(<Home />);

    const viewer = await screen.findByLabelText("回放播放器");
    expect(within(viewer).getByText(/本地报告回放/)).toBeTruthy();
    expect(within(viewer).getByText("课程组备课会")).toBeTruthy();
    expect(
      within(viewer).getByText("这是报告中的本地回放占位，尚未生成真实媒体文件。"),
    ).toBeTruthy();
  });

  it("从我的会议返回报告时会回到会议首页", () => {
    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: "我的会议" }));
    fireEvent.click(screen.getByRole("button", { name: /已结束/ }));
    fireEvent.click(screen.getAllByRole("button", { name: "查看报告" })[0]);
    fireEvent.click(screen.getByRole("button", { name: /返回会议首页/ }));

    expect(screen.getByText("下午好，林老师")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "会议首页" }).getAttribute("aria-current"),
    ).toBe("page");
  });

  it("会议中心状态筛选会暴露当前按下状态", () => {
    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: "我的会议" }));
    const upcoming = screen.getByRole("button", { name: /即将开始/ });
    const past = screen.getByRole("button", { name: /已结束/ });
    expect(upcoming.getAttribute("aria-pressed")).toBe("true");
    expect(past.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(past);
    expect(upcoming.getAttribute("aria-pressed")).toBe("false");
    expect(past.getAttribute("aria-pressed")).toBe("true");
  });

  it("报告返回首页后不会保留搜索带入的会议定位", async () => {
    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: /快速会议/ }));
    fireEvent.click(screen.getByRole("button", { name: /开始会议/ }));
    fireEvent.click(screen.getByRole("button", { name: "结束会议" }));
    fireEvent.click(screen.getByRole("button", { name: /返回会议首页/ }));

    fireEvent.click(screen.getByRole("button", { name: "搜索" }));
    const searchDialog = screen.getByRole("dialog", { name: "全局搜索" });
    fireEvent.change(
      within(searchDialog).getByRole("textbox", { name: "全局搜索" }),
      {
        target: { value: "林老师的快速会议" },
      },
    );
    fireEvent.click(
      within(searchDialog).getByRole("button", {
        name: /林老师的快速会议/,
      }),
    );
    const localMeetingRow = screen
      .getByText("林老师的快速会议")
      .closest("article");
    expect(localMeetingRow).toBeTruthy();
    fireEvent.click(
      within(localMeetingRow as HTMLElement).getByRole("button", {
        name: "查看报告",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: /返回会议首页/ }));

    fireEvent.click(screen.getByRole("button", { name: "我的会议" }));
    expect(
      screen.getByRole("button", { name: /即将开始/ }).className,
    ).toContain("active");
  });

  it("本地录制会生成可下载媒体且不提供虚假的回放分享链接", async () => {
    render(<Home />);
    await joinLiveMeeting();
    fireEvent.click(screen.getByRole("button", { name: /录制/ }));
    fireEvent.click(screen.getByRole("button", { name: "结束课堂" }));
    expect(screen.getByText("本地录制已生成")).toBeTruthy();
    expect(
      screen.getByText(
        "媒体已生成，可下载为 WebM 文件；支持本机存储时，重新打开该会议报告仍可恢复。",
      ),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "下载本地录制" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "复制本地回放引用" })).toBeNull();
  });

  it("报告页下载本地录制时使用 WebM 文件名", async () => {
    const createObjectURL = vi.fn(() => "blob:local-recording");
    const revokeObjectURL = vi.fn();
    vi.spyOn(URL, "createObjectURL").mockImplementation(createObjectURL);
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(revokeObjectURL);
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function (this: HTMLAnchorElement) {
        expect(this.download).toBe("数字媒体技术 · 第 3 讲-本地录制.webm");
      });

    render(<Home />);
    await joinLiveMeeting();
    fireEvent.click(screen.getByRole("button", { name: /录制/ }));
    fireEvent.click(screen.getByRole("button", { name: "结束课堂" }));
    fireEvent.click(screen.getByRole("button", { name: "下载本地录制" }));

    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:local-recording");
    expect(screen.getByRole("status").textContent).toContain("本地录制已下载");
    click.mockRestore();
  });

  it("导出报告会下载包含当前标题和统计的文本摘要", () => {
    const createObjectURL = vi.fn(() => "blob:report-summary");
    const revokeObjectURL = vi.fn();
    vi.spyOn(URL, "createObjectURL").mockImplementation(createObjectURL);
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(revokeObjectURL);
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: "我的会议" }));
    fireEvent.click(screen.getByRole("button", { name: /已结束/ }));
    fireEvent.click(screen.getAllByRole("button", { name: "查看报告" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "导出报告" }));

    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:report-summary");
    expect(screen.getByRole("status").textContent).toContain("报告摘要已下载");
    click.mockRestore();
  });

  it("历史普通会议导出时使用会议摘要和文件名", async () => {
    let exportedBlob: Blob | undefined;
    vi.spyOn(URL, "createObjectURL").mockImplementation((value) => {
      exportedBlob = value as Blob;
      return "blob:normal-report";
    });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function (this: HTMLAnchorElement) {
        expect(this.download).toBe("课程组备课会-会议报告.txt");
      });

    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: "我的会议" }));
    fireEvent.click(screen.getByRole("button", { name: /已结束/ }));
    fireEvent.click(screen.getAllByRole("button", { name: "查看报告" })[1]);
    fireEvent.click(screen.getByRole("button", { name: "导出报告" }));

    const content = await exportedBlob?.text();
    expect(content).toContain("学习通会议 · 会议报告摘要");
    expect(content).toContain("状态：会议已结束 · 报告已生成");
    expect(content).toContain("参会人数：8 / 8（100%）");
    expect(content).not.toContain("到课人数");
    expect(content).not.toContain("课堂已结束");
    click.mockRestore();
  });

  it("报告页播放按钮会打开可关闭的本地录制查看区域", async () => {
    render(<Home />);
    await joinLiveMeeting();
    fireEvent.click(screen.getByRole("button", { name: /录制/ }));
    fireEvent.click(screen.getByRole("button", { name: "结束课堂" }));
    const replayTrigger = screen.getByRole("button", { name: "查看本地录制状态" });
    fireEvent.click(replayTrigger);

    const viewer = screen.getByLabelText("报告回放播放器");
    expect(within(viewer).getByText("本地录制状态预览")).toBeTruthy();
    expect(
      within(viewer).getByText(
        "本地媒体已生成，可在当前报告中预览或下载；支持本机存储时会按会议保存。",
      ),
    ).toBeTruthy();
    expect(within(viewer).getByText("会话时长 00:00:00")).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByLabelText("报告回放播放器")).toBeNull();
    expect(document.activeElement).toBe(replayTrigger);
  });

  it("本地报告待办会按会议号保存并在重新打开后恢复", () => {
    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: /快速会议/ }));
    fireEvent.click(screen.getByRole("button", { name: /开始会议/ }));
    fireEvent.click(screen.getByRole("button", { name: "结束会议" }));

    const todo = screen.getByRole("checkbox", { name: /导出本地会话摘要/ });
    expect(todo).toHaveProperty("checked", false);
    fireEvent.click(todo);
    expect(todo).toHaveProperty("checked", true);
    fireEvent.click(screen.getByRole("button", { name: "＋ 添加" }));
    expect(screen.getByText("整理会议行动项")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /返回会议首页/ }));

    fireEvent.click(screen.getByRole("button", { name: "我的会议" }));
    fireEvent.click(screen.getByRole("button", { name: /已结束/ }));
    const localMeetingRow = screen
      .getByText("林老师的快速会议")
      .closest("article");
    expect(localMeetingRow).toBeTruthy();
    fireEvent.click(
      within(localMeetingRow as HTMLElement).getByRole("button", {
        name: "查看报告",
      }),
    );

    expect(
      screen.getByRole("checkbox", { name: /导出本地会话摘要/ }),
    ).toHaveProperty("checked", true);
    expect(screen.getByText("整理会议行动项")).toBeTruthy();
  });

  it("报告待办会响应同源窗口的 storage 更新", async () => {
    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: /快速会议/ }));
    fireEvent.click(screen.getByRole("button", { name: /开始会议/ }));
    fireEvent.click(screen.getByRole("button", { name: "结束会议" }));

    const roomId = (
      JSON.parse(window.localStorage.getItem("learning-meetings-created") ?? "[]") as {
        roomId?: string;
      }[]
    )[0]?.roomId;
    expect(roomId).toMatch(/^\d{6,18}$/);
    const key = `learning-meeting-report-todos:${roomId}`;
    const nextTodos = [
      {
        id: "export-summary",
        title: "导出本地会话摘要",
        detail: "保存当前页面快照到本机",
        done: true,
      },
      {
        id: "cross-window-follow-up",
        title: "同源窗口新增任务",
        detail: "由另一窗口写入",
        done: false,
      },
    ];
    window.localStorage.setItem(key, JSON.stringify(nextTodos));
    window.dispatchEvent(
      new StorageEvent("storage", {
        key,
        newValue: JSON.stringify(nextTodos),
      }),
    );

    await waitFor(() => {
      expect(
        screen.getByRole("checkbox", { name: /导出本地会话摘要/ }),
      ).toHaveProperty("checked", true);
      expect(screen.getByText("同源窗口新增任务")).toBeTruthy();
    });
  });

  it("未开启录制结束会议时，报告不会显示虚假的回放入口", () => {
    render(<Home />);
    enterLiveMeeting();
    fireEvent.click(screen.getByRole("button", { name: "结束课堂" }));

    expect(screen.getByText("本次课堂未开启录制")).toBeTruthy();
    expect(screen.getByText("本次会话未发布课堂活动")).toBeTruthy();
    expect(screen.getByText("0 项已发布")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "打开课堂回放" })).toBeNull();
    expect(screen.queryByRole("button", { name: "复制本地回放引用" })).toBeNull();
    expect(screen.getByText("导出本地会话摘要")).toBeTruthy();
  });

  it("录制停止后仍会在报告中保留本次会话的回放状态", async () => {
    render(<Home />);
    await joinLiveMeeting();
    const recordingButton = screen.getByRole("button", { name: /录制/ });
    fireEvent.click(recordingButton);
    fireEvent.click(screen.getByRole("button", { name: /停止录制/ }));
    fireEvent.click(screen.getByRole("button", { name: "结束课堂" }));

    expect(screen.getByRole("button", { name: "查看本地录制状态" })).toBeTruthy();
    expect(screen.getByText("本地录制已生成")).toBeTruthy();
  });

  it("已结束的本地录制会进入课堂回放并支持播放、下载和复制引用", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:local-replay");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);

    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: /快速会议/ }));
    fireEvent.click(screen.getByRole("button", { name: /开始会议/ }));
    fireEvent.click(screen.getByRole("button", { name: /开启设备并加入/ }));
    await waitFor(() => {
      expect(screen.getByText("等待另一位参会者")).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: /录制/ }));
    fireEvent.click(screen.getByRole("button", { name: "结束会议" }));
    fireEvent.click(screen.getByRole("button", { name: /返回会议首页/ }));
    fireEvent.click(screen.getByRole("button", { name: "课堂回放" }));

    const localReplay = await screen.findAllByText("林老师的快速会议");
    expect(localReplay.length).toBeGreaterThanOrEqual(2);
    fireEvent.click(
      screen.getByRole("button", { name: "播放林老师的快速会议" }),
    );

    const viewer = screen.getByLabelText("回放播放器");
    expect(within(viewer).getByLabelText("本地录制视频")).toBeTruthy();
    fireEvent.click(within(viewer).getByRole("button", { name: "下载本地录制" }));
    expect(screen.getByRole("status").textContent).toContain("本地录制已下载");
    fireEvent.click(
      within(viewer).getByRole("button", { name: "复制本地回放引用" }),
    );
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(
        expect.stringMatching(/share=replay.*room=\d{9}/),
      );
    });
  });

  it("本地回放找不到媒体时只显示元数据降级提示", async () => {
    const originalIndexedDb = window.indexedDB;
    Object.defineProperty(window, "indexedDB", {
      configurable: true,
      value: undefined,
    });
    try {
      window.localStorage.setItem(
        "learning-meetings-created",
        JSON.stringify([
          {
            id: "local-created-missing-recording",
            day: "30",
            month: "今天",
            time: "刚刚",
            title: "缺失媒体的本地课堂",
            detail: "数字媒体技术 · 2026 秋 · 1 班（48 人）",
            type: "课程课堂",
            accent: "green",
            roomId: "123456789",
            mode: "class",
            autoMute: true,
            generateReport: true,
            reportGenerated: true,
            status: "past",
            reportSnapshot: {
              durationSeconds: 42,
              chatMessageCount: 0,
              publishedActivityCount: 0,
              publishedActivityIds: [],
              recordingAvailable: true,
              participantCount: 1,
              participantName: "林老师",
              meetingMode: "class",
            },
          },
        ]),
      );
      render(<Home />);
      fireEvent.click(screen.getByRole("button", { name: "课堂回放" }));
      await waitFor(() => {
        expect(screen.getAllByText("缺失媒体的本地课堂").length).toBeGreaterThanOrEqual(2);
      });
      fireEvent.click(
        screen.getByRole("button", { name: "查看本地回放缺失媒体的本地课堂" }),
      );

      const viewer = screen.getByLabelText("回放播放器");
      await waitFor(() => {
        expect(within(viewer).getByText("未找到本地媒体文件")).toBeTruthy();
      });
      expect(within(viewer).queryByRole("video")).toBeNull();
      expect(
        within(viewer).getByText(
          "本机没有找到对应媒体文件，只保留会议元数据；请回到会议重新生成录制。",
        ),
      ).toBeTruthy();
    } finally {
      Object.defineProperty(window, "indexedDB", {
        configurable: true,
        value: originalIndexedDb,
      });
    }
  });

  it("预约会议结束后的本地录制也会进入回放列表", async () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:scheduled-replay");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);

    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: /预约会议/ }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByRole("textbox", { name: "会议主题" }), {
      target: { value: "预约录制课堂" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: /确认预约/ }));
    await waitFor(() => expect(screen.getByText("预约录制课堂")).toBeTruthy());

    const scheduledRow = screen.getByText("预约录制课堂").closest("article");
    expect(scheduledRow).toBeTruthy();
    fireEvent.click(
      within(scheduledRow as HTMLElement).getByRole("button", { name: "进入会议" }),
    );
    fireEvent.click(screen.getByRole("button", { name: /开启设备并加入/ }));
    await waitFor(() => {
      expect(screen.getByText("等待另一位参会者")).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: /录制/ }));
    fireEvent.click(screen.getByRole("button", { name: "结束课堂" }));
    fireEvent.click(screen.getByRole("button", { name: /返回会议首页/ }));
    fireEvent.click(screen.getByRole("button", { name: "课堂回放" }));

    expect(await screen.findAllByText("预约录制课堂")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "播放预约录制课堂" }));
    expect(screen.getByLabelText("本地录制视频")).toBeTruthy();
  });

  it("带会议号的本地回放引用优先定位本地会议而不是同名演示回放", async () => {
    const title = "第 3 讲 · 信息架构与导航设计";
    window.localStorage.setItem(
      "learning-meetings-created",
      JSON.stringify([
        {
          id: "local-created-same-title",
          day: "30",
          month: "今天",
          time: "刚刚",
          title,
          detail: "数字媒体技术 · 2026 秋 · 1 班（48 人）",
          type: "课程课堂",
          accent: "green",
          roomId: "987654321",
          mode: "class",
          autoMute: true,
          generateReport: true,
          reportGenerated: true,
          status: "past",
          reportSnapshot: {
            durationSeconds: 24,
            chatMessageCount: 0,
            publishedActivityCount: 0,
            publishedActivityIds: [],
            recordingAvailable: true,
            participantCount: 1,
            participantName: "林老师",
            meetingMode: "class",
          },
        },
      ]),
    );
    window.history.replaceState(
      {},
      "",
      `/?share=replay&title=${encodeURIComponent(title)}&room=987654321`,
    );
    render(<Home />);

    const viewer = await screen.findByLabelText("回放播放器");
    expect(within(viewer).getByText(/本地课堂/)).toBeTruthy();
    await waitFor(() => {
      expect(
        within(viewer).getByText(
          "本机没有找到对应媒体文件，只保留会议元数据；请回到会议重新生成录制。",
        ),
      ).toBeTruthy();
    });
  });

  it("会议历史存储不可读时不会触发录制孤儿清理", async () => {
    const pruneSpy = vi
      .spyOn(localRecordingStorage, "pruneLocalRecordings")
      .mockResolvedValue(true);
    const getItemSpy = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("storage unavailable");
      });

    render(<Home />);
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    expect(pruneSpy).not.toHaveBeenCalled();
    expect(getItemSpy).toHaveBeenCalled();
  });

  it("全局搜索会按会议、回放和资料匹配并跳转页面", () => {
    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: "搜索" }));

    const panel = screen.getByRole("dialog", { name: "全局搜索" });
    const search = within(panel).getByRole("textbox", { name: "全局搜索" });
    expect(document.activeElement).toBe(search);
    fireEvent.change(search, { target: { value: "毕业设计" } });

    expect(within(panel).getByText("3 个匹配结果")).toBeTruthy();
    expect(
      within(panel).getAllByRole("button", { name: /毕业设计中期答辩/ })[0],
    ).toBeTruthy();
    expect(
      within(panel).getByRole("button", { name: /毕业设计中期答辩安排/ }),
    ).toBeTruthy();

    fireEvent.click(
      within(panel).getAllByRole("button", { name: /毕业设计中期答辩/ })[0],
    );
    expect(screen.getByRole("heading", { name: "我的会议" })).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: "全局搜索" })).toBeNull();
  });

  it("会议中心和全局搜索都支持按会议号定位", () => {
    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: "我的会议" }));

    const meetingSearch = screen.getByRole("textbox", { name: "搜索会议" });
    fireEvent.change(meetingSearch, { target: { value: "563294108" } });
    expect(screen.getByText("毕业设计中期答辩")).toBeTruthy();
    expect(screen.queryByText("数字媒体技术 · 课堂")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "会议首页" }));
    fireEvent.click(screen.getByRole("button", { name: "搜索" }));
    const panel = screen.getByRole("dialog", { name: "全局搜索" });
    const globalSearch = within(panel).getByRole("textbox", {
      name: "全局搜索",
    });
    fireEvent.change(globalSearch, { target: { value: "563294108" } });
    const result = within(panel).getByRole("button", {
      name: /毕业设计中期答辩/,
    });
    expect(result).toBeTruthy();
    fireEvent.click(result);
    expect(screen.getByRole("heading", { name: "我的会议" })).toBeTruthy();
    expect(screen.getByText("毕业设计中期答辩")).toBeTruthy();
  });

  it("全局搜索首页日程会让对应会议在会议中心可见", () => {
    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: "搜索" }));

    const panel = screen.getByRole("dialog", { name: "全局搜索" });
    const search = within(panel).getByRole("textbox", { name: "全局搜索" });
    fireEvent.change(search, { target: { value: "数字媒体技术 · 课堂" } });
    fireEvent.click(
      within(panel).getByRole("button", { name: /数字媒体技术 · 课堂/ }),
    );

    expect(screen.getByRole("heading", { name: "我的会议" })).toBeTruthy();
    expect(screen.getByText("数字媒体技术 · 课堂")).toBeTruthy();
  });

  it("全局搜索同名会议时会按会议号定位正确的状态分组", () => {
    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: /快速会议/ }));
    const createDialog = screen.getByRole("dialog");
    fireEvent.change(
      within(createDialog).getByRole("textbox", { name: "会议主题" }),
      { target: { value: "毕业设计中期答辩" } },
    );
    fireEvent.click(within(createDialog).getByRole("button", { name: /开始会议/ }));
    fireEvent.click(screen.getByRole("button", { name: "结束会议" }));
    fireEvent.click(screen.getByRole("button", { name: /返回会议首页/ }));

    fireEvent.click(screen.getByRole("button", { name: "搜索" }));
    const panel = screen.getByRole("dialog", { name: "全局搜索" });
    const search = within(panel).getByRole("textbox", { name: "全局搜索" });
    fireEvent.change(search, { target: { value: "毕业设计中期答辩" } });

    const results = within(panel)
      .getAllByRole("button")
      .filter(
        (button) =>
          button.textContent?.includes("毕业设计中期答辩") &&
          !button.textContent?.includes("安排"),
      );
    expect(results).toHaveLength(2);
    fireEvent.click(results[1]);

    expect(screen.getByRole("heading", { name: "我的会议" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /即将开始/ }).className).toContain(
      "active",
    );
    expect(screen.getByText("线上会议 · 12 人")).toBeTruthy();
  });

  it("全局搜索回放结果会直接打开对应回放查看器", () => {
    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: "搜索" }));

    const panel = screen.getByRole("dialog", { name: "全局搜索" });
    const search = within(panel).getByRole("textbox", { name: "全局搜索" });
    fireEvent.change(search, { target: { value: "信息架构与导航设计" } });
    fireEvent.click(
      within(panel).getByRole("button", { name: /信息架构与导航设计/ }),
    );

    const viewer = screen.getByLabelText("回放播放器");
    expect(
      within(viewer).getByText("第 3 讲 · 信息架构与导航设计"),
    ).toBeTruthy();
  });

  it("全局搜索资料结果会直接打开对应资料详情", () => {
    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: "搜索" }));

    const panel = screen.getByRole("dialog", { name: "全局搜索" });
    const search = within(panel).getByRole("textbox", { name: "全局搜索" });
    fireEvent.change(search, { target: { value: "信息架构课件" } });
    fireEvent.click(
      within(panel).getByRole("button", { name: /信息架构课件/ }),
    );

    const details = screen.getByLabelText("资料详情");
    expect(
      within(details).getByText("第 3 讲 · 信息架构课件.pptx"),
    ).toBeTruthy();
  });

  it("已经在回放页时再次搜索会更新当前回放目标", () => {
    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: "课堂回放" }));
    fireEvent.click(screen.getByRole("button", { name: "搜索" }));

    const panel = screen.getByRole("dialog", { name: "全局搜索" });
    const search = within(panel).getByRole("textbox", { name: "全局搜索" });
    fireEvent.change(search, { target: { value: "用户研究方法" } });
    fireEvent.click(
      within(panel).getByRole("button", { name: /用户研究方法/ }),
    );

    const viewer = screen.getByLabelText("回放播放器");
    expect(within(viewer).getByText("第 2 讲 · 用户研究方法")).toBeTruthy();
    expect(
      within(viewer).queryByText("第 3 讲 · 信息架构与导航设计"),
    ).toBeNull();
  });

  it("已经在资料页时再次搜索会更新当前资料目标", () => {
    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: "会议资料" }));
    fireEvent.click(screen.getByRole("button", { name: "搜索" }));

    const panel = screen.getByRole("dialog", { name: "全局搜索" });
    const search = within(panel).getByRole("textbox", { name: "全局搜索" });
    fireEvent.change(search, { target: { value: "答辩安排" } });
    fireEvent.click(
      within(panel).getByRole("button", { name: /答辩安排/ }),
    );

    const details = screen.getByLabelText("资料详情");
    expect(
      within(details).getByText("毕业设计中期答辩安排.docx"),
    ).toBeTruthy();
  });

  it("创建本机预约后全局搜索可以找到并定位该会议", () => {
    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: /预约会议/ }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByRole("textbox", { name: "会议主题" }), {
      target: { value: "本地教研预约" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: /确认预约/ }));

    fireEvent.click(screen.getByRole("button", { name: "搜索" }));
    const panel = screen.getByRole("dialog", { name: "全局搜索" });
    const search = within(panel).getByRole("textbox", { name: "全局搜索" });
    fireEvent.change(search, { target: { value: "本地教研预约" } });

    expect(within(panel).getByText("1 个匹配结果")).toBeTruthy();
    fireEvent.click(
      within(panel).getByRole("button", { name: /本地教研预约/ }),
    );
    expect(screen.getByRole("heading", { name: "我的会议" })).toBeTruthy();
  });

  it("快速会议历史会进入全局搜索并定位到已结束列表", () => {
    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: /快速会议/ }));
    fireEvent.click(screen.getByRole("button", { name: /开始会议/ }));
    fireEvent.click(screen.getByRole("button", { name: "结束会议" }));
    fireEvent.click(screen.getByRole("button", { name: /返回会议首页/ }));
    fireEvent.click(screen.getByRole("button", { name: "搜索" }));

    const panel = screen.getByRole("dialog", { name: "全局搜索" });
    const search = within(panel).getByRole("textbox", { name: "全局搜索" });
    fireEvent.change(search, { target: { value: "林老师的快速会议" } });

    expect(within(panel).getByText("1 个匹配结果")).toBeTruthy();
    fireEvent.click(
      within(panel).getByRole("button", { name: /林老师的快速会议/ }),
    );

    expect(screen.getByRole("heading", { name: "我的会议" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /已结束/ }).className,
    ).toContain("active");
    expect(screen.getByText("林老师的快速会议")).toBeTruthy();
  });

  it("本机历史会保留报告生成状态并持久化手动生成结果", async () => {
    const first = render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: /快速会议/ }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(
      within(dialog).getByRole("checkbox", { name: /自动生成会议报告/ }),
    );
    fireEvent.click(within(dialog).getByRole("button", { name: /开始会议/ }));
    fireEvent.click(screen.getByRole("button", { name: "结束会议" }));

    expect(screen.getByRole("button", { name: "立即生成报告" })).toBeTruthy();
    expect(
      JSON.parse(window.localStorage.getItem("learning-meetings-created") ?? "[]")[0]
        .reportGenerated,
    ).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: /返回会议首页/ }));
    first.unmount();

    const second = render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: "我的会议" }));
    fireEvent.click(screen.getByRole("button", { name: /已结束/ }));
    await waitFor(() => expect(screen.getByText("林老师的快速会议")).toBeTruthy());
    const localMeetingRow = screen
      .getByText("林老师的快速会议")
      .closest("article");
    expect(localMeetingRow).toBeTruthy();
    fireEvent.click(
      within(localMeetingRow as HTMLElement).getByRole("button", {
        name: "查看报告",
      }),
    );
    expect(screen.getByRole("button", { name: "立即生成报告" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "立即生成报告" }));
    expect(screen.getByText("本地会话参与")).toBeTruthy();
    expect(
      JSON.parse(window.localStorage.getItem("learning-meetings-created") ?? "[]")[0]
        .reportGenerated,
    ).toBe(true);

    second.unmount();
    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: "我的会议" }));
    fireEvent.click(screen.getByRole("button", { name: /已结束/ }));
    await waitFor(() => expect(screen.getByText("林老师的快速会议")).toBeTruthy());
    const restoredMeetingRow = screen
      .getByText("林老师的快速会议")
      .closest("article");
    expect(restoredMeetingRow).toBeTruthy();
    fireEvent.click(
      within(restoredMeetingRow as HTMLElement).getByRole("button", {
        name: "查看报告",
      }),
    );
    expect(screen.getByText("本地会话参与")).toBeTruthy();
  });

  it("本机历史报告模式冲突时会按会议记录回退到演示报告", async () => {
    window.localStorage.setItem(
      "learning-meetings-created",
      JSON.stringify([
        {
          id: "local-created-mode-conflict",
          day: "28",
          month: "今天",
          time: "刚刚",
          title: "模式冲突的本机会议",
          detail: "本机创建 · 仅当前演示可见",
          type: "普通会议",
          accent: "blue",
          roomId: "936217504",
          mode: "normal",
          autoMute: true,
          generateReport: true,
          reportGenerated: true,
          status: "past",
          reportSnapshot: {
            durationSeconds: 42,
            chatMessageCount: 0,
            publishedActivityCount: 0,
            publishedActivityIds: [],
            recordingAvailable: false,
            participantCount: 1,
            participantName: "林老师",
            meetingMode: "class",
          },
        },
      ]),
    );
    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: "我的会议" }));
    fireEvent.click(screen.getByRole("button", { name: /已结束/ }));

    await waitFor(() => expect(screen.getByText("模式冲突的本机会议")).toBeTruthy());
    const localMeetingRow = screen
      .getByText("模式冲突的本机会议")
      .closest("article");
    expect(localMeetingRow).toBeTruthy();
    fireEvent.click(
      within(localMeetingRow as HTMLElement).getByRole("button", {
        name: "查看报告",
      }),
    );

    expect(screen.getByText("参会人数")).toBeTruthy();
    expect(screen.queryByText("本地会话参与")).toBeNull();
  });

  it("旧本机普通会议历史缺少 mode 时会按会议类型恢复", async () => {
    window.localStorage.setItem(
      "learning-meetings-created",
      JSON.stringify([
        {
          id: "legacy-normal-local-meeting",
          day: "28",
          month: "今天",
          time: "刚刚",
          title: "旧版普通会议",
          detail: "本机创建 · 仅当前演示可见",
          type: "普通会议",
          accent: "blue",
          roomId: "936217506",
          status: "past",
          reportGenerated: true,
          reportSnapshot: {
            durationSeconds: 42,
            chatMessageCount: 2,
            publishedActivityCount: 0,
            publishedActivityIds: [],
            recordingAvailable: false,
            participantCount: 1,
            participantName: "林老师",
            meetingMode: "normal",
          },
        },
      ]),
    );
    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: "我的会议" }));
    fireEvent.click(screen.getByRole("button", { name: /已结束/ }));

    await waitFor(() => expect(screen.getByText("旧版普通会议")).toBeTruthy());
    const row = screen.getByText("旧版普通会议").closest("article");
    expect(row).toBeTruthy();
    fireEvent.click(
      within(row as HTMLElement).getByRole("button", { name: "查看报告" }),
    );

    expect(screen.getByText("本地会话参与")).toBeTruthy();
    expect(screen.queryByText("到课人数")).toBeNull();
  });

  it("旧本机记录缺少报告状态时会从自动报告选项推导", async () => {
    window.localStorage.setItem(
      "learning-meetings-created",
      JSON.stringify([
        {
          id: "local-created-legacy-report",
          day: "28",
          month: "今天",
          time: "刚刚",
          title: "旧版未生成报告的会议",
          detail: "本机创建 · 仅当前演示可见",
          type: "普通会议",
          accent: "blue",
          roomId: "936217505",
          mode: "normal",
          autoMute: true,
          generateReport: false,
          status: "past",
          reportSnapshot: {
            durationSeconds: 42,
            chatMessageCount: 0,
            publishedActivityCount: 0,
            publishedActivityIds: [],
            recordingAvailable: false,
            participantCount: 1,
            participantName: "林老师",
            meetingMode: "normal",
          },
        },
      ]),
    );
    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: "我的会议" }));
    fireEvent.click(screen.getByRole("button", { name: /已结束/ }));

    await waitFor(() => expect(screen.getByText("旧版未生成报告的会议")).toBeTruthy());
    const localMeetingRow = screen
      .getByText("旧版未生成报告的会议")
      .closest("article");
    expect(localMeetingRow).toBeTruthy();
    fireEvent.click(
      within(localMeetingRow as HTMLElement).getByRole("button", {
        name: "查看报告",
      }),
    );

    expect(screen.getByRole("button", { name: "立即生成报告" })).toBeTruthy();
  });

  it("全局搜索和通知浮层支持 Escape 关闭", () => {
    render(<Home />);
    const searchButton = screen.getByRole("button", { name: "搜索" });
    expect(searchButton.getAttribute("aria-expanded")).toBe("false");
    expect(searchButton.getAttribute("aria-controls")).toBe(
      "global-utility-panel-search",
    );
    fireEvent.click(searchButton);
    expect(searchButton.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("dialog", { name: "全局搜索" })).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "全局搜索" })).toBeNull();
    expect(searchButton.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(searchButton);

    const notificationsButton = screen.getByRole("button", { name: "通知" });
    expect(notificationsButton.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(notificationsButton);
    expect(notificationsButton.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("dialog", { name: "通知中心" })).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "通知中心" })).toBeNull();
    expect(notificationsButton.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(notificationsButton);
  });

  it("通知可以定位页面并全部标记为已读", () => {
    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: "通知" }));

    const panel = screen.getByRole("dialog", { name: "通知中心" });
    expect(within(panel).getByText("3 条未读")).toBeTruthy();
    fireEvent.click(within(panel).getByRole("button", { name: "全部已读" }));
    expect(within(panel).getByText("0 条未读")).toBeTruthy();
    expect(screen.getByRole("button", { name: "通知" }).querySelector("i")).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("通知已全部标记为已读");
    expect(
      JSON.parse(
        window.localStorage.getItem("learning-meeting-notification-read") ?? "[]",
      ),
    ).toEqual([
      "replay-ready",
      "defense-reminder",
      "attendance-alert",
    ]);

    fireEvent.click(
      within(panel).getByRole("button", {
        name: /课堂回放已生成/,
      }),
    );
    expect(screen.getByRole("heading", { name: "课堂回放" })).toBeTruthy();
  });

  it("通知已读状态会在重新挂载和同源窗口同步后保留", async () => {
    const first = render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: "通知" }));
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "通知中心" })).getByRole(
        "button",
        { name: /课堂回放已生成/ },
      ),
    );
    expect(
      JSON.parse(
        window.localStorage.getItem("learning-meeting-notification-read") ?? "[]",
      ),
    ).toEqual(["replay-ready"]);

    first.unmount();
    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: "通知" }));
    expect(
      within(screen.getByRole("dialog", { name: "通知中心" })).getByText("2 条未读"),
    ).toBeTruthy();

    window.localStorage.setItem(
      "learning-meeting-notification-read",
      JSON.stringify(["replay-ready", "defense-reminder"]),
    );
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "learning-meeting-notification-read",
        newValue: JSON.stringify(["replay-ready", "defense-reminder"]),
      }),
    );

    await waitFor(() => {
      expect(
        within(screen.getByRole("dialog", { name: "通知中心" })).getByText("1 条未读"),
      ).toBeTruthy();
    });
  });

  it("通知已读状态保存失败时仍更新页面并提示", () => {
    const setItemSpy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("storage unavailable");
      });
    try {
      render(<Home />);
      fireEvent.click(screen.getByRole("button", { name: "通知" }));
      const panel = screen.getByRole("dialog", { name: "通知中心" });
      fireEvent.click(within(panel).getByRole("button", { name: "全部已读" }));

      expect(within(panel).getByText("0 条未读")).toBeTruthy();
      expect(screen.getByRole("status").textContent).toContain("本机状态保存失败");
    } finally {
      setItemSpy.mockRestore();
    }
  });

  it("回放生成通知会直接打开对应回放查看器", () => {
    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: "通知" }));

    const panel = screen.getByRole("dialog", { name: "通知中心" });
    fireEvent.click(
      within(panel).getByRole("button", { name: /课堂回放已生成/ }),
    );

    expect(screen.queryByRole("dialog", { name: "通知中心" })).toBeNull();
    expect(screen.getByLabelText("回放播放器")).toBeTruthy();
    expect(
      within(screen.getByLabelText("回放播放器")).getByText(
        "第 3 讲 · 信息架构与导航设计",
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "通知" }));
    expect(
      within(screen.getByRole("dialog", { name: "通知中心" })).getByText(
        "2 条未读",
      ),
    ).toBeTruthy();
  });

  it("会议资料可以按来源筛选并查看文件详情", () => {
    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: "会议资料" }));

    fireEvent.click(screen.getAllByRole("button", { name: /课堂录制/ })[0]);
    expect(screen.getByText("课堂录制 · 交互设计第 2 讲.mp4")).toBeTruthy();
    expect(screen.queryByText("第 3 讲 · 信息架构课件.pptx")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /查看全部/ }));
    expect(screen.getByText("第 3 讲 · 信息架构课件.pptx")).toBeTruthy();

    const search = screen.getByRole("textbox", { name: "搜索文件或来源" });
    fireEvent.change(search, { target: { value: "毕业设计" } });
    expect(screen.getByText("毕业设计中期答辩安排.docx")).toBeTruthy();
    expect(screen.queryByText("第 3 讲 · 信息架构课件.pptx")).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: "查看毕业设计中期答辩安排.docx" }),
    );
    const details = screen.getByLabelText("资料详情");
    expect(within(details).getByText("毕业设计中期答辩安排.docx")).toBeTruthy();
    expect(within(details).queryByRole("button", { name: "移除资料" })).toBeNull();
    fireEvent.click(
      within(details).getByRole("button", { name: "关闭资料详情" }),
    );
    expect(screen.queryByLabelText("资料详情")).toBeNull();
    expect(search).toHaveProperty("value", "毕业设计");

    fireEvent.click(screen.getByRole("button", { name: /查看全部/ }));
    expect(search).toHaveProperty("value", "");
    expect(screen.getByText("第 3 讲 · 信息架构课件.pptx")).toBeTruthy();
  });

  it("资料详情打开后会显示可关闭的类型化本地预览", () => {
    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: "会议资料" }));
    const fileButton = screen.getByRole("button", {
      name: "查看第 3 讲 · 信息架构课件.pptx",
    });
    fireEvent.click(fileButton);

    const details = screen.getByLabelText("资料详情");
    const openFileButton = within(details).getByRole("button", { name: "打开资料" });
    fireEvent.click(openFileButton);
    const documentPreview = screen.getByLabelText("资料预览");
    expect(within(documentPreview).getByText("课件 · 本地预览")).toBeTruthy();
    expect(within(documentPreview).getByText("文档预览已就绪，接入真实文件后可查看课件内容。")).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByLabelText("资料预览")).toBeNull();
    expect(screen.getByLabelText("资料详情")).toBeTruthy();
    expect(document.activeElement).toBe(openFileButton);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByLabelText("资料详情")).toBeNull();
    expect(document.activeElement).toBe(fileButton);

    fireEvent.click(screen.getAllByRole("button", { name: /课堂录制/ })[0]);
    fireEvent.click(
      screen.getByRole("button", { name: "查看课堂录制 · 交互设计第 2 讲.mp4" }),
    );
    fireEvent.click(
      within(screen.getByLabelText("资料详情")).getByRole("button", {
        name: "打开资料",
      }),
    );
    expect(
      within(screen.getByLabelText("资料预览")).getByText(
        "视频预览已就绪，接入真实媒体后可在此播放。",
      ),
    ).toBeTruthy();
  });

  it("切换资料时会清理旧预览并保持详情内容一致", () => {
    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: "会议资料" }));
    fireEvent.click(
      screen.getByRole("button", { name: "查看第 3 讲 · 信息架构课件.pptx" }),
    );
    fireEvent.click(
      within(screen.getByLabelText("资料详情")).getByRole("button", {
        name: "打开资料",
      }),
    );
    expect(screen.getByLabelText("资料预览")).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: "查看课堂录制 · 交互设计第 2 讲.mp4" }),
    );

    expect(screen.queryByLabelText("资料预览")).toBeNull();
    expect(
      within(screen.getByLabelText("资料详情")).getByText(
        "课堂录制 · 交互设计第 2 讲.mp4",
      ),
    ).toBeTruthy();
  });

  it("会议资料可以按文件夹筛选并上传文件元数据", () => {
    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: "会议资料" }));

    fireEvent.click(screen.getAllByRole("button", { name: /课堂录制/ })[0]);
    expect(screen.getByText("课堂录制 · 交互设计第 2 讲.mp4")).toBeTruthy();
    expect(screen.queryByText("第 3 讲 · 信息架构课件.pptx")).toBeNull();

    const upload = screen.getByLabelText("选择要上传的资料");
    const file = new File(["mock"], "课堂补充资料.pdf", {
      type: "application/pdf",
    });
    fireEvent.change(upload, { target: { files: [file] } });

    expect(screen.getByText("课堂补充资料.pdf")).toBeTruthy();
    expect(screen.getByText("本地资料区 · 当前浏览器")).toBeTruthy();
    expect(screen.getByText("3 个文件 · 本地页面")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("已添加资料");
    expect(
      screen
        .getAllByRole("button", { name: /课堂录制/ })[0]
        .getAttribute("aria-pressed"),
    ).toBe("false");
  });

  it("本地上传资料可以下载当前页面保留的原文件", () => {
    const createObjectURL = vi.fn(() => "blob:material-download");
    const revokeObjectURL = vi.fn();
    vi.spyOn(URL, "createObjectURL").mockImplementation(createObjectURL);
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(revokeObjectURL);
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    const file = new File(["真实资料内容"], "可下载资料.pdf", {
      type: "application/pdf",
    });

    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: "会议资料" }));
    fireEvent.change(screen.getByLabelText("选择要上传的资料"), {
      target: { files: [file] },
    });
    fireEvent.click(screen.getByRole("button", { name: "查看可下载资料.pdf" }));
    fireEvent.click(
      within(screen.getByLabelText("资料详情")).getByRole("button", {
        name: "下载原文件",
      }),
    );

    expect(createObjectURL).toHaveBeenCalledWith(file);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:material-download");
    expect(click).toHaveBeenCalledOnce();
    expect(screen.getByRole("status").textContent).toContain("已下载资料");
    click.mockRestore();
  });

  it("当前页面上传的图片会使用真实本地对象 URL 预览", () => {
    const createObjectURL = vi.fn(() => "blob:image-preview");
    const revokeObjectURL = vi.fn();
    vi.spyOn(URL, "createObjectURL").mockImplementation(createObjectURL);
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(revokeObjectURL);
    const file = new File(["image-bytes"], "课堂截图.png", {
      type: "image/png",
    });

    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: "会议资料" }));
    fireEvent.change(screen.getByLabelText("选择要上传的资料"), {
      target: { files: [file] },
    });
    fireEvent.click(screen.getByRole("button", { name: "查看课堂截图.png" }));
    fireEvent.click(
      within(screen.getByLabelText("资料详情")).getByRole("button", {
        name: "打开资料",
      }),
    );

    expect(screen.getByRole("img", { name: "预览课堂截图.png" })).toBeTruthy();
    expect(createObjectURL).toHaveBeenCalledWith(file);
    fireEvent.click(screen.getByRole("button", { name: "关闭预览" }));
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:image-preview");
  });

  it("刷新后只有资料元数据时不会伪造原文件下载", () => {
    const first = render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: "会议资料" }));
    fireEvent.change(screen.getByLabelText("选择要上传的资料"), {
      target: {
        files: [new File(["内容"], "刷新后资料.pdf", { type: "application/pdf" })],
      },
    });
    first.unmount();

    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: "会议资料" }));
    fireEvent.click(screen.getByRole("button", { name: "查看刷新后资料.pdf" }));
    fireEvent.click(
      within(screen.getByLabelText("资料详情")).getByRole("button", {
        name: "下载原文件",
      }),
    );

    expect(screen.getByRole("status").textContent).toContain(
      "当前只恢复了资料元数据",
    );
  });

  it("单页应用在资料页与首页之间切换时会保留当前会话文件内容", () => {
    const createObjectURL = vi.fn(() => "blob:navigation-download");
    const revokeObjectURL = vi.fn();
    vi.spyOn(URL, "createObjectURL").mockImplementation(createObjectURL);
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(revokeObjectURL);
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    const file = new File(["navigation-content"], "跨页资料.pdf", {
      type: "application/pdf",
    });

    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: "会议资料" }));
    fireEvent.change(screen.getByLabelText("选择要上传的资料"), {
      target: { files: [file] },
    });
    fireEvent.click(screen.getByRole("button", { name: "会议首页" }));
    fireEvent.click(screen.getByRole("button", { name: "会议资料" }));
    fireEvent.click(screen.getByRole("button", { name: "查看跨页资料.pdf" }));
    fireEvent.click(
      within(screen.getByLabelText("资料详情")).getByRole("button", {
        name: "下载原文件",
      }),
    );

    expect(createObjectURL).toHaveBeenCalledWith(file);
    expect(screen.getByRole("status").textContent).toContain("已下载资料");
    click.mockRestore();
  });

  it("本地上传资料会进入全局搜索并能定位回资料详情", () => {
    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: "会议资料" }));

    const upload = screen.getByLabelText("选择要上传的资料");
    fireEvent.change(upload, {
      target: {
        files: [new File(["mock"], "全局搜索资料.pdf", { type: "application/pdf" })],
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "搜索" }));
    const searchPanel = screen.getByRole("dialog", { name: "全局搜索" });
    fireEvent.change(
      within(searchPanel).getByRole("textbox", { name: "全局搜索" }),
      { target: { value: "全局搜索资料" } },
    );

    const result = within(searchPanel).getByRole("button", {
      name: /全局搜索资料\.pdf/,
    });
    expect(result.textContent).toContain("本地上传");
    fireEvent.click(result);

    expect(screen.queryByRole("dialog", { name: "全局搜索" })).toBeNull();
    expect(screen.getByLabelText("资料详情")).toBeTruthy();
    expect(screen.getByLabelText("资料详情").textContent).toContain(
      "全局搜索资料.pdf",
    );
  });

  it("全局搜索同名资料时会按稳定标识打开对应记录", () => {
    window.localStorage.setItem(
      "learning-meeting-material-files",
      JSON.stringify([
        {
          id: "same-name-first",
          icon: "P",
          name: "同名精准资料.pdf",
          source: "本地上传",
          size: "1 KB",
          time: "刚刚",
          color: "orange",
          folder: "课件",
        },
        {
          id: "same-name-second",
          icon: "P",
          name: "同名精准资料.pdf",
          source: "本地上传",
          size: "2 MB",
          time: "昨天",
          color: "blue",
          folder: "白板",
        },
      ]),
    );

    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: "搜索" }));
    const searchPanel = screen.getByRole("dialog", { name: "全局搜索" });
    fireEvent.change(
      within(searchPanel).getByRole("textbox", { name: "全局搜索" }),
      { target: { value: "同名精准资料" } },
    );

    const results = within(searchPanel).getAllByRole("button", {
      name: /同名精准资料\.pdf/,
    });
    expect(results).toHaveLength(2);
    fireEvent.click(results[1]);

    expect(screen.getByLabelText("资料详情").textContent).toContain("2 MB");
    fireEvent.click(
      within(screen.getByLabelText("资料详情")).getByRole("button", {
        name: "打开资料",
      }),
    );
    expect(screen.getByLabelText("资料预览").textContent).toContain("白板");
  });

  it("本地资料元数据会在重新挂载后恢复", async () => {
    const first = render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: "会议资料" }));
    fireEvent.change(screen.getByLabelText("选择要上传的资料"), {
      target: {
        files: [new File(["mock"], "可恢复资料.pdf", { type: "application/pdf" })],
      },
    });

    await waitFor(() => {
      expect(
        JSON.parse(
          window.localStorage.getItem("learning-meeting-material-files") ?? "[]",
        ),
      ).toEqual([
        expect.objectContaining({
          name: "可恢复资料.pdf",
          source: "本地上传",
        }),
      ]);
    });

    first.unmount();
    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: "会议资料" }));
    expect(screen.getByText("可恢复资料.pdf")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "搜索" }));
    const panel = screen.getByRole("dialog", { name: "全局搜索" });
    fireEvent.change(within(panel).getByRole("textbox", { name: "全局搜索" }), {
      target: { value: "可恢复资料" },
    });
    expect(
      within(panel).getByRole("button", { name: /可恢复资料\.pdf/ }),
    ).toBeTruthy();
  });

  it("资料持久化恢复会遵守 160 个字符的文件名边界", async () => {
    const fileName = `${"长文件名".repeat(30)}.pdf`;
    expect(fileName.length).toBeGreaterThan(120);
    expect(fileName.length).toBeLessThanOrEqual(160);

    const first = render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: "会议资料" }));
    fireEvent.change(screen.getByLabelText("选择要上传的资料"), {
      target: {
        files: [new File(["mock"], fileName, { type: "application/pdf" })],
      },
    });
    await waitFor(() => {
      expect(window.localStorage.getItem("learning-meeting-material-files")).toContain(
        fileName,
      );
    });

    first.unmount();
    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: "会议资料" }));
    expect(screen.getByText(fileName)).toBeTruthy();
  });

  it("恢复资料元数据时会过滤异常记录并限制重复标识", () => {
    window.localStorage.setItem(
      "learning-meeting-material-files",
      JSON.stringify([
        { id: "bad", name: "异常资料.pdf", source: "云端" },
        {
          id: "local-valid-material",
          icon: "P",
          name: "合法资料.pdf",
          source: "本地上传",
          size: "1 KB",
          time: "刚刚",
          color: "orange",
          folder: "课件",
        },
        {
          id: "local-valid-material",
          icon: "P",
          name: "重复资料.pdf",
          source: "本地上传",
          size: "1 KB",
          time: "刚刚",
          color: "orange",
          folder: "课件",
        },
      ]),
    );

    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: "会议资料" }));
    expect(screen.getByText("合法资料.pdf")).toBeTruthy();
    expect(screen.queryByText("异常资料.pdf")).toBeNull();
    expect(screen.queryByText("重复资料.pdf")).toBeNull();
  });

  it("本机资料持久化失败时保留当前页面状态并提示", () => {
    const setItemSpy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("storage unavailable");
      });
    try {
      render(<Home />);
      fireEvent.click(screen.getByRole("button", { name: "会议资料" }));
      fireEvent.change(screen.getByLabelText("选择要上传的资料"), {
        target: {
          files: [new File(["mock"], "未持久化资料.pdf", { type: "application/pdf" })],
        },
      });

      expect(screen.getByText("未持久化资料.pdf")).toBeTruthy();
      expect(screen.getByRole("status").textContent).toContain(
        "本机状态保存失败",
      );
    } finally {
      setItemSpy.mockRestore();
    }
  });

  it("同源窗口移除资料后会清理当前页面的详情和预览", async () => {
    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: "会议资料" }));
    fireEvent.change(screen.getByLabelText("选择要上传的资料"), {
      target: {
        files: [new File(["mock"], "窗口资料.pdf", { type: "application/pdf" })],
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "查看窗口资料.pdf" }));
    const details = screen.getByLabelText("资料详情");
    fireEvent.click(within(details).getByRole("button", { name: "打开资料" }));
    expect(screen.getByLabelText("资料预览")).toBeTruthy();

    window.localStorage.setItem("learning-meeting-material-files", "[]");
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "learning-meeting-material-files",
        newValue: "[]",
      }),
    );

    await waitFor(() => {
      expect(screen.queryByText("窗口资料.pdf")).toBeNull();
      expect(screen.queryByLabelText("资料详情")).toBeNull();
      expect(screen.queryByLabelText("资料预览")).toBeNull();
    });
  });

  it("资料上传会拒绝空白或超长文件名并保留原列表", () => {
    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: "会议资料" }));
    const upload = screen.getByLabelText("选择要上传的资料");
    const initialRows = document.querySelectorAll(".file-row").length;

    fireEvent.change(upload, {
      target: {
        files: [new File(["mock"], `${"x".repeat(161)}.pdf`, { type: "application/pdf" })],
      },
    });
    expect(document.querySelectorAll(".file-row")).toHaveLength(initialRows);
    expect(screen.getByRole("status").textContent).toContain("文件名不能为空");

    fireEvent.change(upload, {
      target: {
        files: [new File(["mock"], "   ", { type: "application/octet-stream" })],
      },
    });
    expect(document.querySelectorAll(".file-row")).toHaveLength(initialRows);
    expect(screen.getByRole("status").textContent).toContain("文件名不能为空");
  });

  it("本地上传资料可以移除并同步关闭详情与预览", () => {
    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: "会议资料" }));

    const upload = screen.getByLabelText("选择要上传的资料");
    const file = new File(["mock"], "待移除资料.pdf", {
      type: "application/pdf",
    });
    fireEvent.change(upload, { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: "查看待移除资料.pdf" }));

    const details = screen.getByLabelText("资料详情");
    expect(within(details).getByRole("button", { name: "移除资料" })).toBeTruthy();
    fireEvent.click(within(details).getByRole("button", { name: "打开资料" }));
    expect(screen.getByLabelText("资料预览")).toBeTruthy();

    fireEvent.click(within(details).getByRole("button", { name: "移除资料" }));

    expect(screen.queryByText("待移除资料.pdf")).toBeNull();
    expect(screen.queryByLabelText("资料详情")).toBeNull();
    expect(screen.queryByLabelText("资料预览")).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("已移除资料");
  });

  it("重复上传同名资料时保留两条独立记录且不产生 key 警告", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(
      () => undefined,
    );
    render(<Home />);
    fireEvent.click(screen.getByRole("button", { name: "会议资料" }));

    const upload = screen.getByLabelText("选择要上传的资料");
    const file = new File(["mock"], "重复资料.pdf", {
      type: "application/pdf",
    });
    fireEvent.change(upload, { target: { files: [file] } });
    fireEvent.change(upload, { target: { files: [file] } });

    expect(screen.getAllByText("重复资料.pdf")).toHaveLength(2);
    expect(
      screen.getAllByRole("button", { name: "查看重复资料.pdf" }),
    ).toHaveLength(2);
    expect(
      consoleError.mock.calls.filter(
        ([message]) =>
          typeof message === "string" && message.includes("same key"),
      ),
    ).toHaveLength(0);
  });
});
