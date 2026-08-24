"use client";

import { createContext, useContext } from "react";

export type AuthUser = {
  access_token: string;
  expired: boolean;
  profile: {
    [key: string]: unknown;
    email?: string;
    name?: string;
    preferred_username?: string;
    sub: string;
  };
};

export type AuthContextValue = {
  isLoading: boolean;
  login: () => Promise<void>;
  logout: () => Promise<void>;
  provider: "google" | "oidc";
  renderGoogleButton: (element: HTMLElement) => Promise<void>;
  user: AuthUser | null;
};

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used within OidcAuthProvider");
  return value;
}
