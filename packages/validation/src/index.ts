import { z } from "zod";

const email = z.email().max(254).transform((value) => value.trim().toLowerCase());
const password = z.string().min(1).max(256);
const token = z.string().min(20).max(200);

export const inviteClientSchema = z.object({
  clientId: z.string().min(1).max(64),
  email,
  name: z.string().trim().min(1).max(120),
});

export const acceptInvitationSchema = z.object({ token, password });

export const requestPasswordResetSchema = z.object({ email });

export const resetPasswordSchema = z.object({ token, password });

export type InviteClientInput = z.infer<typeof inviteClientSchema>;
export type AcceptInvitationInput = z.infer<typeof acceptInvitationSchema>;
export type RequestPasswordResetInput = z.infer<typeof requestPasswordResetSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
