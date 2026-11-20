# 织序 LoomOps v1.1

织序是一个多 Agent 编排、调度与验证原型。它用经营订单质检演示并行派工、结构化结果核验、失败反馈和局部分支重跑。

## 在本机复现

**网页开发版**需要 Node.js 22 或更高版本。在仓库根目录运行以下命令，然后用浏览器打开 `http://127.0.0.1:4173`。

```powershell
node loomops/server.mjs
```

**Windows 桌面版**需要 Windows 10/11 x64、.NET Framework 4.8 和 WebView2 Runtime。编译所需的 WebView2 SDK 文件和声明随仓库提供。在仓库根目录用 PowerShell 运行：

```powershell
.\desktop\build.ps1
```

构建后双击 `desktop-package-v1.1\LoomOps\LoomOps.exe`。同目录的 DLL 需要随程序一起分发。

## 验收演示

1. 进入「工作流编排」并确认使用「离线演示」。默认任务已带 8 条样例订单。
2. 点击「运行工作流」。在「执行事件」中观察首次验证未通过、证据缺失、反馈第 1 轮和重新派工。
3. 检查最终状态为「已通过」，报告显示 **6 笔有效订单、¥73,250.00 有效收入和 3 项异常**。
4. 在「运行记录」打开此次运行的详情，可导出快照或从历史工作流配置重跑。

离线演示在首次分析中模拟缺失证据，使用固定样例可重复触发反馈。要测试实时模式，在「模型设置」选择「DeepSeek 实时推理」，输入自己的 API Key，测试连接并保存，再运行任务。分析和复核分别调用模型，运行详情记录模型调用次数。实时结果及用时会受模型和网络影响。

## 自动测试

```powershell
node --test loomops/test.cjs
```

测试覆盖 CSV 与计算基准、离线反馈闭环、人工审核、模型反馈传递、依赖图校验和 DeepSeek HTTP 错误处理。自动测试使用模拟请求，可离线运行。

## 源码结构

| 路径 | 用途 |
| --- | --- |
| `loomops/dist/engine.js` | CSV 扫描、依赖图、Agent 筛选、验证与重跑 |
| `loomops/dist/app.js` | 编排界面、模型设置、报告和运行记录 |
| `loomops/server.mjs`、`loomops/proxy.mjs` | 本地网页服务和 DeepSeek 请求代理 |
| `desktop/Program.cs`、`desktop/DeepSeekClient.cs` | Windows 窗口、内嵌 WebView2 和桌面模型接入 |
| `desktop/build.ps1` | Windows 桌面版构建入口 |
| `desktop-deps/webview2/` | WebView2 SDK 构建文件、许可和声明 |

## AI 使用说明

开发过程中使用 Codex 辅助生成代码、排查问题和验证构建。实时运行使用 DeepSeek 生成分析和复核结果。订单统计、规则检索、任务分配与结构化校验由程序执行。离线模式使用模拟输出，以便复现反馈过程。
