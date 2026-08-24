import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { and, desc, eq, inArray, isNull, lt } from "drizzle-orm";
import { closeDatabasePool, db } from "../src/client";
import {
  Conversation,
  Document,
  DocumentChunk,
  Feedback,
  Investigation,
  Message,
} from "../src/schema";
import { splitDistinctTuningExamples } from "./tuning-dataset";

type ReviewedFinding = {
  evidenceChunkIds: string[];
  expectedTerms: string[];
  forbiddenTerms?: string[];
};

const REVIEW_SYSTEM_PROMPT =
  "제공된 근거만 사용해 질문 언어로 답한다. 설계와 활성 구성을 구분하고 근거 없는 값은 만들지 않는다.";
const MAX_EVIDENCE_CHARACTERS = 2_000;

function promptEvidence(content: string) {
  return content.length > MAX_EVIDENCE_CHARACTERS
    ? `${content.slice(0, MAX_EVIDENCE_CHARACTERS)}\n[근거 뒷부분 생략]`
    : content;
}

function systemPrompts(evidence: string) {
  return [`${REVIEW_SYSTEM_PROMPT}\n\n검증된 근거:\n${evidence}`];
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
    evidence: Array<{
      content: string;
      filename: string;
      locator: string | null;
    }>;
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
        content: DocumentChunk.content,
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
          isNull(Document.deletedAt),
        ),
      );
    if (evidence.length !== new Set(finding.evidenceChunkIds).size)
      throw new Error(
        `Approved investigation ${row.investigationId} references missing evidence`,
      );
    const answer = row.resolution.trim();
    const evidenceBlock = evidence
      .map(
        ({ content, filename, locator }) =>
          `[source: ${filename}${locator ? ` · ${locator}` : ""}]\n${promptEvidence(content)}`,
      )
      .join("\n\n");
    const prompts = systemPrompts(evidenceBlock);
    examples.push({
      answer,
      evidence: evidence.map(({ content, filename, locator }) => ({
        content,
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
  const splits = splitDistinctTuningExamples(examples);
  const rows = (split: typeof examples) =>
    split.flatMap(({ answer, question, systemPrompts }) =>
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
  const data = (split: typeof examples) => `${rows(split).join("\n")}\n`;
  await Promise.all([
    writeFile(resolve(output, "train.jsonl"), data(splits.train), {
      mode: 0o600,
    }),
    writeFile(resolve(output, "valid.jsonl"), data(splits.valid), {
      mode: 0o600,
    }),
    writeFile(resolve(output, "test.jsonl"), data(splits.test), {
      mode: 0o600,
    }),
    writeFile(
      resolve(output, "manifest.json"),
      `${JSON.stringify(
        {
          exportedAt: new Date().toISOString(),
          splits,
          version: 2,
        },
        null,
        2,
      )}\n`,
      { mode: 0o600 },
    ),
  ]);
  console.log(
    `Exported ${examples.length} distinct approved tuning examples (${splits.train.length} train, ${splits.valid.length} validation, ${splits.test.length} test).`,
  );
} finally {
  await closeDatabasePool();
}
