import type { NextFunction, Request, Response } from "express";
import multer from "multer";
import path from "node:path";
import { config } from "../config/env";
import { createUniqueStoredPath, ensureStorageDir } from "../services/storage";
import { getAllowedExtension } from "../validation/fileUpload";

const storage = multer.diskStorage({
  destination: (_req, _file, callback) => {
    void ensureStorageDir()
      .then((destination) => callback(null, destination))
      .catch((error: unknown) => callback(error instanceof Error ? error : new Error("Storage unavailable"), ""));
  },
  filename: (_req, file, callback) => {
    const extension = getAllowedExtension(file.originalname);
    if (!extension) {
      callback(new Error("Unsupported file type."), "");
      return;
    }

    void createUniqueStoredPath(extension)
      .then((absolutePath) => callback(null, path.basename(absolutePath)))
      .catch((error: unknown) => callback(error instanceof Error ? error : new Error("Unable to store file"), ""));
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: config.maxUploadBytes,
    files: 1,
  },
  fileFilter: (_req, file, callback) => {
    if (!getAllowedExtension(file.originalname)) {
      callback(new Error("Unsupported file type."));
      return;
    }

    callback(null, true);
  },
});

export function handleEvidenceUpload(req: Request, res: Response, next: NextFunction): void {
  upload.single("file")(req, res, (error: unknown) => {
    if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
      res.status(413).json({ error: `File exceeds the ${config.maxUploadMb} MB limit.` });
      return;
    }

    if (error instanceof Error) {
      const status = error.message === "Unsupported file type." ? 400 : 400;
      res.status(status).json({ error: error.message === "Unsupported file type." ? error.message : "Invalid request" });
      return;
    }

    next();
  });
}
