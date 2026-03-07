import prisma from "@/lib/db";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type UserRow = {
  id: string;
  name: string;
  email: string;
  role: "ADMIN" | "USER";
  joinedAt: Date;
  filesUploaded: number;
};

function formatDate(d: Date) {
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export default async function AdminUsersPage() {
  const dbUsers = await prisma.user.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      createdAt: true,
      _count: { select: { files: true } },
    },
  });

  const users: UserRow[] = dbUsers.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role as "ADMIN" | "USER",
    joinedAt: u.createdAt,
    filesUploaded: u._count.files,
  }));

  return (
    <div className="flex flex-col gap-6 p-6 lg:p-8 animate-fade-slide-up">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">Users</h1>
            <span className="inline-flex items-center rounded-full border border-border bg-muted px-2.5 py-0.5 text-xs font-semibold text-muted-foreground">
              {users.length} total
            </span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">All registered accounts and their access levels</p>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent">
              <TableHead className="text-[0.65rem] font-semibold uppercase tracking-widest text-muted-foreground">User</TableHead>
              <TableHead className="text-[0.65rem] font-semibold uppercase tracking-widest text-muted-foreground">Role</TableHead>
              <TableHead className="text-[0.65rem] font-semibold uppercase tracking-widest text-muted-foreground">Joined</TableHead>
              <TableHead className="text-[0.65rem] font-semibold uppercase tracking-widest text-muted-foreground">Files Uploaded</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((user) => (
              <TableRow key={user.id} className="border-border hover:bg-muted/40 transition-colors">
                <TableCell>
                  <div className="flex items-center gap-3">
                    <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/12 text-xs font-bold text-primary">
                      {user.name[0].toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">{user.name}</p>
                      <p className="truncate text-xs text-muted-foreground">{user.email}</p>
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <span
                    className={
                      user.role === "ADMIN"
                        ? "rounded-full bg-primary/12 px-2.5 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide text-primary"
                        : "rounded-full bg-muted px-2.5 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide text-muted-foreground"
                    }
                  >
                    {user.role}
                  </span>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">{formatDate(user.joinedAt)}</TableCell>
                <TableCell className="text-sm font-medium text-foreground tabular-nums">{user.filesUploaded}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
