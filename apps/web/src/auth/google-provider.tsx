"use client";

import { useCallback, useMemo, useState } from "react";

import { env } from "~/env";
import { AuthContext, type AuthContextValue, type AuthUser } from "./context";

type GoogleCredentialResponse = { credential?: string };
type GoogleIdentity = {
  disableAutoSelect: () => void;
  initialize: (input: {
    callback: (response: GoogleCredentialResponse) => void;
    client_id: string;
  }) => void;
  prompt: () => void;
  renderButton: (
    element: HTMLElement,
    options: {
      locale: string;
      shape: "pill";
      size: "large";
      text: "signin_with";
      theme: "outline";
      width: number;
    },
  ) => void;
};

declare global {
  interface Window {
    google?: { accounts: { id: GoogleIdentity } };
  }
}

let googleScriptPromise: Promise<void> | undefined;

function loadGoogleIdentity(): Promise<void> {
  if (window.google?.accounts.id) return Promise.resolve();
  googleScriptPromise ??= new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      'script[src="https://accounts.google.com/gsi/client"]',
    );
    const script = existing ?? document.createElement("script");
    script.addEventListener("load", () => resolve(), { once: true });
    script.addEventListener(
      "error",
      () => reject(new Error("Google 로그인을 불러오지 못했습니다.")),
      { once: true },
    );
    if (!existing) {
      script.async = true;
      script.src = "https://accounts.google.com/gsi/client";
      document.head.append(script);
    }
  });
  return googleScriptPromise;
}

export function GoogleAuthProvider(props: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);

  const acceptCredential = useCallback((response: GoogleCredentialResponse) => {
    if (!response.credential) return;
    // The browser treats this as an opaque bearer credential. The API verifies
    // Google's signature, issuer, audience, expiry, email_verified and allowlist.
    setUser({
      access_token: response.credential,
      expired: false,
      profile: { sub: "google-session" },
    });
  }, []);

  const initializeGoogle = useCallback(async () => {
    const clientId = env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
    if (!clientId) {
      throw new Error("NEXT_PUBLIC_GOOGLE_CLIENT_ID를 설정해 주세요.");
    }
    await loadGoogleIdentity();
    const google = window.google?.accounts.id;
    if (!google) throw new Error("Google 로그인을 초기화하지 못했습니다.");
    google.initialize({ callback: acceptCredential, client_id: clientId });
    return google;
  }, [acceptCredential]);

  const renderGoogleButton = useCallback(
    async (element: HTMLElement) => {
      const google = await initializeGoogle();
      element.replaceChildren();
      google.renderButton(element, {
        locale: "ko",
        shape: "pill",
        size: "large",
        text: "signin_with",
        theme: "outline",
        width: 280,
      });
    },
    [initializeGoogle],
  );

  const login = useCallback(async () => {
    (await initializeGoogle()).prompt();
  }, [initializeGoogle]);

  const logout = useCallback(async () => {
    window.google?.accounts.id.disableAutoSelect();
    setUser(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      isLoading: false,
      login,
      logout,
      provider: "google",
      renderGoogleButton,
      user,
    }),
    [login, logout, renderGoogleButton, user],
  );

  return (
    <AuthContext.Provider value={value}>{props.children}</AuthContext.Provider>
  );
}
