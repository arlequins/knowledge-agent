"use client";

import { useEffect, useState } from "react";

import { useAuth } from "~/auth/provider";
import { AuthStatus } from "~/auth/status";
import { env } from "~/env";
import { AgentChat } from "./agent-chat";

function configuredOrigins() {
  return new Set(
    (env.NEXT_PUBLIC_EMBED_ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  );
}

function parentOrigin() {
  try {
    const location = window.location as Location & {
      ancestorOrigins?: DOMStringList;
    };
    if (location.ancestorOrigins?.length) return location.ancestorOrigins[0];
    if (document.referrer) return new URL(document.referrer).origin;
  } catch {
    return undefined;
  }
  return undefined;
}

/** Compact iframe shell. It is a presentation gate; API authorization remains mandatory. */
export function EmbeddedChat() {
  const { user } = useAuth();
  const [origin, setOrigin] = useState<string>();
  const [isFrame, setIsFrame] = useState(false);
  const allowed = configuredOrigins();

  useEffect(() => {
    setOrigin(parentOrigin());
    try {
      setIsFrame(window.self !== window.top);
    } catch {
      setIsFrame(true);
    }
  }, []);

  if (!isFrame || !origin || !allowed.has(origin)) {
    return (
      <main className="bg-background text-foreground flex min-h-screen items-center justify-center p-6">
        <section className="w-full max-w-md rounded-xl border p-6">
          <h1 className="text-lg font-semibold">
            임베드 채팅이 준비되지 않았습니다
          </h1>
          <p className="text-muted-foreground mt-2 text-sm">
            허용된 사이트에서 iframe으로 열고, 정확한 origin을
            NEXT_PUBLIC_EMBED_ALLOWED_ORIGINS에 등록해야 합니다.
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className="bg-background text-foreground min-h-screen p-2 sm:p-4">
      <header className="mb-3 flex items-center justify-between gap-3 border-b pb-3">
        <h1 className="text-base font-semibold">Knowledge Agent</h1>
        <AuthStatus compact />
      </header>
      {user ? (
        <AgentChat />
      ) : (
        <section className="flex min-h-[50vh] items-center justify-center rounded-xl border p-6 text-center">
          <div>
            <h2 className="text-lg font-semibold">
              로그인 후 대화를 시작하세요
            </h2>
            <p className="text-muted-foreground mt-2 text-sm">
              이 위젯은 로그인한 사용자의 워크스페이스와 동일한 권한을
              사용합니다.
            </p>
            <div className="mt-4 flex justify-center">
              <AuthStatus />
            </div>
          </div>
        </section>
      )}
    </main>
  );
}
