-- CreateEnum
CREATE TYPE "BlockchainRegistrationStatus" AS ENUM ('NOT_REGISTERED', 'PENDING', 'REGISTERED', 'FAILED');

-- CreateEnum
CREATE TYPE "BlockchainTransactionStatus" AS ENUM ('PENDING', 'CONFIRMED', 'FAILED');

-- AlterTable
ALTER TABLE "Evidence" ADD COLUMN     "blockchainEvidenceId" TEXT,
ADD COLUMN     "blockchainRegistrationStatus" "BlockchainRegistrationStatus" NOT NULL DEFAULT 'NOT_REGISTERED',
ADD COLUMN     "blockchainRegistrationTxId" TEXT,
ADD COLUMN     "registeredOnChainAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "BlockchainTransaction" (
    "id" UUID NOT NULL,
    "txHash" TEXT,
    "contractAddress" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "functionName" TEXT NOT NULL,
    "status" "BlockchainTransactionStatus" NOT NULL,
    "blockNumber" BIGINT,
    "submittedById" UUID NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),
    "errorMessage" TEXT,

    CONSTRAINT "BlockchainTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BlockchainTransaction_submittedById_idx" ON "BlockchainTransaction"("submittedById");

-- CreateIndex
CREATE INDEX "BlockchainTransaction_txHash_idx" ON "BlockchainTransaction"("txHash");

-- CreateIndex
CREATE INDEX "BlockchainTransaction_status_idx" ON "BlockchainTransaction"("status");

-- CreateIndex
CREATE INDEX "BlockchainTransaction_submittedAt_idx" ON "BlockchainTransaction"("submittedAt");

-- CreateIndex
CREATE INDEX "Evidence_blockchainRegistrationStatus_idx" ON "Evidence"("blockchainRegistrationStatus");

-- AddForeignKey
ALTER TABLE "BlockchainTransaction" ADD CONSTRAINT "BlockchainTransaction_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
