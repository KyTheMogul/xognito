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
    const dashboardUrl = new URL('/dashboard', request.url);
    dashboardUrl.searchParams.set('token', token);
    return NextResponse.redirect(dashboardUrl);
  }

  // For dashboard requests, ensure the token is preserved
  if (path === '/dashboard' && token) {
    const response = NextResponse.next();
    response.headers.set('x-auth-token', token);
    return response;
  }

  return NextResponse.next();
}

// Configure the middleware to run on specific paths
export const config = {
  matcher: ['/', '/dashboard', '/login', '/signup']
}; 