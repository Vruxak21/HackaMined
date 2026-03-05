import { NextRequest, NextResponse } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

export async function middleware(request: NextRequest) {
    const { pathname } = request.nextUrl;

    // Check for a Better Auth session cookie (lightweight — no DB hit)
    const sessionCookie = getSessionCookie(request);

    const isProtected =
        pathname.startsWith("/admin") || pathname.startsWith("/user");

    if (isProtected && !sessionCookie) {
        const signinUrl = new URL("/", request.url); // root is the auth page
        signinUrl.searchParams.set("redirect", pathname);
        return NextResponse.redirect(signinUrl);
    }

    return NextResponse.next();
}

export const config = {
    matcher: [
        // Match /admin/* and /user/* but skip _next internals and static assets
        "/admin/:path*",
        "/user/:path*",
    ],
};
