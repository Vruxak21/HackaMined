import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import prisma from "./db";
import { logAction } from "./auth-helper";

export const auth = betterAuth({
  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),
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