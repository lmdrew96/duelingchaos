import { Show, SignInButton, UserButton } from '@clerk/react';

// Only ever mounted when a Clerk publishable key exists (see App.tsx) —
// Show/SignInButton/UserButton all assert they're wrapped by ClerkProvider
// and throw otherwise.
export function AuthHeader() {
  return (
    <span className="auth-header">
      <Show when="signed-in">
        <UserButton />
      </Show>
      <Show when="signed-out">
        <SignInButton mode="modal">
          <button className="ghost">Sign in</button>
        </SignInButton>
      </Show>
    </span>
  );
}
