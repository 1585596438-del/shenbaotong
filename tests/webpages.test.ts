import test from "node:test";
import assert from "node:assert/strict";
import { publicUrl, publicAddresses, readPublicPage } from "../src/server/public-web";
import { extractWebpage, getCapture, saveCapture, safeCrawlError } from "../src/server/webpages";

test("抓取拒绝内网、保留地址、伪装 IP 和登录凭据", () => {
  for (const value of ["http://localhost/", "http://127.0.0.1/", "http://2130706433/", "http://0x7f000001/", "http://10.1.2.3/", "http://169.254.169.254/", "http://[::1]/", "http://[::ffff:127.0.0.1]/", "http://192.168.1.1/", "https://name:password@example.com/", "file:///C:/test.txt", "http://example.com:3000/"]) assert.throws(() => publicUrl(value));
  assert.equal(publicUrl("https://example.com/#/notice").hash, "#/notice");
});

test("DNS 混合返回公网与内网时整体拒绝", async () => {
  await assert.rejects(publicAddresses(new URL("https://example.com"), async () => [{ address: "8.8.8.8", family: 4 }, { address: "127.0.0.1", family: 4 }]), /内网/);
  const values = await publicAddresses(new URL("https://example.com"), async () => [{ address: "8.8.8.8", family: 4 }]);
  assert.equal(values[0].address, "8.8.8.8");
});

test("每次重定向重新验证，不能跳转到内网", async () => {
  let calls = 0;
  await assert.rejects(readPublicPage("https://example.com/", AbortSignal.timeout(1000), async url => {
    calls++; return { url, status: 302, headers: { location: "http://127.0.0.1:3000/api/status" }, bytes: Buffer.alloc(0) };
  }), /内网|标准端口/);
  assert.equal(calls, 1);
});

test("正文清理保留隐藏通知内容、表格行与公开 PDF 链接，不执行脚本", () => {
  const result = extractWebpage('<html><title>竞赛通知</title><body><nav>首页 导航</nav><div class="v_news_content" style="display:none"><p>参赛要求：计算机专业学生组成三人团队。</p><table><tr><th>阶段</th><th>日期</th></tr><tr><td>报名</td><td>2026年11月30日</td></tr></table><script>throw new Error("never run")</script><a href="/rules.pdf">完整规则</a><a href="javascript:alert(1)">无效链接</a></div><footer>页脚</footer></body></html>', "https://example.com/news/1");
  assert.match(result.text, /报名 \| 2026年11月30日/);
  assert.match(result.text, /三人团队/);
  assert.doesNotMatch(result.text, /首页|页脚|never run/);
  assert.deepEqual(result.attachments, [{ title: "完整规则", url: "https://example.com/rules.pdf", pdf: true }]);
});

test("预览快照保留 PDF 页码，错误不暴露网络堆栈或 URL 凭据", () => {
  const preview = saveCapture({ title: "通知", text: "要求", sourceUrl: "https://example.com/rules.pdf", pages: [{ page: 2, text: "要求" }], fileName: "rules.pdf", method: "pdf", pageCount: 1, warnings: [], attachments: [] });
  assert.equal(getCapture(preview.captureId).pages[0].page, 2);
  assert.throws(() => getCapture("missing"), /过期/);
  assert.equal(safeCrawlError(new Error("request failed https://user:secret@example.com")), "无法读取该公开网页，请检查网址或改用上传文件、粘贴正文。");
});
