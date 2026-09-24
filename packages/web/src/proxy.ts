import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PATHS = new Set(["/login"]);

function apiOrigin(): string {
  return (process.env.BOTANICAL_API_URL ?? "http://localhost:8787").replace(/\/$/, "");
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname.startsWith("/api") || pathname.startsWith("/_next")) {
    return NextResponse.next();
  }

  let authenticated = false;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    const me = await fetch(`${apiOrigin()}/api/auth/me`, {
      headers: {
        cookie: request.headers.get("cookie") ?? "",
        accept: "application/json",
      },
      cache: "no-store",
      signal: controller.signal,
    });
    clearTimeout(timer);
    authenticated = me.ok;
  } catch {
    authenticated = false;
  }

  if (PUBLIC_PATHS.has(pathname)) {
    if (authenticated) {
      return NextResponse.redirect(new URL("/", request.url));
    }
    return NextResponse.next();
  }

  if (!authenticated) {
    const login = new URL("/login", request.url);
    if (pathname !== "/") login.searchParams.set("next", pathname);
    return NextResponse.redirect(login);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
