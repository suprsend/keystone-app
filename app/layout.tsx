import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { cookies } from "next/headers";
import "./globals.css";
import { AppProviders } from "@/components/providers";
import { listWorkspaces } from "@/lib/server/workspace";

// Neutral product chrome set in Geist (matches the clean reference look).
// Mono (template slugs, ids) stays Geist Mono.
const geistSans = Geist({ variable: "--font-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Keystone — Notifications",
  description: "Notification settings for Keystone — a project-management platform.",
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const store = await cookies();

  // Workspaces are read live from SuprSend. A failure here is shown by WorkspaceGuard.
  const workspaces = await listWorkspaces().catch(() => []);
  const cookieWs = store.get("ws")?.value;
  const initialWorkspace = (workspaces.find((w) => w.slug === cookieWs) ?? workspaces[0])?.slug ?? "";

  // The project cookie only counts for the workspace it was set in. The client checks
  // it against the live project list and moves to a real project (or none).
  const initialTenant = cookieWs === initialWorkspace ? (store.get("tenant")?.value ?? "") : "";

  // Seed the actor from the cookie. Default to the Admin overseer ("admin"
  // sentinel) so the app opens in the Administer/Manage context with the full
  // nav functional; picking a person in "Viewing as" switches to that user.
  const initialActor = store.get("actor")?.value ?? "admin";

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="bg-background text-foreground min-h-full">
        <AppProviders
          workspaces={workspaces}
          initialWorkspace={initialWorkspace}
          initialTenant={initialTenant}
          initialActor={initialActor}
        >
          {children}
        </AppProviders>
      </body>
    </html>
  );
}
