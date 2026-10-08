import { ethers } from "hardhat";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const INVESTIGATOR1 = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const INVESTIGATOR2 = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";

async function main(): Promise<void> {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();

  const Registry = await ethers.getContractFactory("BlockTraceEvidenceRegistry");
  const registry = await Registry.deploy();
  await registry.waitForDeployment();

  const contractAddress = await registry.getAddress();

  const authorize1 = await registry.registerInvestigator(INVESTIGATOR1, true);
  await authorize1.wait();
  const authorize2 = await registry.registerInvestigator(INVESTIGATOR2, true);
  await authorize2.wait();

  const rpc = process.env.BLOCKCHAIN_RPC_URL ?? "http://127.0.0.1:8545";

  console.log("BlockTraceEvidenceRegistry deployed");
  console.log(`Contract: ${contractAddress}`);
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Chain ID: ${network.chainId.toString()}`);
  console.log(`RPC: ${rpc}`);
  console.log("Authorized investigators:");
  console.log(`  investigator1: ${INVESTIGATOR1}`);
  console.log(`  investigator2: ${INVESTIGATOR2}`);
  console.log("");
  console.log("Configure the backend with:");
  console.log(`BLOCKTRACE_CONTRACT_ADDRESS=${contractAddress}`);
  console.log("BLOCKCHAIN_RPC_URL=http://127.0.0.1:8545");
  console.log("Use the matching Hardhat development private keys in backend/.env only.");

  const output = {
    contractName: "BlockTraceEvidenceRegistry",
    contractAddress,
    deployer: deployer.address,
    chainId: network.chainId.toString(),
    rpc,
    authorizedInvestigators: [INVESTIGATOR1, INVESTIGATOR2],
  };

  const deploymentsDir = path.join(__dirname, "..", "deployments");
  await mkdir(deploymentsDir, { recursive: true });
  await writeFile(path.join(deploymentsDir, "localhost.json"), `${JSON.stringify(output, null, 2)}\n`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Deployment failed");
  process.exit(1);
});
