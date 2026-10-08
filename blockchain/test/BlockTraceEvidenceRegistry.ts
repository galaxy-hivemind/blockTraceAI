import { expect } from "chai";
import { ethers } from "hardhat";

describe("BlockTraceEvidenceRegistry", () => {
  async function deployRegistry() {
    const [owner, investigator1, investigator2, stranger] = await ethers.getSigners();
    const Registry = await ethers.getContractFactory("BlockTraceEvidenceRegistry");
    const registry = await Registry.deploy();
    await registry.waitForDeployment();
    return { registry, owner, investigator1, investigator2, stranger };
  }

  const evidenceId = ethers.id("evidence-1");
  const incidentId = ethers.id("incident-1");
  const sha256Hash = "0x9d27783f5df17c4f85d3ce3ef54bf3f7e5eac58ea7e9899a396f814ddcae881d";

  describe("investigator authorization", () => {
    it("lets the owner authorize an investigator", async () => {
      const { registry, owner, investigator1 } = await deployRegistry();

      await expect(registry.connect(owner).registerInvestigator(investigator1.address, true))
        .to.emit(registry, "InvestigatorPermissionUpdated")
        .withArgs(investigator1.address, true);

      expect(await registry.authorizedInvestigators(investigator1.address)).to.equal(true);
    });

    it("lets the owner revoke an investigator", async () => {
      const { registry, owner, investigator1 } = await deployRegistry();
      await registry.connect(owner).registerInvestigator(investigator1.address, true);

      await expect(registry.connect(owner).registerInvestigator(investigator1.address, false))
        .to.emit(registry, "InvestigatorPermissionUpdated")
        .withArgs(investigator1.address, false);

      expect(await registry.authorizedInvestigators(investigator1.address)).to.equal(false);
    });

    it("rejects investigator authorization from a non-owner", async () => {
      const { registry, investigator1, stranger } = await deployRegistry();

      await expect(registry.connect(stranger).registerInvestigator(investigator1.address, true)).to.be.revertedWithCustomError(
        registry,
        "NotOwner",
      );
    });
  });

  describe("evidence registration", () => {
    it("lets an authorized investigator register evidence", async () => {
      const { registry, owner, investigator1 } = await deployRegistry();
      await registry.connect(owner).registerInvestigator(investigator1.address, true);

      const tx = await registry
        .connect(investigator1)
        .registerEvidence(evidenceId, incidentId, sha256Hash, investigator1.address);
      const receipt = await tx.wait();
      const block = await ethers.provider.getBlock(receipt!.blockNumber);

      await expect(tx)
        .to.emit(registry, "EvidenceRegistered")
        .withArgs(evidenceId, incidentId, sha256Hash, investigator1.address, investigator1.address, block!.timestamp);

      const record = await registry.getEvidence(evidenceId);
      expect(record.exists).to.equal(true);
      expect(record.incidentId).to.equal(incidentId);
      expect(record.sha256Hash).to.equal(sha256Hash);
      expect(record.registeredBy).to.equal(investigator1.address);
      expect(record.currentCustodian).to.equal(investigator1.address);
      expect(record.registeredAt).to.equal(block!.timestamp);
    });

    it("stores the initial custodian separately from the sender when they differ", async () => {
      const { registry, owner, investigator1, investigator2 } = await deployRegistry();
      await registry.connect(owner).registerInvestigator(investigator1.address, true);

      await registry
        .connect(investigator1)
        .registerEvidence(evidenceId, incidentId, sha256Hash, investigator2.address);

      const record = await registry.getEvidence(evidenceId);
      expect(record.registeredBy).to.equal(investigator1.address);
      expect(record.currentCustodian).to.equal(investigator2.address);
    });

    it("rejects registration from an unauthorized address", async () => {
      const { registry, stranger, investigator1 } = await deployRegistry();

      await expect(
        registry.connect(stranger).registerEvidence(evidenceId, incidentId, sha256Hash, investigator1.address),
      ).to.be.revertedWithCustomError(registry, "UnauthorizedInvestigator");
    });
  });

  describe("duplicate protection and hash immutability", () => {
    it("rejects a duplicate evidence ID and leaves the original hash unchanged", async () => {
      const { registry, owner, investigator1 } = await deployRegistry();
      await registry.connect(owner).registerInvestigator(investigator1.address, true);
      await registry
        .connect(investigator1)
        .registerEvidence(evidenceId, incidentId, sha256Hash, investigator1.address);

      const otherHash = "0x1111111111111111111111111111111111111111111111111111111111111111";
      await expect(
        registry.connect(investigator1).registerEvidence(evidenceId, ethers.id("other-incident"), otherHash, investigator1.address),
      ).to.be.revertedWithCustomError(registry, "EvidenceAlreadyRegistered");

      const record = await registry.getEvidence(evidenceId);
      expect(record.sha256Hash).to.equal(sha256Hash);
      expect(record.incidentId).to.equal(incidentId);
    });

    it("has no supported function that can change a registered hash", async () => {
      const { registry } = await deployRegistry();
      const fragmentNames = registry.interface.fragments
        .filter((fragment) => fragment.type === "function")
        .map((fragment) => ("name" in fragment ? fragment.name : ""));

      expect(fragmentNames).to.not.include("updateEvidence");
      expect(fragmentNames).to.not.include("updateHash");
      expect(fragmentNames).to.not.include("setSha256Hash");
    });
  });

  describe("recordVerification", () => {
    async function registeredRegistry() {
      const context = await deployRegistry();
      await context.registry.connect(context.owner).registerInvestigator(context.investigator1.address, true);
      await context.registry
        .connect(context.investigator1)
        .registerEvidence(evidenceId, incidentId, sha256Hash, context.investigator1.address);
      return context;
    }

    it("lets an authorized investigator record a MATCH", async () => {
      const { registry, investigator1 } = await registeredRegistry();
      const tx = await registry.connect(investigator1).recordVerification(evidenceId, sha256Hash, true);
      const receipt = await tx.wait();
      const block = await ethers.provider.getBlock(receipt!.blockNumber);

      await expect(tx)
        .to.emit(registry, "EvidenceVerified")
        .withArgs(evidenceId, sha256Hash, true, investigator1.address, block!.timestamp);
    });

    it("lets an authorized investigator record a MISMATCH", async () => {
      const { registry, investigator1 } = await registeredRegistry();
      const computed = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
      const tx = await registry.connect(investigator1).recordVerification(evidenceId, computed, false);
      const receipt = await tx.wait();
      const block = await ethers.provider.getBlock(receipt!.blockNumber);

      await expect(tx)
        .to.emit(registry, "EvidenceVerified")
        .withArgs(evidenceId, computed, false, investigator1.address, block!.timestamp);
    });

    it("rejects recordVerification from an unauthorized address", async () => {
      const { registry, stranger } = await registeredRegistry();

      await expect(registry.connect(stranger).recordVerification(evidenceId, sha256Hash, true)).to.be.revertedWithCustomError(
        registry,
        "UnauthorizedInvestigator",
      );
    });

    it("rejects recordVerification for unknown evidence", async () => {
      const { registry, owner, investigator1 } = await deployRegistry();
      await registry.connect(owner).registerInvestigator(investigator1.address, true);

      await expect(
        registry.connect(investigator1).recordVerification(ethers.id("missing"), sha256Hash, true),
      ).to.be.revertedWithCustomError(registry, "EvidenceNotRegistered");
    });

    it("does not change the original hash after recordVerification", async () => {
      const { registry, investigator1 } = await registeredRegistry();
      const computed = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
      await registry.connect(investigator1).recordVerification(evidenceId, computed, false);

      const record = await registry.getEvidence(evidenceId);
      expect(record.sha256Hash).to.equal(sha256Hash);
    });
  });
});
