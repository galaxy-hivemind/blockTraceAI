import { PrismaClient, Role, UserStatus } from "@prisma/client";
import { hashPassword } from "../backend/src/services/password";
import { DEV_INVESTIGATOR_WALLETS } from "./devWallets";

const prisma = new PrismaClient();

const developmentPassword = process.env.SEED_DEV_PASSWORD ?? "BlockTraceDev!2026";

const users = [
  {
    email: "admin@blocktrace.local",
    fullName: "Organization Admin",
    role: Role.ORG_ADMIN,
    walletAddress: null,
  },
  {
    email: "investigator1@blocktrace.local",
    fullName: "Investigator One",
    role: Role.INVESTIGATOR,
    walletAddress: DEV_INVESTIGATOR_WALLETS["investigator1@blocktrace.local"],
  },
  {
    email: "investigator2@blocktrace.local",
    fullName: "Investigator Two",
    role: Role.INVESTIGATOR,
    walletAddress: DEV_INVESTIGATOR_WALLETS["investigator2@blocktrace.local"],
  },
  {
    email: "auditor@blocktrace.local",
    fullName: "Auditor",
    role: Role.AUDITOR,
    walletAddress: null,
  },
] as const;

async function main(): Promise<void> {
  const passwordHash = await hashPassword(developmentPassword);

  for (const user of users) {
    await prisma.user.upsert({
      where: { email: user.email },
      update: {
        fullName: user.fullName,
        role: user.role,
        status: UserStatus.ACTIVE,
        passwordHash,
        walletAddress: user.walletAddress,
      },
      create: {
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        status: UserStatus.ACTIVE,
        passwordHash,
        walletAddress: user.walletAddress,
      },
    });
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error: unknown) => {
    console.error(error instanceof Error ? error.message : "Seed failed");
    await prisma.$disconnect();
    process.exit(1);
  });
