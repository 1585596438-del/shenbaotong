# RAG知识问答库 Implementation Plan

> 执行方式：用户已明确要求开始搭建，由当前会话直接执行。先完成系统，再导入真实资料验证；不扩展到推荐、资格核验与材料清单。参考 writing-plans 和 executing-plans 的任务与验证流程。

**Goal:** 建立支持文本/TXT/PDF入库、持久化、检索、引用问答和来源查看的本地知识库。

**Architecture:** Next.js页面与服务端接口，SQLite事务保存文档及片段，按文档范围进行中文关键词检索及可配置的向量检索。兼容chat/completions与embeddings服务端接口；未配置服务时只展示原文片段并标记模式。

**Tech Stack:** Next.js、React、TypeScript、better-sqlite3、PDF.js、Node test＋tsx。

**Spec:** 根目录《申报通-项目开发流程框架.md》中的导入、检索问答、来源和恢复部分；用户本轮要求限定为RAG知识库。

## Global Constraints

- 本地单人工作区，只监听127.0.0.1。
- 单文件10MB、50页；保存PDF页码或文本段落；扫描件明确报错。
- 默认不录入样例知识。系统搭建后导入用户提供的两份真实附件验证。
- 引用必须属于本次检索片段，片段必须来自所选文档范围。
- 未接API时显示“原文检索”，不能宣称已完成真实大模型与向量API验证。
- 重新索引失败保留旧数据；不同嵌入模型不混用；重复导入不重复创建。

## Review Focus

1. 分块不能丢失后半段文字、混合页码或截掉表格行。
2. 限定文档时不能引用其他文档，未知问题不能借无关片段作答。
3. 模型产生未知引用、空引用或失效引用时不能显示为有依据回答。
4. 导入、重复导入、删除与索引失败要保持数据库一致。
5. API响应无效、超时、模型变更以及文件异常都要显示可恢复的明确状态。

## Task 1：数据、分块与原文检索

**Files:** src/server/types.ts、chunking.ts、store.ts、retrieval.ts；tests/core.test.ts。

**Interfaces:** splitPages(pages: PageText[]): ChunkDraft[]；KnowledgeStore目录、文档、片段及问答记录；rankChunks(question, chunks, vectors?)返回带来源的排序结果。

- [x] 先写来源定位、中文召回、文档隔离、重复导入及持久化测试并观察失败。
- [x] 实现真实SQLite事务与按页/段落分块，空文本拒绝。
- [x] 实现中文词与双字片段检索、可选余弦向量融合，并测试无关查询拒绝。
- [x] 运行 npm test，对应测试全部通过。

## Task 2：文档与模型接入

**Files:** src/server/documents.ts、provider.ts、rag.ts、http.ts；tests/rag.test.ts。

**Interfaces:** parseDocument(bytes, fileName)返回PageText[]；embedTexts(texts)返回同维度向量；answerQuestion(question, documentIds)返回mode、answer、citations、warnings。

- [x] 先写无API降级、无依据、非法引用、错误嵌入及模型失败测试并观察失败。
- [x] 实现PDF/TXT解析、大小页数校验、服务端模型配置、批量索引与引用校验。
- [x] API错误保留已导入正文，不暴露认证响应；索引使用原子替换。
- [x] 运行 npm test 和 npm run typecheck。

## Task 3：接口与页面

**Files:** src/app/api/**、src/app/page.tsx、layout.tsx、globals.css；src/components/workspace.tsx。

**Interfaces:** GET/POST /api/documents、GET/DELETE /api/documents/:id、POST /api/documents/:id/index、POST /api/questions、GET /api/status。

- [x] 实现空知识库、导入表单、文档筛选、原文面板、问答与引用卡片。
- [x] 用接口检查异常输入和状态，再用浏览器验证导入、问答、切换来源和移动端。
- [x] npm run build 完成生产编译。

## Task 4：真实资料验证与交付

**Files:** scripts/validate-data.ts、README.md、docs/RAG验证记录.md。

- [x] 系统搭建后，将两份真实附件经导入接口入库。
- [x] 验证84项目录末页、学校分类条款和未知问题；保留各自页码。
- [x] 验证重复导入、指定文档、重启持久化与生产页面。
- [x] 完成独立代码审查，修复重要问题，记录最终验证与API未验证的边界。

## 执行记录

初始状态：目录没有代码和Git仓库。使用现有工作区开发；不创建额外工作树。Git初始化及提交在实际代码验证后进行，若受到权限约束以真实状态记录。
