// TODO: implement
import { NextResponse } from "next/server";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
    return NextResponse.json({ message: "TODO: get file", id: params.id });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
    return NextResponse.json({ message: "TODO: delete file", id: params.id });
}
