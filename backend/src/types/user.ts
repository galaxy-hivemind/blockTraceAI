import type { Role, UserStatus } from "@prisma/client";

export type PublicUser = {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  status: UserStatus;
  walletAddress: string | null;
};
