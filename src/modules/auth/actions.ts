"use server";

import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "@/lib/supabase/server";

import { homePathFor } from "./roles";
import { loginSchema } from "./login-schema";
import { getCurrentUser } from "./session";

export type LoginState = { error: string | null };

const GENERIC_FAILURE = "Invalid email or password.";
const NOT_ACTIVE = "This account does not have active access. Ask an administrator.";

/** Signs in with email and password. Errors never reveal whether an email exists. */
export async function signIn(_previous: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? GENERIC_FAILURE };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    return { error: GENERIC_FAILURE };
  }

  // A valid session without an active profile is not access. Clear it so the user is not left half signed in.
  const user = await getCurrentUser();
  if (user === null) {
    await supabase.auth.signOut();
    return { error: NOT_ACTIVE };
  }

  redirect(homePathFor(user.role));
}

/** Clears the session on the server and returns to login. */
export async function signOut(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/login");
}
