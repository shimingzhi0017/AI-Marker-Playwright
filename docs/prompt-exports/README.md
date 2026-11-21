# AI生成评分标准：提示词导出

本目录由项目真实生成函数离线导出。运行命令：`node scripts/export-prompts.mjs`。

## 阅读说明

当前功能根据教师提供的题目和参考答案生成评分标准；answer字段忠实识别已有参考答案，不是无输入自动解题。一般建议写入warnings；影响可执行标准的关键问题写入blockingIssues，无法确定正确答案或给分边界时停止生成可执行标准。

以下为自动区分题型、总分10分、步长1分、无图片的模板快照，题目、答案及分值分配使用明确占位文字，并非当前教师方案。实际请求会带入实际设置和图片；粘贴到其他工具前需替换占位内容并提供对应图片。

## 本次优化

- 理科三档口径再校准：宽松模式下，答案正确且有相关解题过程即可给分（默认满分），不苛求过程严谨或完整；正常模式下，答案正确且写有相关有效过程应给分、不因过程不完整判零，足以支持结论时给满分，否则按有效内容给部分分。
- 文科独立模板与宽严分化：语文、英语、政治、历史、地理使用文科专用采分、同义概括与等级评价条款，彻底剥离残留数理过程与错算表述及非必要 LaTeX 要求，并为 `answers`/`holistic` 补齐宽松、正常、严格三档差异。
- 七科真实阅卷细节补强：补全语文默写/文言/作文、英语应用文/读后续写、化学用语/热化学/实验、生物遗传/光合/对照、政治模块与双层赋分、历史史料/小论文及地理因果链规则。
- 九学科 26 组可选题型细分（`taskType`）：生成弹窗与阅卷共用细分模板；物理电磁/实验与图像题自动剥离运动学刹车示范。
- 生成后质量自检（`lintGeneratedRubric`）：自动拦截“酌情扣分”等模糊条款、非分档区间分值与模式冲突，并提示教师确认。
- 物理按量定义、方向、参考系、零点、实际代入和适用条件核验等价性；接受刹车时用加号公式代入负加速度、负电流表示反向及等价整体变号等自洽写法。
- 区分做功定义、变化量与减少量、表压与绝对压强、速度与速率等实质差别。
- 仅将本题相关边界写入各小问，避免把所有专题要求机械加入每题；参考答案识别与核验分开，不静默改原答案，不猜补学生过程。

## 优先查看物理完整提示词

[宽松](physics-lenient.txt) · [正常](physics-normal.txt) · [严格](physics-strict.txt)

## 九学科、三种口径

| 学科 | 宽松 | 正常 | 严格 |
| --- | --- | --- | --- |
| 语文 | [查看](chinese-lenient.txt) | [查看](chinese-normal.txt) | [查看](chinese-strict.txt) |
| 数学 | [查看](mathematics-lenient.txt) | [查看](mathematics-normal.txt) | [查看](mathematics-strict.txt) |
| 英语 | [查看](english-lenient.txt) | [查看](english-normal.txt) | [查看](english-strict.txt) |
| 物理 | [查看](physics-lenient.txt) | [查看](physics-normal.txt) | [查看](physics-strict.txt) |
| 化学 | [查看](chemistry-lenient.txt) | [查看](chemistry-normal.txt) | [查看](chemistry-strict.txt) |
| 生物 | [查看](biology-lenient.txt) | [查看](biology-normal.txt) | [查看](biology-strict.txt) |
| 政治 | [查看](politics-lenient.txt) | [查看](politics-normal.txt) | [查看](politics-strict.txt) |
| 历史 | [查看](history-lenient.txt) | [查看](history-normal.txt) | [查看](history-strict.txt) |
| 地理 | [查看](geography-lenient.txt) | [查看](geography-normal.txt) | [查看](geography-strict.txt) |

[全部27份提示词及示例设置（JSON）](all-prompts.json)

导出与规则传递测试不等于真实模型判分验收；应使用已判分答卷试评。

## 九学科真实阅卷规则更新

已逐科补充真实场景，并同步用于标准生成和阅卷。执行中的规则缺失、矛盾及关键资料缺失使用gradingIssues报告，程序强制转人工确认；不与字迹识别混为一类。

- [语文完整 Markdown](语文.md)

- [数学完整 Markdown](数学.md)

- [英语完整 Markdown](英语.md)

- [物理完整 Markdown](物理.md)

- [化学完整 Markdown](化学.md)

- [生物完整 Markdown](生物.md)

- [政治完整 Markdown](政治.md)

- [历史完整 Markdown](历史.md)

- [地理完整 Markdown](地理.md)

[按学科拆分的 ZIP](九学科提示词-按学科拆分.zip)。在 Windows 运行 `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/package-prompts.ps1` 可重新生成 Markdown 和压缩包。执行策略参数只用于本次进程。
