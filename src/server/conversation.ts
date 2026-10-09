import type { Answer, ConversationMessage } from "./types";

export const CONTEXT_TURNS = 8;
export const CONTEXT_CHARACTERS = 6000;

export function personalConversation(question: string, hasHistory: boolean) {
  if (/报名|组队|材料|截止|规则|比赛|竞赛|参赛|参加|费用|人数|几人|老师|教师|奖项|资格|适合|要求/.test(question)) return false;
  return (/^我(?:是|目前是|现在是|就读|在读|读).{0,80}(?:专业|大[一二三四]|研究生|本科|专科|学生)/.test(question) && !/报名|组队|材料|截止|规则|赛|要求|[？?]/.test(question)) ||
    (hasHistory && /我(?:刚才|之前|前面|刚|上次).*(?:说|提|告诉).*(?:专业|年级|学校|方向|偏好|名字)|(?:我的|我是什么).*(?:专业|年级|学校|方向|偏好)|你(?:还)?记得我/.test(question));
}

export function conversationMessages(answers: Answer[]): ConversationMessage[] {
  const pairs: ConversationMessage[][] = [];
  let remaining = CONTEXT_CHARACTERS;
  for (const answer of answers.slice(-CONTEXT_TURNS).reverse()) {
    const user = answer.question.slice(0, Math.min(1000, remaining));
    const assistant = answer.answer.slice(0, Math.min(1200, remaining - user.length));
    if (!user || !assistant) break;
    pairs.unshift([{ role: "user", content: user }, { role: "assistant", content: assistant }]);
    remaining -= user.length + assistant.length;
    if (remaining < 2) break;
  }
  return pairs.flat();
}
