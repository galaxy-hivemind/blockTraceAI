import type { User } from "@prisma/client";
import type { PublicUser } from "../types/user";

export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    role: user.role,
    status: user.status,
    walletAddress: user.walletAddress,
  };
}
