import { createContext, useContext, type ReactNode } from "react";
import { ClerkProvider, useAuth, Show, UserButton, SignInButton } from "@clerk/react";

type AuthContextType = {
  getToken: () => Promise<string | null>;
};

const AuthContext = createContext<AuthContextType>({
  getToken: () => Promise.resolve(null),
});

export function useAuthToken() {
  return useContext(AuthContext);
}

const CLERK_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined;

function ClerkBridge({ children }: { children: ReactNode }) {
  const { getToken } = useAuth();
  return <AuthContext value={{ getToken }}>{children}</AuthContext>;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  if (!CLERK_KEY) return <>{children}</>;
  return (
    <ClerkProvider publishableKey={CLERK_KEY}>
      <ClerkBridge>{children}</ClerkBridge>
    </ClerkProvider>
  );
}

export function AuthButtons() {
  if (!CLERK_KEY) return null;
  return (
    <>
      <Show when="signed-in">
        <UserButton />
      </Show>
      <Show when="signed-out">
        <SignInButton mode="modal">
          <button className="rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
            Sign in
          </button>
        </SignInButton>
      </Show>
    </>
  );
}
