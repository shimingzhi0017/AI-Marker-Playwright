# AI阅卷工作台

面向教师的本地可视化 AI 阅卷工作台。当前主版本：**v2026.10.30**。

从“开始阅卷”主流程出发，完成评分方案、模型配置、页面检查、自动评分、人工确认、历史追踪与结果导出。

[下载 Windows 便携版 ZIP](https://github.com/shimingzhi0017/AI-Marker-Playwright/releases/latest/download/AI-Marker-Playwright-portable.zip) · [查看 v2026.10.30 发布说明](https://github.com/shimingzhi0017/AI-Marker-Playwright/releases/tag/v2026.10.30)

## 当前版本亮点

- **开始阅卷主流程**：打开阅卷浏览器、检查页面、选择运行模式并开始处理。
- **评分方案**：支持题目、参考答案、图片和公式预览，可生成并编辑评分标准。
- **单双评与仲裁**：支持主评、复评、客观题逐项比对、主观题分差判断及仲裁。
- **人工确认**：评分结果、识别内容和评分理由可在提交前检查与修改。
- **任务与历史**：支持独立并发任务、暂停、历史详情以及 JSON、CSV、带图 HTML 导出。
- **Windows 便携版**：ZIP 内置运行所需组件，解压后双击“启动工作台.cmd”即可使用，无需单独安装 Node.js。

## 快速开始

1. 下载便携版 ZIP，并先“全部解压”到普通文件夹。
2. 启动工作台，配置 AI 接口和阅卷方案。
3. 打开专用阅卷浏览器，登录并进入阅卷页面。
4. 点击“检查页面”，确认识别结果后开始阅卷。
5. 首次使用建议选择“人工确认”或“只填分”，确认网站流程稳定后再启用自动提交。

## 安装源码版

需要 Node.js 24 或更新的 LTS 版本：

```powershell
npm.cmd ci
npx playwright install chromium
npm.cmd run ui
```

Windows 也可以双击 `启动可视化.cmd`。详细步骤见[首次运行说明](首次运行说明.md)。

## 测试与验证

当前版本已通过 **103 项本地自动化测试**：

```powershell
npm.cmd test
npm.cmd run check:browser
```

自动测试使用本地模拟网页和模型服务，不会向真实平台提交分数。真实网站的登录、评分准确率和自动提交仍需在实际环境中逐平台验收。

## 项目资料

- [发布说明](release-notes.md)
- [测试报告](测试报告.md)
- [验证与待办](验证与待办.md)
- [首次运行说明](首次运行说明.md)
- [功能迁移对照](原版功能对照.md)

项目配置、API 密钥、任务、答卷、历史和登录资料保存在本机，不包含在发布包和 GitHub 仓库中。

本项目遵循 GPL-3.0，第三方声明见 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)。
