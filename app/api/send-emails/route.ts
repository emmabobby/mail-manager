import { NextResponse } from 'next/server'
import nodemailer from 'nodemailer'
import type { TransportOptions as SMTPTransportOptions } from 'nodemailer'

export const runtime = 'nodejs' 

type EmailPayload = {
  emails: string[]
  subject: string
  htmlContent: string
  sender: { name: string; email: string }
}

const isTransientSmtpError = (code?: number, response?: string) => {
  if (!code && !response) return false
  const text = (response || '').toLowerCase()
  if (code && code >= 400 && code < 500) return true
  return (
    text.includes('4.7.0') ||
    text.includes('4.7.1') ||
    text.includes('try again later') ||
    text.includes('temporarily unavailable') ||
    text.includes('resources temporarily unavailable') ||
    text.includes('rate limit') ||
    text.includes('quota exceeded') ||
    text.includes('greylist') ||
    text.includes('timeout') ||
    text.includes('temporary')
  )
}

export async function POST(request: Request) {
  const { emails, subject, htmlContent, sender } = (await request.json()) as EmailPayload

  if (!emails?.length) return NextResponse.json({ success: false, message: 'No email addresses provided' }, { status: 400 })
  if (!subject?.trim()) return NextResponse.json({ success: false, message: 'Email subject is required' }, { status: 400 })
  if (!htmlContent?.trim()) return NextResponse.json({ success: false, message: 'Email content is required' }, { status: 400 })
  if (!sender?.email || !sender?.name) return NextResponse.json({ success: false, message: 'Sender information is required' }, { status: 400 })


  const AUTH_USER = process.env.SMTP_USER || process.env.SMTP_USER
  const AUTH_PASS = process.env.SMTP_PASS || process.env.SMTP_PASS
  if (!AUTH_USER || !AUTH_PASS) {
    return NextResponse.json({ success: false, message: 'SMTP not configured (EMAIL_USER/EMAIL_PASS missing)' }, { status: 500 })
  }

  const HOST = process.env.SMTP_HOST || 'mail.privateemail.com'
  const PORT = Number(process.env.SMTP_PORT || 465)
  const SECURE = PORT === 465

  console.log('SMTP host:', process.env.SMTP_HOST, 'port:', process.env.SMTP_PORT, 'user:', process.env.SMTP_USER?.toLowerCase());
  console.log('From:', `"${sender.name}" <${sender.email}>`)


  const transporter = nodemailer.createTransport({
    host: HOST,
    port: PORT,
    secure: SECURE,
    auth: {
      user: AUTH_USER,
      pass: AUTH_PASS
    },
    // Debug mode
    logger: true,
    debug: true,
    // Disable pooling for now
    pool: false,
    // Timeouts
    connectionTimeout: 30_000,
    greetingTimeout: 20_000,
    socketTimeout: 60_000,
    // Disable some authentication methods that might cause issues
    authMethod: 'PLAIN',
    // Disable TLS for now to rule out certificate issues
    ignoreTLS: false,
    requireTLS: true,
    tls: {
      // Do not fail on invalid certs
      rejectUnauthorized: false
    }
  } as SMTPTransportOptions)

  // Test SMTP connection
  try {
    console.log('Verifying SMTP connection...')
    const verify = await transporter.verify()
    console.log('SMTP connection verified:', verify)
  } catch (e: any) {
    const errorMessage = e?.message ?? String(e)
    console.error('SMTP verification failed:', errorMessage)
    console.error('Error details:', e)
    return NextResponse.json(
      { 
        success: false, 
        message: 'SMTP verification failed', 
        error: errorMessage,
        details: {
          host: HOST,
          port: PORT,
          secure: SECURE,
          user: AUTH_USER ? `${AUTH_USER.substring(0, 3)}...` : 'undefined',
          authMethod: 'PLAIN'
        }
      },
      { status: 500 }
    )
  }

  const BATCH_SIZE = 40            // << you asked for "like 30 mails" per batch
  const CONCURRENCY = 5            // send up to 5 at a time inside a batch
  const BATCH_DELAY_MS = 3_000     // pause between batches if there are more than 30
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
    const ctaPattern = new RegExp(`(^|\\n)\\s*(?:${ctaPhrases.map(p => p.replace(/ /g, '\\s*')).join('|')})\\s*(?=\\n|$)`,'gi')

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

    const currentYear = new Date().getFullYear()
    const domain = sender.email.split('@')[1] || 'yourdomain.com'
    const physicalAddress = process.env.COMPANY_ADDRESS || 'Your Company Address, City, Country'

    return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="format-detection" content="telephone=no" />
  <meta name="x-apple-disable-message-reformatting" />
  <title>${subjectLine}</title>
  <!--[if mso]>
  <style type="text/css">
    body, table, td {font-family: Arial, sans-serif !important;}
  </style>
  <![endif]-->
  <style type="text/css">
    /* Base styles */
    body, #bodyTable, #bodyCell { height: 100% !important; margin: 0; padding: 0; width: 100% !important; }
    body { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; margin: 0; padding: 0; }
    img { -ms-interpolation-mode: bicubic; border: 0; height: auto; line-height: 100%; outline: none; text-decoration: none; }
    table { border-collapse: collapse; mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
    #outlook a { padding: 0; }
    .ReadMsgBody { width: 100%; } .ExternalClass { width: 100%; }
    .ExternalClass, .ExternalClass p, .ExternalClass span, .ExternalClass font, .ExternalClass td, .ExternalClass div { line-height: 100%; }
    
    /* Responsive styles */
    @media only screen and (max-width: 600px) {
      .email-container { width: 100% !important; padding: 15px !important; }
      .button { display: block !important; width: 100% !important; max-width: 280px !important; margin: 20px auto !important; }
      .mobile-padding { padding-left: 15px !important; padding-right: 15px !important; }
      .mobile-stack { display: block !important; width: 100% !important; }
    }
    
    /* Custom styles */
    .email-container { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 8px; overflow: hidden; }
    .email-content { padding: 30px; }
    .email-footer { font-size: 12px; color: #666666; text-align: center; padding: 20px; border-top: 1px solid #eeeeee; }
    .button { background-color: #2563eb; color: #ffffff !important; text-decoration: none; padding: 12px 24px; border-radius: 6px; display: inline-block; font-weight: bold; }
    p { margin: 15px 0; line-height: 1.6; font-size: 15px; color: #333333; }
    h1, h2, h3 { color: #222222; margin-top: 0; }
  </style>
</head>
<body style="margin: 0; padding: 0; background-color: #f8f9fa; font-family: Arial, sans-serif; -webkit-font-smoothing: antialiased; -webkit-text-size-adjust: none; width: 100% !important; height: 100% !important;">
  <table border="0" cellpadding="0" cellspacing="0" width="100%" bgcolor="#f8f9fa">
    <tr>
      <td align="center" valign="top">
        <table class="email-container" border="0" cellpadding="0" cellspacing="0" width="600" bgcolor="#ffffff">
          <tr>
            <td align="left" valign="top" class="email-content" style="padding: 30px;">
              <!-- Email Content -->
              ${paragraphs}
              
              <!-- Email Footer -->
              <table border="0" cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td style="padding: 20px 0 0 0; border-top: 1px solid #eeeeee;">
                    <p style="font-size: 12px; color: #666666; margin: 0; text-align: center;">
                      &copy; ${currentYear} ${sender.name}. All rights reserved.<br />
                      ${physicalAddress}<br />
                      <a href="https://${domain}" style="color: #2563eb; text-decoration: none;">${domain}</a> | 
                      <a href="mailto:unsubscribe@${domain}" style="color: #2563eb; text-decoration: none;">Unsubscribe</a> | 
                      <a href="https://${domain}/preferences" style="color: #2563eb; text-decoration: none;">Update Preferences</a>
                    </p>
                    <p style="font-size: 10px; color: #999999; margin: 10px 0 0 0; text-align: center; line-height: 1.4;">
                      You're receiving this email because you signed up for updates from ${sender.name}.<br />
                      If you'd prefer not to receive future emails, you may <a href="https://${domain}/unsubscribe?email=${encodeURIComponent(email)}" style="color: #2563eb; text-decoration: none;">unsubscribe here</a>.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
  }

  // Ensure FROM generally matches the authenticated mailbox for best deliverability
   // Use authenticated mailbox in visible From to avoid spam/JFE040011
  const displayName = sender.name || 'ServiceConect'
  const fromHeader = `"${displayName}" <${AUTH_USER}>`

  type Result =
    | { email: string; status: 'success'; responseId?: string }
    | { email: string; status: 'failed'; error: string; code?: string; response?: string; responseCode?: number }

  const sendOneWithRetry = async (rcpt: string): Promise<Result> => {
    let attempt = 0
    while (attempt <= MAX_RETRIES) {
      try {
        const personalized = personalizeContent(htmlContent, rcpt)
        const html = formatHtmlContent(personalized, subject, rcpt)
        const text = toPlainText(personalized)
        const domain = sender.email.split('@')[1] || 'yourdomain.com'
        const messageId = `<${Date.now()}.${Math.random().toString(36).substring(2)}@${domain}>`
        
        console.log(`Sending email to: ${rcpt}`)
        const mailOptions = {
          from: fromHeader,
          to: rcpt,
          subject,
          text,
          html,
          // Important headers for deliverability
          headers: {
            'Message-ID': messageId,
            'X-Auto-Response-Suppress': 'OOF, AutoReply',
            'Precedence': 'bulk',
            'Auto-Submitted': 'auto-generated',
            'List-Unsubscribe': `<mailto:unsubscribe@${domain}>, <https://${domain}/unsubscribe?email=${encodeURIComponent(rcpt)}>`,
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
            'Feedback-ID': `campaign:${Date.now()}:${domain}`,
            'X-Entity-Ref-ID': messageId,
            'X-Report-Abuse': `Please report abuse by forwarding this email to abuse@${domain}`
          },
          // Envelope must match your authenticated domain
          envelope: { 
            from: AUTH_USER, 
            to: rcpt 
          },
          // DKIM signing would be handled by your SMTP server or you can add it here
          dkim: process.env.DKIM_PRIVATE_KEY ? {
            domainName: domain,
            keySelector: 'default',
            privateKey: process.env.DKIM_PRIVATE_KEY
          } : undefined
        }
        
        console.log(`Mail options prepared for ${rcpt}`, {
          from: fromHeader,
          to: rcpt,
          subject,
          textLength: text?.length,
          htmlLength: html?.length,
          hasDkim: !!process.env.DKIM_PRIVATE_KEY
        })
        
        const info = await transporter.sendMail(mailOptions)
        console.log(`Email sent to ${rcpt}:`, info.response)
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
        const errorMessage = err?.message || 'Unknown SMTP error'
        console.error(`Failed to send email to ${rcpt}:`, errorMessage)
        console.error('Error details:', err)
        return { 
          email: rcpt, 
          status: 'failed', 
          error: errorMessage,
          code: err?.code,
          response: err?.response,
          responseCode: err?.responseCode
        }
      }
    }
    return { email: rcpt, status: 'failed', error: 'Exceeded retry attempts' }
  }

  // Simple worker pool for intra-batch concurrency
  const results: Result[] = []
  let successCount = 0
  let failCount = 0

  const runBatch = async (batch: string[]) => {
    const queue = [...batch]
    const worker = async () => {
      while (queue.length) {
        const rcpt = queue.shift()!
        const r = await sendOneWithRetry(rcpt)
        results.push(r)
        if (r.status === 'success') successCount++
        else failCount++
      }
    }
    const workers = Array.from({ length: Math.min(CONCURRENCY, batch.length) }, () => worker())
    await Promise.all(workers)
  }

  for (let i = 0; i < emails.length; i += BATCH_SIZE) {
    const batch = emails.slice(i, i + BATCH_SIZE)
    await runBatch(batch)
    if (i + BATCH_SIZE < emails.length) {
      await new Promise(r => setTimeout(r, BATCH_DELAY_MS))
    }
  }

  // const warnings: string[] = []
  // if (fromLooksMismatch) {
  //   warnings.push(
  //     'The From address does not match the authenticated SMTP account. Use the same mailbox (or set a verified alias) for best deliverability.'
  //   )
  // }

  return NextResponse.json({
    success: true,
    message: `Processed ${emails.length} email(s)`,
    summary: { total: emails.length, success: successCount, failed: failCount },
    results,
  })
}
