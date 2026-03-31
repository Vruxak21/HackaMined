import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import prisma from "./db";
import { logAction } from "./auth-helper";

function buildTrustedOrigins(): string[] {
  const envOrigins = [
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.BETTER_AUTH_URL,
    process.env.BETTER_AUTH_TRUSTED_ORIGINS,
  ]
    .filter(Boolean)
    .flatMap((value) => String(value).split(","))
    .map((origin) => origin.trim())
    .filter(Boolean);

  const localOrigins = [
    "http://localhost:3000",
    "https://localhost:3000",
    "http://localhost:3001",
    "https://localhost:3001",
    "http://127.0.0.1:3000",
    "https://127.0.0.1:3000",
    "http://127.0.0.1:3001",
    "https://127.0.0.1:3001",
  ];

  return Array.from(new Set([...envOrigins, ...localOrigins]));
}

export const auth = betterAuth({
  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),
  trustedOrigins: buildTrustedOrigins(),
  emailAndPassword: {
    enabled: true,
  },
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID as string,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
    },
  },
  databaseHooks: {
    session: {
      create: {
        after: async (session) => {
          // When a session is created (user logs in), create an audit log
          await logAction({
            userId: session.userId,
            action: "LOGIN",
            detail: "User logged in",
            ipAddress: session.ipAddress ?? undefined,
          });
        },
      },
    },
  },
});