"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import {
  Eye,
  EyeOff,
  Mail,
  Lock,
  User,
  Loader2,
  Chrome,
  Shield,
  ShieldCheck,
  Database,
  Key,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { ThemeToggle } from "@/components/ThemeToggle";
import { signIn, signUp, useSession } from "@/lib/auth-client";

// ── Zod Schemas ──────────────────────────────────────────────────────────────

const signInSchema = z.object({
  email: z.string().email("Enter a valid email address"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

const signUpSchema = z
  .object({
    name: z.string().min(2, "Name must be at least 2 characters"),
    email: z.string().email("Enter a valid email address"),
    password: z.string().min(8, "Password must be at least 8 characters"),
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

type SignInValues = z.infer<typeof signInSchema>;
type SignUpValues = z.infer<typeof signUpSchema>;

// ── Field wrapper ─────────────────────────────────────────────────────────────

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-[0.65rem] font-semibold uppercase tracking-widest text-muted-foreground">
        {label}
      </Label>
      {children}
      {error && (
        <p className="text-xs text-destructive leading-tight">{error}</p>
      )}
    </div>
  );
}

// ── Password Input ─────────────────────────────────────────────────────────────

function PasswordInput({
  id,
  placeholder,
  ...rest
}: React.ComponentProps<"input"> & { id: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
      <Input
        id={id}
        type={show ? "text" : "password"}
        placeholder={placeholder}
        className="pl-9 pr-9 h-10 bg-muted/60 border-border focus-visible:border-primary focus-visible:ring-0 focus-visible:shadow-[0_0_0_3px_rgba(214,89,174,0.15)]"
        {...rest}
      />
      <button
        type="button"
        onClick={() => setShow((v) => !v)}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
        aria-label={show ? "Hide password" : "Show password"}
      >
        {show ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
      </button>
    </div>
  );
}

// ── Sign In Form ──────────────────────────────────────────────────────────────

function SignInForm() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<SignInValues>({ resolver: zodResolver(signInSchema) });

  async function onSubmit(data: SignInValues) {
    setLoading(true);
    const { error } = await signIn.email({
      email: data.email,
      password: data.password,
      callbackURL: "/auth/callback",
    });
    setLoading(false);

    if (error) {
      toast.error(error.message ?? "Sign in failed. Please try again.");
    } else {
      toast.success("Welcome back! Redirecting…");
      router.push("/auth/callback");
    }
  }

  async function handleGoogle() {
    setGoogleLoading(true);
    const { error } = await signIn.social({
      provider: "google",
      callbackURL: "/auth/callback",
    });
    if (error) {
      setGoogleLoading(false);
      toast.error(error.message ?? "Google sign in failed.");
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <Field label="Email" error={errors.email?.message}>
        <div className="relative">
          <Mail className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
          <Input
            id="signin-email"
            type="email"
            placeholder="you@company.com"
            autoComplete="email"
            className="pl-9 h-10 bg-muted/60 border-border focus-visible:border-primary focus-visible:ring-0 focus-visible:shadow-[0_0_0_3px_rgba(214,89,174,0.15)]"
            {...register("email")}
          />
        </div>
      </Field>

      <Field label="Password" error={errors.password?.message}>
        <div className="space-y-1">
          <PasswordInput
            id="signin-password"
            placeholder="••••••••"
            autoComplete="current-password"
            {...register("password")}
          />
          <div className="flex justify-end">
            <button
              type="button"
              className="text-[0.7rem] text-primary/80 hover:text-primary transition-colors"
            >
              Forgot password?
            </button>
          </div>
        </div>
      </Field>

      <Button
        type="submit"
        className="w-full h-10 bg-primary text-primary-foreground hover:bg-primary/90 font-semibold tracking-wide font-body active:scale-[0.97] transition-all duration-150"
        disabled={loading}
      >
        {loading ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            Signing in…
          </>
        ) : (
          <>
            <Shield className="size-4" />
            Sign In
          </>
        )}
      </Button>

      <div className="flex items-center gap-3">
        <Separator className="flex-1" />
        <span className="text-[0.65rem] uppercase tracking-widest text-muted-foreground">or</span>
        <Separator className="flex-1" />
      </div>

      <Button
        type="button"
        variant="outline"
        className="w-full h-10 gap-2 font-body font-medium active:scale-[0.97] transition-all duration-150"
        onClick={handleGoogle}
        disabled={googleLoading}
      >
        {googleLoading ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Chrome className="size-4" />
        )}
        Continue with Google
      </Button>
    </form>
  );
}

// ── Sign Up Form ──────────────────────────────────────────────────────────────

function SignUpForm() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<SignUpValues>({ resolver: zodResolver(signUpSchema) });

  async function onSubmit(data: SignUpValues) {
    setLoading(true);
    const { error } = await signUp.email({
      name: data.name,
      email: data.email,
      password: data.password,
      callbackURL: "/auth/callback",
    });
    setLoading(false);

    if (error) {
      toast.error(error.message ?? "Sign up failed. Please try again.");
    } else {
      toast.success("Account created! Redirecting…");
      router.push("/auth/callback");
    }
  }

  async function handleGoogle() {
    setGoogleLoading(true);
    const { error } = await signIn.social({
      provider: "google",
      callbackURL: "/auth/callback",
    });
    if (error) {
      setGoogleLoading(false);
      toast.error(error.message ?? "Google sign up failed.");
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <Field label="Full Name" error={errors.name?.message}>
        <div className="relative">
          <User className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
          <Input
            id="signup-name"
            type="text"
            placeholder="Jane Doe"
            autoComplete="name"
            className="pl-9 h-10 bg-muted/60 border-border focus-visible:border-primary focus-visible:ring-0 focus-visible:shadow-[0_0_0_3px_rgba(214,89,174,0.15)]"
            {...register("name")}
          />
        </div>
      </Field>

      <Field label="Work Email" error={errors.email?.message}>
        <div className="relative">
          <Mail className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
          <Input
            id="signup-email"
            type="email"
            placeholder="you@company.com"
            autoComplete="email"
            className="pl-9 h-10 bg-muted/60 border-border focus-visible:border-primary focus-visible:ring-0 focus-visible:shadow-[0_0_0_3px_rgba(214,89,174,0.15)]"
            {...register("email")}
          />
        </div>
      </Field>

      <Field label="Password" error={errors.password?.message}>
        <PasswordInput
          id="signup-password"
          placeholder="Min. 8 characters"
          autoComplete="new-password"
          {...register("password")}
        />
      </Field>

      <Field label="Confirm Password" error={errors.confirmPassword?.message}>
        <PasswordInput
          id="signup-confirm"
          placeholder="Repeat your password"
          autoComplete="new-password"
          {...register("confirmPassword")}
        />
      </Field>

      <Button
        type="submit"
        className="w-full h-10 bg-primary text-primary-foreground hover:bg-primary/90 font-semibold tracking-wide font-body active:scale-[0.97] transition-all duration-150"
        disabled={loading}
      >
        {loading ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            Creating account…
          </>
        ) : (
          <>
            <Shield className="size-4" />
            Create Account
          </>
        )}
      </Button>

      <div className="flex items-center gap-3">
        <Separator className="flex-1" />
        <span className="text-[0.65rem] uppercase tracking-widest text-muted-foreground">or</span>
        <Separator className="flex-1" />
      </div>

      <Button
        type="button"
        variant="outline"
        className="w-full h-10 gap-2 font-body font-medium active:scale-[0.97] transition-all duration-150"
        onClick={handleGoogle}
        disabled={googleLoading}
      >
        {googleLoading ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Chrome className="size-4" />
        )}
        Continue with Google
      </Button>

      <p className="text-center text-xs text-muted-foreground">
        By creating an account you agree to our{" "}
        <span className="text-primary hover:underline cursor-pointer">Terms of Service</span>{" "}
        &{" "}
        <span className="text-primary hover:underline cursor-pointer">Privacy Policy</span>.
      </p>
    </form>
  );
}

// ── Trust Signal ──────────────────────────────────────────────────────────────

function TrustSignal({
  icon,
  stat,
  desc,
}: {
  icon: React.ReactNode;
  stat: string;
  desc: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/15 text-primary mt-0.5">
        {icon}
      </div>
      <div>
        <p className="text-sm font-bold text-foreground font-display leading-tight">{stat}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
      </div>
    </div>
  );
}

// ── Background Pattern ────────────────────────────────────────────────────────

function NetworkPattern() {
  return (
    <svg
      className="absolute inset-0 w-full h-full opacity-[0.04]"
      viewBox="0 0 600 600"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <defs>
        <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
          <path d="M 40 0 L 0 0 0 40" fill="none" stroke="currentColor" strokeWidth="0.5" />
        </pattern>
      </defs>
      <rect width="600" height="600" fill="url(#grid)" />
      {/* Nodes */}
      {[
        [80, 120], [240, 80], [400, 160], [520, 80],
        [160, 280], [300, 240], [460, 300], [80, 400],
        [220, 440], [380, 400], [520, 460], [140, 540],
        [440, 520],
      ].map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="3" fill="currentColor" />
      ))}
      {/* Edges */}
      <g stroke="currentColor" strokeWidth="0.8" fill="none">
        <line x1="80" y1="120" x2="240" y2="80" />
        <line x1="240" y1="80" x2="400" y2="160" />
        <line x1="400" y1="160" x2="520" y2="80" />
        <line x1="80" y1="120" x2="160" y2="280" />
        <line x1="240" y1="80" x2="300" y2="240" />
        <line x1="400" y1="160" x2="460" y2="300" />
        <line x1="160" y1="280" x2="300" y2="240" />
        <line x1="300" y1="240" x2="460" y2="300" />
        <line x1="160" y1="280" x2="80" y2="400" />
        <line x1="300" y1="240" x2="220" y2="440" />
        <line x1="460" y1="300" x2="380" y2="400" />
        <line x1="80" y1="400" x2="220" y2="440" />
        <line x1="220" y1="440" x2="380" y2="400" />
        <line x1="380" y1="400" x2="520" y2="460" />
        <line x1="220" y1="440" x2="140" y2="540" />
        <line x1="380" y1="400" x2="440" y2="520" />
      </g>
    </svg>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function Home() {
  const { data: session, isPending } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (!isPending && session?.user) {
      router.push("/auth/callback");
    }
  }, [session, isPending, router]);

  if (!isPending && session?.user) {
    return null;
  }

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[55%_45%] bg-background">

      {/* ── Left panel — brand ─────────────────────────────────── */}
      <div className="relative hidden lg:flex flex-col justify-between overflow-hidden bg-muted p-14">
        {/* Subtle gradient overlay */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse 70% 60% at 20% 40%, rgba(214,89,174,0.06) 0%, transparent 70%), radial-gradient(ellipse 50% 50% at 80% 80%, rgba(214,89,174,0.04) 0%, transparent 60%)",
          }}
        />

        {/* Data-flow network pattern */}
        <NetworkPattern />

        {/* Top: wordmark */}
        <div className="relative flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary shadow-[0_0_20px_rgba(214,89,174,0.3)]">
            <Shield size={16} className="text-primary-foreground" />
          </div>
          <div>
            <p className="font-display text-sm font-bold tracking-tight text-foreground leading-none">PII Sentinel</p>
            <p className="text-[0.6rem] font-semibold uppercase tracking-widest text-muted-foreground mt-0.5">by Tribastion</p>
          </div>
        </div>

        {/* Middle: hero copy */}
        <div className="relative space-y-8">
          <div className="space-y-4">
            <h1 className="font-display text-[2.6rem] font-extrabold leading-[1.1] tracking-tight text-foreground">
              Protect your<br />
              <span className="text-primary">sensitive data.</span><br />
              At enterprise scale.
            </h1>
            <p className="text-sm text-muted-foreground leading-relaxed max-w-sm">
              PII Sentinel automatically detects and sanitizes personally identifiable information from documents —
              with full audit trails, AES-256-GCM encryption, and AI-powered accuracy.
            </p>
          </div>

          {/* Trust signals */}
          <div className="space-y-4">
            <TrustSignal
              icon={<Database size={14} />}
              stat="19+ PII Types"
              desc="Names, IDs, cards, biometrics, and more"
            />
            <TrustSignal
              icon={<Key size={14} />}
              stat="AES-256-GCM Encrypted"
              desc="Data at rest and in transit, always"
            />
            <TrustSignal
              icon={<ShieldCheck size={14} />}
              stat="Full Audit Trail"
              desc="Every action logged, timestamped, and immutable"
            />
          </div>
        </div>

        {/* Bottom: badge row */}
        <div className="relative flex flex-wrap gap-2">
          {["SOC 2 Ready", "GDPR Compliant", "HIPAA Aligned", "End-to-End Encrypted"].map((badge) => (
            <span
              key={badge}
              className="rounded-full border border-border/60 bg-background/50 px-3 py-1 text-[0.6rem] font-semibold uppercase tracking-wider text-muted-foreground"
            >
              {badge}
            </span>
          ))}
        </div>
      </div>

      {/* ── Right panel — auth form ────────────────────────────── */}
      <div className="relative flex min-h-screen items-center justify-center bg-background p-8 lg:min-h-0">
        {/* Theme toggle — top right */}
        <div className="absolute top-5 right-5">
          <ThemeToggle />
        </div>

        <div className="w-full max-w-sm">
          {/* Mobile brand */}
          <div className="mb-10 flex items-center gap-2.5 lg:hidden">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
              <Shield size={14} className="text-primary-foreground" />
            </div>
            <div>
              <p className="font-display text-sm font-bold tracking-tight text-foreground leading-none">PII Sentinel</p>
              <p className="text-[0.55rem] font-semibold uppercase tracking-widest text-muted-foreground mt-0.5">by Tribastion</p>
            </div>
          </div>

          <div className="mb-8">
            <h2 className="font-display text-[1.6rem] font-bold tracking-tight text-foreground leading-tight">
              Sign in to PII Sentinel
            </h2>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Secure access to your workspace
            </p>
          </div>

          <Tabs defaultValue="signin" className="w-full">
            <TabsList className="w-full h-9 bg-muted rounded-md p-0.5 mb-7">
              <TabsTrigger
                value="signin"
                className="flex-1 text-[0.7rem] font-semibold uppercase tracking-widest data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm rounded-sm"
              >
                Sign In
              </TabsTrigger>
              <TabsTrigger
                value="signup"
                className="flex-1 text-[0.7rem] font-semibold uppercase tracking-widest data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm rounded-sm"
              >
                Register
              </TabsTrigger>
            </TabsList>

            <TabsContent value="signin">
              <SignInForm />
            </TabsContent>

            <TabsContent value="signup">
              <SignUpForm />
            </TabsContent>
          </Tabs>

          <p className="mt-8 text-center text-xs text-muted-foreground">
            Protected by Tribastion · End-to-end encrypted
          </p>
        </div>
      </div>
    </div>
  );
}
