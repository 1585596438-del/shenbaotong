import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import { readModelSettings, prepareModelSettings, publicModelSettings, saveModelSettings } from "../src/server/model-settings";
import { readProviderConfig, ApiProvider } from "../src/server/provider";
import { GET, PUT } from "../src/app/api/settings/route";
import { POST } from "../src/app/api/settings/test/route";

test("网页模型配置：保存生效、密钥边界、接口保护和实际连接测试", async t => {
  const root = mkdtempSync(path.join(tmpdir(), "shenbaotong-settings-"));
  const keys = ["RAG_DATA_DIR", "AI_BASE_URL", "AI_API_KEY", "AI_CHAT_MODEL", "EMBEDDING_BASE_URL", "EMBEDDING_API_KEY", "AI_EMBEDDING_MODEL"];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  Object.assign(process.env, { RAG_DATA_DIR: root, AI_BASE_URL: "https://original.example/v1", AI_API_KEY: "original-private-key", AI_CHAT_MODEL: "original-chat", EMBEDDING_BASE_URL: "", EMBEDDING_API_KEY: "", AI_EMBEDDING_MODEL: "" });
  const input = { baseUrl: "https://original.example/v1", chatModel: "chosen-chat", apiKey: "", embeddingEnabled: false, embeddingUseChat: true, embeddingBaseUrl: "", embeddingApiKey: "", embeddingModel: "" };
  const request = (data: unknown, method = "PUT", origin = "http://127.0.0.1:3000") => new Request("http://127.0.0.1:3000/api/settings", { method, headers: { origin, host: "127.0.0.1:3000", "Content-Type": "application/json" }, body: JSON.stringify(data) });
  try {
    await t.test("保留现有环境配置；网页响应不包含任何密钥", async () => {
      assert.equal(readModelSettings().apiKey, "original-private-key");
      const response = await GET();
      assert.equal(response.headers.get("cache-control"), "no-store");
      const body = await response.text();
      assert.ok(!body.includes("original-private-key"));
      assert.equal(JSON.parse(body).hasApiKey, true);
    });
    await t.test("留空保留密钥，保存后新模型立即用于请求，刷新读取不依赖重启", async () => {
      assert.equal((await PUT(request(input))).status, 200);
      assert.equal(readProviderConfig().chatModel, "chosen-chat");
      assert.equal(readProviderConfig().apiKey, "original-private-key");
      assert.equal(new ApiProvider().chatReady, true);
      const enabled = prepareModelSettings({ ...input, embeddingEnabled: true, embeddingModel: "vector-a" });
      saveModelSettings(enabled);
      assert.equal(readProviderConfig().embeddingApiKey, "original-private-key");
      const firstKey = new ApiProvider().embeddingKey;
      saveModelSettings({ ...enabled, embeddingModel: "vector-b" });
      assert.notEqual(new ApiProvider().embeddingKey, firstKey);
      assert.equal(publicModelSettings().embeddingUseChat, true);
    });
    await t.test("换服务不能沿用原密钥；异常输入或跨站操作不能更改配置", async () => {
      const original = readFileSync(path.join(root, "model-settings.json"), "utf8");
      assert.equal((await PUT(request({ ...input, baseUrl: "https://new.example/v1" }))).status, 400);
      assert.equal((await PUT(request(input, "PUT", "https://outside.example"))).status, 400);
      for (const baseUrl of ["http://outside.example/v1", "https://user:secret@new.example/v1", "https://new.example/v1?key=private", "https://new.example/v1/chat/completions"]) assert.throws(() => prepareModelSettings({ ...input, apiKey: "new-key", baseUrl }));
      assert.throws(() => prepareModelSettings({ ...input, unknown: "field" }));
      assert.throws(() => prepareModelSettings({ ...input, embeddingEnabled: true, embeddingModel: "vector", embeddingUseChat: false, embeddingBaseUrl: "https://embed.example/v1" }));
      const changed = prepareModelSettings({ ...input, baseUrl: "https://new.example/v1", apiKey: "replacement-key" });
      assert.equal(changed.apiKey, "replacement-key");
      const oversized = request({ ...input, apiKey: "a".repeat(20_000) });
      assert.equal((await PUT(oversized)).status, 400);
      assert.equal(readFileSync(path.join(root, "model-settings.json"), "utf8"), original);
    });
    await t.test("单独连接测试真实兼容接口，失败脱敏且不保存测试密钥", async () => {
      let invalid = false;
      const calls: { url: string; authorization: string | undefined; body: { model: string; input?: string[] } }[] = [];
      const server = createServer(async (req, res) => {
        let body = ""; for await (const part of req) body += part;
        calls.push({ url: req.url!, authorization: req.headers.authorization, body: JSON.parse(body) });
        res.setHeader("content-type", "application/json");
        if (invalid) { res.statusCode = 401; res.end(JSON.stringify({ error: "do-not-expose-test-secret" })); }
        else res.end(JSON.stringify(req.url?.endsWith("/embeddings") ? { data: [{ index: 0, embedding: [1, 2, 3] }] } : { choices: [{ message: { content: "OK" } }] }));
      });
      await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
      const address = server.address() as { port: number };
      const candidate = { ...input, baseUrl: `http://127.0.0.1:${address.port}/v1`, apiKey: "fixture-secret", embeddingEnabled: true, embeddingModel: "fixture-vector" };
      const file = path.join(root, "model-settings.json"), before = readFileSync(file, "utf8");
      try {
        assert.equal((await POST(request({ ...candidate, target: "chat" }, "POST"))).status, 200);
        const vector = await POST(request({ ...candidate, target: "embedding" }, "POST"));
        assert.equal(vector.status, 200);
        assert.ok((await vector.text()).includes("3"));
        assert.equal(calls[0].url, "/v1/chat/completions");
        assert.equal(calls[1].url, "/v1/embeddings");
        assert.equal(calls[1].authorization, "Bearer fixture-secret");
        assert.equal(calls[1].body.model, "fixture-vector");
        invalid = true;
        const failure = await POST(request({ ...candidate, target: "chat" }, "POST"));
        assert.equal(failure.status, 400);
        assert.ok(!(await failure.text()).includes("do-not-expose-test-secret"));
        assert.equal(readFileSync(file, "utf8"), before);
        assert.ok(!before.includes("fixture-secret"));
      } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
    });
    assert.ok(existsSync(path.join(root, "model-settings.json")));
  } finally {
    for (const key of keys) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; }
    rmSync(root, { recursive: true, force: true });
  }
});
