-- AlterTable
ALTER TABLE "audit_log" ADD COLUMN     "encryptionKeyVersion" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "file" ADD COLUMN     "encryptionKeyVersion" INTEGER NOT NULL DEFAULT 1;
