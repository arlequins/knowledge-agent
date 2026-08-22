import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { and, desc, eq, inArray, lt } from "drizzle-orm";
import { closeDatabasePool, db } from "../src/client";
import {
  Conversation,
  Document,
  DocumentChunk,
  Feedback,
  Investigation,
  Message,
} from "../src/schema";

type ReviewedFinding = {
  evidenceChunkIds: string[];
  expectedTerms: string[];
  forbiddenTerms?: string[];
};

const REVIEW_SYSTEM_PROMPT =
  "근거로 확인된 사실만 답하고, 설계와 현재 활성화된 구성을 구분한다. 시간대 근거 없이 cron을 현지 시각으로 바꾸지 않는다.";
const RUNTIME_SYSTEM_PROMPT =
  "You are a precise evidence-grounded assistant. Answer entirely in the user's language; when the question is Korean, write only Korean except for exact technical identifiers and quoted source values, and never switch to Chinese. Treat user assertions as claims to verify. Distinguish proposed design, checked-in configuration, enabled schedule, and observed live state. A daily evaluation or improvement loop is not daily model fine-tuning. Give an exact run time only when evidence provides both an enabled schedule and its timezone. Never claim that an administrator or external system confirmed something unless that confirmation appears in the supplied evidence.";

function systemPrompts(resolution: string) {
  return [
    REVIEW_SYSTEM_PROMPT,
    RUNTIME_SYSTEM_PROMPT,
    `${RUNTIME_SYSTEM_PROMPT}\n\nRetrieved knowledge:\n[source: approved investigation]\n${resolution}\n\nUse retrieved knowledge as evidence. If it is insufficient, say what is unknown instead of inventing facts.`,
  ];
}

function outputDirectory() {
  const index = process.argv.indexOf("--output");
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value) throw new Error("--output is required");
  return resolve(value);
}

function reviewedFinding(value: unknown): ReviewedFinding | undefined {
  if (!value || typeof value !== "object") return undefined;
  const finding = value as Record<string, unknown>;
  if (
    !Array.isArray(finding.evidenceChunkIds) ||
    !finding.evidenceChunkIds.every((value) => typeof value === "string") ||
    finding.evidenceChunkIds.length === 0 ||
    !Array.isArray(finding.expectedTerms) ||
    !finding.expectedTerms.every((value) => typeof value === "string") ||
    finding.expectedTerms.length === 0 ||
    (finding.forbiddenTerms !== undefined &&
      (!Array.isArray(finding.forbiddenTerms) ||
        !finding.forbiddenTerms.every((value) => typeof value === "string")))
  )
    return undefined;
  return finding as ReviewedFinding;
}

const output = outputDirectory();
try {
  const approved = await db
    .select({
      answerCreatedAt: Message.createdAt,
      conversationId: Message.conversationId,
      feedbackId: Feedback.id,
      findings: Investigation.findings,
      investigationId: Investigation.id,
      resolution: Investigation.resolution,
    })
    .from(Investigation)
    .innerJoin(Feedback, eq(Investigation.feedbackId, Feedback.id))
    .innerJoin(Message, eq(Feedback.messageId, Message.id))
    .innerJoin(Conversation, eq(Message.conversationId, Conversation.id))
    .where(eq(Investigation.status, "approved"))
    .orderBy(desc(Investigation.completedAt));

  const examples: Array<{
    answer: string;
    evidence: Array<{ filename: string; locator: string | null }>;
    feedbackId: string;
    forbiddenTerms: string[];
    investigationId: string;
    messages: Array<{ content: string; role: "assistant" | "system" | "user" }>;
    question: string;
    requiredTerms: string[];
    systemPrompts: string[];
  }> = [];
  for (const row of approved) {
    const finding = reviewedFinding(row.findings);
    if (!finding || !row.resolution?.trim()) continue;
    const [question] = await db
      .select({ content: Message.content })
      .from(Message)
      .where(
        and(
          eq(Message.conversationId, row.conversationId),
          eq(Message.role, "user"),
          lt(Message.createdAt, row.answerCreatedAt),
        ),
      )
      .orderBy(desc(Message.createdAt))
      .limit(1);
    if (!question?.content.trim()) continue;
    const evidence = await db
      .select({
        filename: Document.filename,
        id: DocumentChunk.id,
        locator: DocumentChunk.locator,
      })
      .from(DocumentChunk)
      .innerJoin(Document, eq(DocumentChunk.documentId, Document.id))
      .where(
        and(
          inArray(DocumentChunk.id, finding.evidenceChunkIds),
          eq(Document.status, "completed"),
        ),
      );
    if (evidence.length !== new Set(finding.evidenceChunkIds).size)
      throw new Error(
        `Approved investigation ${row.investigationId} references missing evidence`,
      );
    const answer = row.resolution.trim();
    const prompts = systemPrompts(answer);
    examples.push({
      answer,
      evidence: evidence.map(({ filename, locator }) => ({
        filename,
        locator,
      })),
      feedbackId: row.feedbackId,
      forbiddenTerms: finding.forbiddenTerms ?? [],
      investigationId: row.investigationId,
      messages: [
        {
          content: prompts[0] ?? REVIEW_SYSTEM_PROMPT,
          role: "system",
        },
        { content: question.content, role: "user" },
        { content: answer, role: "assistant" },
      ],
      question: question.content,
      requiredTerms: finding.expectedTerms,
      systemPrompts: prompts,
    });
  }
  if (examples.length === 0)
    throw new Error("No approved, evidence-backed tuning examples were found");

  await mkdir(output, { recursive: true });
  const trainingRows = examples.flatMap(({ answer, question, systemPrompts }) =>
    systemPrompts.map((systemPrompt) =>
      JSON.stringify({
        messages: [
          { content: systemPrompt, role: "system" },
          { content: question, role: "user" },
          { content: answer, role: "assistant" },
        ],
      }),
    ),
  );
  const data = `${trainingRows.join("\n")}\n`;
  await Promise.all([
    writeFile(resolve(output, "train.jsonl"), data, { mode: 0o600 }),
    writeFile(resolve(output, "valid.jsonl"), data, { mode: 0o600 }),
    writeFile(resolve(output, "test.jsonl"), data, { mode: 0o600 }),
    writeFile(
      resolve(output, "manifest.json"),
      `${JSON.stringify({ examples, exportedAt: new Date().toISOString(), version: 1 }, null, 2)}\n`,
      { mode: 0o600 },
    ),
  ]);
  console.log(`Exported ${examples.length} approved tuning example(s).`);
} finally {
  await closeDatabasePool();
}
