import { NextResponse } from 'next/server'
import nodemailer from 'nodemailer'

export const runtime = 'nodejs' // ensure Node runtime for Nodemailer

type EmailPayload = {
  emails: string[]
  subject: string
  htmlContent: string
  sender: {
    name: string
    email: string
  }
}

export async function POST(request: Request) {
  // Use explicit Gmail SMTP (more reliable than service: 'gmail')
  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: {
      user: process.env.EMAIL_USER, // must match the Gmail account used for SMTP
      pass: process.env.EMAIL_PASS, // Gmail App Password (not your normal password)
    },
  })

  // (Optional) During setup: verify the transporter once.
  try {
    await transporter.verify()
  } catch (e) {
    return NextResponse.json(
      { success: false, message: 'SMTP verification failed', error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    )
  }

  try {
    const { emails, subject, htmlContent, sender } = (await request.json()) as EmailPayload

    // Validate required fields
    if (!emails?.length) {
      return NextResponse.json({ success: false, message: 'No email addresses provided' }, { status: 400 })
    }
    if (!subject?.trim()) {
      return NextResponse.json({ success: false, message: 'Email subject is required' }, { status: 400 })
    }
    if (!htmlContent?.trim()) {
      return NextResponse.json({ success: false, message: 'Email content is required' }, { status: 400 })
    }
    if (!sender?.email || !sender?.name) {
      return NextResponse.json({ success: false, message: 'Sender information is required' }, { status: 400 })
    }

    // Batch settings
    const BATCH_SIZE = 150
    const BATCH_DELAY_MS = 1000

    type Result = { email: string; status: 'success' } | { email: string; status: 'failed'; error: string }
    const results: Result[] = []
    let successCount = 0
    let failCount = 0

    // Helper: strip HTML to make a text version
    const toPlainText = (html: string) =>
      html
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<\/(div|p|br|li|h[1-6])>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim()

    // Format HTML content with a professional email template
    const formatHtmlContent = (content: string, subjectLine: string) => {
      const trimmedContent = content.trim()

      // If already a full HTML doc, return as-is
      if (/^\s*<!doctype html>/i.test(trimmedContent) || /^\s*<html[^>]*>/i.test(trimmedContent)) {
        return trimmedContent
      }

      // Convert markdown-style links [text](url) to HTML (with optional !btn! prefix)
      const withMarkdownLinks = trimmedContent.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, text, url) => {
        if (String(text).startsWith('!btn!')) {
          const buttonText = String(text).replace('!btn!', '').trim()
          return `
            <div style="text-align:center;margin:20px 0;">
              <a href="${url}" target="_blank" class="button">${buttonText}</a>
            </div>
          `
        }
        return `<a href="${url}" style="color:#2563eb;text-decoration:underline;">${text}</a>`
      })

      // Convert plain URLs to links
      const withPlainLinks = withMarkdownLinks.replace(
        /(https?:\/\/[^\s<]+)/g,
        (url) => `<a href="${url}" style="color:#2563eb;text-decoration:underline;word-break:break-all;">${url}</a>`
      )

      // Paragraphize
      const paragraphs = withPlainLinks
        .split('\n')
        .map((p) => p.trim())
        .filter(Boolean)
        .map((p) => `<p style="font-size:15px;margin:15px 0;line-height:1.6;">${p}</p>`)
        .join('')

      // Single, valid HTML document (the duplicate block was removed)
      return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Type" content="text/html; charset=utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${subjectLine}</title>
<style>
  body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 20px; background-color: #f8f9fa; }
  .container { max-width: 600px; margin: 0 auto; background: #fff; padding: 30px; border-radius: 8px; box-shadow: 0 2px 5px rgba(0,0,0,0.1); }
  h1 { color: #2563eb; font-size: 20px; margin-top: 0; }
  p { font-size: 15px; margin: 15px 0; line-height: 1.6; }
  .button { display: inline-block; background-color: #2563eb; color: #fff !important; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: bold; margin: 20px 0; text-align: center; min-width: 200px; }
  .footer { margin-top: 30px; font-size: 12px; color: #666; border-top: 1px solid #eee; padding-top: 15px; }
  @media only screen and (max-width: 600px) {
    .container { width: 100% !important; padding: 15px !important; }
    .button { display: block !important; margin: 20px auto !important; width: 100%; max-width: 280px; box-sizing: border-box; }
  }
</style>
</head>
<body>
  <div class="container">
    ${paragraphs}
    <div class="footer">© ${new Date().getFullYear()}.</div>
  </div>
</body>
</html>`
    }

    // Send one email
    const sendEmail = async (email: string) => {
      const html = formatHtmlContent(htmlContent, subject)
      const text = toPlainText(htmlContent)

      await transporter.sendMail({
        from: `"${sender.name}" <${sender.email}>`,
        to: email,
        subject,
        html,
        text,
      })

      return { email, status: 'success' as const }
    }

    // Process a batch in parallel (with per-batch error capture)
    const processBatch = async (batch: string[]) => {
      const batchPromises = batch.map((email) =>
        sendEmail(email).catch((error) => ({
          email,
          status: 'failed' as const,
          error: error instanceof Error ? error.message : 'Unknown error',
        }))
      )
      return Promise.all(batchPromises)
    }

    // Iterate batches with delay
    for (let i = 0; i < emails.length; i += BATCH_SIZE) {
      const batch = emails.slice(i, i + BATCH_SIZE)
      const batchResults = await processBatch(batch)

      for (const result of batchResults) {
        if (result.status === 'success') successCount++
        else failCount++
        results.push(result)
      }

      if (i + BATCH_SIZE < emails.length) {
        await new Promise((r) => setTimeout(r, BATCH_DELAY_MS))
      }
    }

    return NextResponse.json({
      success: true,
      message: `Processed ${emails.length} email(s)`,
      summary: { total: emails.length, success: successCount, failed: failCount },
      results,
    })
  } catch (error) {
    console.error('Error processing email request:', error)
    return NextResponse.json(
      {
        success: false,
        message: 'Failed to process email sending request',
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}
