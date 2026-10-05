import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { KnowledgeStore } from "../../src/server/store";

export function competitionFixture() {
  const temporaryRoot = path.resolve(tmpdir());
  const root = mkdtempSync(path.join(temporaryRoot, "competition-test-"));
  const dbPath = path.join(root, "knowledge.sqlite");
  let store = new KnowledgeStore(dbPath);
  const { document } = store.importDocument({
    title: "2026测试赛事规则", competition: "测试赛事",
    sourceUrl: "https://example.edu/contest/rules", kind: "rule", year: "2026",
    stage: "通用规则", pages: [{ page: null, text: "同校学生最多3人。" }], fileName: "rule.txt",
  });
  const chunk = store.getChunks([document.id])[0];
  let eventId: string | undefined;
  return {
    get store() { return store; },
    document, chunk, root,
    createEvent() {
      if (!eventId) {
        const competition = store.competitions.createCompetition({
          name: "测试赛事", aliases: ["测试杯"], catalogNumber: 25, catalogYear: 2024,
          officialUrl: "https://example.edu/contest",
        });
        eventId = store.competitions.createEvent({
          competitionId: competition.id, editionLabel: "2026第1届", yearStart: 2026,
          yearEnd: 2026, trackName: "软件赛", stage: "通用规则",
        }).id;
      }
      return eventId;
    },
    publishStudentLimit(value = 3) {
      const draft = store.competitions.ensureDraft(this.createEvent());
      const saved = store.competitions.saveDraft(draft.id, {
        expectedRevision: draft.editRevision,
        body: { schemaVersion: 1, sources: [{ documentId: document.id, applicabilityNote: "适用于2026软件赛通用规则", confirmed: true }],
          fields: { "team.studentMax": { kind: "integer", value, state: "confirmed", note: "" } } },
        evidence: [{ fieldPath: "team.studentMax", documentId: document.id, chunkId: chunk.id }],
      });
      return store.competitions.publish(saved.id, saved.editRevision);
    },
    reopen() {
      store.close();
      store = new KnowledgeStore(dbPath);
    },
    cleanup() {
      store.close();
      const target = path.resolve(root);
      const relative = path.relative(temporaryRoot, target);
      if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        throw new Error("拒绝清理临时目录之外的路径");
      }
      rmSync(target, { recursive: true, force: true });
    },
  };
}
