/**
 * prisma/seed.ts
 *
 * Seeds the database with one ADMIN and one standard USER.
 *
 * Passwords are hashed with scrypt using the exact same parameters
 * that Better Auth uses internally (see better-auth/src/crypto/password.ts):
 *   N=16384, r=16, p=1, dkLen=64  →  stored as "hexSalt:hexKey"
 *
 * Run via:  bunx prisma db seed   (uses bun as runner)
 */

import "dotenv/config";
import { PrismaClient } from "../lib/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { scryptSync, randomBytes } from "crypto";

// ── Prisma setup ─────────────────────────────────────────────────────────────

const adapter = new PrismaPg({
    connectionString: process.env.DATABASE_URL,
});
const prisma = new PrismaClient({ adapter } as never);

// ── Password hashing (mirrors Better Auth's scrypt config exactly) ────────────

function hashPassword(password: string): string {
    const salt = randomBytes(16).toString("hex"); // 16 bytes → 32 hex chars
    const key = scryptSync(
        password.normalize("NFKC"),
        salt,
        64,             // dkLen
        { N: 16384, r: 16, p: 1, maxmem: 128 * 16384 * 16 * 2 }
    );
    return `${salt}:${key.toString("hex")}`;
}

// ── Seed data ─────────────────────────────────────────────────────────────────

const users = [
    {
        id: "seed-admin-001",
        email: "admin@piisanitizer.com",
        name: "Admin User",
        role: "ADMIN" as const,
        password: "Admin@123",
    },
    {
        id: "seed-user-001",
        email: "user@piisanitizer.com",
        name: "Standard User",
        role: "USER" as const,
        password: "User@123",
    },
];

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
    console.log("🌱  Seeding database…\n");

    for (const userData of users) {
        const hashedPassword = hashPassword(userData.password);

        // 1. Upsert the user row (Better Auth `user` table)
        const user = await prisma.user.upsert({
            where: { email: userData.email },
            update: { name: userData.name, role: userData.role },
            create: {
                id: userData.id,
                email: userData.email,
                name: userData.name,
                emailVerified: true,
                role: userData.role,
            },
        });

        // 2. Upsert the linked credential account row
        //    Better Auth stores the hashed password in account.password
        await prisma.account.upsert({
            where: { id: `${user.id}-credential` },
            update: { password: hashedPassword },
            create: {
                id: `${user.id}-credential`,
                accountId: user.email,   // Better Auth uses email as accountId for credentials
                providerId: "credential",
                userId: user.id,
                password: hashedPassword,
                createdAt: new Date(),
                updatedAt: new Date(),
            },
        });

        console.log(
            `  ✅  ${userData.role.padEnd(5)}  ${userData.email}  (password: ${userData.password})`
        );
    }

    console.log("\n✨  Seeding complete!");
    console.log("  Admin  → admin@piisanitizer.com  /  Admin@123");
    console.log("  User   → user@piisanitizer.com   /  User@123\n");
}

main()
    .catch((e) => {
        console.error("❌  Seed failed:", e);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());
