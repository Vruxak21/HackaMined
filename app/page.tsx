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
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
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
      <Label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        {label}
      </Label>
      {children}
      {error && (
        <p className="text-[0.75rem] text-destructive leading-tight">{error}</p>
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
        className="pl-9 pr-9 h-10 border-border/70 bg-background focus:border-primary"
        {...rest}
      />
      <button
        type="button"
        onClick={() => setShow((v) => !v)}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
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
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
      <Field label="Email" error={errors.email?.message}>
        <div className="relative">
          <Mail className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
          <Input
            id="signin-email"
            type="email"
            placeholder="you@example.com"
            className="pl-9 h-10 border-border/70 bg-background focus:border-primary"
            {...register("email")}
          />
        </div>
      </Field>

      <Field label="Password" error={errors.password?.message}>
        <div className="space-y-1">
          <PasswordInput
            id="signin-password"
            placeholder="••••••••"
            {...register("password")}
          />
          <div className="flex justify-end">
            <button
              type="button"
              className="text-[0.7rem] text-muted-foreground hover:text-foreground"
            >
              Forgot password?
            </button>
          </div>
        </div>
      </Field>

      <Button
        type="submit"
        className="w-full h-10 bg-primary text-primary-foreground hover:bg-primary/90 font-semibold tracking-wide"
        disabled={loading}
      >
        {loading ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            Signing in…
          </>
        ) : (
          "Sign In"
        )}
      </Button>

      <div className="flex items-center gap-3">
        <Separator className="flex-1" />
        <span className="text-[0.7rem] uppercase tracking-widest text-muted-foreground">or</span>
        <Separator className="flex-1" />
      </div>

      <Button
        type="button"
        variant="outline"
        className="w-full h-10 gap-2 border-border/70"
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
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
      <Field label="Full Name" error={errors.name?.message}>
        <div className="relative">
          <User className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
          <Input
            id="signup-name"
            type="text"
            placeholder="Jane Doe"
            className="pl-9 h-10 border-border/70 bg-background focus:border-primary"
            {...register("name")}
          />
        </div>
      </Field>

      <Field label="Email" error={errors.email?.message}>
        <div className="relative">
          <Mail className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
          <Input
            id="signup-email"
            type="email"
            placeholder="you@example.com"
            className="pl-9 h-10 border-border/70 bg-background focus:border-primary"
            {...register("email")}
          />
        </div>
      </Field>

      <Field label="Password" error={errors.password?.message}>
        <PasswordInput
          id="signup-password"
          placeholder="Min. 8 characters"
          {...register("password")}
        />
      </Field>

      <Field label="Confirm Password" error={errors.confirmPassword?.message}>
        <PasswordInput
          id="signup-confirm"
          placeholder="Repeat your password"
          {...register("confirmPassword")}
        />
      </Field>

      <Button
        type="submit"
        className="w-full h-10 bg-primary text-primary-foreground hover:bg-primary/90 font-semibold tracking-wide"
        disabled={loading}
      >
        {loading ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            Creating account…
          </>
        ) : (
          "Create Account"
        )}
      </Button>

      <div className="flex items-center gap-3">
        <Separator className="flex-1" />
        <span className="text-[0.7rem] uppercase tracking-widest text-muted-foreground">or</span>
        <Separator className="flex-1" />
      </div>

      <Button
        type="button"
        variant="outline"
        className="w-full h-10 gap-2 border-border/70"
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

      <p className="text-center text-[0.7rem] text-muted-foreground">
        By creating an account you agree to our{" "}
        <span className="underline underline-offset-2 cursor-pointer hover:text-foreground">
          Terms of Service
        </span>{" "}
        &{" "}
        <span className="underline underline-offset-2 cursor-pointer hover:text-foreground">
          Privacy Policy
        </span>
        .
      </p>
    </form>
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
    <div className="min-h-screen grid lg:grid-cols-2">
      {/* ── Left panel — branding ─────────────────────────────── */}
      <div className="hidden lg:flex flex-col justify-between bg-foreground text-background p-12">
        {/* Top: wordmark */}
        <div className="flex items-center gap-2.5">
          <div className="flex size-8 items-center justify-center rounded-lg bg-primary">
            <Shield size={15} className="text-foreground" />
          </div>
          <span className="text-sm font-bold tracking-tight">PII Sanitizer</span>
        </div>

        {/* Middle: hero copy */}
        <div className="space-y-6">
          <div className="space-y-3">
            <p className="text-[0.65rem] uppercase tracking-[0.2em] text-background/40 font-semibold">
              HackaMined &apos;26
            </p>
            <h1 className="text-4xl font-bold leading-[1.15] tracking-tight">
              Protect what<br />matters most.
            </h1>
            <p className="text-sm text-background/50 leading-relaxed max-w-xs">
              Automatically detect and sanitize personally identifiable information from your documents — securely and at scale.
            </p>
          </div>

          {/* Feature pills */}
          <div className="flex flex-wrap gap-2">
            {["AES-256-GCM", "16 PII types", "PDF · SQL · CSV · JSON"].map((f) => (
              <span
                key={f}
                className="rounded-full border border-background/15 px-3 py-1 text-[0.65rem] font-medium text-background/50 uppercase tracking-wide"
              >
                {f}
              </span>
            ))}
          </div>
        </div>

        {/* Bottom: tagline */}
        <p className="text-[0.65rem] text-background/25 font-medium uppercase tracking-widest">
          End-to-end encrypted · Audit logged
        </p>
      </div>

      {/* ── Right panel — auth form ───────────────────────────── */}
      <div className="flex items-center justify-center p-6 lg:p-16 bg-background">
        <div className="w-full max-w-sm">
          {/* Mobile brand */}
          <div className="mb-10 flex items-center gap-2.5 lg:hidden">
            <div className="flex size-8 items-center justify-center rounded-lg bg-foreground">
              <Shield size={15} className="text-background" />
            </div>
            <span className="text-sm font-bold tracking-tight">PII Sanitizer</span>
          </div>

          <div className="mb-8">
            <h2 className="text-2xl font-bold tracking-tight">Get started</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Sign in or create a new account
            </p>
          </div>

          <Tabs defaultValue="signin" className="w-full">
            <TabsList className="w-full h-9 bg-muted/60 rounded-md p-0.5 mb-8">
              <TabsTrigger
                value="signin"
                className="flex-1 text-xs font-semibold uppercase tracking-wide data-[state=active]:bg-background data-[state=active]:shadow-sm rounded-sm"
              >
                Sign In
              </TabsTrigger>
              <TabsTrigger
                value="signup"
                className="flex-1 text-xs font-semibold uppercase tracking-wide data-[state=active]:bg-background data-[state=active]:shadow-sm rounded-sm"
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
        </div>
      </div>
    </div>
  );
}
