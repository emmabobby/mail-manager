import { NextResponse } from "next/server"
import nodemailer from "nodemailer"

export async function GET() {
  try {
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 465),
      secure: Number(process.env.SMTP_PORT) === 465, // true if 465
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    })

    // just verify connection, don’t send an email yet
    await transporter.verify()

    return NextResponse.json({ success: true, message: "SMTP connection OK ✅" })
  } catch (error: any) {
    return NextResponse.json(
      { success: false, message: "SMTP connection failed ❌", error: error.message },
      { status: 500 }
    )
  }
}
