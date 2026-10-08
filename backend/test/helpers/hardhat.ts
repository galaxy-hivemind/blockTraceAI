import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Contract, ContractFactory, JsonRpcProvider, NonceManager, Wallet } from "ethers";

export const HARDHAT_OWNER_KEY = "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba";
export const HARDHAT_OWNER_KEY_B = "0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e";
export const HARDHAT_INVESTIGATOR1_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
export const HARDHAT_INVESTIGATOR2_KEY = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a";
export const HARDHAT_UNAUTHORIZED_KEY = "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6";

export const HARDHAT_INVESTIGATOR1 = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
export const HARDHAT_INVESTIGATOR2 = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
export const HARDHAT_UNAUTHORIZED = "0x90F79bf6EB2c4f870365E785982E1f101E93b906";

const repoRoot = path.resolve(__dirname, "../../..");
const rpcUrl = "http://127.0.0.1:8545";

let startedNode: ChildProcess | undefined;

async function rpcReady(url: string): Promise<boolean> {
  try {
    const provider = new JsonRpcProvider(url, undefined, { staticNetwork: true });
    await provider.getBlockNumber();
    return true;
  } catch {
    return false;
  }
}

export async function ensureHardhatNode(): Promise<void> {
  if (await rpcReady(rpcUrl)) {
    return;
  }

  const compile = spawnSync("npm", ["run", "compile"], {
    cwd: path.join(repoRoot, "blockchain"),
    encoding: "utf8",
  });
  if (compile.status !== 0) {
    throw new Error(compile.stderr || compile.stdout || "Hardhat compile failed");
  }

  startedNode = spawn("npx", ["hardhat", "node", "--hostname", "127.0.0.1", "--port", "8545"], {
    cwd: path.join(repoRoot, "blockchain"),
    stdio: ["ignore", "pipe", "pipe"],
  });

  const startedAt = Date.now();
  while (Date.now() - startedAt < 30_000) {
    if (await rpcReady(rpcUrl)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error("Hardhat node did not become ready");
}

export async function deployRegistry(
  ownerPrivateKey = HARDHAT_OWNER_KEY,
): Promise<{ contractAddress: string; provider: JsonRpcProvider }> {
  const compile = spawnSync("npm", ["run", "compile"], {
    cwd: path.join(repoRoot, "blockchain"),
    encoding: "utf8",
  });
  if (compile.status !== 0) {
    throw new Error(compile.stderr || compile.stdout || "Hardhat compile failed");
  }

  const artifactPath = path.join(
    repoRoot,
    "blockchain/artifacts/contracts/BlockTraceEvidenceRegistry.sol/BlockTraceEvidenceRegistry.json",
  );
  const artifact = JSON.parse(await readFile(artifactPath, "utf8")) as { abi: unknown; bytecode: string };
  const provider = new JsonRpcProvider(rpcUrl);
  const owner = new NonceManager(new Wallet(ownerPrivateKey, provider));
  await owner.getNonce("pending");
  const factory = new ContractFactory(artifact.abi, artifact.bytecode, owner);
  const contract = await factory.deploy();
  await contract.waitForDeployment();
  const contractAddress = await contract.getAddress();

  const registry = new Contract(contractAddress, artifact.abi, owner);
  await (await registry.registerInvestigator(HARDHAT_INVESTIGATOR1, true)).wait();
  await (await registry.registerInvestigator(HARDHAT_INVESTIGATOR2, true)).wait();

  return { contractAddress, provider };
}

export function applyBlockchainEnv(contractAddress: string): void {
  process.env.BLOCKCHAIN_RPC_URL = rpcUrl;
  process.env.BLOCKCHAIN_PRIVATE_KEY = HARDHAT_OWNER_KEY;
  process.env.BLOCKTRACE_CONTRACT_ADDRESS = contractAddress;
  process.env.BLOCKTRACE_INVESTIGATOR1_PRIVATE_KEY = HARDHAT_INVESTIGATOR1_KEY;
  process.env.BLOCKTRACE_INVESTIGATOR2_PRIVATE_KEY = HARDHAT_INVESTIGATOR2_KEY;
  process.env.BLOCKTRACE_SIGNER_PRIVATE_KEYS = HARDHAT_UNAUTHORIZED_KEY;
}

export async function stopStartedHardhatNode(): Promise<void> {
  if (!startedNode?.pid) {
    return;
  }

  startedNode.kill("SIGTERM");
  startedNode = undefined;
}
