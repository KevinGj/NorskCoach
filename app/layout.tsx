import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Norsk Coach",
  description: "A daily Norwegian speech coach for pronunciation, rhythm, and fluency."
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
