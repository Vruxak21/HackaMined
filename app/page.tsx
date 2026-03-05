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
  Sparkles,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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

// ── Shared Password Input ─────────────────────────────────────────────────────

function PasswordInput({
  id,
  placeholder,
  ...rest
}: React.ComponentProps<"input"> & { id: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
      <Input
        id={id}
        type={show ? "text" : "password"}
        placeholder={placeholder}
        className="pl-9 pr-9"
        {...rest}
      />
      <button
        type="button"
        onClick={() => setShow((v) => !v)}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
        aria-label={show ? "Hide password" : "Show password"}
      >
        {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
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
      {/* Email */}
      <div className="space-y-1.5">
        <Label htmlFor="signin-email">Email</Label>
        <div className="relative">
          <Mail className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
          <Input
            id="signin-email"
            type="email"
            placeholder="you@example.com"
            className="pl-9"
            {...register("email")}
          />
        </div>
        {errors.email && (
          <p className="text-[0.8rem] text-destructive">{errors.email.message}</p>
        )}
      </div>

      {/* Password */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor="signin-password">Password</Label>
          <button
            type="button"
            className="text-xs text-muted-foreground hover:text-primary transition-colors"
          >
            Forgot password?
          </button>
        </div>
        <PasswordInput
          id="signin-password"
          placeholder="••••••••"
          {...register("password")}
        />
        {errors.password && (
          <p className="text-[0.8rem] text-destructive">{errors.password.message}</p>
        )}
      </div>

      {/* Submit */}
      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            Signing in…
          </>
        ) : (
          "Sign In"
        )}
      </Button>

      {/* Divider */}
      <div className="flex items-center gap-3">
        <Separator className="flex-1" />
        <span className="text-xs text-muted-foreground">or</span>
        <Separator className="flex-1" />
      </div>

      {/* Google */}
      <Button
        type="button"
        variant="outline"
        className="w-full gap-2"
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
      {/* Name */}
      <div className="space-y-1.5">
        <Label htmlFor="signup-name">Full Name</Label>
        <div className="relative">
          <User className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
          <Input
            id="signup-name"
            type="text"
            placeholder="Jane Doe"
            className="pl-9"
            {...register("name")}
          />
        </div>
        {errors.name && (
          <p className="text-[0.8rem] text-destructive">{errors.name.message}</p>
        )}
      </div>

      {/* Email */}
      <div className="space-y-1.5">
        <Label htmlFor="signup-email">Email</Label>
        <div className="relative">
          <Mail className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
          <Input
            id="signup-email"
            type="email"
            placeholder="you@example.com"
            className="pl-9"
            {...register("email")}
          />
        </div>
        {errors.email && (
          <p className="text-[0.8rem] text-destructive">{errors.email.message}</p>
        )}
      </div>

      {/* Password */}
      <div className="space-y-1.5">
        <Label htmlFor="signup-password">Password</Label>
        <PasswordInput
          id="signup-password"
          placeholder="Min. 8 characters"
          {...register("password")}
        />
        {errors.password && (
          <p className="text-[0.8rem] text-destructive">{errors.password.message}</p>
        )}
      </div>

      {/* Confirm Password */}
      <div className="space-y-1.5">
        <Label htmlFor="signup-confirm">Confirm Password</Label>
        <PasswordInput
          id="signup-confirm"
          placeholder="Repeat your password"
          {...register("confirmPassword")}
        />
        {errors.confirmPassword && (
          <p className="text-[0.8rem] text-destructive">
            {errors.confirmPassword.message}
          </p>
        )}
      </div>

      {/* Submit */}
      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            Creating account…
          </>
        ) : (
          "Create Account"
        )}
      </Button>

      {/* Divider */}
      <div className="flex items-center gap-3">
        <Separator className="flex-1" />
        <span className="text-xs text-muted-foreground">or</span>
        <Separator className="flex-1" />
      </div>

      {/* Google */}
      <Button
        type="button"
        variant="outline"
        className="w-full gap-2"
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
        <span className="underline underline-offset-2 cursor-pointer hover:text-foreground transition-colors">
          Terms of Service
        </span>{" "}
        &amp;{" "}
        <span className="underline underline-offset-2 cursor-pointer hover:text-foreground transition-colors">
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
    // Render nothing while the redirect fires
    return null;
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-linear-to-br from-background via-muted/30 to-background p-4">
      {/* Decorative blobs */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 -right-40 size-96 rounded-full bg-primary/8 blur-3xl" />
        <div className="absolute -bottom-40 -left-40 size-96 rounded-full bg-primary/8 blur-3xl" />
      </div>

      <div className="relative w-full max-w-md">
        {/* Brand header */}
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <div className="flex size-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg ring-4 ring-primary/20">
            <Sparkles className="size-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Hackamined&apos;26</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Sign in or create an account to continue
            </p>
          </div>
        </div>

        {/* Auth card */}
        <Card className="shadow-2xl border-border/50 backdrop-blur-sm">
          <CardHeader className="pb-0">
            <Tabs defaultValue="signin" className="w-full">
              <TabsList className="w-full">
                <TabsTrigger value="signin" className="flex-1">
                  Sign In
                </TabsTrigger>
                <TabsTrigger value="signup" className="flex-1">
                  Create Account
                </TabsTrigger>
              </TabsList>

              <TabsContent value="signin" className="mt-6 space-y-1">
                <CardTitle className="text-lg font-semibold">Welcome back</CardTitle>
                <CardDescription>
                  Enter your credentials to access your account.
                </CardDescription>
                <CardContent className="px-0 pt-5 pb-0">
                  <SignInForm />
                </CardContent>
              </TabsContent>

              <TabsContent value="signup" className="mt-6 space-y-1">
                <CardTitle className="text-lg font-semibold">
                  Create an account
                </CardTitle>
                <CardDescription>
                  Join us today — it only takes a minute.
                </CardDescription>
                <CardContent className="px-0 pt-5 pb-0">
                  <SignUpForm />
                </CardContent>
              </TabsContent>
            </Tabs>
          </CardHeader>
        </Card>
      </div>
    </div>
  );
}
