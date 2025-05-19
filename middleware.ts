import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  // Get the pathname of the request
  const path = request.nextUrl.pathname;

  // Define public paths that don't require authentication
  const isPublicPath = path === '/' || path === '/login' || path === '/signup';

  // Get the token from the URL
  const token = request.nextUrl.searchParams.get('token');

  // If the path is the dashboard and there's no token, redirect to home
  if (path === '/dashboard' && !token) {
    return NextResponse.redirect(new URL('/', request.url));
  }

  // If there's a token and we're on a public path, redirect to dashboard
  if (token && isPublicPath) {
    return NextResponse.redirect(new URL(`/dashboard?token=${token}`, request.url));
  }

  return NextResponse.next();
}

// Configure the middleware to run on specific paths
export const config = {
  matcher: ['/', '/dashboard', '/login', '/signup']
}; 