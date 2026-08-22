"use client";

import { Button } from "@arlequins/ui/button";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { useTRPC } from "~/trpc/react";
import { useAuth } from "./provider";

export function AuthStatus(props: { compact?: boolean }) {
  const { isLoading, login, logout, provider, renderGoogleButton, user } =
    useAuth();
  const googleButton = useRef<HTMLDivElement>(null);
  const [googleError, setGoogleError] = useState<string>();
  const trpc = useTRPC();
  const session = useQuery(
    trpc.auth.me.queryOptions(undefined, { enabled: Boolean(user) }),
  );

  useEffect(() => {
    if (provider !== "google" || user || !googleButton.current) return;
    setGoogleError(undefined);
    void renderGoogleButton(googleButton.current).catch((error: unknown) =>
      setGoogleError(
        error instanceof Error ? error.message : "Google 로그인 설정 오류",
      ),
    );
  }, [provider, renderGoogleButton, user]);

  useEffect(() => {
    if (provider === "google" && user && session.isError) {
      void logout();
    }
  }, [logout, provider, session.isError, user]);

  if (isLoading) {
    return <Button disabled>로그인 확인 중…</Button>;
  }

  if (!user && provider === "google") {
    return (
      <div className="flex flex-col items-end gap-1">
        <div aria-label="Google로 로그인" ref={googleButton} role="group" />
        {googleError ? (
          <button
            className="text-destructive text-xs underline"
            onClick={() => void login().catch(() => undefined)}
            type="button"
          >
            {googleError}
          </button>
        ) : null}
      </div>
    );
  }

  if (!user) {
    return <Button onClick={() => void login()}>Sign in</Button>;
  }

  const displayName =
    typeof user.profile.name === "string"
      ? user.profile.name
      : typeof user.profile.preferred_username === "string"
        ? user.profile.preferred_username
        : undefined;

  return (
    <div className="flex items-center gap-3">
      <span
        className={props.compact ? "hidden" : "text-muted-foreground text-sm"}
      >
        {session.data?.name ?? displayName ?? user.profile.sub}
      </span>
      {session.data && (
        <span
          className={
            props.compact ? "sr-only" : "text-muted-foreground text-sm"
          }
          data-testid="api-session"
        >
          API session: {session.data.name ?? session.data.id}
        </span>
      )}
      <Button
        size={props.compact ? "sm" : "default"}
        variant="outline"
        onClick={() => void logout()}
      >
        {provider === "google" ? "로그아웃" : "Sign out"}
      </Button>
    </div>
  );
}
