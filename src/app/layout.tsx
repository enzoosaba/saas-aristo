import type { Metadata } from "next";
import { Onest, Geist_Mono } from "next/font/google";
import "./globals.css";
import "./theme.css";
import "./functional.css";
import "./responsive.css";
import "./mobile-reference.css";
import "./ux-refinement.css";
import "./desktop-reference.css";
import "./weekly-planner.css";
import "./mobile-nav.css";
import "./progress-bars.css";
import "./mobile-polish.css";
import "./buttons.css";
import ScrollEffects from "@/components/ScrollEffects";

import DashboardSidebar from "@/components/ui/dashboard-sidebar";
import MainNav from "@/components/MainNav";
import StudyProvider from "@/components/StudyProvider";
import TopBar from "@/components/TopBar";

const onest = Onest({
  variable: "--font-onest",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Plataforma Coelho",
  description: "Plataforma de mentoria e estudos",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="pt-BR"
      data-theme="dark"
      suppressHydrationWarning
      className={`${onest.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('aristo-theme')==='light'?'light':'dark';document.documentElement.dataset.theme=t;document.documentElement.style.colorScheme=t}catch(e){}})();`,
          }}
        />
      </head>
      <body className="min-h-full bg-cream text-ink">
        <svg
          width="0"
          height="0"
          aria-hidden="true"
          className="brand-gradient-defs"
        >
          <defs>
            <linearGradient
              id="coelho-accent"
              gradientUnits="userSpaceOnUse"
              x1="0"
              y1="0"
              x2="24"
              y2="24"
            >
              <stop offset="0%" stopColor="#ff8b38" />
              <stop offset="45%" stopColor="#ff5d00" />
              <stop offset="100%" stopColor="#e85002" />
            </linearGradient>
          </defs>
        </svg>
        <StudyProvider>
          <div className="app-shell">
            <a href="#conteudo" className="skip-link">
              Pular para o conteúdo
            </a>
            <ScrollEffects />
            <TopBar />
            <MainNav />
            <DashboardSidebar />
            <main id="conteudo" className="main-content">
              {children}
            </main>
          </div>
        </StudyProvider>
      </body>
    </html>
  );
}
