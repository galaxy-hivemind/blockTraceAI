import { z } from "zod";

export const evidenceDescriptionSchema = z
  .string()
  .trim()
  .max(2000)
  .optional()
  .transform((value) => (value && value.length > 0 ? value : undefined));

export const evidenceIdSchema = z.string().uuid();
