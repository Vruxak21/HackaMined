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
    <div className="flex flex-col gap-6 p-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-bold text-gray-900">Users</h1>
        <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-semibold text-gray-600">
          {users.length} total
        </span>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <Table>
          <TableHeader>
            <TableRow className="bg-gray-50">
              <TableHead>User</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Joined</TableHead>
              <TableHead>Files Uploaded</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((user) => (
              <TableRow key={user.id} className="hover:bg-gray-50/50">
                {/* User */}
                <TableCell>
                  <div className="flex items-center gap-3">
                    <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-sm font-bold text-indigo-700">
                      {user.name[0].toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-gray-800">{user.name}</p>
                      <p className="truncate text-xs text-gray-400">{user.email}</p>
                    </div>
                  </div>
                </TableCell>
                {/* Role */}
                <TableCell>
                  <span
                    className={
                      user.role === "ADMIN"
                        ? "rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-semibold text-blue-700"
                        : "rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-semibold text-gray-600"
                    }
                  >
                    {user.role}
                  </span>
                </TableCell>
                {/* Joined */}
                <TableCell className="text-sm text-gray-500">{formatDate(user.joinedAt)}</TableCell>
                {/* Files */}
                <TableCell className="text-sm font-medium text-gray-700">{user.filesUploaded}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
