import { NextResponse } from 'next/server';

function retiredResponse() {
  return NextResponse.json(
    {
      error:
        'Standalone Skills has been retired. Use Agent Knowledge in Super Admin > Agents.',
      code: 'SKILLS_RETIRED',
    },
    { status: 410 }
  );
}

export async function GET(_req: Request) {
  return retiredResponse();
}

export async function POST(_req: Request) {
  return retiredResponse();
}

export async function PUT(_req: Request) {
  return retiredResponse();
}

export async function PATCH(_req: Request) {
  return retiredResponse();
}

export async function DELETE(_req: Request) {
  return retiredResponse();
}
