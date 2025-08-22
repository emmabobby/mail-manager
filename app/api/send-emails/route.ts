import { type NextRequest, NextResponse } from "next/server"

const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email'
const BATCH_SIZE = 500 // Maximum emails per batch

type EmailPayload = {
  sender: {
    name: string
    email: string
  }
  to: Array<{ email: string }>
  subject: string
  htmlContent: string
  textContent?: string
  headers?: {
    'Content-Type': string
  }
}

export async function POST(request: NextRequest) {
  try {
    const { emails, subject, htmlContent, sender } = await request.json()

    if (!emails || !Array.isArray(emails) || emails.length === 0) {
      return NextResponse.json(
        { error: "No emails provided" },
        { status: 400 }
      )
    }

    if (!subject || !htmlContent || !sender?.name || !sender?.email) {
      return NextResponse.json(
        { error: "Missing required fields: subject, htmlContent, or sender information" },
        { status: 400 }
      )
    }

    const brevoApiKey = process.env.NEXT_PUBLIC_BREVO_API_KEY
    if (!brevoApiKey) {
      console.error('Brevo API key is not configured')
      return NextResponse.json(
        { error: "Email service is not properly configured. Please contact support." },
        { status: 500 }
      )
    }

    console.log('Brevo API Key:', brevoApiKey ? 'Key is set' : 'Key is missing');

    // Process emails in batches of BATCH_SIZE
    const batches = []
    for (let i = 0; i < emails.length; i += BATCH_SIZE) {
      batches.push(emails.slice(i, i + BATCH_SIZE))
    }

    const results = []
    let successCount = 0
    let failCount = 0

    // Process each batch
    for (const [index, batch] of batches.entries()) {
      try {
        // Ensure htmlContent has proper HTML structure if it's just plain text
        const formattedHtmlContent = htmlContent.trim().startsWith('<!DOCTYPE html>') 
          ? htmlContent 
          : `<!DOCTYPE html>
            <html>
              <head>
                <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
                <title>${subject}</title>
              </head>
              <body>
                <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333333;">
                  ${htmlContent.replace(/\n/g, '<br>')}
                </div>
              </body>
            </html>`;

        const payload: EmailPayload = {
          sender: {
            name: sender.name,
            email: sender.email
          },
          to: batch.map(email => ({ email })),
          subject,
          htmlContent: formattedHtmlContent,
          headers: {
            'Content-Type': 'text/html; charset=UTF-8'
          }
        }

        const response = await fetch(BREVO_API_URL, {
          method: 'POST',
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'api-key': brevoApiKey
          },
          body: JSON.stringify(payload)
        })

        if (!response.ok) {
          let errorMessage = 'Unknown error occurred'
          try {
            const errorData = await response.json()
            console.error(`Batch ${index + 1} failed:`, errorData)
            errorMessage = errorData.message || errorData.error || JSON.stringify(errorData)
          } catch (e) {
            console.error(`Failed to parse error response:`, e)
          }
          
          // Special handling for authentication errors
          if (response.status === 401 || response.status === 403) {
            return NextResponse.json(
              { 
                error: "Authentication failed. Please check your Brevo API key.",
                details: errorMessage
              },
              { status: 500 }
            )
          }
          
          failCount += batch.length
          results.push({
            batch: index + 1,
            status: 'failed',
            count: batch.length,
            error: errorMessage
          })
          continue
        }

        successCount += batch.length
        results.push({
          batch: index + 1,
          status: 'success',
          count: batch.length
        })

        // Add a small delay between batches to avoid rate limiting
        if (index < batches.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 500))
        }
      } catch (error) {
        console.error(`Error processing batch ${index + 1}:`, error)
        failCount += batch.length
        results.push({
          batch: index + 1,
          status: 'error',
          count: batch.length,
          error: error instanceof Error ? error.message : 'Unknown error'
        })
      }
    }

    return NextResponse.json({
      success: true,
      message: `Processed ${emails.length} emails in ${batches.length} batch(es)`,
      summary: {
        total: emails.length,
        success: successCount,
        failed: failCount,
        batches: batches.length
      },
      results
    })
  } catch (error) {
    console.error("Error in send-emails route:", error)
    return NextResponse.json(
      { 
        error: "Failed to process email sending request",
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}
