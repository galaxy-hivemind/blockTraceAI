-- CreateEnum
CREATE TYPE "StorageStatus" AS ENUM ('AVAILABLE', 'MISSING');

-- CreateEnum
CREATE TYPE "IntegrityStatus" AS ENUM ('UNVERIFIED', 'VERIFIED', 'COMPROMISED');

-- CreateTable
CREATE TABLE "Evidence" (
    "id" UUID NOT NULL,
    "evidenceCode" TEXT NOT NULL,
    "incidentId" UUID NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "storedFilename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileSizeBytes" INTEGER NOT NULL,
    "sha256HashCached" TEXT NOT NULL,
    "hashAlgorithm" TEXT NOT NULL,
    "description" TEXT,
    "collectorId" UUID NOT NULL,
    "currentCustodianId" UUID,
    "storageLocation" TEXT NOT NULL,
    "storageStatus" "StorageStatus" NOT NULL DEFAULT 'AVAILABLE',
    "integrityStatus" "IntegrityStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Evidence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Evidence_evidenceCode_key" ON "Evidence"("evidenceCode");

-- CreateIndex
CREATE UNIQUE INDEX "Evidence_storedFilename_key" ON "Evidence"("storedFilename");

-- CreateIndex
CREATE INDEX "Evidence_incidentId_idx" ON "Evidence"("incidentId");

-- CreateIndex
CREATE INDEX "Evidence_collectorId_idx" ON "Evidence"("collectorId");

-- CreateIndex
CREATE INDEX "Evidence_currentCustodianId_idx" ON "Evidence"("currentCustodianId");

-- CreateIndex
CREATE INDEX "Evidence_storageStatus_idx" ON "Evidence"("storageStatus");

-- CreateIndex
CREATE INDEX "Evidence_integrityStatus_idx" ON "Evidence"("integrityStatus");

-- CreateIndex
CREATE INDEX "Evidence_createdAt_idx" ON "Evidence"("createdAt");

-- AddForeignKey
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_collectorId_fkey" FOREIGN KEY ("collectorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_currentCustodianId_fkey" FOREIGN KEY ("currentCustodianId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE SEQUENCE "evidence_code_seq";
