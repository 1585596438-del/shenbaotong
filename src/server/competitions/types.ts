export type RuleState = "unknown" | "unreviewed" | "confirmed" | "conflict";
export type VersionState = "draft" | "published" | "archived" | "needs_review";
export type RuleKind = "text" | "texts" | "integer" | "boolean" | "date" | "material";

export type Deadline = {
  itemId: string;
  name: string;
  stage: string;
  precision: "date" | "datetime";
  value: string;
  timezone: "Asia/Shanghai";
};

export type Material = {
  itemId: string;
  name: string;
  stage: string;
  requirement: "required" | "optional" | "unknown";
  condition: string;
};

export type RuleValue = string | string[] | number | boolean | Deadline | Material;
export type RuleField = { kind: RuleKind; value: RuleValue | null; state: RuleState; note: string };
export type FixedFieldPath =
  | "content.summary"
  | "content.contestFormat"
  | "content.entryPath"
  | "content.technicalRequirements"
  | "student.levels"
  | "student.fullTimeRequired"
  | "student.majorRestrictions"
  | "student.gradeRestrictions"
  | "team.studentMin"
  | "team.studentMax"
  | "team.teacherMin"
  | "team.teacherMax"
  | "team.totalTeamMax"
  | "team.teachersCountTowardTotal"
  | "team.sameSchoolRequired"
  | "team.teacherRequirements"
  | "tags.majors"
  | "tags.skills"
  | "tags.interests"
  | "school.name"
  | "school.category"
  | "school.basisYear";
export type FieldPath = FixedFieldPath | `deadlines.${string}` | `materials.${string}`;
export type RuleSource = { documentId: string; applicabilityNote: string; confirmed: boolean };
export type RuleBody = { schemaVersion: 1; sources: RuleSource[]; fields: Partial<Record<FieldPath, RuleField>> };
export type EvidenceInput = { fieldPath: FieldPath; documentId: string; chunkId: string };
export type Competition = {
  id: string;
  name: string;
  aliases: string[];
  catalogNumber: number | null;
  catalogYear: number | null;
  officialUrl: string;
  createdAt: string;
};
export type CompetitionEvent = {
  id: string;
  competitionId: string;
  editionLabel: string;
  yearStart: number;
  yearEnd: number;
  trackName: string;
  stage: string;
  sourceDocumentIds: string[];
  createdAt: string;
};
export type RuleVersion = {
  id: string;
  eventId: string;
  version: number;
  status: VersionState;
  body: RuleBody;
  evidence: EvidenceInput[];
  editRevision: number;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
};
export type CreateCompetition = Omit<Competition, "id" | "createdAt">;
export type CreateEvent = Omit<CompetitionEvent, "id" | "createdAt" | "sourceDocumentIds">;
export type SaveDraft = { expectedRevision: number; body: RuleBody; evidence: EvidenceInput[] };
export type EventDetail = {
  competition: Competition;
  event: CompetitionEvent;
  versions: RuleVersion[];
  current: RuleVersion | null;
  draft: RuleVersion | null;
};
export type PublicationIssue = { fieldPath: string; message: string };

const competitionErrorTag = Symbol.for("shenbaotong.competition-error");
export class CompetitionError extends Error {
  readonly [competitionErrorTag] = true;
  constructor(message: string, public status: 400 | 404 | 409 = 400) {
    super(message);
    this.name = "CompetitionError";
  }
}

// Route bundles can have distinct constructors while sharing the cached store.
export function isCompetitionError(error: unknown): error is CompetitionError {
  return error instanceof Error && Reflect.get(error, competitionErrorTag) === true
    && [400, 404, 409].includes(Reflect.get(error, "status"));
}

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
  { path: "school.basisYear", kind: "integer", label: "学校认定适用年" },
];

export function emptyRuleBody(): RuleBody {
  return { schemaVersion: 1, sources: [], fields: {} };
}
