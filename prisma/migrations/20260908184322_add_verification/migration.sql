-- CreateEnum
CREATE TYPE "VerificationResult" AS ENUM ('MATCH', 'MISMATCH');

-- CreateTable
CREATE TABLE "Verification" (
    "id" UUID NOT NULL,
    "evidenceId" UUID NOT NULL,
    "verifiedById" UUID NOT NULL,
    "expectedBlockchainHash" TEXT NOT NULL,
    "actualHash" TEXT NOT NULL,
    "result" "VerificationResult" NOT NULL,
    "verifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "blockchainTxId" TEXT,
    "notes" TEXT,

    CONSTRAINT "Verification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Verification_evidenceId_idx" ON "Verification"("evidenceId");

-- CreateIndex
CREATE INDEX "Verification_verifiedById_idx" ON "Verification"("verifiedById");

-- CreateIndex
CREATE INDEX "Verification_verifiedAt_idx" ON "Verification"("verifiedAt");

-- CreateIndex
CREATE INDEX "Verification_result_idx" ON "Verification"("result");

-- AddForeignKey
ALTER TABLE "Verification" ADD CONSTRAINT "Verification_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "Evidence"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Verification" ADD CONSTRAINT "Verification_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
