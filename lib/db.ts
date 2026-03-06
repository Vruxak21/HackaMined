import { PrismaClient } from "./generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg"

/**
 * Build the PostgreSQL connection string.
 * When DATABASE_SSL=true, appends sslmode=require so the pg driver uses TLS.
 */
function buildConnectionString(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL environment variable is not set");

  if (process.env.DATABASE_SSL !== "true") return url;

  try {
    const parsed = new URL(url);
    if (!parsed.searchParams.has("sslmode")) {
      parsed.searchParams.set("sslmode", "require");
    }
    return parsed.toString();
  } catch {
    // If the URL is not parseable, return as-is
    return url;
  }
}

const adapter = new PrismaPg({
    connectionString: buildConnectionString()
})

const prismaClientSingleton = () => {
    return new PrismaClient({adapter})
}

declare const globalThis: {
    prismaGlobal: ReturnType<typeof prismaClientSingleton>;
} & typeof global;

const prisma = globalThis.prismaGlobal || prismaClientSingleton();

if (process.env.NODE_ENV !== "production") {
    globalThis.prismaGlobal = prisma;
}

export default prisma;