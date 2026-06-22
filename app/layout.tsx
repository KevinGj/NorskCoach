import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Norsk Coach",
  description: "En daglig norsk taletrener for uttale, rytme og flyt."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="no">
      <body>{children}</body>
    </html>
  );
}
