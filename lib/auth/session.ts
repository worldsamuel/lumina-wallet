import jwt from "jsonwebtoken";

const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

export type LuminaSessionPayload = {
  address: string;
  createdAt: number;
};

export function getSessionMaxAgeSeconds() {
  return SESSION_MAX_AGE_SECONDS;
}

export function signSession(payload: LuminaSessionPayload) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("Missing SESSION_SECRET.");

  return jwt.sign(payload, secret, {
    expiresIn: SESSION_MAX_AGE_SECONDS,
  });
}
