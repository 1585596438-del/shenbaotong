import test from "node:test";
import assert from "node:assert/strict";
import { competitionFixture } from "./helpers/competition-fixture";
import type { Competition, CompetitionEvent, RuleVersion } from "../src/server/competitions/types";
import type { KnowledgeStore } from "../src/server/store";

const base = "http://localhost:3000/api/competitions";
function request(path: string, method = "POST", body?: unknown, origin = "http://127.0.0.1:3000") {
  return new Request(`${base}${path}`, { method,
    headers: { host: "127.0.0.1:3000", origin, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
const context = (id: string) => ({ params: Promise.resolve({ id }) });

test("竞赛维护接口使用真实请求及独立临时数据库", async t => {
  const f = competitionFixture();
  const previousDirectory = process.env.RAG_DATA_DIR;
  const globals = globalThis as typeof globalThis & { ragStore?: KnowledgeStore; ragStorePath?: string };
  const previousStore = globals.ragStore;
  const previousPath = globals.ragStorePath;
  delete globals.ragStore;
  delete globals.ragStorePath;
  process.env.RAG_DATA_DIR = f.root;
  try {
    const collection = await import("../src/app/api/competitions/route");
    const detail = await import("../src/app/api/competitions/events/[id]/route");
    const draft = await import("../src/app/api/competitions/events/[id]/draft/route");
    const version = await import("../src/app/api/competitions/versions/[id]/route");
    const publication = await import("../src/app/api/competitions/versions/[id]/publish/route");
    const http = await import("../src/server/competitions/http");
    const input = { name: "测试赛事", aliases: [], catalogNumber: null, catalogYear: null, officialUrl: "" };
    let competition: Competition;
    let event: CompetitionEvent;
    let saved: RuleVersion;

    await t.test("所有写接口先拒绝外站及错误端口，不读取正文或写入数据库", async () => {
      for (const origin of ["https://external.example", "http://127.0.0.1:3001"]) {
        const responses = await Promise.all([
          collection.POST(request("", "POST", {}, origin)),
          draft.POST(request("/events/missing/draft", "POST", undefined, origin), context("missing")),
          version.PUT(request("/versions/missing", "PUT", {}, origin), context("missing")),
          publication.POST(request("/versions/missing/publish", "POST", {}, origin), context("missing")),
        ]);
        for (const response of responses) {
          assert.equal(response.status, 400);
          assert.match((await response.json()).error, /本地/);
        }
      }
      assert.equal(f.store.competitions.listCompetitions().length, 0);
    });
    await t.test("缺失赛道及版本返回404", async () => {
      const responses = [
        await detail.GET(request("/events/missing", "GET"), context("missing")),
        await draft.POST(request("/events/missing/draft"), context("missing")),
        await version.PUT(request("/versions/missing", "PUT", { expectedRevision: 0, body: { schemaVersion: 1, sources: [], fields: {} }, evidence: [] }), context("missing")),
        await publication.POST(request("/versions/missing/publish", "POST", { expectedRevision: 0 }), context("missing")),
      ];
      for (const response of responses) assert.equal(response.status, 404);
    });
    await t.test("新建母赛事可立即列出，无赛道仍保留，重复名称409", async () => {
      const created = await collection.POST(request("", "POST", { action: "competition", input }));
      assert.equal(created.status, 201);
      competition = (await created.json()).competition;
      const result = await (await collection.GET()).json();
      assert.equal(result.competitions[0].id, competition.id);
      assert.deepEqual(result.items, []);
      assert.equal((await collection.POST(request("", "POST", { action: "competition", input }))).status, 409);
    });
    await t.test("建赛道、读详情、无正文创建草稿及重复继续使用同一草稿", async () => {
      const result = await collection.POST(request("", "POST", { action: "event", input: {
        competitionId: competition.id, editionLabel: "2026", yearStart: 2026, yearEnd: 2026, trackName: "软件赛", stage: "通用规则",
      } }));
      assert.equal(result.status, 201);
      event = (await result.json()).event;
      assert.equal((await (await detail.GET(request(`/events/${event.id}`, "GET"), context(event.id))).json()).detail.draft, null);
      const first = await draft.POST(request(`/events/${event.id}/draft`), context(event.id));
      assert.equal(first.status, 200);
      saved = (await first.json()).version;
      const repeated = await draft.POST(request(`/events/${event.id}/draft`), context(event.id));
      assert.equal((await repeated.json()).version.id, saved.id);
    });
    await t.test("正常保存与旧revision冲突保持原数据库值", async () => {
      const payload = { expectedRevision: saved.editRevision, body: { schemaVersion: 1, sources: [], fields: {
        "team.studentMax": { kind: "integer", value: 3, state: "unreviewed", note: "" },
      } }, evidence: [] };
      const result = await version.PUT(request(`/versions/${saved.id}`, "PUT", payload), context(saved.id));
      assert.equal(result.status, 200);
      saved = (await result.json()).version;
      assert.equal(saved.body.fields["team.studentMax"]?.value, 3);
      assert.equal((await version.PUT(request(`/versions/${saved.id}`, "PUT", payload), context(saved.id))).status, 409);
      assert.equal(f.store.competitions.getVersion(saved.id).editRevision, saved.editRevision);
      assert.equal((await publication.POST(request(`/versions/${saved.id}/publish`, "POST", { expectedRevision: saved.editRevision - 1 }), context(saved.id))).status, 409);
    });
    await t.test("不合法JSON、action、附加属性与发布revision返回400且不修改草稿", async () => {
      const malformed = new Request(base, { method: "POST", body: "{", headers: { "content-type": "application/json" } });
      assert.equal((await collection.POST(malformed)).status, 400);
      for (const payload of [null, [], { action: "unknown", input }, { action: "competition", input, extra: true }])
        assert.equal((await collection.POST(request("", "POST", payload))).status, 400);
      for (const payload of [{ expectedRevision: -1 }, { expectedRevision: 0.5 }, { expectedRevision: "0" }, { expectedRevision: saved.editRevision, extra: true }])
        assert.equal((await publication.POST(request(`/versions/${saved.id}/publish`, "POST", payload), context(saved.id))).status, 400);
      assert.equal((await version.PUT(request(`/versions/${saved.id}`, "PUT", { expectedRevision: saved.editRevision, body: saved.body, evidence: [], extra: true }), context(saved.id))).status, 400);
      assert.equal(f.store.competitions.getVersion(saved.id).editRevision, saved.editRevision);
    });
    await t.test("无确认及依据不能发布，真实临时原文确认后可发布并返回详情", async () => {
      assert.equal((await publication.POST(request(`/versions/${saved.id}/publish`, "POST", { expectedRevision: saved.editRevision }), context(saved.id))).status, 400);
      const response = await version.PUT(request(`/versions/${saved.id}`, "PUT", { expectedRevision: saved.editRevision,
        body: { schemaVersion: 1, sources: [{ documentId: f.document.id, applicabilityNote: "2026软件赛通用规则", confirmed: true }],
          fields: { "team.studentMax": { kind: "integer", value: 3, state: "confirmed", note: "" } } },
        evidence: [{ fieldPath: "team.studentMax", documentId: f.document.id, chunkId: f.chunk.id }],
      }), context(saved.id));
      assert.equal(response.status, 200);
      saved = (await response.json()).version;
      const published = await publication.POST(request(`/versions/${saved.id}/publish`, "POST", { expectedRevision: saved.editRevision }), context(saved.id));
      assert.equal(published.status, 200);
      saved = (await published.json()).version;
      assert.equal(saved.status, "published");
      assert.equal((await (await detail.GET(request(`/events/${event.id}`, "GET"), context(event.id))).json()).detail.current.id, saved.id);
      assert.equal((await version.PUT(request(`/versions/${saved.id}`, "PUT", { expectedRevision: saved.editRevision, body: saved.body, evidence: saved.evidence }), context(saved.id))).status, 409);
    });
    await t.test("按流实际UTF-8字节限64KB，不信任长度声明，超限及时取消", async () => {
      const exact = JSON.stringify("a".repeat(65534));
      assert.equal(await http.readRuleJson(new Request(base, { method: "POST", body: exact })), "a".repeat(65534));
      for (const contentLength of [undefined, "1", "999999"]) {
        let cancelled = false;
        const stream = new ReadableStream<Uint8Array>({
          start(controller) { controller.enqueue(new TextEncoder().encode(JSON.stringify("中".repeat(22000)))); },
          cancel() { cancelled = true; },
        });
        const headers = contentLength ? { "content-length": contentLength } : {};
        const streamed = new Request(base, { method: "POST", body: stream, headers, duplex: "half" } as RequestInit);
        const response = await collection.POST(streamed);
        assert.equal(response.status, 400);
        assert.match((await response.json()).error, /65536|64KB/);
        assert.equal(cancelled, true);
      }
    });
    await t.test("UTF-8跨块完整解析，流读取失败与未知异常不泄露SQL或堆栈", async () => {
      const bytes = new TextEncoder().encode(JSON.stringify({ text: "中文" }));
      const stream = new ReadableStream<Uint8Array>({ start(controller) {
        for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
        controller.close();
      } });
      assert.deepEqual(await http.readRuleJson(new Request(base, { method: "POST", body: stream, duplex: "half" } as RequestInit)), { text: "中文" });
      const invalidUtf8 = new Request(base, { method: "POST", body: Uint8Array.of(0x22, 0xff, 0x22) });
      await assert.rejects(() => http.readRuleJson(invalidUtf8.clone()), /UTF-8/);
      assert.equal((await collection.POST(invalidUtf8)).status, 400);
      assert.equal(f.store.competitions.listCompetitions().length, 1);
      const broken = new ReadableStream<Uint8Array>({ start(controller) { controller.error(new Error("SQL SELECT secret FROM private")); } });
      const result = await collection.POST(new Request(base, { method: "POST", body: broken, duplex: "half" } as RequestInit));
      assert.equal(result.status, 400);
      assert.doesNotMatch(JSON.stringify(await result.json()), /SQL|SELECT|secret|stack/);
      const unexpected = http.competitionErrorResponse(new Error("SQLITE_ERROR SELECT secret FROM private"));
      assert.equal(unexpected.status, 500);
      assert.doesNotMatch(JSON.stringify(await unexpected.json()), /SQLITE|SELECT|secret|stack/);
    });
    await t.test("独立路由模块的领域错误保留状态，未标记的异常继续脱敏", async () => {
      // Next bundles routes separately while the database store survives in globalThis.
      const otherBundleError = new Error("另一规则模块的编辑冲突");
      Object.assign(otherBundleError, { name: "CompetitionError", status: 409 });
      Object.defineProperty(otherBundleError, Symbol.for("shenbaotong.competition-error"), { value: true });
      const response = http.competitionErrorResponse(otherBundleError);
      assert.equal(response.status, 409);
      assert.equal((await response.json()).error, otherBundleError.message);
      const unbranded = Object.assign(new Error("SQLITE private details"), { name: "CompetitionError", status: 409 });
      assert.equal(http.competitionErrorResponse(unbranded).status, 500);
      const invalidStatus = Object.assign(new Error("SQLITE private details"), { status: 500 });
      Object.defineProperty(invalidStatus, Symbol.for("shenbaotong.competition-error"), { value: true });
      assert.equal(http.competitionErrorResponse(invalidStatus).status, 500);
    });
  } finally {
    // Route imports can initialize this global after it was cleared above.
    (globalThis as typeof globals).ragStore?.close();
    globals.ragStore = previousStore;
    globals.ragStorePath = previousPath;
    if (previousDirectory === undefined) delete process.env.RAG_DATA_DIR;
    else process.env.RAG_DATA_DIR = previousDirectory;
    f.cleanup();
  }
});
