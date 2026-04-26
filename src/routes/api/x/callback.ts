import { createFileRoute } from "@tanstack/react-router";

import { auth } from "@/lib/auth/auth";
import { connectXAccountForUser } from "@/lib/bookmarks/x";

function readCookie(request: Request, name: string) {
  const cookie = request.headers.get("cookie") ?? "";
  return cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

function clearCookie(name: string) {
  return `${name}=; Path=/api/x; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export const Route = createFileRoute("/api/x/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const session = await auth.api.getSession({
          headers: request.headers,
        });

        const userId = session?.user?.id;
        if (!userId) {
          return Response.redirect(new URL("/login", request.url), 302);
        }

        const url = new URL(request.url);
        const code = url.searchParams.get("code") ?? "";
        const state = url.searchParams.get("state") ?? "";
        const cookieState = readCookie(request, "x_oauth_state");
        const codeVerifier = readCookie(request, "x_oauth_verifier");
        const headers = new Headers();
        headers.append("Set-Cookie", clearCookie("x_oauth_state"));
        headers.append("Set-Cookie", clearCookie("x_oauth_verifier"));

        if (!code || !state || !cookieState || state !== decodeURIComponent(cookieState) || !codeVerifier) {
          headers.set("Location", "/app?x=failed");
          return new Response(null, { status: 302, headers });
        }

        try {
          await connectXAccountForUser(userId, code, decodeURIComponent(codeVerifier));
          headers.set("Location", "/app?x=connected");
        } catch {
          headers.set("Location", "/app?x=failed");
        }

        return new Response(null, { status: 302, headers });
      },
    },
  },
});
