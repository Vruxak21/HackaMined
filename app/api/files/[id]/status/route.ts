// TODO: implement
import { NextResponse } from "next/server";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
    return NextResponse.json({ message: "TODO: get file status", id: params.id });
}
