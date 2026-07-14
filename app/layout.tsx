import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { cookies } from "next/headers";
import "./globals.css";
import { AppProviders } from "@/components/providers";
import { getDefaultTenant, isTenantOfWorkspace, type TenantId } from "@/lib/tenants";
import { DEFAULT_WORKSPACE, isWorkspaceSlug, type WorkspaceSlug } from "@/lib/workspaces";

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

  const cookieWs = store.get("ws")?.value;
  const initialWorkspace: WorkspaceSlug = isWorkspaceSlug(cookieWs) ? cookieWs : DEFAULT_WORKSPACE;

  // The project (tenant) must belong to the active workspace; otherwise fall back
  // to that workspace's first project.
  const cookieTenant = store.get("tenant")?.value;
  const initialTenant: TenantId = isTenantOfWorkspace(initialWorkspace, cookieTenant)
    ? (cookieTenant as TenantId)
    : getDefaultTenant(initialWorkspace).id;

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
