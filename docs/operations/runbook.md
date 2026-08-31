# 本地运行手册

本项目当前是学习通会议前端原型，包含同源本地 WebRTC 实验。没有生产环境、服务端
信令、账号系统、跨设备通信、TURN 中继或云端录制；不要把本地运行结果当作生产可用性
证明。

## 环境

- 工作目录：仓库根目录下的 `web/`。
- Node.js：`web/package.json` 要求 `>=22.13.0`。
- 包管理器：使用 npm 和已提交的 `web/package-lock.json`。
- 本地预约数据：仅保存在当前浏览器的 `localStorage`，键名为
  `learning-meeting-scheduled`；不保存凭据。
- 通知已读状态：仅保存在当前浏览器的 `localStorage`，键名为
  `learning-meeting-notification-read`；只记录已知通知 ID，不保存通知正文或凭据。

## 启动与验证

```powershell
cd F:\ai研发\agent-friendly-project-skeleton\web
npm ci
npm run dev
```

开发服务默认监听 `http://localhost:3000/`。提交 Web 改动前运行：

```powershell
npm run check       # 测试、类型检查、生产构建
npm run lint
cd ..
git diff --check
```

测试使用 Vitest、jsdom、Testing Library 和 fake MediaStream、BroadcastChannel、
RTCPeerConnection，不需要摄像头、麦克风或浏览器自动化。当前自动化门禁不能证明真实
硬件质量、浏览器兼容性或跨网络连通性。

如需验证生产构建产物：

```powershell
cd F:\ai研发\agent-friendly-project-skeleton\web
npm run build
npm run start
```

## 健康检查与日志

确认开发服务是否监听：

```powershell
Get-NetTCPConnection -LocalPort 3000 -State Listen
```

查看占用进程：

```powershell
$listener = Get-NetTCPConnection -LocalPort 3000 -State Listen
Get-Process -Id $listener.OwningProcess
```

开发和生产启动日志直接输出到启动它的终端。当前没有独立健康接口、指标、告警或
生产值班系统。

## 常见故障

| 现象 | 可能原因 | 安全诊断方式 | 恢复方法 |
| --- | --- | --- | --- |
| `npm ci` 或脚本无法运行 | Node 版本过低或依赖未安装 | `node --version`、确认当前目录为 `web/` | 安装满足版本要求的 Node，再重新执行 `npm ci` |
| 3000 端口无法启动 | 已有开发服务占用 | 使用上面的 `Get-NetTCPConnection` 只读检查 | 保留现有服务，或执行 `npm run dev -- --port 3001` |
| 设备请求失败 | 权限拒绝、设备被占用或没有设备 | 查看会中错误提示，确认 `getUserMedia` 错误类型 | 释放设备、修正权限后点击“重新加入”；不要修改代码绕过权限 |
| 两个窗口无法连接 | 房间号不同、不是同源地址或一方未加入 | 确认两边使用同一房间号和同一 localhost 地址 | 双方离开后使用同一房间号重新加入；本实验不支持跨设备 |
| 预约恢复为空 | 当前浏览器存储不可用或数据格式无效 | 查看页面提示；只读检查对应 localStorage 键是否存在 | 重新预约；不要清除整个浏览器存储 |
| 自动化测试失败 | 代码回归或测试环境被残留进程影响 | 先运行 `npm test`，再运行目标测试文件 | 根据失败断言修复代码；不使用浏览器自动化替代测试 |

## 发布与回退

当前仓库没有配置正式发布流水线。交付前仅以 `npm run check`、`npm run lint` 和
`git diff --check` 作为代码门禁；生产部署、域名、凭据和回退由后续平台接入时另行
定义。在没有明确部署记录前，不执行删除、覆盖或回退操作。

## 数据安全

- 不把账号、访问令牌、真实课程名单或会议隐私数据写入仓库、任务文档或日志。
- 演示预约只写入当前浏览器的 `learning-meeting-scheduled` 键；快速会议历史和本地
  会话快照写入 `learning-meetings-created`，回放发布标记写入
  `learning-meeting-published-replay`，通知已读状态写入
  `learning-meeting-notification-read`。
- 如需清理演示数据，只删除已确认的精确键；先确认目标 origin，不要清空整个
  `localStorage` 或用户浏览器数据。
- 本地 WebRTC 媒体只应在用户明确授权后采集，并仅用于同源窗口实验；不要据此推断
  已具备生产级隐私、访问控制或合规能力。

