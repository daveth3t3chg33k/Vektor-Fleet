import type { Metadata, Viewport } from "next";
import AppShell from "@/components/AppShell";
import "./globals.css";

export const metadata: Metadata = {
  title: "VektorFleet — Fleet Operations Console",
  description:
    "Hardware-agnostic, WhatsApp-native fleet management for African logistics enterprises. Fuel pilferage detection, predictive maintenance and NTSA/KRA compliance automation.",
};

export const viewport: Viewport = {
  themeColor: "#05080f",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans antialiased">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
