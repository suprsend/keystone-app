import { GateForm } from "./gate-form";

export const metadata = { title: "Keystone — locked" };

export default function GatePage() {
  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <div className="w-full max-w-xs space-y-5">
        <div className="space-y-1.5">
          <h1 className="text-lg font-semibold">Keystone</h1>
          <p className="text-muted-foreground text-sm">
            This demo is password protected. Enter the password you were given to continue.
          </p>
        </div>
        <GateForm />
      </div>
    </main>
  );
}
