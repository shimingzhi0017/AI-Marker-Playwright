# 上游代码来源

本项目复用AI-Marker-Suite的提示词构建、评分计算及27个网站适配器源代码：

- 来源：https://github.com/five-plus-one/AI-Marker-Suite
- 提交：8348fe411ed238f1cfe498f5e77ee34ff6398c6d
- 文件：vendor/prompt.js、vendor/score.js、vendor/adapters/（保留原始源文件）
- 作者：5plus1及上游贡献者
- 授权：GPL-3.0，全文见LICENSE。

本迁移项目作为衍生项目按GPL-3.0提供，保留来源及许可证。npm依赖分别适用各自包中的许可证。

网站适配器通过src/suite-adapters.mjs兼容层接入Playwright。兼容层不运行原油猴UI注册、页面设置钩子，光大V2的无关请求阻断已移除。桌面工具负责图片下载及提交回执验证。
