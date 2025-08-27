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
    const BATCH_SIZE = 2000 // Gmail limit is 2000/day, 500/3hrs for regular accounts
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

    // Derive a human-readable name from an email address
    const nameFromEmail = (email: string) => {
      try {
        const local = email.split('@')[0] || ''
        const withoutPlus = local.split('+')[0]
        const parts = withoutPlus
          .replace(/[^a-zA-Z0-9_.-]/g, ' ') // keep common separators
          .replace(/[_.-]+/g, ' ') // normalize separators to spaces
          .trim()
          .split(/\s+/)
        if (!parts.length) return 'there'
        const words = parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
        return words.join(' ')
      } catch {
        return 'there'
      }
    }

    // Replace supported placeholders with the recipient's name
    const personalizeContent = (content: string, email: string) => {
      const name = nameFromEmail(email)
      return content
        .replace(/\{\{\s*receipetien\s*\}\}/gi, name)
        .replace(/\{\{\s*recipient\s*\}\}/gi, name)
        .replace(/\{\{\s*recipientname\s*\}\}/gi, name)
        .replace(/\{\{\s*name\s*\}\}/gi, name)
    }

    // Append #<email> to every http(s) link that *doesn't already have a fragment*.
    const addEmailHashToLinks = (html: string, email: string) => {
      return html.replace(
        /href=(["'])(https?:\/\/[^"'#\s]+)(#[^"']*)?\1/gi,
        (_m, quote, url, hash) => {
          if (hash) return _m // already has a fragment; leave it
          return `href=${quote}${url}#${email}${quote}`
        }
      )
    }

    // Format HTML content with a professional email template
    const formatHtmlContent = (content: string, subjectLine: string, email: string) => {
      const trimmedContent = content.trim()

      // If already a full HTML doc, return as-is
      if (/^\s*<!doctype html>/i.test(trimmedContent) || /^\s*<html[^>]*>/i.test(trimmedContent)) {
         return addEmailHashToLinks(trimmedContent, email)
      }

      // Convert markdown-style links [text](url) to HTML (with optional !btn! prefix)
      const withMarkdownLinks = trimmedContent.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, text, url) => {
        // Create URL object to safely handle the URL
        let urlObj;
        try {
          urlObj = new URL(url);
          // Add email as hash if it's not already there
          if (!urlObj.hash) {
            urlObj.hash = email;
          }
        } catch (e) {
          // If URL is invalid, use as is
          urlObj = { toString: () => url };
        }
        
        if (String(text).startsWith('!btn!')) {
          const buttonText = String(text).replace('!btn!', '').trim()
          return `
            <div style="text-align:center;margin:20px 0;">
              <a href="${urlObj.toString()}" target="_blank" class="button">${buttonText}</a>
            </div>
          `
        }
        return `<a href="${urlObj.toString()}" style="color:#2563eb;text-decoration:underline;" target="_blank">${text}</a>`
      })

      // Find the first URL (used for auto button when we see a standalone "view more")
      const firstUrlMatch = withMarkdownLinks.match(/https?:\/\/[^\s<)]+/)
      const firstUrl = firstUrlMatch?.[0]

      // Convert plain URLs to links and add email hash
      const withPlainLinks = withMarkdownLinks.replace(
        /(https?:\/\/[^\s<"]+)/g,
        (url) => {
          try {
            const urlObj = new URL(url);
            // Add email as hash if it's not already there
            if (!urlObj.hash) {
              urlObj.hash = email;
            }
            return `<a href="${urlObj.toString()}" style="color:#2563eb;text-decoration:underline;word-break:break-all;" target="_blank">${url}</a>`
          } catch (e) {
            // If URL is invalid, return as is
            return `<a href="${url}" style="color:#2563eb;text-decoration:underline;word-break:break-all;" target="_blank">${url}</a>`
          }
        }
      )

      // Auto-buttonize common CTAs using the first URL
      const ctaPhrases = ['view more', 'learn more', 'see more']
      const ctaPattern = new RegExp(`(^|\\n)\\s*(?:${ctaPhrases.map(p => p.replace(/ /g, '\\s*')).join('|')})\\s*(?=\\n|$)`, 'gi')
      
      const withViewMoreButton = withPlainLinks.replace(ctaPattern, (match, prefix) => {
        if (!firstUrl) return match
        // Normalize the displayed text to Title Case of the matched CTA
        const normalized = match
          .replace(/^\s+|\s+$/g, '')
          .replace(/^\n/, '')
          .toLowerCase()
          .replace(/\s+/g, ' ')
          .replace(/\b\w/g, (c) => c.toUpperCase())
          
        // Create a URL with the recipient's email as a hash fragment
        const url = new URL(firstUrl)
        url.hash = email // Add recipient's email as hash
        
        return `${prefix}<div style="text-align:center;margin:20px 0;">
          <a href="${url.toString()}" target="_blank" class="button">${normalized}</a>
        </div>`
      })

      // Paragraphize
      const paragraphs = withViewMoreButton
        .split('\n')
        .map((p) => p.trim())
        .filter(Boolean)
        .map((p) => {
          // Avoid wrapping already-inserted button blocks or raw HTML blocks
          if (/^<div[\s>]/i.test(p) || /^<a[\s>]/i.test(p)) return p
          return `<p style="font-size:15px;margin:15px 0;line-height:1.6;">${p}</p>`
        })
        .join('')

      // Single, valid HTML document
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
    <div class="footer">  ${new Date().getFullYear()}.</div>
  </div>
</body>
</html>`
    }

    // Send email to a single recipient
    const sendEmail = async (email: string) => {
      try {
        const personalizedContent = personalizeContent(htmlContent, email)
        const text = toPlainText(personalizedContent)
        const html = formatHtmlContent(personalizedContent, subject, email)

        await transporter.sendMail({
          from: `"${sender.name}" <${sender.email}>`,
          to: email,
          subject,
          text,
          html,
        })

        return { email, status: 'success' as const }
      } catch (error) {
        console.error(`Failed to send email to ${email}:`, error)
        throw error
      }
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
