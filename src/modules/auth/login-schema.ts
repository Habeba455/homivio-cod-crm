import { z } from "zod";

/** Validates the login form at the server boundary. Password rules are checked on sign-up only, not here. */
export const loginSchema = z
  .object({
    email: z
      .string()
      .trim()
      .toLowerCase()
      .max(254)
      .pipe(z.email({ error: "Enter a valid email address." })),
    password: z
      .string()
      .min(1, { error: "Enter your password." })
      .max(200, { error: "Password is too long." }),
  })
  .strict();

export type LoginInput = z.infer<typeof loginSchema>;
