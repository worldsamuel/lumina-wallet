import { NextResponse } from "next/server";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization",
};

export function withCors<T extends NextResponse>(response: T) {
  Object.entries(corsHeaders).forEach(([key, value]) => response.headers.set(key, value));
  return response;
}

export function optionsResponse() {
  return withCors(new NextResponse(null, { status: 204 }));
}

export function jsonResponse(data: unknown, init?: ResponseInit) {
  return withCors(NextResponse.json(data, init));
}
