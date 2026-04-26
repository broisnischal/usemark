import { createFileRoute } from "@tanstack/react-router";

import { auth } from "@/lib/auth/auth";
import { createXAuthorizationRequest } from "@/lib/bookmarks/x";

function oauthCookie(name: string, value: string) {
  return `${name}=${encodeURIComponent(value)}; Path=/api/x; HttpOnly; Secure; SameSite=Lax; Max-Age=600`;
}

export const Route = createFileRoute("/api/x/connect")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const session = await auth.api.getSession({
          headers: request.headers,
        });

        if (!session?.user?.id) {
          return Response.redirect(new URL("/login", request.url), 302);
        }

        const authorization = await createXAuthorizationRequest();
        const headers = new Headers();
        headers.append("Set-Cookie", oauthCookie("x_oauth_state", authorization.state));
        headers.append("Set-Cookie", oauthCookie("x_oauth_verifier", authorization.codeVerifier));
        headers.set("Location", authorization.url);

        return new Response(null, { status: 302, headers });
      },
    },
  },
});
