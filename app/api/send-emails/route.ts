import { NextResponse } from 'next/server'
import nodemailer from 'nodemailer'

export const runtime = 'nodejs' // ensure Node runtime for Nodemailer

type EmailPayload = {
  emails: string[]
  subject: string
  htmlContent: string
  sender: { name: string; email: string }
}

const isTransientSmtpError = (code?: number, response?: string) => {
  // Common transient throttling/storage errors from Google
  if (!code && !response) return false
  if (code && code >= 500) return false // hard failure
  const text = (response || '').toLowerCase()
  return (
    (code && code >= 400 && code < 500) ||
    text.includes('4.7.0') || // rate limit / too many msgs
    text.includes('4.7.1') ||
    text.includes('try again later') ||
    text.includes('temporarily unavailable') ||
    text.includes('resources temporarily unavailable') ||
    text.includes('rate limit') ||
    text.includes('quota exceeded') ||
    text.includes('greylist') ||
    text.includes('timeout')
  )
}

export async function POST(request: Request) {
  const { emails, subject, htmlContent, sender } = (await request.json()) as EmailPayload

  if (!emails?.length) return NextResponse.json({ success: false, message: 'No email addresses provided' }, { status: 400 })
  if (!subject?.trim()) return NextResponse.json({ success: false, message: 'Email subject is required' }, { status: 400 })
  if (!htmlContent?.trim()) return NextResponse.json({ success: false, message: 'Email content is required' }, { status: 400 })
  if (!sender?.email || !sender?.name) return NextResponse.json({ success: false, message: 'Sender information is required' }, { status: 400 })

  const AUTH_USER = process.env.EMAIL_USER
  const AUTH_PASS = process.env.EMAIL_PASS

  if (!AUTH_USER || !AUTH_PASS) {
    return NextResponse.json({ success: false, message: 'SMTP not configured (EMAIL_USER/EMAIL_PASS missing)' }, { status: 500 })
  }

  // IMPORTANT: Gmail + bulk => throttle hard. Use pooled transport.
  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    // Pooling lets Nodemailer reuse a few connections and self-throttle.
    pool: true,
    maxConnections: 2,     // keep very low to avoid Gmail rate alarms
    maxMessages: 15,       // messages per connection before recycling
    rateDelta: 1000,       // window for rateLimit (ms)
    rateLimit: 3,          // ~3 msgs/sec across pool
    auth: { user: AUTH_USER, pass: AUTH_PASS },
  })

  try {
    await transporter.verify()
  } catch (e: any) {
    return NextResponse.json(
      { success: false, message: 'SMTP verification failed', error: e?.message ?? String(e) },
      { status: 500 }
    )
  }

  // Gentle batching (avoid hundreds at once)
  const BATCH_SIZE = 50
  const BATCH_DELAY_MS = 8_000 // pause between batches so Gmail doesn’t flag you

  // Retries for transient 4xx
  const MAX_RETRIES = 3
  const BASE_BACKOFF_MS = 2_000

  const toPlainText = (html: string) =>
    html
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<\/(div|p|br|li|h[1-6])>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim()

  const nameFromEmail = (email: string) => {
    try {
      const local = email.split('@')[0] || ''
      const withoutPlus = local.split('+')[0]
      const parts = withoutPlus.replace(/[^a-zA-Z0-9_.-]/g, ' ').replace(/[_.-]+/g, ' ').trim().split(/\s+/)
      if (!parts.length) return 'there'
      return parts.map(p => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join(' ')
    } catch {
      return 'there'
    }
  }

  const personalizeContent = (content: string, email: string) => {
    const name = nameFromEmail(email)
    return content
      .replace(/\{\{\s*receipetien\s*\}\}/gi, name)
      .replace(/\{\{\s*recipient\s*\}\}/gi, name)
      .replace(/\{\{\s*recipientname\s*\}\}/gi, name)
      .replace(/\{\{\s*name\s*\}\}/gi, name)
  }

  const addEmailHashToLinks = (html: string, email: string) =>
    html.replace(/href=(["'])(https?:\/\/[^"'#\s]+)(#[^"']*)?\1/gi, (_m, quote, url, hash) =>
      hash ? _m : `href=${quote}${url}#${email}${quote}`
    )

  const formatHtmlContent = (content: string, subjectLine: string, email: string) => {
    const trimmed = content.trim()
    if (/^\s*<!doctype html>/i.test(trimmed) || /^\s*<html[^>]*>/i.test(trimmed)) {
      return addEmailHashToLinks(trimmed, email)
    }

    const withMarkdownLinks = trimmed.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, text, url) => {
      let u: URL | null = null
      try { u = new URL(url); if (!u.hash) u.hash = email } catch {}
      if (String(text).startsWith('!btn!')) {
        const btn = String(text).replace('!btn!', '').trim()
        return `<div style="text-align:center;margin:20px 0;"><a href="${(u ?? new URL(url, 'https://dummy.invalid')).toString()}" target="_blank" class="button">${btn}</a></div>`
      }
      return `<a href="${(u ?? new URL(url, 'https://dummy.invalid')).toString()}" style="color:#2563eb;text-decoration:underline;" target="_blank">${text}</a>`
    })

    const firstUrlMatch = withMarkdownLinks.match(/https?:\/\/[^\s<)]+/)
    const firstUrl = firstUrlMatch?.[0]

    const withPlainLinks = withMarkdownLinks.replace(/(https?:\/\/[^\s<"]+)/g, (url) => {
      try {
        const u = new URL(url)
        if (!u.hash) u.hash = email
        return `<a href="${u.toString()}" style="color:#2563eb;text-decoration:underline;word-break:break-all;" target="_blank">${url}</a>`
      } catch {
        return `<a href="${url}" style="color:#2563eb;text-decoration:underline;word-break:break-all;" target="_blank">${url}</a>`
      }
    })

    const ctaPhrases = ['view more', 'learn more', 'see more']
    const ctaPattern = new RegExp(`(^|\\n)\\s*(?:${ctaPhrases.map(p => p.replace(/ /g, '\\s*')).join('|')})\\s*(?=\\n|$)`, 'gi')

    const withViewMoreBtn = withPlainLinks.replace(ctaPattern, (match, prefix) => {
      if (!firstUrl) return match
      const normalized = match.trim().toLowerCase().replace(/\s+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
      const u = new URL(firstUrl)
      u.hash = email
      return `${prefix}<div style="text-align:center;margin:20px 0;"><a href="${u.toString()}" target="_blank" class="button">${normalized}</a></div>`
    })

    const paragraphs = withViewMoreBtn
      .split('\n')
      .map(p => p.trim())
      .filter(Boolean)
      .map(p => (/^<div[\s>]/i.test(p) || /^<a[\s>]/i.test(p)) ? p : `<p style="font-size:15px;margin:15px 0;line-height:1.6;">${p}</p>`)
      .join('')

    return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"><meta http-equiv="Content-Type" content="text/html; charset=utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${subjectLine}</title>
<style>
  body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 20px; background-color: #f8f9fa; }
  .container { max-width: 600px; margin: 0 auto; background: #fff; padding: 30px; border-radius: 8px; box-shadow: 0 2px 5px rgba(0,0,0,0.1); }
  p { font-size: 15px; margin: 15px 0; line-height: 1.6; }
  .button { display: inline-block; background-color: #2563eb; color: #fff !important; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: bold; margin: 20px 0; text-align: center; min-width: 200px; }
  .footer { margin-top: 30px; font-size: 12px; color: #666; border-top: 1px solid #eee; padding-top: 15px; }
  @media only screen and (max-width: 600px) {
    .container { width: 100% !important; padding: 15px !important; }
    .button { display: block !important; margin: 20px auto !important; width: 100%; max-width: 280px; box-sizing: border-box; }
  }
</style>
</head>
<body><div class="container">
  ${paragraphs}
  <div class="footer">${new Date().getFullYear()}.</div>
</div></body></html>`
  }

  // Ensure FROM matches authenticated account or a verified alias
  const fromHeader = `"${sender.name}" <${sender.email}>`
  const fromLooksMismatch = sender.email.toLowerCase() !== AUTH_USER.toLowerCase()

  type Result = { email: string; status: 'success'; responseId?: string } | { email: string; status: 'failed'; error: string }

  const sendOneWithRetry = async (rcpt: string): Promise<Result> => {
    let attempt = 0
    while (attempt <= MAX_RETRIES) {
      try {
        const personalized = personalizeContent(htmlContent, rcpt)
        const html = formatHtmlContent(personalized, subject, rcpt)
        const text = toPlainText(personalized)
        const info = await transporter.sendMail({
          from: fromHeader,
          to: rcpt,
          subject,
          text,
          html,
        })
        // info.accepted/info.rejected available; include messageId
        return { email: rcpt, status: 'success', responseId: info.messageId }
      } catch (err: any) {
        const code: number | undefined = err?.responseCode
        const resp: string | undefined = err?.response
        if (isTransientSmtpError(code, resp) && attempt < MAX_RETRIES) {
          const backoff = BASE_BACKOFF_MS * Math.pow(2, attempt)
          await new Promise(r => setTimeout(r, backoff))
          attempt++
          continue
        }
        return { email: rcpt, status: 'failed', error: err?.message || 'Unknown SMTP error' }
      }
    }
    return { email: rcpt, status: 'failed', error: 'Exceeded retry attempts' }
  }

  const results: Result[] = []
  let successCount = 0
  let failCount = 0

  for (let i = 0; i < emails.length; i += BATCH_SIZE) {
    const batch = emails.slice(i, i + BATCH_SIZE)

    // Send this batch sequentially-ish to respect Gmail’s rate; you can parallelize lightly if needed
    for (const rcpt of batch) {
      const r = await sendOneWithRetry(rcpt)
      results.push(r)
      if (r.status === 'success') successCount++
      else failCount++
    }

    // Pause between batches (unless this was the last)
    if (i + BATCH_SIZE < emails.length) {
      await new Promise(r => setTimeout(r, BATCH_DELAY_MS))
    }
  }

  // Helpful warnings
  const warnings: string[] = []
  if (fromLooksMismatch) {
    warnings.push(
      'The From address does not match the authenticated Gmail account. Use the same Gmail or a verified alias to avoid deliverability issues.'
    )
  }
  if (emails.length > 200) {
    warnings.push(
      'Gmail is not designed for bulk campaigns. Consider moving to an email service provider (Brevo/SendGrid/SES) with proper domain auth and warmup.'
    )
  }

  return NextResponse.json({
    success: true,
    message: `Processed ${emails.length} email(s)`,
    summary: { total: emails.length, success: successCount, failed: failCount },
    warnings,
    results,
  })
}
