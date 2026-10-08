import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BlockTrace",
  description: "Blockchain-based digital evidence integrity and chain of custody",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
