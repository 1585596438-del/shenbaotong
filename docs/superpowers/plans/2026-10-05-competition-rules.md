# 结构化竞赛规则库 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有申报通工作台增加有原文依据、可审核发布的竞赛规则库，完成三个赛事的草稿录入和真实资料验证。

**Architecture:** 在现有 SQLite 数据库增量新增赛事、赛道、规则版本和字段依据四张表。规则维护与原文删除共享数据库连接和事务；Next.js 服务端验证字段、来源与版本，React 页面显示可编辑规则和原文。录入脚本只创建草稿，不自动确认或发布。

**Tech Stack:** 现有 Next.js、React、TypeScript、better-sqlite3、node:test＋tsx；不新增产品依赖，不调用模型 API。

**Spec:** `docs/superpowers/specs/2026-10-05-competition-rules-design.md`，用户已确认。

**执行状态：** 用户已审阅计划并选择子代理分任务执行。2026-10-06继续：Task 1～5已完成双阶段审查；Task 5保存为本地提交163d79a，主会话完整回归82/82、类型检查及生产构建通过。下一执行点为Task 6列表建档页面，Task 6～9待实施。

---

## 执行边界与工作区

- 使用 `C:/Users/Lenovo/Desktop/传智杯` 当前工作区及 `feat/rag-knowledge-base`，已有数据库和运行中的本地服务；不移动或重建用户目录。
- 开发前记录 Git 状态，保留用户改动。数据库新增前，使用 better-sqlite3 的 backup 方法将当前数据库备份到忽略目录 `artifacts/backups/`；不要直接复制正在写入的 WAL 数据库文件。
- 原文、密钥、数据库、截图和真实验证输出继续留在被忽略目录；日志不输出环境变量或密钥。
- Windows Git 写操作、Node 运行及受限网络操作按实际沙箱审批执行；需要权限不等于测试失败。
- 本轮不实现 AI 提取、专业推荐、资格结论或清单；页面标签说明后续用途，不把规则发布显示成资格批准。
- 先实施并验证软件，再经同样接口录入真实资料。测试使用临时数据库，不删除用户原文。

## 文件职责与接口契约

| 文件 | 职责 |
| --- | --- |
| `src/server/competitions/types.ts` | 规则字段、赛事、赛道、版本、请求和响应类型 |
| `src/server/competitions/validation.ts` | 纯函数校验字段类型、日期、范围、发布状态与来源适用性 |
| `src/server/competitions/store.ts` | 四表初始化、建档、版本、证据、事务发布和来源失效 |
| `src/server/store.ts` | 初始化 CompetitionStore，删除资料时先撤销关联规则 |
| `src/server/competitions/http.ts` | 64KB JSON 请求、统一错误码及 NextResponse |
| `src/app/api/competitions/**/route.ts` | 6 个新接口，复用 checkOrigin 和现有 getStore |
| `src/components/competition-library.tsx` | 赛事/赛道列表、新建、详情和版本入口 |
| `src/components/rule-editor.tsx` | 草稿表单、原文依据、确认及发布 |
| `src/components/rule-field.tsx` | 各字段值编辑、未知状态和确认控件 |
| `src/components/rule-source-picker.tsx` | 选择文档与片段、适用说明、原文定位 |
| `src/components/workspace.tsx` | 新入口与返回问答的资料范围，不重构原有问答 |
| `src/app/globals.css` | 复用样式，补充规则页和响应式布局 |
| `src/server/competitions/seed.ts` | 校验资料哈希、唯一锚点、幂等录入 |
| `scripts/import-competition-rules.ts` | 本地脚本入口，关闭连接，不自动确认发布 |
| `docs/competition-rule-seeds-2026-10-05.json` | 三个赛道的公开来源映射与待审核字段草稿 |
| `tests/competitions.test.ts` | 数据校验、版本、证据、删除和发布事务测试 |
| `tests/competition-routes.test.ts` | 真实 Request 与接口错误码测试 |
| `tests/competition-seed.test.ts` | 哈希/锚点、重复录入和不覆盖编辑测试 |
| `tests/helpers/competition-fixture.ts` | 临时数据库和可追溯的简短测试原文 |
| `docs/竞赛规则开发与验证记录.md` | 操作结果、事实核对、限制和复现步骤 |

所有下文命令以项目根目录为工作目录。Node test 命令用显式文件名，不依赖 Windows 通配符展开。

### 固定数据契约

规则正文使用扁平字段路径表达设计中的分组，页面按分组显示。字段值没有执行含义，不允许表达式。下面的类型是各任务共享的契约，实施时写入 types.ts：

```ts
export type RuleState = "unknown" | "unreviewed" | "confirmed" | "conflict";
export type VersionState = "draft" | "published" | "archived" | "needs_review";
export type RuleKind = "text" | "texts" | "integer" | "boolean" | "date" | "material";
export type Deadline = {
  itemId: string; name: string; stage: string; precision: "date" | "datetime";
  value: string; timezone: "Asia/Shanghai";
};
export type Material = {
  itemId: string; name: string; stage: string;
  requirement: "required" | "optional" | "unknown"; condition: string;
};
export type RuleValue = string | string[] | number | boolean | Deadline | Material;
export type RuleField = { kind: RuleKind; value: RuleValue | null; state: RuleState; note: string };
export type FixedFieldPath =
  | "content.summary" | "content.contestFormat" | "content.entryPath"
  | "content.technicalRequirements" | "student.levels" | "student.fullTimeRequired"
  | "student.majorRestrictions" | "student.gradeRestrictions"
  | "team.studentMin" | "team.studentMax" | "team.teacherMin" | "team.teacherMax"
  | "team.totalTeamMax" | "team.teachersCountTowardTotal" | "team.sameSchoolRequired"
  | "team.teacherRequirements" | "tags.majors" | "tags.skills" | "tags.interests"
  | "school.name" | "school.category" | "school.basisYear";
export type FieldPath = FixedFieldPath | `deadlines.${string}` | `materials.${string}`;
export type RuleSource = { documentId: string; applicabilityNote: string; confirmed: boolean };
export type RuleBody = { schemaVersion: 1; sources: RuleSource[]; fields: Partial<Record<FieldPath, RuleField>> };
export type EvidenceInput = { fieldPath: FieldPath; documentId: string; chunkId: string };
export type Competition = {
  id: string; name: string; aliases: string[]; catalogNumber: number | null;
  catalogYear: number | null; officialUrl: string; createdAt: string;
};
export type CompetitionEvent = {
  id: string; competitionId: string; editionLabel: string;
  yearStart: number; yearEnd: number; trackName: string; stage: string;
  sourceDocumentIds: string[]; createdAt: string;
};
export type RuleVersion = {
  id: string; eventId: string; version: number; status: VersionState;
  body: RuleBody; evidence: EvidenceInput[]; editRevision: number;
  createdAt: string; updatedAt: string; publishedAt: string | null;
};
export type CreateCompetition = Omit<Competition, "id" | "createdAt">;
export type CreateEvent = Omit<CompetitionEvent, "id" | "createdAt" | "sourceDocumentIds">;
export type SaveDraft = { expectedRevision: number; body: RuleBody; evidence: EvidenceInput[] };
export type EventDetail = {
  competition: Competition; event: CompetitionEvent; versions: RuleVersion[];
  current: RuleVersion | null; draft: RuleVersion | null;
};
export type PublicationIssue = { fieldPath: string; message: string };
export class CompetitionError extends Error {
  constructor(message: string, public status: 400 | 404 | 409 = 400) { super(message); }
}
```

`getDetail(eventId)` 返回 EventDetail；`list()` 返回 `{ competition, event, current, draft }[]`，current 只查 status=published，不能按最大版本号查找。

CompetitionStore 的公开方法：createCompetition(input)、createEvent(input)、list()、getDetail(eventId)、getVersion(versionId)、ensureDraft(eventId)、saveDraft(versionId,input)、publish(versionId,expectedRevision)、invalidateDocument(documentId)。所有查询返回解析后的 JSON，未知 ID 抛 CompetitionError(404)。ensureDraft 在无草稿时从 current 克隆，没有 current 时生成空字段；若最新历史版本 needs_review，允许克隆成草稿，但撤销全部字段确认并去掉失效依据。

数据方法的输入/输出签名固定为：

```ts
createCompetition(input: CreateCompetition): Competition;
createEvent(input: CreateEvent): CompetitionEvent;
getDetail(eventId: string): EventDetail;
getVersion(versionId: string): RuleVersion;
ensureDraft(eventId: string): RuleVersion;
saveDraft(versionId: string, input: SaveDraft): RuleVersion;
publish(versionId: string, expectedRevision: number): RuleVersion;
invalidateDocument(documentId: string): void;
publicationIssues(event: CompetitionEvent, competition: Competition, version: RuleVersion): PublicationIssue[];
```

publicationIssues 是store内部校验，调用 validation.ts 的 `collectPublicationIssues(body:RuleBody,evidence:EvidenceInput[]):PublicationIssue[]` 检查纯状态规则，再补充从当前数据库查到的来源适用性及片段真实性问题。validateCreateCompetition/validateCreateEvent/validateEvidenceInputs/validateSaveDraft 均接收unknown，返回对应类型，不直接信任类型断言。

固定字段定义在types.ts，字段编辑器和服务端共用；该文件只能包含纯类型和纯数据，不导入数据库或Node环境配置：

```ts
export const FIELD_DEFINITIONS: Array<{ path: FixedFieldPath; kind: RuleKind; label: string }> = [
  { path: "content.summary", kind: "text", label: "比赛内容" },
  { path: "content.contestFormat", kind: "text", label: "比赛形式" },
  { path: "content.entryPath", kind: "text", label: "参赛途径" },
  { path: "content.technicalRequirements", kind: "texts", label: "技术要求" },
  { path: "student.levels", kind: "texts", label: "学生层次" },
  { path: "student.fullTimeRequired", kind: "boolean", label: "要求全日制" },
  { path: "student.majorRestrictions", kind: "text", label: "专业限制" },
  { path: "student.gradeRestrictions", kind: "text", label: "年级限制" },
  { path: "team.studentMin", kind: "integer", label: "学生人数下限" },
  { path: "team.studentMax", kind: "integer", label: "学生人数上限" },
  { path: "team.teacherMin", kind: "integer", label: "教师名额下限" },
  { path: "team.teacherMax", kind: "integer", label: "教师名额上限" },
  { path: "team.totalTeamMax", kind: "integer", label: "团队总名额上限" },
  { path: "team.teachersCountTowardTotal", kind: "boolean", label: "教师计入团队总名额" },
  { path: "team.sameSchoolRequired", kind: "boolean", label: "学生须同校" },
  { path: "team.teacherRequirements", kind: "text", label: "教师与指导组要求" },
  { path: "tags.majors", kind: "texts", label: "建议专业" },
  { path: "tags.skills", kind: "texts", label: "建议技能" },
  { path: "tags.interests", kind: "texts", label: "兴趣方向" },
  { path: "school.name", kind: "text", label: "认定学校" },
  { path: "school.category", kind: "text", label: "学校竞赛类别" },
  { path: "school.basisYear", kind: "integer", label: "学校认定适用年" }
];
export function emptyRuleBody(): RuleBody {
  return { schemaVersion: 1, sources: [], fields: {} };
}
```

## Task 1：字段模型与纯函数校验

**Files:** Create types.ts、validation.ts、tests/competitions.test.ts。

- [x] **Step 1：写字段、未知值和日期边界测试。** 验证整数非负、上下限、unknown=null、禁止伪造时刻和无效日历日期。使用下面的测试入口，后续每类约束补一个有业务区别的案例。

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { validateBody, validateCalendar } from "../src/server/competitions/validation";
test("未知不是无限制，人数上下限不能倒置", () => {
  const base = { schemaVersion: 1 as const, sources: [], fields: {} };
  assert.doesNotThrow(() => validateBody(base));
  assert.throws(() => validateBody({ ...base, fields: {
    "team.studentMax": { kind: "integer", value: 0, state: "unknown", note: "" }
  }}), /未知/);
  assert.throws(() => validateBody({ ...base, fields: {
    "team.studentMin": { kind: "integer", value: 4, state: "unreviewed", note: "" },
    "team.studentMax": { kind: "integer", value: 3, state: "unreviewed", note: "" }
  }}), /最小/);
});
test("日期精度和真实日历日期独立校验", () => {
  assert.doesNotThrow(() => validateCalendar("2026-07-20", "date"));
  assert.doesNotThrow(() => validateCalendar("2026-07-20T15:00:00+08:00", "datetime"));
  assert.throws(() => validateCalendar("2026-02-30", "date"), /日期/);
  assert.throws(() => validateCalendar("2026-07-20T23:59:00+08:00", "date"), /精度/);
});
```

- [x] **Step 2：运行测试观察缺少模块的失败。** `npx tsx --test tests/competitions.test.ts`。预期首次失败为未实现模块，不把权限异常计为红灯。
- [x] **Step 3：实现上方类型与验证入口。** `validateBody(value: unknown): RuleBody` 逐项验证后返回新构造对象，拒绝未知对象键和路径；不通过类型断言直接接受网络输入。固定路径与 kind 一一对应；deadlines.* 必须 date，materials.* 必须 material。未知值必须 null，有值不能为 null；空字符串或空数组不能代表确定“不限”，使用明确文字。核心日期函数如下：

```ts
export function validateCalendar(value: string, precision: "date" | "datetime") {
  const pattern = precision === "date"
    ? /^\d{4}-\d{2}-\d{2}$/
    : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+08:00$/;
  if (!pattern.test(value)) throw new Error("日期精度不正确。");
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  const dayDate = new Date(Date.UTC(year, month - 1, day));
  if (dayDate.getUTCFullYear() !== year || dayDate.getUTCMonth() !== month - 1 || dayDate.getUTCDate() !== day)
    throw new Error("日期不存在。");
  if (precision === "datetime") {
    const [hour, minute, second] = value.slice(11, 19).split(":").map(Number);
    if (hour > 23 || minute > 59 || second > 59) throw new Error("日期时刻不正确。");
  }
}
```

具体上限：名字及赛事别名160字、说明/规则正文2000字、适用说明500字、路径/itemId80字；sources最多30、fields最多100、规则文本数组最多30项且每项80字、deadline/material各最多20条；人数整数0—1000，school.basisYear及赛道年份2000—2100。JSON 按 UTF-8 字节最多65536。material 与 date 的 itemId 必须等于路径后缀，防止换排序后依据错位。固定字段可缺省，前端补显示 unknown。验证方法名固定为 validateBody、validateCreateCompetition、validateCreateEvent、validateEvidenceInputs、validateSaveDraft、validateCalendar、collectPublicationIssues，不再增加第二套规则定义。

- [x] **Step 4：运行同一测试命令，预期全部字段测试通过。** 然后 `npm run typecheck` 检查契约类型。
- [x] **Step 5：提交本任务实际实现与测试。** `git add src/server/competitions/types.ts src/server/competitions/validation.ts tests/competitions.test.ts`；`git commit -m "feat: define validated competition rule fields"`。

## Task 2：共享连接、增量建表与赛事建档

**Files:** Create store.ts、tests/helpers/competition-fixture.ts；Modify src/server/store.ts、tests/competitions.test.ts。

- [x] **Step 1：写旧数据保留及重开数据库的测试。** helper 使用 mkdtempSync 创建路径、KnowledgeStore 导入一份简短原文，返回 store、document、chunk 和 cleanup。cleanup 先关闭数据库再删除临时目录；不触及用户 data。

测试文件从helper导入competitionFixture，错误断言从types.ts导入CompetitionError。下面是各任务完成后的完整helper：Task 2 先实现createEvent/reopen/cleanup；publishStudentLimit随Task 3加入，seedManifest随Task 8加入，不为未实现方法添加占位实现。

```ts
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { KnowledgeStore } from "../../src/server/store";
import type { RuleBody } from "../../src/server/competitions/types";
export function competitionFixture() {
  const root = mkdtempSync(path.join(tmpdir(), "shenbaotong-rules-"));
  const file = path.join(root, "knowledge.sqlite");
  let store = new KnowledgeStore(file);
  let eventId: string | null = null;
  const text = "同校学生最多3人。";
  const sourceUrl = "https://example.edu/contest/rules";
  const document = store.importDocument({ title: "2026测试赛事规则", competition: "测试赛事",
    sourceUrl, kind: "rule", year: "2026", stage: "通用规则", fileName: "rule.txt",
    pages: [{ page: null, text }] }).document;
  const chunk = store.getChunks([document.id])[0];
  const competitionInput = { name: "测试赛事", aliases: ["测试杯"], catalogNumber: 25,
    catalogYear: 2024, officialUrl: "https://example.edu/contest" };
  const eventInput = { editionLabel: "2026第1届", yearStart: 2026, yearEnd: 2026,
    trackName: "软件赛", stage: "通用规则" };
  function createEvent() {
    if (eventId) return eventId;
    const competition = store.competitions.createCompetition(competitionInput);
    const event = store.competitions.createEvent({ ...eventInput, competitionId: competition.id });
    eventId = event.id;
    return eventId;
  }
  return {
    get store() { return store; }, document, chunk, root, createEvent,
    reopen() { store.close(); store = new KnowledgeStore(file); },
    cleanup() { store.close(); rmSync(root, { recursive: true, force: true }); },
    publishStudentLimit(max: number) {
      const eventId = createEvent();
      const draft = store.competitions.ensureDraft(eventId);
      const body: RuleBody = { schemaVersion: 1,
        sources: [{ documentId: document.id, applicabilityNote: "同届软件赛通用规则", confirmed: true }],
        fields: { "team.studentMax": { kind: "integer", value: max, state: "confirmed", note: "" } } };
      const saved = store.competitions.saveDraft(draft.id, { expectedRevision: draft.editRevision,
        body, evidence: [{ fieldPath: "team.studentMax", documentId: document.id, chunkId: chunk.id }] });
      return store.competitions.publish(saved.id, saved.editRevision);
    },
    seedManifest() {
      return { schemaVersion: 1 as const, entries: [{ competition: competitionInput, event: eventInput,
        sources: [{ key: "rules", url: sourceUrl, textSha256: createHash("sha256").update(text).digest("hex") }],
        fields: [{ path: "team.studentMax" as const,
          field: { kind: "integer" as const, value: 3, state: "unreviewed" as const, note: "" },
          evidence: [{ sourceKey: "rules", anchor: text }] }] }] };
    }
  };
}
```

```ts
test("规则表初始化不丢失原文，赛事建档可恢复", () => {
  const f = competitionFixture();
  try {
    const competition = f.store.competitions.createCompetition({
      name: "测试赛事", aliases: ["测试杯"], catalogNumber: 25,
      catalogYear: 2024, officialUrl: "https://example.edu/contest"
    });
    const event = f.store.competitions.createEvent({
      competitionId: competition.id, editionLabel: "2026第1届", yearStart: 2026,
      yearEnd: 2026, trackName: "软件赛", stage: "通用规则"
    });
    f.reopen();
    assert.equal(f.store.listDocuments().length, 1);
    assert.equal(f.store.getDocument(f.document.id)?.chunks[0].text, "同校学生最多3人。");
    assert.equal(f.store.competitions.getDetail(event.id).event.trackName, "软件赛");
  } finally { f.cleanup(); }
});
```

- [x] **Step 2：运行测试，预期 competitions 属性尚不存在。** `npx tsx --test tests/competitions.test.ts`。
- [x] **Step 3：在现有三表创建后初始化四表。** KnowledgeStore 增加 `readonly competitions: CompetitionStore`，构造器用 `this.competitions = new CompetitionStore(this.db)`；CompetitionStore 接收 Database.Database，不能自行 new Database。四表建表要点：

```sql
CREATE TABLE IF NOT EXISTS competitions (
  id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, aliasesJson TEXT NOT NULL,
  catalogNumber INTEGER, catalogYear INTEGER, officialUrl TEXT NOT NULL, createdAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS competition_events (
  id TEXT PRIMARY KEY, competitionId TEXT NOT NULL REFERENCES competitions(id),
  editionLabel TEXT NOT NULL, yearStart INTEGER NOT NULL, yearEnd INTEGER NOT NULL,
  trackName TEXT NOT NULL, stage TEXT NOT NULL, sourceDocumentIdsJson TEXT NOT NULL,
  createdAt TEXT NOT NULL, UNIQUE(competitionId, editionLabel, trackName, stage)
);
CREATE TABLE IF NOT EXISTS competition_rule_versions (
  id TEXT PRIMARY KEY, eventId TEXT NOT NULL REFERENCES competition_events(id),
  version INTEGER NOT NULL, status TEXT NOT NULL CHECK(status IN ('draft','published','archived','needs_review')),
  bodyJson TEXT NOT NULL, editRevision INTEGER NOT NULL, createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL, publishedAt TEXT, UNIQUE(eventId,version)
);
CREATE UNIQUE INDEX IF NOT EXISTS competition_one_draft ON competition_rule_versions(eventId) WHERE status='draft';
CREATE UNIQUE INDEX IF NOT EXISTS competition_one_publication ON competition_rule_versions(eventId) WHERE status='published';
CREATE TABLE IF NOT EXISTS competition_rule_evidence (
  id TEXT PRIMARY KEY, versionId TEXT NOT NULL REFERENCES competition_rule_versions(id) ON DELETE CASCADE,
  fieldPath TEXT NOT NULL, documentId TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  chunkId TEXT NOT NULL REFERENCES chunks(id) ON DELETE CASCADE,
  UNIQUE(versionId,fieldPath,chunkId)
);
CREATE INDEX IF NOT EXISTS competition_evidence_document ON competition_rule_evidence(documentId);
```

createCompetition/createEvent 用参数化 INSERT 和 randomUUID；接口用户新建重复建档返回409，种子模块可先按唯一键查找复用。yearStart不得超过yearEnd；官网 URL 复用 sourceUrl 且拒绝用户名密码。查询显式映射 aliasesJson/bodyJson，不将数据库内部列原样发送。

- [x] **Step 4：执行测试并重开临时数据库验证。** 新测试和原 tests/core.test.ts 均通过。
- [x] **Step 5：提交建表与建档。** `git add src/server/competitions/store.ts src/server/store.ts tests/helpers/competition-fixture.ts tests/competitions.test.ts`；`git commit -m "feat: persist competition events alongside knowledge sources"`。

## Task 3：草稿、证据校验与原子发布

**Files:** Modify store.ts、validation.ts、tests/competitions.test.ts。

- [x] **Step 1：写无依据发布、错误文档片段和修改版本冲突测试。** 使用 fixture 的 document/chunk 配置一条已确认 studentMax=3；先不给证据验证发布失败，再给正确证据发布成功。另一个文档的 chunkId 不能与当前 documentId 搭配；旧 expectedRevision 必须409。

```ts
test("确认值必须有真实依据，旧窗口不能覆盖草稿", () => {
  const f = competitionFixture();
  try {
    const eventId = f.createEvent();
    const draft = f.store.competitions.ensureDraft(eventId);
    const body = { schemaVersion: 1 as const,
      sources: [{ documentId: f.document.id, applicabilityNote: "同届软件赛通用规则", confirmed: true }],
      fields: { "team.studentMax": { kind: "integer" as const, value: 3, state: "confirmed" as const, note: "" } }
    };
    const saved = f.store.competitions.saveDraft(draft.id, { expectedRevision: 0, body, evidence: [] });
    assert.throws(() => f.store.competitions.publish(saved.id, saved.editRevision), /依据/);
    assert.throws(() => f.store.competitions.saveDraft(draft.id, { expectedRevision: 0, body, evidence: [] }),
      error => error instanceof CompetitionError && error.status === 409);
    const cited = f.store.competitions.saveDraft(draft.id, { expectedRevision: saved.editRevision, body,
      evidence: [{ fieldPath: "team.studentMax", documentId: f.document.id, chunkId: f.chunk.id }] });
    assert.equal(f.store.competitions.publish(cited.id, cited.editRevision).status, "published");
  } finally { f.cleanup(); }
});
```

- [x] **Step 2：运行测试，观察发布与草稿行为缺失。** `npx tsx --test tests/competitions.test.ts`。
- [x] **Step 3：实现 ensureDraft、saveDraft 和 publish 的事务。** ensureDraft 克隆版本时仅复制仍有效证据；缺失依据的官方字段退回unreviewed。saveDraft 拒绝非draft、错误版本、未知fieldPath；事务内验证证据、替换body和evidence并递增revision。保存允许有值但未绑定证据的unreviewed草稿，发布不允许。核心事务順序如下，实施代码按此顺序调用已定义方法：

```ts
publish(versionId: string, expectedRevision: number): RuleVersion {
  return this.db.transaction(() => {
    const version = this.getVersion(versionId);
    if (version.status !== "draft" || version.editRevision !== expectedRevision)
      throw new CompetitionError("草稿已改变，请重新载入。", 409);
    const detail = this.getDetail(version.eventId);
    const issues = this.publicationIssues(detail.event, detail.competition, version);
    if (issues.length) throw new CompetitionError(issues.map(issue => issue.message).join("；"));
    const now = new Date().toISOString();
    this.db.prepare("UPDATE competition_rule_versions SET status='archived' WHERE eventId=? AND status='published'")
      .run(version.eventId);
    this.db.prepare("UPDATE competition_rule_versions SET status='published',publishedAt=?,updatedAt=?,editRevision=editRevision+1 WHERE id=?")
      .run(now, now, versionId);
    this.db.prepare("UPDATE competition_events SET sourceDocumentIdsJson=? WHERE id=?")
      .run(JSON.stringify(version.body.sources.map(source => source.documentId)), version.eventId);
    return this.getVersion(versionId);
  })();
}
```

publicationIssues 在同一连接查询实时原文，调用 collectPublicationIssues；该纯函数检查：来源确认、至少一项内容/资格confirmed、所有有值官方字段confirmed且有依据、标签confirmed且有note、没有conflict或unreviewed。unknown允许保留。证据查询必须 JOIN chunks 与 documents，验证 `c.id=chunkId AND c.documentId=documentId`，禁止仅分别验证两ID存在。

来源适用性：公告/规则的赛事名应匹配母赛事name/aliases或赛道名称；解析资料year中的全部20xx年，至少与event范围重叠。标题含另一明确赛道时不能继承其特有规则；通用母赛事规则允许继承并写明说明。没有可解析年份的资料须有适用说明并人工确认，存在明确不同年份不允许以说明绕过。catalog/policy仅供school.*，不能给team/student/deadlines作依据；确认school.category要求school.name、school.basisYear也确认，原文适用年份与basisYear及event.yearEnd相符。复杂数值关系不做隐式推算，跨校/教师条款例外写明正文并保留待确认项。

- [x] **Step 4：运行测试并加版本分离案例。** 发布v1后新草稿编辑不改变v1；发布v2只保留一个published，v1变archived；双次发布和两次创建草稿均不会重复生成。
- [x] **Step 5：提交审核版本功能。** `git add src/server/competitions/store.ts src/server/competitions/validation.ts tests/competitions.test.ts`；`git commit -m "feat: publish evidence-backed competition rule versions"`。

## Task 4：删除来源时立即撤销规则依据

**Files:** Modify src/server/store.ts、competitions/store.ts、tests/competitions.test.ts。

- [x] **Step 1：写删除后失效和发布前来源消失测试。** 使用临时文档发布v1，新建草稿后删除原文。断言current=null、v1=needs_review、关联片段及依据消失、草稿确认撤回；再发布失败而不是恢复旧版本。

```ts
test("删除原文使发布版本失效，并阻止正在编辑的草稿发布", () => {
  const f = competitionFixture();
  try {
    const published = f.publishStudentLimit(3);
    const draft = f.store.competitions.ensureDraft(published.eventId);
    f.store.deleteDocument(f.document.id);
    const detail = f.store.competitions.getDetail(published.eventId);
    assert.equal(detail.current, null);
    assert.equal(detail.versions.find(version => version.id === published.id)?.status, "needs_review");
    assert.equal(f.store.competitions.getVersion(draft.id).evidence.length, 0);
    assert.notEqual(f.store.competitions.getVersion(draft.id).body.fields["team.studentMax"]?.state, "confirmed");
    assert.throws(() => f.store.competitions.publish(draft.id, draft.editRevision), /载入|依据|来源/);
    assert.equal(f.store.getChunks([f.document.id]).length, 0);
  } finally { f.cleanup(); }
});
```

- [x] **Step 2：运行测试，预期发现删除仅影响现有问答而未影响规则。** `npx tsx --test tests/competitions.test.ts`。
- [x] **Step 3：扩展 deleteDocument 既有事务。** 在 DELETE documents 前调用 `this.competitions.invalidateDocument(id)`。该方法查询所有依据和所有body.sources引用该文档的版本，不能只检查有evidence的版本； published/archived改needs_review，draft对应字段改unreviewed并递增revision。未知字段保留unknown。删除原文后FK删除evidence，body.sources移除被删ID，event集合移除ID；维持任何规则发布/存储错误导致整个删除事务回滚。

```ts
// 放在 KnowledgeStore.deleteDocument 原有事务最前面，保留现有问答清理。
this.competitions.invalidateDocument(id);
this.db.prepare("DELETE FROM documents WHERE id=?").run(id);
```

规则值保留在needs_review历史版本中，但没有原文快照；返回详情时不将不存在的chunkId构造成有效引用。移除当前来源不自动选择旧archived版本。

- [x] **Step 4：运行新测试、tests/core.test.ts、tests/rag.test.ts。** 删除问答、并发生成引用失效等旧测试必须保持通过。
- [x] **Step 5：提交失效处理。** `git add src/server/store.ts src/server/competitions/store.ts tests/competitions.test.ts`；`git commit -m "fix: invalidate published rules when knowledge sources are deleted"`。

## Task 5：本地写接口和可展示错误

**Files:** Create competitions/http.ts、5个route.ts（6个处理方法，根路径GET/POST共用文件）、tests/competition-routes.test.ts。

- [x] **Step 1：用真实 Request 调用route导出函数写错误码测试。** 测试外部Origin、404、revision409、65536字节以上JSON和正常保存；设置RAG_DATA_DIR为独立临时目录，并在finally恢复原值。不能用mock绕过JSON校验与数据库。

```ts
test("本地接口拒绝外站写入和不存在的赛道", async () => {
  const { POST } = await import("../src/app/api/competitions/route");
  const rejected = await POST(new Request("http://localhost:3000/api/competitions", {
    method: "POST", headers: { host: "127.0.0.1:3000", origin: "https://external.example", "content-type": "application/json" },
    body: JSON.stringify({ action: "competition" })
  }));
  assert.equal(rejected.status, 400);
  const { GET } = await import("../src/app/api/competitions/events/[id]/route");
  const absent = await GET(new Request("http://localhost:3000/api/competitions/events/missing"),
    { params: Promise.resolve({ id: "missing" }) });
  assert.equal(absent.status, 404);
});
```

- [x] **Step 2：运行 `npx tsx --test tests/competition-routes.test.ts`，预期接口尚未存在。**
- [x] **Step 3：实现JSON与错误封装及接口。** mutation先checkOrigin；用ReadableStream reader累计字节，不信任Content-Length，超过65536立即cancel并400，完整UTF-8文本JSON.parse后再validate。response body只输出用户可理解message，不打印SQL、堆栈或环境配置。统一竞争错误用CompetitionError.status。

POST /api/competitions 请求为 `{action:"competition",input:CreateCompetition}` 或 `{action:"event",input:CreateEvent}`。GET返回 `{competitions,items}`，competitions通过listCompetitions()包含尚无赛道的母赛事，items通过list()返回赛道；便于新建母赛事后立即选择建赛道。其他接口响应分别 `{detail}`、`{version}`；draft创建请求无需正文，publish请求为 `{expectedRevision}`，PUT请求为SaveDraft。所有动态params沿用项目Promise写法。

```ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
export async function PUT(request: Request, context: Context) {
  try {
    checkOrigin(request);
    const { id } = await context.params;
    const input = await readRuleJson(request);
    return NextResponse.json({ version: getStore().competitions.saveDraft(id, validateSaveDraft(input)) });
  } catch (error) { return competitionErrorResponse(error); }
}
```

readRuleJson和competitionErrorResponse放http.ts；validateSaveDraft放validation.ts，复用validateBody/validateEvidenceInputs并校验expectedRevision非负整数。这里示例PUT调用的名字即实现契约，publish/create也使用同一错误封装，不复用默认400掩盖404/409。

- [x] **Step 4：运行route与规则测试，执行 `npm run typecheck`。** 每个输入错误码与实际数据库状态符合预期。
- [x] **Step 5：提交接口。** `git add src/app/api/competitions src/server/competitions/http.ts src/server/competitions/validation.ts tests/competition-routes.test.ts`；`git commit -m "feat: expose local competition rule maintenance APIs"`。

## Task 6：竞赛列表、新建与版本详情

**Files:** Create competition-library.tsx；Modify workspace.tsx、globals.css。

- [ ] **Step 1：实现独立列表组件状态与建档表单。** 组件Props为 `{documents:KnowledgeDocument[],onAsk:(documentIds:string[])=>void}`；GET读取items，赛事选择、新建母赛事、建赛道逐次提交。必填name/editionLabel/yearStart/yearEnd/trackName/stage用普通表单；版本状态显示草稿/已发布/需重新审核/历史版本。选中赛道GET detail，并提供“创建/继续草稿”和“查看当前发布”。原文为空也可建档，规则显示待补来源。

```tsx
const [items, setItems] = useState<Array<{ competition: Competition; event: CompetitionEvent; current: RuleVersion | null; draft: RuleVersion | null }>>([]);
const [detail, setDetail] = useState<EventDetail | null>(null);
const [error, setError] = useState("");
async function reload() {
  const result = await ruleApi<{ items: typeof items }>("/api/competitions");
  setItems(result.items);
}
async function openEvent(id: string) {
  const result = await ruleApi<{ detail: EventDetail }>(`/api/competitions/events/${encodeURIComponent(id)}`);
  setDetail(result.detail);
}
async function createDraft() {
  if (!detail) return;
  await ruleApi(`/api/competitions/events/${encodeURIComponent(detail.event.id)}/draft`, { method: "POST" });
  await openEvent(detail.event.id);
}
```

ruleApi统一检查HTTP错误，放组件目录的`competition-api.ts`，签名为`ruleApi<T>(path:string,init?:RequestInit):Promise<T>`，返回错误时保留status供409提示；只读取服务端error，不吞掉失败。新组件不导入任何服务端runtime，只用import type。

- [ ] **Step 2：在Workspace增加“竞赛规则”tab和入口。** onAsk设置所选documents并切回chat；不自动提交模型问题。readonly详情显示原文链接、待确认字段和版本号；不显示肯定资格结论。历史标识用北京时间比较已确认报名截止日期：仅小于今天的date值显示“已过报名日期”，datetime按真实时刻比较；日期等于今天不推算时刻。缺少报名截止显示“报名时间待确认”。

```tsx
{tab === "competitions" && <CompetitionLibrary documents={documents} onAsk={ids => {
  setSelected(ids.filter(id => documents.some(document => document.id === id)));
  setTab("chat");
}} />}
```

- [ ] **Step 3：补充布局样式并实际操作。** `.competition-layout`桌面两列，宽度小于760px一列，子区域min-width:0；按钮与输入复用已有primary/outline/field。空状态含建档按钮，无来源时提供资料库入口。新建表单校验年度顺序，失败保留输入。测试键盘和390px视口。
- [ ] **Step 4：运行typecheck与build。** 在浏览器建档并刷新，确认仍存在，错误不会关闭表单。此任务不写镜像UI代码的单元测试。
- [ ] **Step 5：提交列表与建档。** `git add src/components/competition-library.tsx src/components/competition-api.ts src/components/workspace.tsx src/app/globals.css`；`git commit -m "feat: add competition library and event maintenance views"`。

## Task 7：规则字段编辑、原文依据与确认发布

**Files:** Create rule-editor.tsx、rule-field.tsx、rule-source-picker.tsx；Modify competition-library.tsx、globals.css。

- [ ] **Step 1：实现受控字段表单。** 编辑器Props为`{detail:EventDetail,version:RuleVersion,documents:KnowledgeDocument[],onSaved:()=>Promise<void>}`。本地保留body、evidence与dirty状态；字段按content/student/team/tags/school分组。unknown开关将value=null、撤销确认；text输入、texts按逗号分隔、integer输入保留空值、boolean用“是/否/未知”而非默认false；修改value/kind/note立即改unreviewed。日期和材料列表用稳定UUID itemId，专用表单添加/删除且同步移除依据。

```ts
function updateField(path: FieldPath, next: RuleField) {
  setBody(previous => ({ ...previous, fields: {
    ...previous.fields, [path]: { ...next, state: next.value === null ? "unknown" : "unreviewed" }
  }}));
  setDirty(true);
}
function confirmField(path: FieldPath) {
  setBody(previous => {
    const field = previous.fields[path];
    if (!field || field.value === null) return previous;
    return { ...previous, fields: { ...previous.fields, [path]: { ...field, state: "confirmed" } } };
  });
  setDirty(true);
}
```

有值的官方字段必须有依据才能点击确认；tags需要维护者说明。更换或删除依据后字段退回unreviewed，不沿用旧确认。去掉适用文档时移除对应evidence并撤销相关确认；适用说明变更也撤销source.confirmed。空数组不表示“不限”，清空后回unknown。

- [ ] **Step 2：实现来源选择器和片段侧栏。** 来源从documents多选；逐份GET `/api/documents/[id]`取得chunks，展示标题、年份、阶段、页码/段落及sourceUrl。绑定/解除片段针对当前fieldPath。source适用说明和“已核对届次/赛道”复选单独呈现；来源年份冲突即时提示，服务端最终拒绝。原文查看请求序号或AbortController避免快速切换显示前一个文档。不存在来源显示需补资料，不伪造片段。
- [ ] **Step 3：实现保存、未保存提示和发布摘要。** PUT带当前editRevision，成功更新version并清dirty；409保留本地编辑，提示重新载入及手工核对，不静默覆盖。发布前必须先保存并使用新revision；弹出所有confirmed项、unknown项和适用来源摘要，再显式POST publish。正在保存/发布时禁用重复操作，失败保留草稿。切换赛道或离开dirty表单先提示是否放弃修改。

```ts
async function save(): Promise<RuleVersion> {
  const result = await ruleApi<{ version: RuleVersion }>(`/api/competitions/versions/${encodeURIComponent(version.id)}`, {
    method: "PUT", headers: { "content-type": "application/json" },
    body: JSON.stringify({ expectedRevision: version.editRevision, body, evidence })
  });
  setVersion(result.version);
  setDirty(false);
  return result.version;
}
async function publish(saved: RuleVersion) {
  await ruleApi(`/api/competitions/versions/${encodeURIComponent(saved.id)}/publish`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ expectedRevision: saved.editRevision })
  });
  await onSaved();
}
```

发布摘要确认按钮才调用publish；不在打开弹窗时发送请求。发布后的编辑入口调用ensureDraft，不能将原published ID继续PUT。

- [ ] **Step 4：完成浏览器验证。** 创建测试赛道，填写studentMax，先验证无证据不能确认/发布，再绑定原文、核对并发布；创建第二版草稿并改值，第一版详情保持原值。双窗口验证409，刷新和手机布局验证数据及滚动。
- [ ] **Step 5：运行typecheck/build，提交审核页面。** `git add src/components/rule-editor.tsx src/components/rule-field.tsx src/components/rule-source-picker.tsx src/components/competition-library.tsx src/app/globals.css`；`git commit -m "feat: review competition rules beside their original evidence"`。

## Task 8：首批三个赛道的幂等草稿录入

**Files:** Create seed.ts、scripts/import-competition-rules.ts、docs/competition-rule-seeds-2026-10-05.json、tests/competition-seed.test.ts；Modify package.json。

- [ ] **Step 1：写稳定来源匹配、正文变化和不覆盖编辑测试。** 使用两份同URL不同正文的临时原文，录入要求URL+正文sha256唯一匹配。第一次创建unreviewed字段与未确认来源；第二次不新增；人工修改后第三次不能覆盖。零命中、多命中、锚点出现两次均跳过该赛道并报告失败，不误选第一个。

```ts
test("录入重复执行不覆盖维护者编辑", () => {
  const f = competitionFixture();
  try {
    const manifest = f.seedManifest();
    const first = seedCompetitionRules(f.store, manifest);
    assert.equal(first.created, 1);
    const event = f.store.competitions.list()[0].event;
    const draft = f.store.competitions.getDetail(event.id).draft!;
    const body = structuredClone(draft.body);
    body.fields["team.studentMax"]!.note = "人工编辑保留";
    f.store.competitions.saveDraft(draft.id, { expectedRevision: draft.editRevision, body, evidence: draft.evidence });
    assert.equal(seedCompetitionRules(f.store, manifest).created, 0);
    assert.equal(f.store.competitions.getDetail(event.id).draft?.body.fields["team.studentMax"]?.note, "人工编辑保留");
    assert.equal(f.store.competitions.getDetail(event.id).current, null);
  } finally { f.cleanup(); }
});
```

- [ ] **Step 2：运行 `npx tsx --test tests/competition-seed.test.ts`，预期尚无seed函数。**
- [ ] **Step 3：定义清单并实现解析。** 清单结构为`{schemaVersion:1,entries:[{competition:CreateCompetition,event:Omit<CreateEvent,"competitionId">,sources:[{key,url,textSha256}],fields:[{path,field,evidence:[{sourceKey,anchor}]}]}]}`。source文档哈希用chunks按sequence恢复正文后计算，保留大小写和空白，不用易变化的文件路径或本机UUID。anchor原文必须在恢复正文中恰好一次出现；收集其字符区间重叠的所有chunks，因此跨分块的句子能关联完整依据。

seed.ts 导出如下类型和函数；校验JSON清单时拒绝额外键并调用已有字段校验：

```ts
export type SeedManifest = {
  schemaVersion: 1;
  entries: Array<{
    competition: CreateCompetition; event: Omit<CreateEvent, "competitionId">;
    sources: Array<{ key: string; url: string; textSha256: string }>;
    fields: Array<{ path: FieldPath; field: RuleField;
      evidence: Array<{ sourceKey: string; anchor: string }> }>;
  }>;
};
export type SeedReport = { created: number; skipped: number; failed: Array<{ competition: string; reason: string }> };
// seedCompetitionRules(store: KnowledgeStore, manifest: SeedManifest): SeedReport
// validateSeedManifest(value: unknown): SeedManifest
```

脚本的退出码：failed非空为1，全部缺资料也返回结构化报告；重复已录入条目为skipped，不是错误。打印赛事名和原因，不打印完整原文或密钥。先完成各赛道的全部来源预检，再写入该赛道事务，某赛道失败不阻止其他资料齐全的赛道，但最终退出码仍为1。

```ts
export function findAnchorChunks(chunks: Array<{ id: string; text: string }>, anchor: string): string[] {
  const text = chunks.map(chunk => chunk.text).join("");
  const start = text.indexOf(anchor);
  if (!anchor || start < 0 || text.indexOf(anchor, start + 1) >= 0)
    throw new Error("原文锚点缺失或不唯一，请核对资料。");
  const end = start + anchor.length;
  let offset = 0;
  return chunks.filter(chunk => {
    const begin = offset; offset += chunk.text.length;
    return begin < end && offset > start;
  }).map(chunk => chunk.id);
}
```

所有来源和字段预检通过后才在事务内创建该赛道；以已定义唯一键查找建档记录，存在任何版本则跳过，不补写或重置。所有有值field强制unreviewed，所有source.confirmed=false，不读取输入里的confirmed值；已存在published版本也不新增草稿。脚本调用getStore再finally close，只向本地数据库写入，不执行网页下载或模型请求。

脚本入口如下，内部事务和资料匹配留在seed.ts，避免另写一套不校验的直接INSERT：

```ts
import { readFile } from "node:fs/promises";
import { getStore } from "../src/server/store";
import { seedCompetitionRules, validateSeedManifest } from "../src/server/competitions/seed";
async function main() {
  const file = process.argv[2] || "docs/competition-rule-seeds-2026-10-05.json";
  const manifest = validateSeedManifest(JSON.parse((await readFile(file, "utf8")).replace(/^\uFEFF/, "")));
  const store = getStore();
  try {
    const report = seedCompetitionRules(store, manifest);
    console.log(JSON.stringify(report, null, 2));
    if (report.failed.length) process.exitCode = 1;
  } finally { store.close(); }
}
main().catch(error => {
  console.error(error instanceof Error ? error.message : "规则草稿录入失败。");
  process.exitCode = 1;
});
```

首批录入范围与事实检查：计算机设计大赛绑定参赛要求及软件分类；蓝桥杯绑定Python规则及省赛时间；中国软件杯绑定报名、延期及作品提交说明。分别核对同校及人数、单人/组别、教师名额计入总人数与A组条件。未取到学校年度认定、校内截止或具体赛题要求的字段为unknown。种子值来自原文人工核对，不根据母赛事名称推断。将每条rule的正文sha256与anchor填入实际JSON后才执行录入。

- [ ] **Step 4：添加npm脚本并运行测试。** `rules:import`=`tsx scripts/import-competition-rules.ts`；`test`显式追加三个新测试文件。运行完整npm test与typecheck；真实资料录入前先测试空库结果：0创建、3个缺来源报告，不能崩溃或生成看似已发布记录。
- [ ] **Step 5：提交草稿录入。** `git add src/server/competitions/seed.ts scripts/import-competition-rules.ts docs/competition-rule-seeds-2026-10-05.json tests/competition-seed.test.ts package.json`；`git commit -m "feat: seed three competition rule drafts with source verification"`。

## Task 9：真实资料操作验收与交付

**Files:** Create docs/竞赛规则开发与验证记录.md；Modify README.md、计划任务状态。

- [ ] **Step 1：运行完整回归、类型检查和生产构建。** 顺序执行 `npm test`、`npm run typecheck`、`npm run build`，检查每个exit_code为0。出现新缺陷先修复并复验影响范围，不反复扩大无关测试。
- [ ] **Step 2：启动或重启最新生产版本，录入三个草稿。** 保留已运行服务信息，必要时有序停止原本项目的进程后 `npm run start`，不按端口杀其他应用。执行 `npm run rules:import`，预期3个新赛道、draft、0个published；再次执行预期0个新赛道且原草稿不变。
- [ ] **Step 3：逐项对照真实原文操作审核。** 用计算机设计大赛验证同校和教师人数独立字段，用蓝桥杯验证省赛日期与报名截止区别，用软件杯验证含教师总名额和延期时间。保留未知字段，逐条查看依据并确认有值字段后发布，核对published详情与实际证据。人工确认由操作者明确操作，不把导入动作当成确认。
- [ ] **Step 4：验证持久化与失效。** 重启后三个赛道与规则仍在。删除来源测试使用临时复制的测试文档和测试赛道，确认needs_review，不删除三个真实赛事资料；验证结束删除明确测试记录或在忽略目录独立测试库操作。
- [ ] **Step 5：完成页面验收。** 电脑和390px手机无横向溢出；键盘操作来源选择、保存和发布；失败保留草稿；空库可建档；打开原文能定位正确页或段落；返回问答沿用正确文档范围。
- [ ] **Step 6：写真实验证记录与README。** 记录数据库迁移、三条赛事范围、确认和未知项、运行命令、成功/失败、来源失效、历史日期及尚未实现的推荐/核验。不能只根据引用ID存在宣称事实正确。
- [ ] **Step 7：检查Git和敏感数据，提交交付。** `git diff --check`通过；暂存明确代码及文档路径，确认不含data、.env.local、数据库、artifacts或密钥。`git commit -m "docs: document competition rule validation and maintenance"`。本轮提交保存在当前分支，GitHub上传沿用用户既有授权，不更改公开可见性、默认分支或远端历史。

## 计划自查与验收对应

| 设计要求 | 实施任务 |
| --- | --- |
| 四表增量、旧数据库保留、共享事务 | Task 2、4 |
| unknown、人数/教师区分、日期精度、学校年度类别 | Task 1、3、7、8 |
| 字段证据、届次赛道适用说明、逐项审核 | Task 3、7 |
| 不可直接编辑发布版、并发revision、旧草稿不影响发布 | Task 3、5、7 |
| 来源删除失效、竞态不留无来源published | Task 4、9 |
| 本地Origin与JSON大小限制、清晰错误码 | Task 5 |
| 赛事列表、建档、原文侧栏、移动和键盘 | Task 6、7、9 |
| 三个赛道、稳定来源、幂等与无资料状态 | Task 8、9 |
| 问答回归、持久化、真实事实核对、复现文档 | Task 4、9 |

接口名和属性均沿用固定数据契约；只保存draft/published/archived/needs_review状态，字段另用RuleState。实施时若发现既有数据与清单不一致，先展示具体缺失项，不补造规则值或自动调整届次。

## 执行方式已选择

1. 子代理分任务执行（技能推荐）：每个任务由新的实现代理完成，主会话逐项审查与验证；使用 subagent-driven-development。
2. 当前会话逐项执行：由当前代理顺序开发并记录验收，使用 executing-plans。

用户已选择方式1（子代理分任务执行），当前会话持续执行并逐项审查。无需在任务之间再次确认继续，也不需要再次确认密钥、模型供应商或三个赛事范围。
