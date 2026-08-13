import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export async function generateMetadata(): Promise<Metadata> {
  const headerStore = await headers();
  const host = headerStore.get("x-forwarded-host") ?? headerStore.get("host") ?? "localhost:3000";
  const protocol = headerStore.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const base = new URL(`${protocol}://${host}`);
  const description = "Cotações, tendências, alertas e recomendações executivas para milho, soja e boi gordo.";

  return {
    metadataBase: base,
    title: "Grisomaq | Inteligência de Mercado",
    description,
    icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
    openGraph: {
      type: "website",
      title: "Grisomaq | Inteligência de Mercado",
      description,
      images: [{ url: new URL("/og.png", base).toString(), width: 1734, height: 907, alt: "Grisomaq Inteligência de Mercado — Milho, Soja e Boi" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "Grisomaq | Inteligência de Mercado",
      description,
      images: [new URL("/og.png", base).toString()],
    },
  };
}

// Aplica o tema salvo ANTES da pintura (evita flash claro/escuro no carregamento).
const themeInit = "try{if(localStorage.getItem('grisomaq-theme')==='light')document.documentElement.dataset.theme='light'}catch(e){}";

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: themeInit }} /></head>
      <body className={`${geistSans.variable} ${geistMono.variable}`}>{children}</body>
    </html>
  );
}
