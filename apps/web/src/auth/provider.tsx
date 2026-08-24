"use client";

import type { User } from "oidc-client-ts";
import { useEffect, useMemo, useState } from "react";

import { env } from "~/env";
import { getUserManager, startLogin, startLogout } from "~/lib/client-auth";
import {
  AuthContext,
  type AuthContextValue,
  type AuthUser,
  useAuth,
} from "./context";
import { GoogleAuthProvider } from "./google-provider";

export { useAuth };

export function OidcAuthProvider(props: { children: React.ReactNode }) {
  if (env.NEXT_PUBLIC_AUTH_PROVIDER === "google") {
    return <GoogleAuthProvider>{props.children}</GoogleAuthProvider>;
  }
  return <OidcAuthProviderInner>{props.children}</OidcAuthProviderInner>;
}

function OidcAuthProviderInner(props: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const manager = getUserManager();
    const onUserLoaded = (nextUser: User) =>
      setUser({
        access_token: nextUser.access_token,
        expired: Boolean(nextUser.expired),
        profile: nextUser.profile,
      });
    const onUserUnloaded = () => setUser(null);

    manager.events.addUserLoaded(onUserLoaded);
    manager.events.addUserUnloaded(onUserUnloaded);
    manager.events.addAccessTokenExpired(onUserUnloaded);
    manager.events.addSilentRenewError(onUserUnloaded);

    void manager
      .getUser()
      .then((storedUser) =>
        setUser(
          storedUser?.expired
            ? null
            : storedUser
              ? {
                  access_token: storedUser.access_token,
                  expired: Boolean(storedUser.expired),
                  profile: storedUser.profile,
                }
              : null,
        ),
      )
      .finally(() => setIsLoading(false));

    return () => {
      manager.events.removeUserLoaded(onUserLoaded);
      manager.events.removeUserUnloaded(onUserUnloaded);
      manager.events.removeAccessTokenExpired(onUserUnloaded);
      manager.events.removeSilentRenewError(onUserUnloaded);
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isLoading,
      login: () => startLogin(),
      logout: startLogout,
      provider: "oidc",
      renderGoogleButton: async () => undefined,
    }),
    [isLoading, user],
  );

  return (
    <AuthContext.Provider value={value}>{props.children}</AuthContext.Provider>
  );
}
