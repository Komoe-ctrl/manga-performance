import { twoFactorClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

/** Browser-side Better Auth client (same origin, `/api/auth/*`). Only used when `DATA_SOURCE=db`. */
export const authClient = createAuthClient({ plugins: [twoFactorClient()] });

export interface CurrentUser {
  id: string;
  email: string;
  role: "ADMIN" | "CLIENT";
  clientId: string | null;
  twoFactorEnabled: boolean;
}

/** The signed-in user, or null. */
export async function fetchCurrentUser(): Promise<CurrentUser | null> {
  const { data } = await authClient.getSession();
  if (!data?.user) return null;
  const user = data.user as typeof data.user & {
    role?: string;
    clientId?: string | null;
    twoFactorEnabled?: boolean | null;
  };
  return {
    id: user.id,
    email: user.email,
    role: user.role === "ADMIN" ? "ADMIN" : "CLIENT",
    clientId: user.clientId ?? null,
    twoFactorEnabled: user.twoFactorEnabled === true,
  };
}
