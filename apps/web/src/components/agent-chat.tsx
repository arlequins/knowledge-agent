"use client";

import { Button } from "@arlequins/ui/button";
import { Input } from "@arlequins/ui/input";
import { Textarea } from "@arlequins/ui/textarea";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useRef, useState } from "react";

import { useAuth } from "~/auth/provider";
import { env } from "~/env";
import { useTRPC } from "~/trpc/react";
import { MarkdownMessage } from "./markdown-message";

const STARTER_PROMPTS = [
  "이 코드베이스의 핵심 흐름을 근거와 함께 설명해줘",
  "관련된 tRPC API와 데이터 모델의 연결을 찾아줘",
  "공식 문서를 기준으로 이 기술의 사용법을 설명해줘",
  "근거가 충분한 내용과 확인이 필요한 내용을 구분해줘",
] as const;

const PERSONAL_MODEL_DEFAULTS = {
  gemini: "gemini-3.5-flash-lite",
  openai: "gpt-5-mini",
} as const;

const PERSONAL_MODEL_OPTIONS = {
  gemini: [
    ["gemini-3.5-flash-lite", "Gemini 3.5 Flash-Lite"],
    ["gemini-3.6-flash", "Gemini 3.6 Flash"],
    ["gemini-3.7-flash", "Gemini 3.7 Flash"],
  ],
  openai: [
    ["gpt-5-mini", "GPT-5 mini"],
    ["gpt-5.4-mini", "GPT-5.4 mini"],
    ["gpt-5.6-terra", "GPT-5.6 Terra"],
  ],
} as const;

type ModelChoice = {
  apiKey: string;
  modelId: string;
  provider: "default" | "gemini" | "openai";
};

const DEFAULT_MODEL_CHOICE: ModelChoice = {
  apiKey: "",
  modelId: "",
  provider: "default",
};

function conversationTitle(question: string): string {
  const normalized = question
    .replace(/[`*_~>#[\](){}|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const characters = Array.from(normalized || "새 대화");
  return characters.length > 56
    ? `${characters.slice(0, 56).join("")}…`
    : characters.join("");
}

function messageError(error: unknown): string {
  return error instanceof Error ? error.message : "요청을 처리하지 못했습니다.";
}

function streamErrorMessage(error: unknown): string {
  const message = messageError(error);
  if (message === "Selected model request failed") {
    return "선택한 모델에서 응답을 받지 못했습니다. 모델 ID와 개인 API 키 또는 로컬 모델 실행 상태를 확인해 주세요.";
  }
  if (
    message === "Local model request failed" ||
    message === "Local model completion is not configured"
  ) {
    return "로컬 Ollama 응답을 받지 못했습니다. Ollama 실행 상태와 `.env.localhost`의 모델 설정을 확인한 뒤 다시 보내세요.";
  }
  if (message === "응답 스트림을 시작하지 못했습니다.") {
    return "에이전트 API에 연결하지 못했습니다. 로컬 개발 서버가 실행 중인지 확인한 뒤 다시 보내세요.";
  }
  return message;
}

function MessageCitations({
  evaluationCaseExists,
  isOwner,
  messageId,
  question,
  workspaceId,
}: {
  evaluationCaseExists: boolean;
  isOwner: boolean;
  messageId: string;
  question?: string;
  workspaceId: string;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [evaluationStatus, setEvaluationStatus] = useState<string>();
  const citations = useQuery(
    trpc.agent.messageCitations.queryOptions({ messageId, workspaceId }),
  );
  const createEvaluationCase = useMutation(
    trpc.agent.createEvaluationCase.mutationOptions({
      onError: (error) => setEvaluationStatus(messageError(error)),
      onSuccess: async () => {
        setEvaluationStatus("평가 기준으로 저장했습니다.");
        await queryClient.invalidateQueries({
          queryKey: trpc.agent.evaluationCases.queryKey({ workspaceId }),
        });
      },
    }),
  );
  if (!citations.data?.length) return null;
  return (
    <details className="mt-3 border-t pt-3 text-xs">
      <summary className="cursor-pointer font-medium">
        인용 {citations.data.length}개
      </summary>
      <ul className="text-muted-foreground mt-2 space-y-1">
        {citations.data.map((citation) => (
          <li key={`${citation.documentId}-${citation.ordinal}`}>
            {citation.filename}
            {citation.locator ? ` · ${citation.locator}` : ""}
            {citation.sourceUri?.startsWith("http")
              ? ` · ${citation.sourceUri}`
              : ""}
            {citation.content ? ` — ${citation.content.slice(0, 120)}` : ""}
          </li>
        ))}
      </ul>
      {isOwner && question ? (
        <div className="mt-3 rounded-md border bg-background p-2">
          <p className="text-muted-foreground">
            인용 내용을 검토한 뒤 이 질문을 반복 평가 기준으로 저장할 수
            있습니다.
          </p>
          <button
            className="mt-2 font-medium hover:underline disabled:cursor-not-allowed disabled:opacity-50"
            disabled={evaluationCaseExists || createEvaluationCase.isPending}
            onClick={() =>
              createEvaluationCase.mutate({
                expectedChunkIds: citations.data.map(
                  (citation) => citation.chunkId,
                ),
                question,
                workspaceId,
              })
            }
            type="button"
          >
            {evaluationCaseExists
              ? "평가 기준에 저장됨"
              : createEvaluationCase.isPending
                ? "저장 중…"
                : "이 인용들을 평가 기준으로 저장"}
          </button>
          {evaluationStatus ? (
            <p className="text-muted-foreground mt-2" role="status">
              {evaluationStatus}
            </p>
          ) : null}
        </div>
      ) : null}
    </details>
  );
}

type FeedbackKind = "helpful" | "incorrect" | "missing" | "needs-investigation";

function MessageFeedback({
  content,
  messageId,
  onReuse,
  workspaceId,
}: {
  content: string;
  messageId: string;
  onReuse: (() => void) | undefined;
  workspaceId: string;
}) {
  const trpc = useTRPC();
  const [comment, setComment] = useState("");
  const [feedbackKind, setFeedbackKind] = useState<FeedbackKind>();
  const [isCopied, setIsCopied] = useState(false);
  const [status, setStatus] = useState<string>();
  const submitFeedback = useMutation(
    trpc.agent.submitFeedback.mutationOptions({
      onError: (error) => setStatus(messageError(error)),
      onSuccess: () => {
        setComment("");
        setFeedbackKind(undefined);
        setStatus("피드백을 저장했습니다.");
      },
    }),
  );

  function submit(kind: FeedbackKind, feedbackComment?: string) {
    setStatus(undefined);
    submitFeedback.mutate({
      ...(feedbackComment?.trim() ? { comment: feedbackComment.trim() } : {}),
      kind,
      messageId,
      workspaceId,
    });
  }

  async function copyAnswer() {
    try {
      await navigator.clipboard.writeText(content);
      setIsCopied(true);
      window.setTimeout(() => setIsCopied(false), 1500);
    } catch {
      setStatus("답변을 복사하지 못했습니다.");
    }
  }

  return (
    <div className="mt-3 border-t pt-3 text-xs">
      <div className="flex flex-wrap gap-x-3 gap-y-2">
        <button
          className="text-muted-foreground hover:text-foreground hover:underline"
          onClick={() => void copyAnswer()}
          type="button"
        >
          {isCopied ? "복사됨" : "복사"}
        </button>
        {onReuse ? (
          <button
            className="text-muted-foreground hover:text-foreground hover:underline"
            onClick={onReuse}
            type="button"
          >
            다시 묻기
          </button>
        ) : null}
        <button
          className="text-muted-foreground hover:text-foreground hover:underline"
          disabled={submitFeedback.isPending}
          onClick={() => submit("helpful")}
          type="button"
        >
          정확함
        </button>
        {(
          [
            ["incorrect", "부정확"],
            ["missing", "근거 부족"],
            ["needs-investigation", "조사 요청"],
          ] as const
        ).map(([kind, label]) => (
          <button
            className="text-muted-foreground hover:text-foreground hover:underline"
            disabled={submitFeedback.isPending}
            key={kind}
            onClick={() => {
              setFeedbackKind(kind);
              setStatus(undefined);
            }}
            type="button"
          >
            {label}
          </button>
        ))}
      </div>
      {feedbackKind ? (
        <form
          className="mt-3 space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            submit(feedbackKind, comment);
          }}
        >
          <Textarea
            aria-label="피드백 설명"
            onChange={(event) => setComment(event.target.value)}
            placeholder="틀린 부분, 빠진 근거, 기대한 답을 적어 주세요. 사실로 바로 학습하지 않고 검토 신호로 저장됩니다."
            value={comment}
          />
          <div className="flex gap-2">
            <Button disabled={submitFeedback.isPending} size="sm" type="submit">
              {submitFeedback.isPending ? "저장 중…" : "피드백 저장"}
            </Button>
            <Button
              onClick={() => {
                setComment("");
                setFeedbackKind(undefined);
              }}
              size="sm"
              type="button"
              variant="outline"
            >
              취소
            </Button>
          </div>
        </form>
      ) : null}
      {status ? (
        <p className="text-muted-foreground mt-2" role="status">
          {status}
        </p>
      ) : null}
    </div>
  );
}

export function AgentChat() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [workspaceId, setWorkspaceId] = useState<string>();
  const [conversationId, setConversationId] = useState<string>();
  const [isNewConversation, setIsNewConversation] = useState(false);
  const [conversationLimit, setConversationLimit] = useState(30);
  const [conversationSearch, setConversationSearch] = useState("");
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [workspaceName, setWorkspaceName] = useState("");
  const [documentContent, setDocumentContent] = useState("");
  const [documentContentType, setDocumentContentType] = useState<
    "text/html" | "text/markdown" | "text/plain"
  >("text/plain");
  const [documentFileError, setDocumentFileError] = useState<string>();
  const [documentFilename, setDocumentFilename] = useState("notes.txt");
  const [memoryContent, setMemoryContent] = useState("");
  const [memberUserId, setMemberUserId] = useState("");
  const [question, setQuestion] = useState("");
  const [streamedText, setStreamedText] = useState("");
  const [streamError, setStreamError] = useState<string>();
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamPhase, setStreamPhase] = useState<"answering" | "retrieving">(
    "retrieving",
  );
  const [modelChoice, setModelChoice] =
    useState<ModelChoice>(DEFAULT_MODEL_CHOICE);
  const [draftModelChoice, setDraftModelChoice] =
    useState<ModelChoice>(DEFAULT_MODEL_CHOICE);
  const [isModelSettingsOpen, setIsModelSettingsOpen] = useState(false);
  const [modelSettingsError, setModelSettingsError] = useState<string>();
  const abortControllerRef = useRef<AbortController>(null);
  const messagesViewportRef = useRef<HTMLDivElement>(null);
  const questionInputRef = useRef<HTMLTextAreaElement>(null);
  const { user } = useAuth();
  const workspaces = useQuery(trpc.agent.workspaces.queryOptions());
  const modelCatalog = useQuery(trpc.agent.models.queryOptions());
  const modelCredentials = useQuery(trpc.agent.modelCredentials.queryOptions());
  const conversations = useQuery({
    ...trpc.agent.conversations.queryOptions({
      workspaceId: workspaceId ?? "",
    }),
    enabled: Boolean(workspaceId),
  });
  const messages = useQuery({
    ...trpc.agent.messages.queryOptions({
      conversationId: conversationId ?? "",
      workspaceId: workspaceId ?? "",
    }),
    enabled: Boolean(workspaceId && conversationId),
  });
  const documents = useQuery({
    ...trpc.agent.documents.queryOptions({ workspaceId: workspaceId ?? "" }),
    enabled: Boolean(workspaceId),
  });
  const indexRuns = useQuery({
    ...trpc.agent.indexRuns.queryOptions({ workspaceId: workspaceId ?? "" }),
    enabled: Boolean(workspaceId),
  });
  const memories = useQuery({
    ...trpc.agent.memories.queryOptions({ workspaceId: workspaceId ?? "" }),
    enabled: Boolean(workspaceId),
  });
  const usage = useQuery({
    ...trpc.agent.usage.queryOptions({ workspaceId: workspaceId ?? "" }),
    enabled: Boolean(workspaceId),
  });
  const isOwner =
    workspaces.data?.find((workspace) => workspace.id === workspaceId)?.role ===
    "owner";
  const visibleConversations = conversations.data?.filter((conversation) =>
    conversation.title
      .toLocaleLowerCase()
      .includes(conversationSearch.trim().toLocaleLowerCase()),
  );
  const auditLog = useQuery({
    ...trpc.agent.auditLog.queryOptions({ workspaceId: workspaceId ?? "" }),
    enabled: Boolean(workspaceId && isOwner),
  });
  const evaluationCases = useQuery({
    ...trpc.agent.evaluationCases.queryOptions({
      workspaceId: workspaceId ?? "",
    }),
    enabled: Boolean(workspaceId && isOwner),
  });
  const evaluationRuns = useQuery({
    ...trpc.agent.evaluationRuns.queryOptions({
      workspaceId: workspaceId ?? "",
    }),
    enabled: Boolean(workspaceId && isOwner),
  });

  useEffect(() => {
    if (!workspaceId && workspaces.data?.[0])
      setWorkspaceId(workspaces.data[0].id);
  }, [workspaceId, workspaces.data]);

  useEffect(() => {
    if (!conversationId && !isNewConversation && conversations.data?.[0]) {
      setConversationId(conversations.data[0].id);
    }
  }, [conversationId, conversations.data, isNewConversation]);

  useEffect(() => {
    const hasConversationContent = Boolean(
      conversationId ||
        isStreaming ||
        messages.data?.length ||
        streamedText.length,
    );
    const viewport = messagesViewportRef.current;
    if (!viewport || !hasConversationContent) return;
    const frame = window.requestAnimationFrame(() => {
      viewport.scrollTo({
        behavior: isStreaming ? "auto" : "smooth",
        top: viewport.scrollHeight,
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [conversationId, isStreaming, messages.data?.length, streamedText]);

  useEffect(
    () => () => {
      abortControllerRef.current?.abort();
    },
    [],
  );

  const createWorkspace = useMutation(
    trpc.agent.createWorkspace.mutationOptions({
      onSuccess: async (workspace) => {
        setWorkspaceId(workspace.id);
        setConversationId(undefined);
        setIsNewConversation(true);
        setWorkspaceName("");
        await queryClient.invalidateQueries({
          queryKey: trpc.agent.workspaces.queryKey(),
        });
      },
    }),
  );
  const createConversation = useMutation(
    trpc.agent.createConversation.mutationOptions({
      onSuccess: async (conversation) => {
        setConversationId(conversation?.id);
        setIsNewConversation(false);
        await queryClient.invalidateQueries({
          queryKey: trpc.agent.conversations.queryKey({
            workspaceId: workspaceId ?? "",
          }),
        });
      },
    }),
  );
  const archiveConversation = useMutation(
    trpc.agent.archiveConversation.mutationOptions({
      onSuccess: async () => {
        setConversationId(undefined);
        setIsNewConversation(true);
        await queryClient.invalidateQueries({
          queryKey: trpc.agent.conversations.queryKey({
            workspaceId: workspaceId ?? "",
          }),
        });
      },
    }),
  );
  const ingestTextDocument = useMutation(
    trpc.agent.ingestTextDocument.mutationOptions({
      onSuccess: async () => {
        setDocumentContent("");
        await queryClient.invalidateQueries({
          queryKey: trpc.agent.documents.queryKey({
            workspaceId: workspaceId ?? "",
          }),
        });
      },
    }),
  );
  const deleteDocument = useMutation(
    trpc.agent.deleteDocument.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries({
          queryKey: trpc.agent.documents.queryKey({
            workspaceId: workspaceId ?? "",
          }),
        });
      },
    }),
  );
  const startIndex = useMutation(
    trpc.agent.startIndex.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries({
          queryKey: trpc.agent.indexRuns.queryKey({
            workspaceId: workspaceId ?? "",
          }),
        });
      },
    }),
  );
  const createMemory = useMutation(
    trpc.agent.createMemory.mutationOptions({
      onSuccess: () => {
        setMemoryContent("");
      },
    }),
  );
  const reviewMemory = useMutation(
    trpc.agent.reviewMemory.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries({
          queryKey: trpc.agent.memories.queryKey({
            workspaceId: workspaceId ?? "",
          }),
        });
      },
    }),
  );
  const deleteMemory = useMutation(
    trpc.agent.deleteMemory.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries({
          queryKey: trpc.agent.memories.queryKey({
            workspaceId: workspaceId ?? "",
          }),
        });
      },
    }),
  );
  const addWorkspaceMember = useMutation(
    trpc.agent.addWorkspaceMember.mutationOptions({
      onSuccess: () => setMemberUserId(""),
    }),
  );
  const runEvaluation = useMutation(
    trpc.agent.runEvaluation.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries({
          queryKey: trpc.agent.evaluationRuns.queryKey({
            workspaceId: workspaceId ?? "",
          }),
        });
      },
    }),
  );
  const saveModelCredential = useMutation(
    trpc.agent.saveModelCredential.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries({
          queryKey: trpc.agent.modelCredentials.queryKey(),
        });
      },
    }),
  );
  const deleteModelCredential = useMutation(
    trpc.agent.deleteModelCredential.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries({
          queryKey: trpc.agent.modelCredentials.queryKey(),
        });
      },
    }),
  );
  function submitWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = workspaceName.trim();
    if (!name) return;
    const slug = `${
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") || "workspace"
    }-${Date.now()}`;
    createWorkspace.mutate({ name, slug });
  }

  function submitDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspaceId || !documentContent.trim() || !documentFilename.trim())
      return;
    ingestTextDocument.mutate({
      content: documentContent,
      contentType: documentContentType,
      filename: documentFilename.trim(),
      workspaceId,
    });
  }

  async function selectDocumentFile(file?: File) {
    setDocumentFileError(undefined);
    if (!file) return;
    if (!/\.(md|txt)$/i.test(file.name) && file.type !== "text/plain") {
      setDocumentFileError(
        "현재는 안전하게 텍스트와 Markdown 파일만 지원합니다.",
      );
      return;
    }
    if (file.size > 1_000_000) {
      setDocumentFileError("문서는 1MB 이하여야 합니다.");
      return;
    }
    setDocumentFilename(file.name);
    setDocumentContentType(
      file.type === "text/html" || /\.html?$/i.test(file.name)
        ? "text/html"
        : /\.md$/i.test(file.name)
          ? "text/markdown"
          : "text/plain",
    );
    setDocumentContent(await file.text());
  }

  function submitMemory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspaceId || !memoryContent.trim()) return;
    createMemory.mutate({
      content: memoryContent,
      sourceConversationId: conversationId,
      workspaceId,
    });
  }

  function reuseQuestion(value: string) {
    setQuestion(value);
    window.requestAnimationFrame(() => {
      questionInputRef.current?.focus();
    });
  }

  function stopGeneration() {
    abortControllerRef.current?.abort();
  }

  async function applyModelChoice() {
    const next = {
      ...draftModelChoice,
      apiKey: draftModelChoice.apiKey.trim(),
      modelId: draftModelChoice.modelId.trim(),
    };
    if (next.provider !== "default" && !next.modelId) {
      setModelSettingsError("사용할 모델 ID를 입력해 주세요.");
      return;
    }
    if (next.provider !== "default") {
      const saved = modelCredentials.data?.find(
        (credential) => credential.provider === next.provider,
      );
      if (!next.apiKey && !saved) {
        setModelSettingsError("처음 연결할 때는 개인 API 키가 필요합니다.");
        return;
      }
      try {
        await saveModelCredential.mutateAsync({
          ...(next.apiKey ? { apiKey: next.apiKey } : {}),
          modelId: next.modelId,
          provider: next.provider,
        });
      } catch (error) {
        setModelSettingsError(messageError(error));
        return;
      }
    }
    setModelChoice({ ...next, apiKey: "" });
    setDraftModelChoice({ ...next, apiKey: "" });
    setModelSettingsError(undefined);
    setIsModelSettingsOpen(false);
  }

  function resetModelChoice() {
    setModelChoice(DEFAULT_MODEL_CHOICE);
    setDraftModelChoice(DEFAULT_MODEL_CHOICE);
    setModelSettingsError(undefined);
    setIsModelSettingsOpen(false);
  }

  async function removeSavedCredential(provider: "gemini" | "openai") {
    try {
      await deleteModelCredential.mutateAsync({ provider });
      if (modelChoice.provider === provider) resetModelChoice();
      else
        setDraftModelChoice((current) => ({
          ...current,
          apiKey: "",
        }));
    } catch (error) {
      setModelSettingsError(messageError(error));
    }
  }

  function currentModelLabel() {
    if (modelChoice.provider === "gemini")
      return `Gemini · ${modelChoice.modelId}`;
    if (modelChoice.provider === "openai")
      return `OpenAI · ${modelChoice.modelId}`;
    return modelCatalog.data?.defaultModel?.label ?? "기본 모델";
  }

  function savedCredential(provider: "gemini" | "openai") {
    return modelCredentials.data?.find(
      (credential) => credential.provider === provider,
    );
  }

  function questionBefore(messageIndex: number) {
    return messages.data
      ?.slice(0, messageIndex)
      .reverse()
      .find((candidate) => candidate.role === "user")?.content;
  }

  async function submitQuestion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submittedQuestion = question.trim();
    if (!workspaceId || !submittedQuestion) return;
    setIsStreaming(true);
    setStreamPhase("retrieving");
    setStreamedText("");
    setStreamError(undefined);
    const controller = new AbortController();
    abortControllerRef.current?.abort();
    abortControllerRef.current = controller;
    try {
      let activeConversationId = conversationId;
      if (!activeConversationId) {
        const conversation = await createConversation.mutateAsync({
          title: conversationTitle(submittedQuestion),
          workspaceId,
        });
        if (!conversation) throw new Error("대화를 만들지 못했습니다.");
        activeConversationId = conversation.id;
      }
      const response = await fetch(
        `${env.NEXT_PUBLIC_API_URL.replace(/\/$/, "")}/agent/stream`,
        {
          method: "POST",
          headers: {
            ...(user?.access_token && !user.expired
              ? { Authorization: `Bearer ${user.access_token}` }
              : {}),
            "Content-Type": "application/json",
            ...(modelChoice.provider !== "default"
              ? {
                  "X-Agent-Model": modelChoice.modelId,
                  "X-Agent-Model-Provider": modelChoice.provider,
                }
              : {}),
          },
          body: JSON.stringify({
            conversationId: activeConversationId,
            question: submittedQuestion,
            workspaceId,
          }),
          signal: controller.signal,
        },
      );
      if (!response.ok || !response.body) {
        throw new Error("응답 스트림을 시작하지 못했습니다.");
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffered = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffered += decoder.decode(value, { stream: true });
        const lines = buffered.split("\n");
        buffered = lines.pop() ?? "";
        for (const line of lines) {
          if (!line) continue;
          const value = JSON.parse(line) as {
            message?: string;
            text?: string;
            type: "complete" | "delta" | "error";
          };
          if (value.type === "delta") {
            setStreamPhase("answering");
            setStreamedText((text) => text + (value.text ?? ""));
          }
          if (value.type === "error") throw new Error(value.message);
        }
      }
      setQuestion("");
      await queryClient.invalidateQueries({
        queryKey: trpc.agent.messages.queryKey({
          conversationId: activeConversationId,
          workspaceId,
        }),
      });
      await queryClient.invalidateQueries({
        queryKey: trpc.agent.conversations.queryKey({ workspaceId }),
      });
    } catch (error) {
      if (
        controller.signal.aborted ||
        (error instanceof DOMException && error.name === "AbortError")
      ) {
        setQuestion(submittedQuestion);
        setStreamError(
          "답변 생성을 중지했습니다. 질문을 다듬거나 그대로 다시 보낼 수 있습니다.",
        );
      } else {
        setStreamError(streamErrorMessage(error));
      }
    } finally {
      if (abortControllerRef.current === controller)
        abortControllerRef.current = null;
      setIsStreaming(false);
      setStreamedText("");
    }
  }

  if (workspaces.isLoading)
    return (
      <p className="text-muted-foreground">워크스페이스를 불러오는 중입니다.</p>
    );
  if (workspaces.isError)
    return <p className="text-destructive">{messageError(workspaces.error)}</p>;

  if (!workspaceId) {
    return (
      <form className="rounded-xl border p-6" onSubmit={submitWorkspace}>
        <h2 className="text-lg font-semibold">첫 워크스페이스 만들기</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          대화와 문서는 이 워크스페이스 안에서만 공유됩니다.
        </p>
        <div className="mt-4 flex gap-2">
          <Input
            aria-label="워크스페이스 이름"
            onChange={(event) => setWorkspaceName(event.target.value)}
            placeholder="예: 개인 연구"
            value={workspaceName}
          />
          <Button disabled={createWorkspace.isPending} type="submit">
            만들기
          </Button>
        </div>
        {createWorkspace.isError && (
          <p className="text-destructive mt-3 text-sm">
            {messageError(createWorkspace.error)}
          </p>
        )}
      </form>
    );
  }

  return (
    <section className="grid w-full min-w-0 gap-3 lg:grid-cols-[16rem_minmax(0,1fr)]">
      <aside
        className={`${isSidebarOpen ? "block" : "hidden"} rounded-xl border p-3 lg:block lg:max-h-[calc(100vh-6.75rem)] lg:overflow-y-auto`}
      >
        <div className="mb-3 flex items-center justify-between lg:hidden">
          <p className="text-sm font-medium">대화 및 도구</p>
          <Button
            onClick={() => setIsSidebarOpen(false)}
            size="sm"
            type="button"
            variant="ghost"
          >
            닫기
          </Button>
        </div>
        <p className="text-muted-foreground px-2 text-xs font-medium tracking-wide uppercase">
          워크스페이스
        </p>
        <select
          className="mt-2 h-9 w-full rounded-md border bg-background px-2 text-sm"
          onChange={(event) => {
            setWorkspaceId(event.target.value);
            setConversationId(undefined);
            setIsNewConversation(false);
            setConversationLimit(30);
          }}
          value={workspaceId}
        >
          {workspaces.data?.map((workspace) => (
            <option key={workspace.id} value={workspace.id}>
              {workspace.name}
            </option>
          ))}
        </select>
        <Button
          className="mt-4 w-full"
          disabled={isStreaming}
          onClick={() => {
            setConversationId(undefined);
            setIsNewConversation(true);
            setIsSidebarOpen(false);
            setQuestion("");
            setStreamError(undefined);
          }}
          variant="outline"
        >
          새 대화
        </Button>
        <Input
          aria-label="대화 검색"
          className="mt-3"
          onChange={(event) => setConversationSearch(event.target.value)}
          placeholder="대화 검색"
          value={conversationSearch}
        />
        <div className="mt-4 max-h-64 space-y-1 overflow-y-auto pr-1">
          {visibleConversations
            ?.slice(0, conversationLimit)
            .map((conversation) => (
              <button
                className={`w-full rounded-md px-2 py-2 text-left text-sm ${conversationId === conversation.id ? "bg-accent" : "hover:bg-accent/60"}`}
                key={conversation.id}
                onClick={() => {
                  setConversationId(conversation.id);
                  setIsNewConversation(false);
                  setIsSidebarOpen(false);
                }}
                title={conversation.title}
                type="button"
              >
                <span className="block truncate">{conversation.title}</span>
              </button>
            ))}
          {visibleConversations?.length === 0 ? (
            <p className="text-muted-foreground px-2 py-3 text-xs">
              일치하는 대화가 없습니다.
            </p>
          ) : null}
          {(visibleConversations?.length ?? 0) > conversationLimit ? (
            <button
              className="text-muted-foreground w-full rounded-md px-2 py-2 text-left text-xs hover:bg-accent/60"
              onClick={() => setConversationLimit((limit) => limit + 30)}
              type="button"
            >
              이전 대화 더 보기 · 전체 {visibleConversations?.length}개
            </button>
          ) : null}
        </div>
        <details className="mt-5 border-t pt-4">
          <summary className="cursor-pointer text-sm font-medium">
            로컬 지식 추가
          </summary>
          <form className="mt-3 space-y-2" onSubmit={submitDocument}>
            <Input
              accept=".md,.txt,text/plain"
              aria-label="문서 파일 선택"
              onChange={(event) => selectDocumentFile(event.target.files?.[0])}
              type="file"
            />
            <Input
              aria-label="문서 이름"
              onChange={(event) => setDocumentFilename(event.target.value)}
              value={documentFilename}
            />
            <Textarea
              aria-label="문서 내용"
              onChange={(event) => setDocumentContent(event.target.value)}
              placeholder="텍스트를 붙여 넣으면 이 워크스페이스에서 검색합니다."
              value={documentContent}
            />
            <Button
              className="w-full"
              disabled={!documentContent.trim() || ingestTextDocument.isPending}
              type="submit"
              variant="outline"
            >
              {ingestTextDocument.isPending ? "등록 중…" : "문서 등록"}
            </Button>
            {ingestTextDocument.isError && (
              <p className="text-destructive text-xs">
                {messageError(ingestTextDocument.error)}
              </p>
            )}
            {documentFileError && (
              <p className="text-destructive text-xs" role="alert">
                {documentFileError}
              </p>
            )}
          </form>
          <div className="mt-4 space-y-2 border-t pt-4">
            <p className="text-sm font-medium">문서</p>
            {documents.data?.length === 0 && (
              <p className="text-muted-foreground text-xs">
                등록된 문서가 없습니다.
              </p>
            )}
            {documents.data?.map((document) => {
              const latestRun = indexRuns.data?.find(
                (run) => run.documentId === document.id,
              );
              return (
                <div
                  className="rounded-md border p-2 text-xs"
                  key={document.id}
                >
                  <p className="truncate font-medium">{document.filename}</p>
                  <p className="text-muted-foreground mt-1">
                    {document.status} · {Math.ceil(document.sizeBytes / 1024)}{" "}
                    KB
                    {latestRun ? ` · 색인 ${latestRun.status}` : ""}
                  </p>
                  <div className="mt-2 flex gap-2">
                    <button
                      className="text-muted-foreground hover:underline"
                      disabled={startIndex.isPending}
                      onClick={() =>
                        workspaceId &&
                        startIndex.mutate({
                          documentId: document.id,
                          provider: "local",
                          workspaceId,
                        })
                      }
                      type="button"
                    >
                      색인 요청
                    </button>
                    <button
                      className="text-destructive hover:underline"
                      disabled={deleteDocument.isPending}
                      onClick={() =>
                        workspaceId &&
                        deleteDocument.mutate({
                          documentId: document.id,
                          workspaceId,
                        })
                      }
                      type="button"
                    >
                      삭제
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </details>
        <details className="mt-5 border-t pt-4">
          <summary className="cursor-pointer text-sm font-medium">
            기억 후보 추가
          </summary>
          <form className="mt-3 space-y-2" onSubmit={submitMemory}>
            <Input
              aria-label="기억 내용"
              onChange={(event) => setMemoryContent(event.target.value)}
              placeholder="예: 사용자는 한국어 답변을 선호한다"
              value={memoryContent}
            />
            <Button
              className="w-full"
              disabled={!memoryContent.trim() || createMemory.isPending}
              type="submit"
              variant="outline"
            >
              저장
            </Button>
          </form>
          <p className="text-muted-foreground mt-2 text-xs">
            후보 기억은 승인된 뒤에만 답변 문맥으로 사용됩니다.
          </p>
          {memories.data?.length ? (
            <ul className="mt-3 space-y-2 text-xs">
              {memories.data.map((memory) => (
                <li className="rounded border p-2" key={memory.id}>
                  <p>{memory.content}</p>
                  <p className="text-muted-foreground mt-1">
                    {memory.status} · 중요도 {memory.importance}
                  </p>
                  {isOwner && memory.status === "candidate" && workspaceId && (
                    <div className="mt-2 flex gap-2">
                      <button
                        className="text-muted-foreground hover:underline"
                        onClick={() =>
                          reviewMemory.mutate({
                            memoryId: memory.id,
                            status: "approved",
                            workspaceId,
                          })
                        }
                        type="button"
                      >
                        승인
                      </button>
                      <button
                        className="text-muted-foreground hover:underline"
                        onClick={() =>
                          reviewMemory.mutate({
                            memoryId: memory.id,
                            status: "rejected",
                            workspaceId,
                          })
                        }
                        type="button"
                      >
                        거절
                      </button>
                      <button
                        className="text-destructive hover:underline"
                        onClick={() =>
                          deleteMemory.mutate({
                            memoryId: memory.id,
                            workspaceId,
                          })
                        }
                        type="button"
                      >
                        삭제
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          ) : null}
        </details>
        <details className="mt-5 border-t pt-4">
          <summary className="cursor-pointer text-sm font-medium">
            운영 현황
          </summary>
          <p className="text-muted-foreground mt-2 text-xs">
            문서 {usage.data?.documents ?? 0} · 메시지{" "}
            {usage.data?.messages ?? 0} · 기억 {usage.data?.memories ?? 0}
          </p>
          <p className="text-muted-foreground mt-2 break-all font-mono text-[10px]">
            인덱싱용 워크스페이스 ID: {workspaceId}
          </p>
          <p className="text-muted-foreground mt-2 text-xs">
            소유자만 문서 삭제와 기억 검토를 수행할 수 있습니다.
          </p>
          {isOwner && workspaceId && (
            <form
              className="mt-3 flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (!memberUserId.trim()) return;
                addWorkspaceMember.mutate({
                  role: "member",
                  userId: memberUserId.trim(),
                  workspaceId,
                });
              }}
            >
              <Input
                aria-label="멤버 사용자 ID"
                onChange={(event) => setMemberUserId(event.target.value)}
                placeholder="멤버 사용자 UUID"
                value={memberUserId}
              />
              <Button size="sm" type="submit" variant="outline">
                추가
              </Button>
            </form>
          )}
          {isOwner && auditLog.data?.length ? (
            <ul className="mt-3 space-y-1 text-xs">
              {auditLog.data.slice(0, 5).map((entry) => (
                <li
                  className="text-muted-foreground"
                  key={`${entry.action}-${entry.createdAt}`}
                >
                  {entry.action} · {new Date(entry.createdAt).toLocaleString()}
                </li>
              ))}
            </ul>
          ) : null}
        </details>
        {isOwner ? (
          <details className="mt-5 border-t pt-4">
            <summary className="cursor-pointer text-sm font-medium">
              평가 루프
            </summary>
            <p className="text-muted-foreground mt-2 text-xs">
              검토된 질문 {evaluationCases.data?.length ?? 0}개
              {evaluationRuns.data?.[0]?.summary
                ? ` · 최근 인용 재현율 ${Math.round(
                    Number(
                      (
                        evaluationRuns.data[0].summary as {
                          averageCitationRecall?: number;
                        }
                      ).averageCitationRecall ?? 0,
                    ) * 100,
                  )}%`
                : ""}
            </p>
            <Button
              className="mt-3 w-full"
              disabled={
                runEvaluation.isPending || !evaluationCases.data?.length
              }
              onClick={() =>
                workspaceId && runEvaluation.mutate({ workspaceId })
              }
              size="sm"
              variant="outline"
            >
              {runEvaluation.isPending ? "평가 중…" : "검색 평가 실행"}
            </Button>
            {runEvaluation.isSuccess ? (
              <p className="text-muted-foreground mt-2 text-xs" role="status">
                {runEvaluation.data.cases}개 질문 평가 완료 · 인용 재현율{" "}
                {Math.round(runEvaluation.data.averageCitationRecall * 100)}%
              </p>
            ) : null}
            {runEvaluation.isError ? (
              <p className="text-destructive mt-2 text-xs" role="alert">
                {messageError(runEvaluation.error)}
              </p>
            ) : null}
            {evaluationCases.data?.length ? (
              <ul className="mt-3 space-y-2 text-xs">
                {evaluationCases.data.slice(0, 5).map((evaluationCase) => (
                  <li className="rounded-md border p-2" key={evaluationCase.id}>
                    {evaluationCase.question}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground mt-3 text-xs">
                답변의 인용을 펼쳐 검토한 뒤 평가 기준으로 저장하세요.
              </p>
            )}
          </details>
        ) : null}
      </aside>
      <div className="flex min-w-0 flex-col rounded-xl border lg:h-[calc(100vh-6.75rem)] lg:min-h-[42rem]">
        <div className="flex items-center justify-between gap-3 border-b px-4 py-3 sm:px-5">
          <div className="flex min-w-0 items-center gap-2">
            <Button
              className="lg:hidden"
              onClick={() => setIsSidebarOpen(true)}
              size="sm"
              type="button"
              variant="outline"
            >
              대화 및 도구
            </Button>
            <h2 className="truncate font-semibold">
              {conversations.data?.find(
                (conversation) => conversation.id === conversationId,
              )?.title ?? "새 대화"}
            </h2>
          </div>
          {conversationId ? (
            <Button
              disabled={archiveConversation.isPending || isStreaming}
              onClick={() =>
                archiveConversation.mutate({ conversationId, workspaceId })
              }
              size="sm"
              variant="outline"
            >
              대화 보관
            </Button>
          ) : null}
        </div>
        <div
          className="flex-1 space-y-5 overflow-y-auto px-4 py-5 sm:px-6 lg:px-8"
          ref={messagesViewportRef}
        >
          {messages.data?.map((message, messageIndex) => (
            <article
              className={
                message.role === "user"
                  ? "ml-auto max-w-[min(92%,56rem)] rounded-2xl bg-primary px-4 py-3 text-primary-foreground"
                  : "w-full py-3"
              }
              key={message.id}
            >
              {message.role === "assistant" ? (
                <>
                  <p className="text-muted-foreground mb-2 text-xs font-medium">
                    Knowledge Agent
                  </p>
                  <MarkdownMessage content={message.content} />
                </>
              ) : (
                <p className="whitespace-pre-wrap text-sm leading-6">
                  {message.content}
                </p>
              )}
              {message.role === "assistant" && (
                <MessageFeedback
                  content={message.content}
                  messageId={message.id}
                  onReuse={
                    messageIndex === (messages.data?.length ?? 0) - 1 &&
                    questionBefore(messageIndex)
                      ? () =>
                          reuseQuestion(questionBefore(messageIndex) as string)
                      : undefined
                  }
                  workspaceId={workspaceId}
                />
              )}
              {message.role === "assistant" && workspaceId && (
                <MessageCitations
                  evaluationCaseExists={Boolean(
                    evaluationCases.data?.some(
                      (evaluationCase) =>
                        evaluationCase.question ===
                        messages.data
                          ?.slice(0, messageIndex)
                          .reverse()
                          .find((candidate) => candidate.role === "user")
                          ?.content,
                    ),
                  )}
                  isOwner={isOwner}
                  messageId={message.id}
                  question={
                    messages.data
                      ?.slice(0, messageIndex)
                      .reverse()
                      .find((candidate) => candidate.role === "user")?.content
                  }
                  workspaceId={workspaceId}
                />
              )}
            </article>
          ))}
          {isStreaming && (
            <article aria-live="polite" className="w-full py-3">
              <p className="text-muted-foreground mb-2 flex items-center gap-2 text-xs font-medium">
                <span className="size-2 animate-pulse rounded-full bg-primary" />
                {streamPhase === "retrieving"
                  ? "관련 근거를 찾는 중…"
                  : "답변을 작성하는 중…"}
              </p>
              {streamedText ? <MarkdownMessage content={streamedText} /> : null}
            </article>
          )}
          {!conversationId && (
            <div className="flex h-full w-full items-center justify-center py-12 text-center">
              <div className="w-full max-w-3xl">
                <p className="text-xl font-semibold">무엇을 알고 싶으신가요?</p>
                <p className="text-muted-foreground mt-2 text-sm">
                  문서, 코드, 공식 기술 자료를 함께 찾아 근거 중심으로 답합니다.
                </p>
                <div className="mt-6 grid gap-2 text-left sm:grid-cols-2">
                  {STARTER_PROMPTS.map((prompt) => (
                    <button
                      className="hover:bg-accent rounded-xl border bg-background px-4 py-3 text-sm transition-colors"
                      key={prompt}
                      onClick={() => reuseQuestion(prompt)}
                      type="button"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
        <form
          className="border-t bg-background/95 px-4 py-4 backdrop-blur sm:px-6 lg:px-8"
          onSubmit={submitQuestion}
        >
          <div className="focus-within:ring-ring/40 w-full rounded-2xl border bg-background p-3 shadow-sm transition-shadow focus-within:ring-2">
            <Textarea
              aria-label="질문"
              className="min-h-14 max-h-48 resize-none border-0 bg-transparent px-1 py-1 text-base shadow-none focus-visible:ring-0"
              disabled={isStreaming || createConversation.isPending}
              onChange={(event) => setQuestion(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || event.nativeEvent.isComposing)
                  return;
                if (event.ctrlKey) {
                  event.preventDefault();
                  const textarea = event.currentTarget;
                  const selectionStart = textarea.selectionStart;
                  const selectionEnd = textarea.selectionEnd;
                  setQuestion(
                    (current) =>
                      `${current.slice(0, selectionStart)}\n${current.slice(selectionEnd)}`,
                  );
                  window.requestAnimationFrame(() => {
                    textarea.setSelectionRange(
                      selectionStart + 1,
                      selectionStart + 1,
                    );
                  });
                  return;
                }
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }}
              placeholder="무엇을 도와드릴까요?"
              ref={questionInputRef}
              value={question}
            />
            <div className="mt-2 flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <button
                  aria-expanded={isModelSettingsOpen}
                  className="hover:bg-accent max-w-[min(60vw,28rem)] truncate rounded-full px-2 py-1 text-left text-xs font-medium"
                  disabled={isStreaming}
                  onClick={() => {
                    setDraftModelChoice(modelChoice);
                    setModelSettingsError(undefined);
                    setIsModelSettingsOpen((open) => !open);
                  }}
                  type="button"
                >
                  모델 · {currentModelLabel()}
                </button>
                <p className="text-muted-foreground hidden text-xs sm:block">
                  Enter 전송 · Ctrl+Enter 줄바꿈
                </p>
              </div>
              {isStreaming ? (
                <Button
                  onClick={stopGeneration}
                  type="button"
                  variant="outline"
                >
                  중지
                </Button>
              ) : (
                <Button
                  disabled={!question.trim() || createConversation.isPending}
                  type="submit"
                >
                  보내기
                </Button>
              )}
            </div>
          </div>
          {isModelSettingsOpen ? (
            <div className="mt-3 rounded-xl border bg-muted/30 p-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold">모델 변경</p>
                  <p className="text-muted-foreground mt-1 text-xs">
                    기본 모델을 사용하거나 개인 Gemini·OpenAI 키를 연결할 수
                    있습니다.
                  </p>
                </div>
                <button
                  className="text-muted-foreground text-xs hover:underline"
                  onClick={() => setIsModelSettingsOpen(false)}
                  type="button"
                >
                  닫기
                </button>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <label className="space-y-1 text-xs font-medium">
                  제공자
                  <select
                    aria-label="모델 제공자"
                    className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                    onChange={(event) => {
                      const provider = event.target
                        .value as ModelChoice["provider"];
                      setDraftModelChoice({
                        apiKey: "",
                        modelId:
                          provider === "default"
                            ? ""
                            : (savedCredential(provider)?.modelId ??
                              PERSONAL_MODEL_DEFAULTS[provider]),
                        provider,
                      });
                      setModelSettingsError(undefined);
                    }}
                    value={draftModelChoice.provider}
                  >
                    <option value="default">
                      기본 ·{" "}
                      {modelCatalog.data?.defaultModel?.label ?? "서버 설정"}
                    </option>
                    <option value="gemini">Google Gemini · 개인 키</option>
                    <option value="openai">OpenAI · 개인 키</option>
                  </select>
                </label>
                {draftModelChoice.provider !== "default" ? (
                  <label
                    className="space-y-1 text-xs font-medium"
                    htmlFor="personal-model-id"
                  >
                    모델 ID
                    <Input
                      aria-label="모델 ID"
                      id="personal-model-id"
                      list={`${draftModelChoice.provider}-model-options`}
                      onChange={(event) =>
                        setDraftModelChoice((current) => ({
                          ...current,
                          modelId: event.target.value,
                        }))
                      }
                      placeholder={
                        PERSONAL_MODEL_DEFAULTS[draftModelChoice.provider]
                      }
                      value={draftModelChoice.modelId}
                    />
                    <datalist id={`${draftModelChoice.provider}-model-options`}>
                      {PERSONAL_MODEL_OPTIONS[draftModelChoice.provider].map(
                        ([id, label]) => (
                          <option key={id} value={id}>
                            {label}
                          </option>
                        ),
                      )}
                    </datalist>
                  </label>
                ) : (
                  <div className="rounded-lg border bg-background px-3 py-2 text-xs">
                    <p className="font-medium">현재 서버 모델</p>
                    <p className="text-muted-foreground mt-1 break-all">
                      {modelCatalog.data?.defaultModel?.label ??
                        "설정된 모델 정보를 불러오는 중입니다."}
                    </p>
                  </div>
                )}
              </div>
              {draftModelChoice.provider !== "default" ? (
                <label
                  className="mt-3 block space-y-1 text-xs font-medium"
                  htmlFor="personal-model-api-key"
                >
                  개인 API 키
                  <Input
                    aria-label="개인 API 키"
                    id="personal-model-api-key"
                    autoComplete="off"
                    onChange={(event) =>
                      setDraftModelChoice((current) => ({
                        ...current,
                        apiKey: event.target.value,
                      }))
                    }
                    placeholder={
                      savedCredential(draftModelChoice.provider)
                        ? "연결된 키를 변경할 때만 입력"
                        : "API 키 입력"
                    }
                    spellCheck={false}
                    type="password"
                    value={draftModelChoice.apiKey}
                  />
                  <span className="text-muted-foreground font-normal">
                    키를 원문 그대로 저장하지 않고 서버에서 암호화해 로그인
                    사용자에게만 연결합니다. 저장 후에는 다시 입력할 필요가
                    없습니다.
                  </span>
                  {savedCredential(draftModelChoice.provider) ? (
                    <span className="block text-emerald-600 font-normal dark:text-emerald-400">
                      연결됨 ·{" "}
                      {draftModelChoice.provider === "gemini"
                        ? "Gemini"
                        : "OpenAI"}
                    </span>
                  ) : null}
                </label>
              ) : null}
              {modelSettingsError ? (
                <p className="text-destructive mt-3 text-xs" role="alert">
                  {modelSettingsError}
                </p>
              ) : null}
              <div className="mt-4 flex flex-wrap justify-end gap-2">
                {draftModelChoice.provider !== "default" &&
                savedCredential(draftModelChoice.provider) ? (
                  <Button
                    disabled={deleteModelCredential.isPending}
                    onClick={() =>
                      void removeSavedCredential(
                        draftModelChoice.provider as "gemini" | "openai",
                      )
                    }
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    저장된 키 삭제
                  </Button>
                ) : null}
                <Button
                  onClick={resetModelChoice}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  기본 모델 사용
                </Button>
                <Button
                  disabled={saveModelCredential.isPending}
                  onClick={() => void applyModelChoice()}
                  size="sm"
                  type="button"
                >
                  {saveModelCredential.isPending ? "저장 중…" : "이 모델 사용"}
                </Button>
              </div>
            </div>
          ) : null}
          <p className="text-muted-foreground mt-2 text-center text-[11px]">
            답변은 연결된 근거를 우선하며 중요한 내용은 인용을 직접 확인하세요.
          </p>
          {streamError && (
            <p className="text-destructive mt-2 text-sm" role="alert">
              {streamError}
            </p>
          )}
        </form>
      </div>
    </section>
  );
}
